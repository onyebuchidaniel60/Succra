// Test-only gateway world: PGlite store (real migrations), seeded
// owner/agent/mission/policy rows, a scripted fake chain, and a request
// signer that builds §12-authenticated requests exactly like the SDK.
import { randomUUID } from 'node:crypto';
import { sign as naclSign } from 'tweetnacl';
import {
  base58ToBytes32,
  base64ToBytes,
  buildCanonicalString,
  bytesToBase58,
  bytesToBase64,
  type ActionTypeName,
} from '@succra/shared';
import type { ChainGateway, ChainSignatureStatus, FeePayer } from '../../lib/gateway/chain';
import type { OnchainMissionState } from '../../lib/gateway/mission-state';
import { createGatewayTestDb, PGliteGatewayStore } from './pglite-gateway-store';
import type { PGlite } from '@electric-sql/pglite';

export interface TestAgentKey {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  base58: string;
}

export function makeTestAgent(): TestAgentKey {
  const pair = naclSign.keyPair();
  return {
    publicKey: pair.publicKey,
    secretKey: pair.secretKey,
    base58: bytesToBase58(pair.publicKey),
  };
}

export function makeTestFeePayer(): TestAgentKey & { feePayer: FeePayer } {
  const pair = naclSign.keyPair();
  const base58 = bytesToBase58(pair.publicKey);
  return {
    publicKey: pair.publicKey,
    secretKey: pair.secretKey,
    base58,
    feePayer: {
      address: base58,
      signBytes: (message: Uint8Array): Uint8Array => naclSign.detached(message, pair.secretKey),
    },
  };
}

export interface FixtureWorld {
  db: PGlite;
  store: PGliteGatewayStore;
  ownerId: string;
  agent: TestAgentKey;
  agentId: string;
  missionId: string;
  missionPda: string;
  recipient: string;
}

const NATIVE_MINT = '11111111111111111111111111111111';

/** Seed owner/agent/mission/policy. Override anything per test. */
export async function seedWorld(
  overrides: {
    agentStatus?: string;
    assignmentRole?: string;
    mintAddress?: string;
    missionStatus?: string;
    recipient?: string;
    policyTypes?: string[];
    policyRecipients?: string[];
    maxActionAtomic?: string;
  } = {}
): Promise<FixtureWorld> {
  const db = await createGatewayTestDb();
  const store = new PGliteGatewayStore(db);
  const ownerId = randomUUID();
  const agent = makeTestAgent();
  const recipient = overrides.recipient ?? bytesToBase58(new Uint8Array(32).fill(77));
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId] as unknown[]);
  await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
    ownerId,
    `wallet-${ownerId}`,
  ] as unknown[]);
  const agentRow = await store.insertAgent({
    owner_id: ownerId,
    name: 'alpha',
    public_key: agent.base58,
    status: overrides.agentStatus ?? 'ACTIVE_PRIMARY',
  });
  const missionPda = bytesToBase58(new Uint8Array(32).fill(11));
  const missionId = randomUUID();
  const future = new Date(Date.now() + 3600_000).toISOString();
  await db.query(
    `INSERT INTO missions
       (id, owner_id, name, objective, pda_address, vault_address, mint_address,
        budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
     VALUES ($1,$2,'M','O',$3,$4,$5,'50000000','50000000',$6,$7,1,'hash',$8)`,
    [
      missionId,
      ownerId,
      missionPda,
      bytesToBase58(new Uint8Array(32).fill(12)),
      overrides.mintAddress ?? NATIVE_MINT,
      overrides.missionStatus ?? 'ACTIVE',
      agent.base58,
      future,
    ] as unknown[]
  );
  await store.insertAssignment({
    mission_id: missionId,
    agent_id: agentRow.id,
    role: overrides.assignmentRole ?? 'PRIMARY',
  });
  await db.query(
    `INSERT INTO mission_policies
       (mission_id, version, max_action_atomic, allowed_action_types, allowed_recipients, policy_json, policy_hash)
     VALUES ($1, 1, $2, $3::jsonb, $4::jsonb, '{}'::jsonb, 'hash')`,
    [
      missionId,
      overrides.maxActionAtomic ?? '5000000',
      JSON.stringify(overrides.policyTypes ?? ['TRANSFER_SOL']),
      JSON.stringify(overrides.policyRecipients ?? [recipient]),
    ] as unknown[]
  );
  return { db, store, ownerId, agent, agentId: agentRow.id, missionId, missionPda, recipient };
}

