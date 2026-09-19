// Phase 4 Alpha acceptance: reference agent against a LIVE validator.
//
// Gate: SUCCRA_TEST_VALIDATOR_URL + target/idl/succra.json +
// target/deploy/succra-keypair.json all present (local runs only; the
// same honest skip pattern as the Phase 2 expiry tests). Skipped on CI:
// web/supabase jobs have no validator, solana-e2e is red.
// Fee payer: the test exercises the PRODUCTION fee-payer path — it reads
// SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY (the same env var the gateway's
// loadFeePayer() reads), loading repo-root .env.local when present.
// SUCCRA_TEST_FEE_PAYER remains as an escape-hatch override only.
// Anchor is imported DYNAMICALLY (never statically) so collection never
// touches the gitignored IDL or a validator connection.
//
// Flow (REAL SDK over HTTP against a test adapter serving the SAME
// handle* functions the Next.js routes call — no behavioral drift):
//   attach (owner core) -> challenge -> sign -> verify -> heartbeat ->
//   preflight ALLOW -> SDK verify-before-sign -> submit -> CONFIRMED,
//   with the DB mirror matching on-chain state. Plus: anchor-vs-gateway
//   instruction byte-equality, mission decode cross-check, tamper
//   rejection, and chain-rejection -> FAILED.
//
// Money sequence on a 50M budget (all TRANSFER_SOL 1M):
//   direct-anchor nonce-9 execute (48M left on-chain; DB still 50M) ->
//   gateway nonce-5 submit REJECTED by chain (FAILED, no mirror) ->
//   gateway nonce-10 submit CONFIRMED (DB mirror converges to 48M).
// The transient 50M-vs-49M divergence after the direct-anchor bypass is
// expected: only gateway-confirmed actions mirror (documented behavior).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sign as naclSign } from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToBase58, planExecuteInstruction } from '../../packages/shared/src/index';
import { handleHeartbeat, handlePreflight } from '../../apps/web/lib/gateway/handlers';
import {
  attachAgent,
  issueChallenge,
  verifyChallenge,
} from '../../apps/web/lib/gateway/registration';
import { decodeMissionAccount } from '../../apps/web/lib/gateway/mission-state';
import {
  createGatewayTestDb,
  PGliteGatewayStore,
} from '../../apps/web/tests/helpers/pglite-gateway-store';
import type { PGlite } from '@electric-sql/pglite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnchorNs = any;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const IDL_PATH = join(REPO_ROOT, 'target', 'idl', 'succra.json');
const KEYPAIR_PATH = join(REPO_ROOT, 'target', 'deploy', 'succra-keypair.json');

const VALIDATOR_URL = process.env.SUCCRA_TEST_VALIDATOR_URL ?? '';
const LIVE = VALIDATOR_URL !== '' && existsSync(IDL_PATH) && existsSync(KEYPAIR_PATH);

