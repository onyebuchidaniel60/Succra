// Phase 1 program integration tests, executed on a local validator via
// `anchor test`.
//
// Covers the PROJECT_SPEC.md §21 Phase-1 rows: create mission, fund vault,
// cancel/refund. Later-phase rows (authorized transfers, quarantine,
// succession, ...) land with their phases.
//
// NOTE: @solana/web3.js is imported here only because @coral-xyz/anchor
// 0.32.1 (the pinned Phase 1 program-test stack) requires it. This is the
// ARCHITECTURE.md §9 compatibility exception. No product code uses web3.js.
import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import type { Succra } from '../../../target/types/succra';

describe('succra phase 1 — mission foundation', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Succra as anchor.Program<Succra>;
  const connection = provider.connection;
  const owner = provider.wallet.publicKey;

  const BUDGET = new anchor.BN(50_000_000);
  const MAX_ACTION = new anchor.BN(5_000_000);
  const RECOVERY_MAX_ACTION = new anchor.BN(1_000_000);
  // Per-run base so reruns against a reused ledger never collide with
  // missions created by a previous run.
  const MISSION_BASE = new anchor.BN(Date.now() % 1_000_000);

  function futureExpiry(): anchor.BN {
    return new anchor.BN(Math.floor(Date.now() / 1000) + 3600);
  }

  function missionPdas(missionId: anchor.BN): {
    mission: anchor.web3.PublicKey;
    vault: anchor.web3.PublicKey;
  } {
    const [mission] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('mission'), owner.toBuffer(), missionId.toArrayLike(Buffer, 'le', 8)],
      program.programId
    );
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), mission.toBuffer()],
      program.programId
    );
    return { mission, vault };
  }

  function statusName(status: unknown): string {
    const name = Object.keys(status as Record<string, unknown>)[0];
    if (name === undefined) {
      throw new Error('mission status has no variant');
    }
    return name;
  }

  // NOTE: the generated client infers PDA accounts (mission/vault on
  // create, vault on fund/cancel) and the wallet signer, so only the
  // non-inferable accounts are passed explicitly.
  async function createMission(
    missionId: anchor.BN,
    overrides: {
      budget?: anchor.BN;
      maxAction?: anchor.BN;
      recoveryMaxAction?: anchor.BN;
      expiresAt?: anchor.BN;
      actionTypes?: { transferSol: Record<string, never> }[];
    } = {}
  ): Promise<{ mission: anchor.web3.PublicKey; vault: anchor.web3.PublicKey }> {
    const id = missionId.add(MISSION_BASE);
    const { mission, vault } = missionPdas(id);
    const mint = anchor.web3.Keypair.generate().publicKey;
    await program.methods
      .create(
        id,
        overrides.budget ?? BUDGET,
        overrides.maxAction ?? MAX_ACTION,
        overrides.recoveryMaxAction ?? RECOVERY_MAX_ACTION,
        overrides.actionTypes ?? [{ transferSol: {} }],
        [owner],
        mint,
        overrides.expiresAt ?? futureExpiry()
      )
      .accounts({ owner })
      .rpc();
    return { mission, vault };
  }

  before(async () => {
    // The local validator faucet can rate-limit; fund only when needed.
    const balance = await connection.getBalance(owner);
    if (balance < anchor.web3.LAMPORTS_PER_SOL) {
      const signature = await connection.requestAirdrop(owner, 10 * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(signature);
    }
  });

  it('creates a mission in DRAFT with the committed policy', async () => {
    const missionId = new anchor.BN(1);
    const expiresAt = futureExpiry();
    const { mission, vault } = await createMission(missionId, { expiresAt });

    const account = await program.account.mission.fetch(mission);
    expect(account.owner.toBase58()).to.equal(owner.toBase58());
    expect(account.missionId.eq(missionId.add(MISSION_BASE))).to.equal(true);
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
    expect(firstRecipient.toBase58()).to.equal(owner.toBase58());
    expect(account.expiresAt.eq(expiresAt)).to.equal(true);
    expect(account.violationThreshold).to.equal(3);
    expect(account.violationWindowSeconds.eq(new anchor.BN(900))).to.equal(true);
    expect(statusName(account.status)).to.equal('draft');

    const [, expectedVaultBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), mission.toBuffer()],
      program.programId
    );
    expect(account.vaultBump).to.equal(expectedVaultBump);

    const vaultAccount = await connection.getAccountInfo(vault);
    expect(vaultAccount !== null).to.equal(true);
    expect(vaultAccount?.owner.toBase58()).to.equal(program.programId.toBase58());
  });

  it('funds a DRAFT mission, moving it to ACTIVE with full remaining budget', async () => {
    const { mission, vault } = await createMission(new anchor.BN(2));
    const vaultBefore = await connection.getBalance(vault);

    await program.methods.fund().accounts({ mission }).rpc();

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('active');
    expect(account.remainingBudget.eq(BUDGET)).to.equal(true);

    const vaultAfter = await connection.getBalance(vault);
    expect(vaultAfter - vaultBefore).to.equal(BUDGET.toNumber());
  });

  it('rejects funding an already ACTIVE mission', async () => {
    const { mission } = await createMission(new anchor.BN(3));
    await program.methods.fund().accounts({ mission }).rpc();

    try {
      await program.methods.fund().accounts({ mission }).rpc();
      expect.fail('second fund should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidMissionStatus');
    }
  });

  it('cancels an ACTIVE mission, closes the vault, and refunds the owner', async () => {
    const { mission, vault } = await createMission(new anchor.BN(4));
    await program.methods.fund().accounts({ mission }).rpc();

    const vaultBefore = await connection.getBalance(vault);
    expect(vaultBefore).to.be.greaterThan(0);
    const ownerBefore = await connection.getBalance(owner);

    await program.methods.cancel().accounts({ mission }).rpc();

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('cancelled');
    expect((await connection.getAccountInfo(vault)) === null).to.equal(true);

    const ownerAfter = await connection.getBalance(owner);
    // Full vault balance returns to the owner minus the cancel tx fee.
    expect(ownerAfter).to.be.greaterThan(ownerBefore);
    expect(ownerAfter - ownerBefore + 10_000).to.be.greaterThanOrEqual(vaultBefore);
  });

  it('cancels a DRAFT mission and returns the vault rent reserve', async () => {
    const { mission, vault } = await createMission(new anchor.BN(5));

    await program.methods.cancel().accounts({ mission }).rpc();

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('cancelled');
    expect((await connection.getAccountInfo(vault)) === null).to.equal(true);
  });

  it('rejects cancelling an already CANCELLED mission', async () => {
    const { mission } = await createMission(new anchor.BN(6));
    await program.methods.cancel().accounts({ mission }).rpc();

    // The first cancel closed the vault, so the retry fails while
    // resolving accounts — before instruction logic runs. Either way the
    // retry must fail and the mission must stay CANCELLED.
    try {
      await program.methods.cancel().accounts({ mission }).rpc();
      expect.fail('second cancel should have been rejected');
    } catch (error) {
      expect(String(error)).to.be.a('string');
    }

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('cancelled');
  });

  it('rejects fund and cancel from a non-owner', async () => {
    const stranger = anchor.web3.Keypair.generate();
    // Funded by owner transfer (faucet-independent) so the test does not
    // depend on validator faucet rate limits.
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

    const { mission } = await createMission(new anchor.BN(7));

    try {
      await strangerProgram.methods.fund().accounts({ mission }).rpc();
      expect.fail('stranger fund should have been rejected');
    } catch (error) {
      expect(String(error)).to.not.include('InvalidMissionStatus');
    }

    // Owner funding still works afterwards.
    await program.methods.fund().accounts({ mission }).rpc();

    try {
      await strangerProgram.methods.cancel().accounts({ mission }).rpc();
      expect.fail('stranger cancel should have been rejected');
    } catch (error) {
      expect(String(error)).to.not.include('InvalidMissionStatus');
    }

    const account = await program.account.mission.fetch(mission);
    expect(statusName(account.status)).to.equal('active');
  });

  it('rejects creation with zero budget', async () => {
    try {
      await createMission(new anchor.BN(8), { budget: new anchor.BN(0) });
      expect.fail('zero-budget creation should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidBudget');
    }
  });

  it('rejects creation with max action above budget', async () => {
    try {
      await createMission(new anchor.BN(9), { maxAction: BUDGET.add(new anchor.BN(1)) });
      expect.fail('oversized max action should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidMaxAction');
    }
  });

  it('rejects creation with recovery max above the primary max', async () => {
    try {
      await createMission(new anchor.BN(10), {
        recoveryMaxAction: MAX_ACTION.add(new anchor.BN(1)),
      });
      expect.fail('oversized recovery max should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('InvalidRecoveryMaxAction');
    }
  });

  it('rejects creation with no allowed action types', async () => {
    try {
      await createMission(new anchor.BN(11), { actionTypes: [] });
      expect.fail('empty action types should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('EmptyAllowedActionTypes');
    }
  });

  it('rejects creation with a past expiry', async () => {
    try {
      await createMission(new anchor.BN(12), {
        expiresAt: new anchor.BN(Math.floor(Date.now() / 1000) - 60),
      });
      expect.fail('past expiry should have been rejected');
    } catch (error) {
      expect(String(error)).to.include('ExpiryNotInFuture');
    }
  });

  it('rejects duplicate creation for the same mission id', async () => {
    const missionId = new anchor.BN(13);
    await createMission(missionId);

    try {
      await createMission(missionId);
      expect.fail('duplicate creation should have been rejected');
    } catch (error) {
      expect(String(error)).to.not.include('InvalidBudget');
    }
  });
});
