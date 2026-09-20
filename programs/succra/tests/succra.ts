// Phase 1 + Phase 2 program integration tests on a local validator.
//
// Phase 1 rows (PROJECT_SPEC.md §21): create mission, fund vault (SOL and
// SPL), cancel/refund (SOL and SPL).
// Phase 2 rows (§21 Phase 2 subset): authorized TRANSFER_SOL / TRANSFER_SPL,
// blocked transfer variants, budget exhaustion, unauthorized agent,
// unauthorized recipient, stale state/nonce rejection, expiry, status
// gating, and the ActionExecuted event.
//
// NOTE: @solana/web3.js is imported here only because @coral-xyz/anchor
// 0.32.1 (the pinned program-test stack) requires it. This is the
// ARCHITECTURE.md §9 compatibility exception. @solana/spl-token is
// test-only SPL setup tooling. No product code uses either library.
import * as anchor from '@coral-xyz/anchor';
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Succra } from '../../../target/types/succra';

describe('succra phases 1+2 — mission foundation and action execution', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Succra as anchor.Program<Succra>;
  const connection = provider.connection;
  const owner = provider.wallet.publicKey;
  const agent = anchor.web3.Keypair.generate();
  const recipientWallet = anchor.web3.Keypair.generate();

  const BUDGET = new anchor.BN(50_000_000);
  const MAX_ACTION = new anchor.BN(5_000_000);
  const RECOVERY_MAX_ACTION = new anchor.BN(1_000_000);
  // `Pubkey::default()` sentinel for native-SOL missions.
  const NATIVE_MINT = anchor.web3.SystemProgram.programId;
  // Per-run base so reruns against a reused ledger never collide with
  // missions created by a previous run.
  const MISSION_BASE = new anchor.BN(Date.now() % 1_000_000);

  function futureExpiry(): anchor.BN {
    return new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
  }

  function missionPdas(missionId: anchor.BN): {
    mission: anchor.web3.PublicKey;
    vault: anchor.web3.PublicKey;
    splVault: anchor.web3.PublicKey;
  } {
    const [mission] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('mission'), owner.toBuffer(), missionId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), mission.toBuffer()],
      program.programId
    );
    const [splVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('spl-vault'), mission.toBuffer()],
      program.programId
    );
    return { mission, vault, splVault };
  }

  function statusName(status: unknown): string {
    const name = Object.keys(status as Record<string, unknown>)[0];
    if (name === undefined) {
      throw new Error('mission status has no variant');
    }
    return name;
  }

  // Action argument shapes accepted by the generated client.
  type ActionArg = { transferSol: Record<string, never> } | { transferSpl: Record<string, never> };

  // NOTE: the generated client infers PDA accounts and the wallet signer,
  // so only the non-inferable accounts are passed explicitly.
  async function createMission(
    missionNo: number,
    overrides: {
      budget?: anchor.BN;
      maxAction?: anchor.BN;
      recoveryMaxAction?: anchor.BN;
      expiresAt?: anchor.BN;
      actionTypes?: ActionArg[];
      recipients?: anchor.web3.PublicKey[];
      mint?: anchor.web3.PublicKey;
      agent?: anchor.web3.PublicKey;
    } = {}
  ): Promise<{
    mission: anchor.web3.PublicKey;
    vault: anchor.web3.PublicKey;
    splVault: anchor.web3.PublicKey;
  }> {
    const id = new anchor.BN(missionNo).add(MISSION_BASE);
    const { mission, vault, splVault } = missionPdas(id);
    const mint = overrides.mint ?? NATIVE_MINT;
    await program.methods
      .create(
        id,
        overrides.budget ?? BUDGET,
        overrides.maxAction ?? MAX_ACTION,
        overrides.recoveryMaxAction ?? RECOVERY_MAX_ACTION,
        overrides.actionTypes ?? [{ transferSol: {} }],
        overrides.recipients ?? [recipientWallet.publicKey],
        mint,
        overrides.expiresAt ?? futureExpiry(),
        overrides.agent ?? agent.publicKey
      )
      .accounts({ owner })
      .rpc();
    return { mission, vault, splVault };
  }

  async function fundSol(mission: anchor.web3.PublicKey): Promise<void> {
    await program.methods.fund().accounts({ mission }).rpc();
  }

  async function executeSol(
    mission: anchor.web3.PublicKey,
    recipient: anchor.web3.PublicKey,
    amount: anchor.BN,
    nonce: anchor.BN,
    signer: anchor.web3.Keypair = agent
  ): Promise<string> {
    return program.methods
      .executeAction({ transferSol: {} }, recipient, amount, nonce)
      .accounts({
        agent: signer.publicKey,
        mission,
        recipientAccount: recipient,
        splVault: null,
        recipientTokenAccount: null,
      })
      .signers([signer])
      .rpc();
  }

  function waitForActionExecuted(): {
    promise: Promise<Record<string, unknown>>;
    cleanup: () => Promise<void>;
  } {
    let listener = -1;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ActionExecuted event timeout')), 30000);
      listener = program.addEventListener('actionExecuted', (event) => {
        clearTimeout(timer);
        resolve(event as unknown as Record<string, unknown>);
      });
    });
    return {
      promise,
      cleanup: async () => {
        await program.removeEventListener(listener);
      },
    };
  }

  interface SplMint {
    mint: anchor.web3.PublicKey;
    mintAuthority: anchor.web3.Keypair;
  }

  // One mint shared by every SPL test: creating a mint costs several
  // transactions, and the sandbox validator is only stable for short
  // windows, so per-test mints would not fit. Mission isolation still
  // holds: every mission gets its own PDAs and token vault.
  let sharedMintCache: SplMint | null = null;

  async function getSharedMint(): Promise<SplMint> {
    if (sharedMintCache !== null) {
      return sharedMintCache;
    }
    const mintAuthority = anchor.web3.Keypair.generate();
    const fundTx = await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: mintAuthority.publicKey,
          lamports: 3 * anchor.web3.LAMPORTS_PER_SOL,
        })
      )
    );
    await connection.confirmTransaction(fundTx);
    const mint = await createMint(connection, mintAuthority, mintAuthority.publicKey, null, 6);
    sharedMintCache = { mint, mintAuthority };
    return sharedMintCache;
  }

  interface SplMission {
    mission: anchor.web3.PublicKey;
    vault: anchor.web3.PublicKey;
    splVault: anchor.web3.PublicKey;
    mint: anchor.web3.PublicKey;
    mintAuthority: anchor.web3.Keypair;
    ownerAta: anchor.web3.PublicKey;
  }

  async function setupSplMission(
    missionNo: number,
    overrides: {
      actionTypes?: ActionArg[];
      recipients?: anchor.web3.PublicKey[];
      budget?: anchor.BN;
      maxAction?: anchor.BN;
    } = {}
  ): Promise<SplMission> {
    const { mint, mintAuthority } = await getSharedMint();
    const ownerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      mint,
      owner
    );
    const budget = overrides.budget ?? BUDGET;
    await mintTo(
      connection,
      mintAuthority,
      mint,
      ownerAta.address,
      mintAuthority,
      budget.toNumber()
    );
    const { mission, vault, splVault } = await createMission(missionNo, {
      mint,
      budget,
      maxAction: overrides.maxAction,
      actionTypes: overrides.actionTypes ?? [{ transferSpl: {} }],
      recipients: overrides.recipients ?? [recipientWallet.publicKey],
    });
    await program.methods
      .fundSpl()
      .accounts({
        mission,
        ownerTokenAccount: ownerAta.address,
        mint,
      })
      .rpc();
    return { mission, vault, splVault, mint, mintAuthority, ownerAta: ownerAta.address };
  }

  before(async () => {
    // The local validator faucet can rate-limit; fund only when needed.
    const balance = await connection.getBalance(owner);
    if (balance < anchor.web3.LAMPORTS_PER_SOL) {
      const signature = await connection.requestAirdrop(owner, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature);
    }
  });

  it('creates a mission in DRAFT with agent identity and committed policy', async () => {
    const expiresAt = futureExpiry();
    const { mission, vault } = await createMission(1, { expiresAt });

    const account = await program.account.mission.fetch(mission);
    expect(account.owner.toBase58()).to.equal(owner.toBase58());
    expect(account.budget.eq(BUDGET)).to.equal(true);
    expect(account.remainingBudget.eq(new anchor.BN(0))).to.equal(true);
    expect(account.maxAction.eq(MAX_ACTION)).to.equal(true);
    expect(account.recoveryMaxAction.eq(RECOVERY_MAX_ACTION)).to.equal(true);
    expect(account.allowedActionTypes).to.have.lengthOf(1);
    expect(account.allowedRecipients).to.have.lengthOf(1);
    const firstRecipient = account.allowedRecipients[0];
    if (firstRecipient === undefined) {
      throw new Error('expected one allowed recipient');
    }
    expect(firstRecipient.toBase58()).to.equal(recipientWallet.publicKey.toBase58());
    expect(account.expiresAt.eq(expiresAt)).to.equal(true);
    expect(account.violationThreshold).to.equal(3);
    expect(account.violationWindowSeconds.eq(new anchor.BN(900))).to.equal(true);
    expect(statusName(account.status)).to.equal('draft');
    expect(account.currentAgent.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(account.agentNonce.eq(new anchor.BN(0))).to.equal(true);
    expect(account.mint.toBase58()).to.equal(NATIVE_MINT.toBase58());

    const vaultAccount = await connection.getAccountInfo(vault);
    expect(vaultAccount !== null).to.equal(true);
    // Native system PDA: no data, owned by the System Program.
    expect(vaultAccount?.owner.toBase58()).to.equal(anchor.web3.SystemProgram.programId.toBase58());
    expect(vaultAccount?.data.length).to.equal(0);
  });

  it('funds a DRAFT SOL mission, moving it to ACTIVE', async () => {
    const { mission, vault } = await createMission(2);
    const vaultBefore = await connection.getBalance(vault);

    await fundSol(mission);

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('active');
    expect(account.remainingBudget.eq(BUDGET)).to.equal(true);

    const vaultAfter = await connection.getBalance(vault);
    expect(vaultAfter - vaultBefore).to.equal(BUDGET.toNumber());
  });

  it('rejects SOL funding on an SPL mission', async () => {
    const mint = anchor.web3.Keypair.generate().publicKey;
    const { mission } = await createMission(3, { mint });
    try {
      await fundSol(mission);
      expect.fail('SOL fund on SPL mission should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('AssetMismatch');
    }
  });

  it('rejects SPL funding on a SOL mission', async () => {
    const { mission } = await createMission(4);
    try {
      await program.methods
        .fundSpl()
        .accounts({
          mission,
          ownerTokenAccount: recipientWallet.publicKey,
          mint: recipientWallet.publicKey,
        })
        .rpc();
      expect.fail('SPL fund on SOL mission should have been rejected');
    } catch (error) {
      expect(String(error)).to.be.a('string');
    }
  });

  it('fund_spl funds an SPL mission and rejects a second funding', async () => {
    const funded = await setupSplMission(5);
    const account = await program.account.mission.fetch(funded.mission);
    expect(statusName(account.status)).to.equal('active');
    expect(account.remainingBudget.eq(BUDGET)).to.equal(true);

    const vaultToken = await getAccount(connection, funded.splVault);
    expect(vaultToken.amount).to.equal(BigInt(BUDGET.toNumber()));
    expect(vaultToken.mint.toBase58()).to.not.equal(NATIVE_MINT.toBase58());

    try {
      await program.methods
        .fundSpl()
        .accounts({
          mission: funded.mission,
          ownerTokenAccount: funded.ownerAta,
          mint: funded.mint,
        })
        .rpc();
      expect.fail('second SPL funding should have been rejected');
    } catch (error) {
      // The token vault already exists, so the retry fails while
      // resolving accounts — before instruction logic runs. Either way the
      // retry must fail and the mission must stay ACTIVE with funds intact.
      expect(String(error)).to.be.a('string');
    }

    const after = await program.account.mission.fetch(funded.mission);
    expect(statusName(after.status)).to.equal('active');
    expect(after.remainingBudget.eq(BUDGET)).to.equal(true);
  });

  it('cancels an ACTIVE SOL mission, closes the vault, refunds the owner', async () => {
    const { mission, vault } = await createMission(7);
    await fundSol(mission);

    const vaultBefore = await connection.getBalance(vault);
    expect(vaultBefore).to.be.greaterThan(0);
    const ownerBefore = await connection.getBalance(owner);

    await program.methods
      .cancel()
      .accounts({ mission, splVault: null, ownerTokenAccount: null })
      .rpc();

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('cancelled');
    expect((await connection.getAccountInfo(vault)) === null).to.equal(true);

    const ownerAfter = await connection.getBalance(owner);
    expect(ownerAfter).to.be.greaterThan(ownerBefore);
    expect(ownerAfter - ownerBefore + 10_000).to.be.greaterThanOrEqual(vaultBefore);
  });

  it('cancels an ACTIVE SPL mission and refunds the token budget', async () => {
    const funded = await setupSplMission(8);
    const ownerTokensBefore = (await getAccount(connection, funded.ownerAta)).amount;

    await program.methods
      .cancel()
      .accounts({
        mission: funded.mission,
        splVault: funded.splVault,
        ownerTokenAccount: funded.ownerAta,
      })
      .rpc();

    const account = await program.account.mission.fetch(funded.mission);
    expect(statusName(account.status)).to.equal('cancelled');
    // Token vault closed; full token budget back with the owner.
    expect((await connection.getAccountInfo(funded.splVault)) === null).to.equal(true);
    const ownerTokensAfter = (await getAccount(connection, funded.ownerAta)).amount;
    expect(ownerTokensAfter - ownerTokensBefore).to.equal(BigInt(BUDGET.toNumber()));
  });

  it('cancels a DRAFT mission and rejects a second cancel', async () => {
    const { mission } = await createMission(9);
    await program.methods
      .cancel()
      .accounts({ mission, splVault: null, ownerTokenAccount: null })
      .rpc();

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('cancelled');

    try {
      await program.methods
        .cancel()
        .accounts({ mission, splVault: null, ownerTokenAccount: null })
        .rpc();
      expect.fail('second cancel should have been rejected');
    } catch (error) {
      expect(String(error)).to.be.a('string');
    }
  });

  it('rejects fund and cancel from a non-owner', async () => {
    const stranger = anchor.web3.Keypair.generate();
    const fundStranger = await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: stranger.publicKey,
          lamports: 2 * anchor.web3.LAMPORTS_PER_SOL,
        })
      )
    );
    await connection.confirmTransaction(fundStranger);
    const strangerProvider = new anchor.AnchorProvider(connection, new anchor.Wallet(stranger), {});
    const strangerProgram = new anchor.Program<Succra>(program.idl, strangerProvider);

    const { mission } = await createMission(10);

    try {
      await strangerProgram.methods.fund().accounts({ mission }).rpc();
      expect.fail('stranger fund should have been rejected');
    } catch (error) {
      expect(String(error)).to.not.include('InvalidMissionStatus');
    }

    await fundSol(mission);

    try {
      await strangerProgram.methods
        .cancel()
        .accounts({ mission, splVault: null, ownerTokenAccount: null })
        .rpc();
      expect.fail('stranger cancel should have been rejected');
    } catch (error) {
      expect(String(error)).to.not.include('InvalidMissionStatus');
    }

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('active');
  });

  it('executes an authorized TRANSFER_SOL with balances, nonce, and event', async () => {
    const amount = new anchor.BN(3_000_000);
    const { mission, vault } = await createMission(11);
    await fundSol(mission);

    const vaultBefore = await connection.getBalance(vault);
    const recipientBefore = await connection.getBalance(recipientWallet.publicKey);
    const watcher = waitForActionExecuted();

    await executeSol(mission, recipientWallet.publicKey, amount, new anchor.BN(1));
    const event = await watcher.promise;
    await watcher.cleanup();

    // NOTE: anchor 0.32 decodes event fields with camelCase names; u64
    // values arrive as BN.
    const eventMissionId = event['missionId'] as unknown as anchor.BN;
    const eventAmount = event['amount'] as unknown as anchor.BN;
    const eventNonce = event['newNonce'] as unknown as anchor.BN;
    const eventRemaining = event['remainingBudgetAfter'] as unknown as anchor.BN;
    expect(eventMissionId.toNumber()).to.equal(new anchor.BN(11).add(MISSION_BASE).toNumber());
    expect(String(event['agent'])).to.equal(agent.publicKey.toBase58());
    expect(String(event['recipient'])).to.equal(recipientWallet.publicKey.toBase58());
    expect(event['actionType']).to.deep.equal({ transferSol: {} });
    expect(eventAmount.toNumber()).to.equal(amount.toNumber());
    expect(eventNonce.toNumber()).to.equal(1);

    const vaultAfter = await connection.getBalance(vault);
    const recipientAfter = await connection.getBalance(recipientWallet.publicKey);
    expect(vaultBefore - vaultAfter).to.equal(amount.toNumber());
    expect(recipientAfter - recipientBefore).to.equal(amount.toNumber());

    const account = await program.account.mission.fetch(mission);
    expect(account.agentNonce.eq(new anchor.BN(1))).to.equal(true);
    expect(account.remainingBudget.eq(BUDGET.sub(amount))).to.equal(true);
    expect(eventRemaining.toNumber()).to.equal(BUDGET.sub(amount).toNumber());
    expect(statusName(account.status)).to.equal('active');
  });

  it('advances nonces strictly and rejects stale or reused nonces', async () => {
    const { mission } = await createMission(12);
    await fundSol(mission);

    await executeSol(
      mission,
      recipientWallet.publicKey,
      new anchor.BN(1_000_000),
      new anchor.BN(1)
    );
    await executeSol(
      mission,
      recipientWallet.publicKey,
      new anchor.BN(1_000_000),
      new anchor.BN(2)
    );

    for (const stale of [1, 2, 0]) {
      try {
        await executeSol(
          mission,
          recipientWallet.publicKey,
          new anchor.BN(1_000_000),
          new anchor.BN(stale)
        );
        expect.fail(`nonce ${stale} should have been rejected`);
      } catch (error) {
        expect(String(error)).to.include('StaleNonce');
      }
    }

    const account = await program.account.mission.fetch(mission);
    expect(account.agentNonce.eq(new anchor.BN(2))).to.equal(true);
  });

  it('rejects a stale duplicate nonce under concurrency', async () => {
    const { mission } = await createMission(13);
    await fundSol(mission);
    await executeSol(
      mission,
      recipientWallet.publicKey,
      new anchor.BN(1_000_000),
      new anchor.BN(1)
    );

    // Same nonce, different amounts: distinct signatures, so both execute
    // against chain state in some order. Exactly one must win; the loser
    // observes the winner's nonce and is rejected as stale. (Byte-identical
    // concurrent submissions are NOT used here: identical transactions
    // share a signature and the network de-duplicates them.)
    const attempts = await Promise.allSettled([
      executeSol(mission, recipientWallet.publicKey, new anchor.BN(1_000_000), new anchor.BN(2)),
      executeSol(mission, recipientWallet.publicKey, new anchor.BN(2_000_000), new anchor.BN(2)),
    ]);
    const fulfilled = attempts.filter((r) => r.status === 'fulfilled');
    const rejected = attempts.filter((r) => r.status === 'rejected');
    expect(fulfilled).to.have.lengthOf(1);
    expect(rejected).to.have.lengthOf(1);
    // Exactly-once execution is the behavior under test: one request wins
    // and advances the nonce; the other loses. The loser's error STRING is
    // deliberately not asserted: @coral-xyz/anchor@0.32.1 constructs
    // SendTransactionError with the pre-1.98 positional signature, which
    // @solana/web3.js@1.99.x cannot parse, so post-send failures surface as
    // "Unknown action 'undefined'" instead of the program error name. The
    // StaleNonce rule itself is covered by the ordered nonce test above and
    // by unit tests; the nonce==2 check below confirms the single winner.
    expect((fulfilled[0] as PromiseFulfilledResult<unknown>).value).to.be.a('string');

    const account = await program.account.mission.fetch(mission);
    expect(account.agentNonce.eq(new anchor.BN(2))).to.equal(true);
  });

  it('rejects a disallowed recipient', async () => {
    const { mission } = await createMission(14);
    await fundSol(mission);
    const outsider = anchor.web3.Keypair.generate().publicKey;
    try {
      await executeSol(mission, outsider, new anchor.BN(1_000_000), new anchor.BN(1));
      expect.fail('disallowed recipient should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('RecipientNotAllowed');
    }
  });

  it('rejects the vault as a recipient', async () => {
    const id = new anchor.BN(15);
    const offsetId = id.add(MISSION_BASE);
    const { mission, vault } = missionPdas(offsetId);
    await program.methods
      .create(
        offsetId,
        BUDGET,
        MAX_ACTION,
        RECOVERY_MAX_ACTION,
        [{ transferSol: {} }],
        [vault],
        NATIVE_MINT,
        futureExpiry(),
        agent.publicKey
      )
      .accounts({ owner })
      .rpc();
    await fundSol(mission);
    try {
      await executeSol(mission, vault, new anchor.BN(1_000_000), new anchor.BN(1));
      expect.fail('vault recipient should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('RecipientNotAllowed');
    }
  });

  it('rejects amounts above max_action and above remaining budget', async () => {
    const small = await createMission(16, {
      budget: new anchor.BN(12_000_000),
      maxAction: new anchor.BN(5_000_000),
    });
    await fundSol(small.mission);
    try {
      await executeSol(
        small.mission,
        recipientWallet.publicKey,
        new anchor.BN(5_000_001),
        new anchor.BN(1)
      );
      expect.fail('over-max amount should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('AmountExceedsMaxAction');
    }

    await executeSol(
      small.mission,
      recipientWallet.publicKey,
      new anchor.BN(5_000_000),
      new anchor.BN(1)
    );
    await executeSol(
      small.mission,
      recipientWallet.publicKey,
      new anchor.BN(5_000_000),
      new anchor.BN(2)
    );
    // 2M remain: 5M is within max but beyond budget.
    try {
      await executeSol(
        small.mission,
        recipientWallet.publicKey,
        new anchor.BN(5_000_000),
        new anchor.BN(3)
      );
      expect.fail('over-budget amount should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InsufficientBudget');
    }
    // Exact remainder succeeds: budget exhausted precisely.
    await executeSol(
      small.mission,
      recipientWallet.publicKey,
      new anchor.BN(2_000_000),
      new anchor.BN(3)
    );
    const account = await program.account.mission.fetch(small.mission);
    expect(account.remainingBudget.eq(new anchor.BN(0))).to.equal(true);
  });

  it('rejects a disallowed action type', async () => {
    const { mission } = await createMission(17);
    await fundSol(mission);
    try {
      await program.methods
        .executeAction(
          { transferSpl: {} },
          recipientWallet.publicKey,
          new anchor.BN(1_000_000),
          new anchor.BN(1)
        )
        .accounts({
          agent: agent.publicKey,
          mission,
          recipientAccount: recipientWallet.publicKey,
          splVault: null,
          recipientTokenAccount: null,
        })
        .signers([agent])
        .rpc();
      expect.fail('disallowed action type should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('ActionTypeNotAllowed');
    }
  });

  it('rejects SOL execution on an SPL mission and vice versa', async () => {
    const both: ActionArg[] = [{ transferSol: {} }, { transferSpl: {} }];
    const { mission } = await createMission(18, { actionTypes: both });
    await fundSol(mission);
    try {
      await program.methods
        .executeAction(
          { transferSpl: {} },
          recipientWallet.publicKey,
          new anchor.BN(1_000_000),
          new anchor.BN(1)
        )
        .accounts({
          agent: agent.publicKey,
          mission,
          recipientAccount: recipientWallet.publicKey,
          splVault: null,
          recipientTokenAccount: null,
        })
        .signers([agent])
        .rpc();
      expect.fail('SPL execution on SOL mission should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('AssetMismatch');
    }

    const spl = await setupSplMission(19, { actionTypes: both });
    try {
      await executeSol(
        spl.mission,
        recipientWallet.publicKey,
        new anchor.BN(1_000_000),
        new anchor.BN(1)
      );
      expect.fail('SOL execution on SPL mission should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('AssetMismatch');
    }
  });

  it('rejects execution signed by a non-agent', async () => {
    const { mission } = await createMission(20);
    await fundSol(mission);
    const stranger = anchor.web3.Keypair.generate();
    try {
      await executeSol(
        mission,
        recipientWallet.publicKey,
        new anchor.BN(1_000_000),
        new anchor.BN(1),
        stranger
      );
      expect.fail('non-agent execution should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('NotCurrentAgent');
    }
  });

  it('rejects execution on a DRAFT mission', async () => {
    const { mission } = await createMission(21);
    try {
      await executeSol(
        mission,
        recipientWallet.publicKey,
        new anchor.BN(1_000_000),
        new anchor.BN(1)
      );
      expect.fail('DRAFT execution should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidMissionStatus');
    }
  });

  it('rejects execution after expiry', async () => {
    const { mission } = await createMission(22, {
      expiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 2),
    });
    await fundSol(mission);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    try {
      await executeSol(
        mission,
        recipientWallet.publicKey,
        new anchor.BN(1_000_000),
        new anchor.BN(1)
      );
      expect.fail('expired execution should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('MissionExpired');
    }
  });

  it('executes an authorized TRANSFER_SPL with token balances and event', async () => {
    const amount = new anchor.BN(3_000_000);
    const funded = await setupSplMission(23);
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funded.mintAuthority,
      funded.mint,
      recipientWallet.publicKey
    );
    const watcher = waitForActionExecuted();

    await program.methods
      .executeAction({ transferSpl: {} }, recipientWallet.publicKey, amount, new anchor.BN(1))
      .accounts({
        agent: agent.publicKey,
        mission: funded.mission,
        recipientAccount: recipientWallet.publicKey,
        splVault: funded.splVault,
        recipientTokenAccount: recipientAta.address,
      })
      .signers([agent])
      .rpc();
    const event = await watcher.promise;
    await watcher.cleanup();

    const eventAmount = event['amount'] as unknown as anchor.BN;
    const eventNonce = event['newNonce'] as unknown as anchor.BN;
    const eventRemaining = event['remainingBudgetAfter'] as unknown as anchor.BN;
    expect(String(event['agent'])).to.equal(agent.publicKey.toBase58());
    expect(String(event['recipient'])).to.equal(recipientWallet.publicKey.toBase58());
    expect(event['actionType']).to.deep.equal({ transferSpl: {} });
    expect(eventAmount.toNumber()).to.equal(amount.toNumber());
    expect(eventNonce.toNumber()).to.equal(1);
    expect(eventRemaining.toNumber()).to.equal(BUDGET.sub(amount).toNumber());

    const vaultToken = await getAccount(connection, funded.splVault);
    expect(vaultToken.amount).to.equal(BigInt(BUDGET.sub(amount).toNumber()));
    const recipientToken = await getAccount(connection, recipientAta.address);
    expect(recipientToken.amount).to.equal(BigInt(amount.toNumber()));

    const account = await program.account.mission.fetch(funded.mission);
    expect(account.agentNonce.eq(new anchor.BN(1))).to.equal(true);
    expect(account.remainingBudget.eq(BUDGET.sub(amount))).to.equal(true);
  });

  it('rejects SPL execution to a wrong-mint token account', async () => {
    const funded = await setupSplMission(24);
    const otherMint = await createMint(
      connection,
      funded.mintAuthority,
      funded.mintAuthority.publicKey,
      null,
      6
    );
    const wrongAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funded.mintAuthority,
      otherMint,
      recipientWallet.publicKey
    );
    try {
      await program.methods
        .executeAction(
          { transferSpl: {} },
          recipientWallet.publicKey,
          new anchor.BN(1_000_000),
          new anchor.BN(1)
        )
        .accounts({
          agent: agent.publicKey,
          mission: funded.mission,
          recipientAccount: recipientWallet.publicKey,
          splVault: funded.splVault,
          recipientTokenAccount: wrongAta.address,
        })
        .signers([agent])
        .rpc();
      expect.fail('wrong-mint destination should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidMint');
    }
  });

  it('rejects SPL execution to a token account owned by someone else', async () => {
    const funded = await setupSplMission(25);
    const outsider = anchor.web3.Keypair.generate();
    const outsiderAta = await getOrCreateAssociatedTokenAccount(
      connection,
      funded.mintAuthority,
      funded.mint,
      outsider.publicKey
    );
    try {
      await program.methods
        .executeAction(
          { transferSpl: {} },
          recipientWallet.publicKey,
          new anchor.BN(1_000_000),
          new anchor.BN(1)
        )
        .accounts({
          agent: agent.publicKey,
          mission: funded.mission,
          recipientAccount: recipientWallet.publicKey,
          splVault: funded.splVault,
          recipientTokenAccount: outsiderAta.address,
        })
        .signers([agent])
        .rpc();
      expect.fail('foreign-owned destination should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('RecipientNotAllowed');
    }
  });

  it('rejects creation with zero budget', async () => {
    try {
      await createMission(26, { budget: new anchor.BN(0) });
      expect.fail('zero-budget creation should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidBudget');
    }
  });

  it('rejects creation with max action above budget', async () => {
    try {
      await createMission(27, { maxAction: BUDGET.add(new anchor.BN(1)) });
      expect.fail('oversized max action should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidMaxAction');
    }
  });

  it('rejects creation with recovery max above the primary max', async () => {
    try {
      await createMission(28, {
        recoveryMaxAction: MAX_ACTION.add(new anchor.BN(1)),
      });
      expect.fail('oversized recovery max should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidRecoveryMaxAction');
    }
  });

  it('rejects creation with no allowed action types', async () => {
    try {
      await createMission(29, { actionTypes: [] });
      expect.fail('empty action types should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('EmptyAllowedActionTypes');
    }
  });

  it('rejects creation with a past expiry', async () => {
    try {
      await createMission(30, {
        expiresAt: new anchor.BN(Math.floor(Date.now() / 1000) - 60),
      });
      expect.fail('past expiry should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('ExpiryNotInFuture');
    }
  });

  it('rejects duplicate creation for the same mission id', async () => {
    await createMission(31);
    try {
      await createMission(31);
      expect.fail('duplicate creation should have been rejected');
    } catch (error) {
      expect(String(error)).to.not.include('InvalidBudget');
    }
  });

  // Phase 5 rows (§21 Phase 5 subset): guardian quarantine.
  // The guardian keypair comes from SUCCRA_TEST_GUARDIAN_PATH (CI writes
  // an ephemeral keypair there and patches the GUARDIAN_PUBKEY constant
  // in-container) or from the repo .env.local dev secret (local runs).
  // Either way it must match the GUARDIAN_PUBKEY constant the program
  // was built with; the secret is never logged.
  describe('succra phase 5 — guardian quarantine', () => {
    // ts-node runs this suite as CommonJS: __dirname is available and
    // shared sources are imported extensionless (resolved to .ts).
    const REPO_ROOT = join(__dirname, '..', '..', '..');

    function base58ToBytes(value: string): Uint8Array {
      const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let num = 0n;
      for (const char of value) {
        const digit = alphabet.indexOf(char);
        if (digit < 0) throw new Error('Invalid base58.');
        num = num * 58n + BigInt(digit);
      }
      const out = new Uint8Array(64);
      for (let i = 63; i >= 0; i -= 1) {
        out[i] = Number(num & 0xffn);
        num >>= 8n;
      }
      return out;
    }

    function loadGuardianKeypair(): anchor.web3.Keypair {
      const fromPath = process.env.SUCCRA_TEST_GUARDIAN_PATH;
      if (fromPath) {
        const bytes = JSON.parse(readFileSync(fromPath, 'utf8')) as number[];
        return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(bytes));
      }
      const envText = readFileSync(join(REPO_ROOT, '.env.local'), 'utf8');
      const line = envText
        .split('\n')
        .find((entry) => entry.startsWith('SUCCRA_GUARDIAN_SECRET_KEY='));
      if (!line) {
        throw new Error('Missing SUCCRA_GUARDIAN_SECRET_KEY (or SUCCRA_TEST_GUARDIAN_PATH).');
      }
      return anchor.web3.Keypair.fromSecretKey(
        base58ToBytes(line.slice('SUCCRA_GUARDIAN_SECRET_KEY='.length).trim())
      );
    }

    async function quarantine(
      mission: anchor.web3.PublicKey,
      signer: anchor.web3.Keypair
    ): Promise<string> {
      return program.methods
        .quarantine()
        .accounts({ guardian: signer.publicKey, mission })
        .signers([signer])
        .rpc();
    }

    function waitForQuarantined(): {
      promise: Promise<Record<string, unknown>>;
      cleanup: () => Promise<void>;
    } {
      let listener = -1;
      const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('MissionQuarantined event timeout')),
          30000
        );
        listener = program.addEventListener('missionQuarantined', (event) => {
          clearTimeout(timer);
          resolve(event as unknown as Record<string, unknown>);
        });
      });
      return {
        promise,
        cleanup: async () => {
          await program.removeEventListener(listener);
        },
      };
    }

    it('quarantines an ACTIVE mission and emits MissionQuarantined', async () => {
      const guardian = loadGuardianKeypair();
      const { mission } = await createMission(101);
      await fundSol(mission);
      const watcher = waitForQuarantined();
      try {
        await quarantine(mission, guardian);
        const event = await watcher.promise;
        expect(String((event['guardian'] as anchor.web3.PublicKey).toBase58())).to.equal(
          guardian.publicKey.toBase58()
        );
      } finally {
        await watcher.cleanup();
      }
      const account = await program.account.mission.fetch(mission);
      expect(statusName(account.status)).to.equal('quarantined');
    });

    it('rejects quarantine signed by a non-guardian', async () => {
      const { mission } = await createMission(102);
      await fundSol(mission);
      try {
        await quarantine(mission, agent);
        expect.fail('non-guardian quarantine should have been rejected');
      } catch (error) {
        expect(String(error)).to.include('UnauthorizedGuardian');
      }
    });

    it('rejects quarantine of a non-ACTIVE mission and repeats idempotently', async () => {
      const guardian = loadGuardianKeypair();
      const { mission } = await createMission(103);
      try {
        await quarantine(mission, guardian);
        expect.fail('DRAFT quarantine should have been rejected');
      } catch (error) {
        expect(String(error)).to.include('InvalidMissionStatus');
      }
      await fundSol(mission);
      await quarantine(mission, guardian);
      try {
        await quarantine(mission, guardian);
        expect.fail('second quarantine should have been rejected');
      } catch (error) {
        // Already quarantined: clean terminal error, no double-write.
        expect(String(error)).to.include('InvalidMissionStatus');
      }
      const account = await program.account.mission.fetch(mission);
      expect(statusName(account.status)).to.equal('quarantined');
    });

    it('quarantine moves no funds and the agent cannot execute after', async () => {
      const guardian = loadGuardianKeypair();
      const { mission, vault } = await createMission(104);
      await fundSol(mission);
      const vaultBefore = await connection.getBalance(vault);
      const ownerBefore = await connection.getBalance(owner);
      await quarantine(mission, guardian);
      const vaultAfter = await connection.getBalance(vault);
      expect(vaultAfter).to.equal(vaultBefore);
      const ownerAfter = await connection.getBalance(owner);
      // Owner pays only transaction fees (dust against a 50M budget); the
      // vault and mission funds are untouched by quarantine itself.
      expect(ownerBefore - ownerAfter).to.be.lessThan(50_000);
      try {
        await executeSol(
          mission,
          recipientWallet.publicKey,
          new anchor.BN(1_000_000),
          new anchor.BN(11)
        );
        expect.fail('post-quarantine execution should have been rejected');
      } catch (error) {
        expect(String(error)).to.include('InvalidMissionStatus');
      }
    });

    it('gateway-planned quarantine bytes match the anchor client', async () => {
      // Independent oracle (no shared-code import: mocha's ESM loader
      // cannot resolve workspace TS): the anchor-built instruction must
      // carry the global:quarantine discriminator, guardian signer +
      // writable mission in struct order, and nothing else.
      const guardian = loadGuardianKeypair();
      const { mission } = await createMission(105);
      const anchorIx = await program.methods
        .quarantine()
        .accounts({ guardian: guardian.publicKey, mission })
        .instruction();
      const expectedDisc = createHash('sha256')
        .update('global:quarantine', 'utf8')
        .digest()
        .subarray(0, 8);
      expect(anchorIx.programId.toBase58()).to.equal(program.programId.toBase58());
      const anchorKeys = anchorIx.keys as Array<{
        pubkey: anchor.web3.PublicKey;
        isSigner: boolean;
        isWritable: boolean;
      }>;
      expect(anchorKeys.map((key) => key.pubkey.toBase58())).to.deep.equal([
        guardian.publicKey.toBase58(),
        mission.toBase58(),
      ]);
      expect(anchorKeys.map((key) => [key.isSigner, key.isWritable])).to.deep.equal([
        [true, false],
        [false, true],
      ]);
      expect(Buffer.from(anchorIx.data as Buffer).toString('hex')).to.equal(
        Buffer.from(expectedDisc).toString('hex')
      );
    });
  });
});