export interface FakeChainOptions {
  status?: OnchainMissionState['status'];
  currentAgent?: string;
  remainingBudget?: bigint;
  agentNonce?: bigint;
  expiresAtSec?: bigint;
  mint?: string;
  /** When true, getMissionState returns null (undeployed/placeholder PDA). */
  missingMission?: boolean;
  /** Script for sendRawTransaction: return signature or throw. */
  send?: (wireB64: string) => Promise<string>;
  /** Script for getSignatureStatus calls in order; default confirms. */
  statuses?: Array<ChainSignatureStatus | null>;
}

/** Scripted ChainGateway. Records every sent transaction. */
export function makeFakeChain(
  world: FixtureWorld,
  options: FakeChainOptions = {}
): ChainGateway & {
  sent: string[];
} {
  const sent: string[] = [];
  const queue = [...(options.statuses ?? [])];
  return {
    sent,
    async getMissionState(missionPda: string): Promise<OnchainMissionState | null> {
      if (options.missingMission) {
        return null;
      }
      return {
        address: missionPda,
        owner: world.ownerId,
        missionId: 1n,
        mint: options.mint ?? NATIVE_MINT,
        budget: 50_000_000n,
        remainingBudget: options.remainingBudget ?? 50_000_000n,
        maxAction: 5_000_000n,
        allowedActionTypes: ['TRANSFER_SOL'],
        allowedRecipients: [world.recipient],
        expiresAtSec: options.expiresAtSec ?? BigInt(Math.floor(Date.now() / 1000) + 3600),
        status: options.status ?? 'Active',
        currentAgent: options.currentAgent ?? world.agent.base58,
        agentNonce: options.agentNonce ?? 0n,
      };
    },
    async getLatestBlockhash() {
      return { blockhash: NATIVE_MINT, lastValidBlockHeight: 100n };
    },
    async sendRawTransaction(wireB64: string): Promise<string> {
      sent.push(wireB64);
      if (options.send) {
        return options.send(wireB64);
      }
      // Default: the transaction id is the fee-payer (slot 0) signature.
      const bytes = base64ToBytes(wireB64);
      return bytesToBase58(bytes.subarray(1, 65));
    },
    async getSignatureStatus(): Promise<ChainSignatureStatus | null> {
      if (queue.length > 0) {
        return queue.shift() ?? null;
      }
      return { slot: 42, err: null };
    },
  };
}

export interface SignedTestRequest {
  headers: Headers;
  rawBody: string;
}

/** Build a §12-authenticated request exactly like the SDK does. */
export function signTestRequest(args: {
  agent: TestAgentKey;
  agentId: string;
  missionId: string;
  method: string;
  path: string;
  body: unknown;
  timestampMs?: number | undefined;
  nonce?: string | undefined;
}): SignedTestRequest {
  const rawBody = JSON.stringify(args.body);
  const timestamp = String(args.timestampMs ?? Date.now());
  const nonce = args.nonce ?? randomUUID();
  const canonical = buildCanonicalString({
    timestamp,
    nonce,
    missionId: args.missionId,
    method: args.method,
    path: args.path,
    body: rawBody,
  });
  const signature = bytesToBase64(
    naclSign.detached(new TextEncoder().encode(canonical), args.agent.secretKey)
  );
  const headers = new Headers({
    'content-type': 'application/json',
    'x-succra-agent-id': args.agentId,
    'x-succra-timestamp': timestamp,
    'x-succra-nonce': nonce,
    'x-succra-signature': signature,
  });
  return { headers, rawBody };
}

export function preflightBody(
  overrides: {
    idempotencyKey?: string;
    agentNonce?: string;
    actionType?: ActionTypeName;
    recipient?: string;
    amountAtomic?: string;
    expiresAt?: string;
  } = {}
): Record<string, unknown> {
  return {
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    agentNonce: overrides.agentNonce ?? '1',
    actionType: overrides.actionType ?? 'TRANSFER_SOL',
    payload: {
      recipient: overrides.recipient ?? bytesToBase58(new Uint8Array(32).fill(77)),
      amountAtomic: overrides.amountAtomic ?? '1000000',
    },
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
  };
}

/** Decode a base58 address (test helper; throws on invalid input). */
export function testAddressToBytes(value: string): Uint8Array {
  return base58ToBytes32(value);
}