// Minimal .env.local loader (no new deps): KEY=VALUE lines set only when
// the key is not already present. Values are never logged.
function loadLocalEnv(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key !== '' && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

if (!LIVE) {
  describe.skip('phase 4 alpha live (requires SUCCRA_TEST_VALIDATOR_URL + anchor IDL/keypair)', () => {
    it('skipped without a live validator', () => {
      expect(true).toEqual(true);
    });
  });
} else {
  interface LiveWorld {
    anchor: AnchorNs;
    program: AnchorNs;
    connection: AnchorNs;
    owner: AnchorNs;
    programId: string;
    db: PGlite;
    store: PGliteGatewayStore;
    ownerId: string;
    agentPublicKey: Uint8Array;
    agentSecret: Uint8Array;
    agentBase58: string;
    agentId: string;
    missionId: string;
    missionPda: string;
    vaultPda: string;
    recipient: string;
    feeAddress: string;
    feeSecret: Uint8Array;
    baseUrl: string;
    server: Server;
  }

  let world: LiveWorld;

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  function agentHeaders(req: IncomingMessage): Headers {
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && key.startsWith('x-succra-')) {
        headers.set(key, value);
      }
    }
    return headers;
  }

  describe('phase 4 alpha live', () => {
    beforeAll(async () => {
      const anchor: AnchorNs = await import('@coral-xyz/anchor');
      const idl = JSON.parse(readFileSync(IDL_PATH, 'utf8')) as Record<string, unknown>;
      const keypairBytes = new Uint8Array(
        JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8')) as number[]
      );
      const provider = anchor.AnchorProvider.env();
      anchor.setProvider(provider);
      const connection = provider.connection;
      const programId: string =
        process.env.SUCCRA_PROGRAM_ID ?? bytesToBase58(keypairBytes.subarray(32, 64));
      const program = new anchor.Program(idl, provider);
      if (program.programId.toBase58() !== programId) {
        throw new Error(
          `IDL program ${program.programId.toBase58()} does not match expected ${programId}.`
        );
      }
      const owner = provider.wallet.publicKey;
      const airdrop = async (to: AnchorNs, sol: number): Promise<void> => {
        // Best-effort: reused sandboxes throttle the faucet, and the
        // owner/fee-payer are typically already funded (owner transfer).
        // A truly unfunded account fails loudly later at send time.
        try {
          const sig = await connection.requestAirdrop(to, sol * anchor.web3.LAMPORTS_PER_SOL);
          await connection.confirmTransaction(sig, 'confirmed');
        } catch {
          // Fall through; balances are asserted implicitly by later sends.
        }
      };

      // PHASE-4.4: production fee-payer path — the same env var the
      // gateway's loadFeePayer() reads. SUCCRA_TEST_FEE_PAYER is an
      // escape-hatch override only; random keys are never used here.
      loadLocalEnv(join(REPO_ROOT, '.env.local'));
      const feeOverride = process.env.SUCCRA_TEST_FEE_PAYER;
      const gatewaySecret = process.env.SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY;
      const feeSource = feeOverride ?? gatewaySecret;
      if (!feeSource) {
        throw new Error(
          'Missing SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY (load .env.local) and no SUCCRA_TEST_FEE_PAYER override.'
        );
      }
      const { base58ToBytes } = await import('../../packages/shared/src/index');
      let feeSecret: Uint8Array;
      try {
        feeSecret = base58ToBytes(feeSource.trim());
      } catch {
        throw new Error('Fee-payer secret is not valid base58.');
      }
      if (feeSecret.length !== 64) {
        throw new Error('Fee-payer secret must decode to 64 bytes.');
      }
      const feeAddress = bytesToBase58(naclSign.keyPair.fromSecretKey(feeSecret).publicKey);
      await airdrop(owner, 5);
      await airdrop(new anchor.web3.PublicKey(feeAddress), 2);

      const agentPair = naclSign.keyPair();
      const agentBase58 = bytesToBase58(agentPair.publicKey);
      const agentPubkey = new anchor.web3.PublicKey(agentPair.publicKey);
      const missionNo = Date.now() % 1_000_000;
      const [missionPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from('mission'),
          owner.toBuffer(),
          new anchor.BN(missionNo).toArrayLike(Buffer, 'le', 8),
        ],
        program.programId
      );
      const recipientPair = naclSign.keyPair();
      const recipient = bytesToBase58(recipientPair.publicKey);
      const recipientPubkey = new anchor.web3.PublicKey(recipientPair.publicKey);
      await program.methods
        .create(
          new anchor.BN(missionNo),
          new anchor.BN(50_000_000),
          new anchor.BN(5_000_000),
          new anchor.BN(1_000_000),
          [{ transferSol: {} }],
          [recipientPubkey],
          anchor.web3.SystemProgram.programId,
          new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
          agentPubkey
        )
        .accounts({ owner })
        .rpc();
      await program.methods.fund().accounts({ mission: missionPda }).rpc();
      const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), missionPda.toBuffer()],
        program.programId
      );

      const db = await createGatewayTestDb();
      const store = new PGliteGatewayStore(db);
      const ownerId = randomUUID();
      await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId] as unknown[]);
      await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
        ownerId,
        `alpha-owner-${ownerId}`,
      ] as unknown[]);
      const agentRow = await store.insertAgent({
        owner_id: ownerId,
        name: 'alpha',
        public_key: agentBase58,
        status: 'REGISTERED',
      });
      const missionId = randomUUID();
      await db.query(
        `INSERT INTO missions
           (id, owner_id, name, objective, pda_address, vault_address, mint_address,
            budget_atomic, remaining_budget_atomic, status,
            current_agent_public_key, policy_version, policy_hash, expires_at)
         VALUES ($1,$2,'Alpha','Prove it',$3,$4,'11111111111111111111111111111111',
          '50000000','50000000','ACTIVE',$5,1,'hash', now() + interval '1 hour')`,
        [missionId, ownerId, missionPda.toBase58(), vaultPda.toBase58(), agentBase58] as unknown[]
      );
      await store.insertAssignment({
        mission_id: missionId,
        agent_id: agentRow.id,
        role: 'PRIMARY',
      });
      await db.query(
        `INSERT INTO mission_policies
           (mission_id, version, max_action_atomic, allowed_action_types, allowed_recipients, policy_json, policy_hash)
         VALUES ($1, 1, '5000000', '["TRANSFER_SOL"]'::jsonb, $2::jsonb, '{}'::jsonb, 'hash')`,
        [missionId, JSON.stringify([recipient])] as unknown[]
      );

      const { createKitChainGateway } = await import('../../apps/web/lib/gateway/chain');
      const chain = createKitChainGateway(VALIDATOR_URL);
      const feePayer = {
        address: feeAddress,
        signBytes: (message: Uint8Array): Uint8Array => naclSign.detached(message, feeSecret),
      };
      const adapter = createServer((req: IncomingMessage, res: ServerResponse) => {
        void (async (): Promise<void> => {
          const rawBody = await readBody(req);
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          const headers = agentHeaders(req);
          const parts = url.pathname.split('/').filter((part) => part !== '');
          const reply = (status: number, json: unknown): void => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(json));
          };
          try {
            if (req.method === 'POST' && parts[1] === 'agents' && parts[3] === 'heartbeat') {
              const result = await handleHeartbeat({
                store,
                headers,
                method: 'POST',
                path: url.pathname,
                rawBody,
                agentPathId: parts[2] ?? '',
                nowMs: Date.now(),
              });
              reply(result.status, result.json);
            } else if (req.method === 'GET' && parts[1] === 'agents' && parts[3] === 'status') {
              const { handleGetStatus } = await import('../../apps/web/lib/gateway/handlers');
              const result = await handleGetStatus({
                store,
                sessionOwnerId: null,
                headers,
                method: 'GET',
                path: url.pathname,
                agentPathId: parts[2] ?? '',
                nowMs: Date.now(),
              });
              reply(result.status, result.json);
            } else if (
              req.method === 'POST' &&
              parts[1] === 'missions' &&
              parts[3] === 'actions' &&
              parts.length === 4
            ) {
              const result = await handlePreflight({
                store,
                chain,
                feePayerAddress: feeAddress,
                programId,
                headers,
                method: 'POST',
                path: url.pathname,
                rawBody,
                missionId: parts[2] ?? '',
                nowMs: Date.now(),
              });
              reply(result.status, result.json);
            } else if (req.method === 'POST' && parts[3] === 'actions' && parts[5] === 'submit') {
              const { handleSubmit } = await import('../../apps/web/lib/gateway/handlers');
              const result = await handleSubmit({
                store,
                chain,
                feePayer,
                headers,
                method: 'POST',
                path: url.pathname,
                rawBody,
                missionId: parts[2] ?? '',
                requestId: parts[4] ?? '',
                nowMs: Date.now(),
              });
              reply(result.status, result.json);
            } else {
              reply(404, {
                error: { code: 'NOT_FOUND', message: 'No such route.', requestId: 'test' },
              });
            }
          } catch (error) {
            reply(500, { error: { code: 'ADAPTER', message: String(error), requestId: 'test' } });
          }
        })();
      });
      await new Promise<void>((resolve) => adapter.listen(0, '127.0.0.1', resolve));
      const port = (adapter.address() as { port: number }).port;

      world = {
        anchor,
        program,
        connection,
        owner,
        programId,
        db,
        store,
        ownerId,
        agentPublicKey: agentPair.publicKey,
        agentSecret: agentPair.secretKey,
        agentBase58,
        agentId: agentRow.id,
        missionId,
        missionPda: missionPda.toBase58(),
        vaultPda: vaultPda.toBase58(),
        recipient,
        feeAddress,
        feeSecret,
        baseUrl: `http://127.0.0.1:${port}`,
        server: adapter,
      };
    }, 300_000);

    afterAll(async () => {
      await new Promise<void>((resolve) => world.server.close(() => resolve()));
      await world.db.close();
    });

    it('anchor-built and gateway-planned instructions are byte-identical', async () => {
      const { anchor, program, missionPda, vaultPda, recipient, agentBase58 } = world;
      const amount = new anchor.BN(1_000_000);
      const nonce = new anchor.BN(1);
      const anchorIx = await program.methods
        .executeAction({ transferSol: {} }, new anchor.web3.PublicKey(recipient), amount, nonce)
        .accounts({
          agent: new anchor.web3.PublicKey(agentBase58),
          mission: missionPda,
          recipientAccount: new anchor.web3.PublicKey(recipient),
          splVault: null,
          recipientTokenAccount: null,
        })
        .instruction();
      const { addressToBytes } = await import('../../packages/shared/src/index');
      const planned = planExecuteInstruction(
        world.programId,
        { agent: agentBase58, mission: missionPda, recipient, vault: vaultPda },
        {
          actionType: 'TRANSFER_SOL',
          recipient: addressToBytes(recipient),
          amount: 1_000_000n,
          nonce: 1n,
        }
      );
      expect(anchorIx.programId.toBase58()).toEqual(planned.programAddress);
      const roleFlags = (role: string): [boolean, boolean] =>
        role === 'readonly-signer'
          ? [true, false]
          : role === 'writable-signer'
            ? [true, true]
            : role === 'writable'
              ? [false, true]
              : [false, false];
      const anchorKeys = anchorIx.keys as Array<{
        pubkey: AnchorNs;
        isSigner: boolean;
        isWritable: boolean;
      }>;
      expect(anchorKeys.map((key) => key.pubkey.toBase58())).toEqual(
        planned.accounts.map((meta) => meta.address)
      );
      expect(anchorKeys.map((key) => [key.isSigner, key.isWritable])).toEqual(
        planned.accounts.map((meta) => roleFlags(meta.role))
      );
      expect(Buffer.from(anchorIx.data as Buffer).toString('hex')).toEqual(
        Buffer.from(planned.data).toString('hex')
      );
    });

    it('gateway mission decode matches the anchor-decoded account', async () => {
      const { anchor, connection, missionPda, agentBase58 } = world;
      const info = await connection.getAccountInfo(new anchor.web3.PublicKey(missionPda));
      const bytes = new Uint8Array(info.data as Buffer);
      const decoded = decodeMissionAccount(missionPda, bytes);
      expect(decoded.status).toEqual('Active');
      expect(decoded.currentAgent).toEqual(agentBase58);
      expect(decoded.budget).toEqual(50_000_000n);
      expect(decoded.maxAction).toEqual(5_000_000n);
      expect(decoded.agentNonce).toEqual(0n);
      expect(decoded.allowedActionTypes).toEqual(['TRANSFER_SOL']);
      expect(decoded.remainingBudget).toEqual(50_000_000n);
    });

    it('alpha registers via challenge, heartbeats, and reads status', async () => {
      const { store, ownerId, agentId, agentBase58, agentSecret } = world;
      const attached = await attachAgent({
        store,
        ownerId,
        missionId: world.missionId,
        publicKey: agentBase58,
        name: 'alpha',
        role: 'PRIMARY',
      });
      expect(attached.created).toEqual(false);
      const { challenge } = await issueChallenge({ store, ownerId, agentId, nowMs: Date.now() });
      const { hexToBytes, bytesToBase64 } = await import('../../packages/shared/src/index');
      const signature = bytesToBase64(naclSign.detached(hexToBytes(challenge), agentSecret));
      const verified = await verifyChallenge({
        store,
        ownerId,
        agentId,
        challenge,
        signatureBase64: signature,
        nowMs: Date.now(),
      });
      expect(verified.status).toEqual('ACTIVE_PRIMARY');
      const { SuccraAgentClient } = await import('../../packages/sdk/src/index');
      const client = new SuccraAgentClient({
        baseUrl: world.baseUrl,
        agentId,
        keypair: { publicKey: world.agentPublicKey, secretKey: agentSecret },
      });
      const beat = await client.heartbeat();
      expect(beat.agentId).toEqual(agentId);
      const status = await client.getAgentStatus();
      expect(status.status).toEqual('ACTIVE_PRIMARY');
      expect(status.missions).toEqual([{ missionId: world.missionId, role: 'PRIMARY' }]);
    });

    it('chain rejection records FAILED without mirroring', { timeout: 60000 }, async () => {
      const { SuccraAgentClient } = await import('../../packages/sdk/src/index');
      const client = new SuccraAgentClient({
        baseUrl: world.baseUrl,
        agentId: world.agentId,
        keypair: { publicKey: world.agentPublicKey, secretKey: world.agentSecret },
      });
      const future = new Date(Date.now() + 3600_000).toISOString();
      // Approve nonce 5 while the chain is at 0, then jump the chain to 9
      // with a direct-anchor execute so the gateway tx is stale on arrival.
      const pre = await client.preflightAction({
        missionId: world.missionId,
        idempotencyKey: randomUUID(),
        agentNonce: '5',
        actionType: 'TRANSFER_SOL',
        recipient: world.recipient,
        amountAtomic: '1000000',
        expiresAt: future,
      });
      if (pre.decision !== 'ALLOW') throw new Error('expected ALLOW');
      const { anchor, program, missionPda, recipient } = world;
      const agentKp = anchor.web3.Keypair.fromSecretKey(world.agentSecret);
      await program.methods
        .executeAction(
          { transferSol: {} },
          new anchor.web3.PublicKey(recipient),
          new anchor.BN(1_000_000),
          new anchor.BN(9)
        )
        .accounts({
          agent: agentKp.publicKey,
          mission: missionPda,
          recipientAccount: new anchor.web3.PublicKey(recipient),
          splVault: null,
          recipientTokenAccount: null,
        })
        .signers([agentKp])
        .rpc();
      const { signedTransaction } = client.signPreflight(pre.unsignedTransaction, {
        programId: world.programId,
        agent: world.agentBase58,
        mission: world.missionPda,
        vault: world.vaultPda,
        recipient: world.recipient,
        actionType: 'TRANSFER_SOL',
        amountAtomic: '1000000',
        agentNonce: '5',
      });
      const result = await client.submitSignedAction({
        missionId: world.missionId,
        requestId: pre.requestId,
        signedTransaction,
      });
      expect(result.status).toEqual('FAILED');
      expect(result.error?.code).toEqual('CHAIN_REJECTION');
      const tx = await world.store.getOnchainTxByRequest(pre.requestId);
      expect(tx?.status).toEqual('FAILED');
      const mission = await world.store.getMissionById(world.missionId);
      expect(mission?.remaining_budget_atomic).toEqual('50000000');
    });

    it(
      'alpha submits to CONFIRMED and rejects further submit on the terminal request',
      { timeout: 60000 },
      async () => {
        const { SuccraAgentClient } = await import('../../packages/sdk/src/index');
        const client = new SuccraAgentClient({
          baseUrl: world.baseUrl,
          agentId: world.agentId,
          keypair: { publicKey: world.agentPublicKey, secretKey: world.agentSecret },
        });
        const future = new Date(Date.now() + 3600_000).toISOString();
        const pre = await client.preflightAction({
          missionId: world.missionId,
          idempotencyKey: randomUUID(),
          agentNonce: '10',
          actionType: 'TRANSFER_SOL',
          recipient: world.recipient,
          amountAtomic: '1000000',
          expiresAt: future,
        });
        if (pre.decision !== 'ALLOW') throw new Error('expected ALLOW');
        const { signedTransaction } = client.signPreflight(pre.unsignedTransaction, {
          programId: world.programId,
          agent: world.agentBase58,
          mission: world.missionPda,
          vault: world.vaultPda,
          recipient: world.recipient,
          actionType: 'TRANSFER_SOL',
          amountAtomic: '1000000',
          agentNonce: '10',
        });
        const result = await client.submitSignedAction({
          missionId: world.missionId,
          requestId: pre.requestId,
          signedTransaction,
        });
        // PHASE-4.4-DIAGNOSTIC: remove after submit path is verified
        if (result.status === 'FAILED') {
          const diagTx = await world.store.getOnchainTxByRequest(pre.requestId);
          const diagMission = await world.store.getMissionById(world.missionId);
          const diagOnchain = await world.program.account.mission
            .fetch(world.missionPda)
            .catch((error: unknown) => ({ fetchError: String(error) }));
          const diagBalance = await world.connection
            .getBalance(new world.anchor.web3.PublicKey(world.feeAddress))
            .catch((error: unknown) => `balance-error: ${String(error)}`);
          console.log(
            JSON.stringify(
              {
                submitResponse: result,
                onchainTx: diagTx
                  ? { status: diagTx.status, rawError: diagTx.raw_error, slot: diagTx.slot }
                  : null,
                dbMission: diagMission
                  ? {
                      remaining: diagMission.remaining_budget_atomic,
                      status: diagMission.status,
                    }
                  : null,
                chainMission: diagOnchain,
                preflight: { requestId: pre.requestId, expiresAt: pre.expiresAt },
                feePayer: world.feeAddress,
                feeBalanceLamports: diagBalance,
              },
              null,
              2
            )
          );
        }
        expect(result.status).toEqual('CONFIRMED');
        expect(result.signature).not.toBeNull();
        console.log('PHASE-4.5-ALPHA-SIGNATURE:', result.signature);
        // Terminal-state short-circuit fires before hash comparison, per the
        // submit.ts state machine: any further submit on this CONFIRMED row —
        // even with the identical bytes — is ALREADY_SUBMITTED.
        const again = await client
          .submitSignedAction({
            missionId: world.missionId,
            requestId: pre.requestId,
            signedTransaction,
          })
          .then(
            () => 'unexpected-success',
            (error: unknown) => (error as { code?: string }).code ?? 'unknown'
          );
        expect(again).toEqual('ALREADY_SUBMITTED');
        // DB mirror matches the chain: 50M - 1M (direct) - 1M (gateway).
        const mission = await world.store.getMissionById(world.missionId);
        expect(mission?.remaining_budget_atomic).toEqual('48000000');
        const onchain = await world.program.account.mission.fetch(world.missionPda);
        expect(String(onchain.remainingBudget)).toEqual('48000000');
        const tx = await world.store.getOnchainTxByRequest(pre.requestId);
        expect(tx?.status).toEqual('CONFIRMED');
        expect(tx?.slot).not.toBeNull();
      }
    );

    it('rejects tampered submit on an approved request', { timeout: 60000 }, async () => {
      // Tamper detection on a LIVE (non-terminal APPROVED) row: two fresh
      // requests are pre-flighted, then B's correctly-signed bytes are
      // submitted under A's request id. The hash comparison must fire
      // TRANSACTION_MISMATCH because neither row is terminal.
      const { SuccraAgentClient } = await import('../../packages/sdk/src/index');
      const client = new SuccraAgentClient({
        baseUrl: world.baseUrl,
        agentId: world.agentId,
        keypair: { publicKey: world.agentPublicKey, secretKey: world.agentSecret },
      });
      const future = new Date(Date.now() + 3600_000).toISOString();
      const preA = await client.preflightAction({
        missionId: world.missionId,
        idempotencyKey: randomUUID(),
        agentNonce: '11',
        actionType: 'TRANSFER_SOL',
        recipient: world.recipient,
        amountAtomic: '1000000',
        expiresAt: future,
      });
      if (preA.decision !== 'ALLOW') throw new Error('expected ALLOW');
      const preB = await client.preflightAction({
        missionId: world.missionId,
        idempotencyKey: randomUUID(),
        agentNonce: '12',
        actionType: 'TRANSFER_SOL',
        recipient: world.recipient,
        amountAtomic: '1000000',
        expiresAt: future,
      });
      if (preB.decision !== 'ALLOW') throw new Error('expected ALLOW');
      const { signedTransaction: signedB } = client.signPreflight(preB.unsignedTransaction, {
        programId: world.programId,
        agent: world.agentBase58,
        mission: world.missionPda,
        vault: world.vaultPda,
        recipient: world.recipient,
        actionType: 'TRANSFER_SOL',
        amountAtomic: '1000000',
        agentNonce: '12',
      });
      const tamperedCode = await client
        .submitSignedAction({
          missionId: world.missionId,
          requestId: preA.requestId,
          signedTransaction: signedB,
        })
        .then(
          () => 'unexpected-success',
          (error: unknown) => (error as { code?: string }).code ?? 'unknown'
        );
      expect(tamperedCode).toEqual('TRANSACTION_MISMATCH');
      // A pre-send rejection consumes nothing: no on-chain row exists.
      const txA = await world.store.getOnchainTxByRequest(preA.requestId);
      expect(txA).toBeNull();
    });
  });
}
