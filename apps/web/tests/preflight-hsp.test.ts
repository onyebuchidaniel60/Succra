import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildSuccraRequestTypedData,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '@succra/shared';
import type { MissionOnChainState } from '../lib/gateway/contract-reader';
import { startMockHspServer } from '../../../packages/hsp-client/test/mock-server.js';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const missionAddress = `0x${'11'.repeat(20)}` as const;
const merchant = `0x${'33'.repeat(20)}`;
const token = `0x${'44'.repeat(20)}`;
const ownerWallet = `0x${'55'.repeat(20)}`;
const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'66'.repeat(32)}`);

const mocks = vi.hoisted(() => ({
  missions: new Map<string, unknown>(),
  agents: new Map<string, unknown>(),
  rows: [] as unknown[],
  consumed: new Set<string>(),
  replayNonce: null as string | null,
  onchain: null as unknown,
  ownerWallet: '',
}));

vi.mock('@/lib/supabase', () => ({ admin: () => ({}) }));

vi.mock('@/lib/gateway/contract-reader', () => ({
  readMissionState: vi.fn(async () => mocks.onchain),
}));

vi.mock('@/lib/gateway/store-preflight', () => ({
  getMissionById: vi.fn(async (_db: unknown, id: string) => mocks.missions.get(id) ?? null),
  getAgentByAddress: vi.fn(async (_db: unknown, address: string) => {
    return mocks.agents.get(address.toLowerCase()) ?? null;
  }),
  getOwnerWalletAddress: vi.fn(async () => mocks.ownerWallet),
  getActionRequestByMissionAndIdempotencyKey: vi.fn(
    async (_db: unknown, missionId: string, key: string) => {
      return (
        (mocks.rows as Array<Record<string, unknown>>).find(
          (row) => row['mission_id'] === missionId && row['idempotency_key'] === key
        ) ?? null
      );
    }
  ),
  listActionRequestKeys: vi.fn(async (_db: unknown, missionId: string) => {
    const rows = (mocks.rows as Array<Record<string, unknown>>).filter(
      (row) => row['mission_id'] === missionId
    );
    return {
      requestIds: new Set(rows.map((row) => String(row['onchain_request_id']))),
      idempotencyKeys: new Set(rows.map((row) => String(row['idempotency_key']))),
    };
  }),
  insertActionRequest: vi.fn(async (_db: unknown, row: Record<string, unknown>) => {
    const conflict = (mocks.rows as Array<Record<string, unknown>>).some(
      (existing) =>
        existing['mission_id'] === row['mission_id'] &&
        (existing['idempotency_key'] === row['idempotency_key'] ||
          existing['agent_nonce'] === row['agent_nonce'])
    );
    if (conflict) throw { code: '23505' };
    const id = randomUUID();
    mocks.rows.push({ ...row, id, submitted_at: null, created_at: new Date().toISOString() });
    return id;
  }),
  consumeAgentNonce: vi.fn(async (_db: unknown, agentId: string, nonce: string) => {
    if (mocks.replayNonce === nonce) return 'REPLAY_DETECTED';
    const key = `${agentId}:${nonce}`;
    if (mocks.consumed.has(key)) return 'REPLAY_DETECTED';
    mocks.consumed.add(key);
    return 'CONSUMED';
  }),
  isAgentAssigned: vi.fn(async () => true),
}));

const { POST } = await import('../app/api/missions/[id]/actions/route');

function onchainState(overrides: Partial<MissionOnChainState> = {}): MissionOnChainState {
  return {
    contractAddress: missionAddress,
    currentAgent: account.address,
    status: 'ACTIVE',
    agentNonce: 4n,
    stateVersion: 0n,
    confirmedSpentAtomic: 0n,
    paymentToken: token,
    budgetAtomic: 1000n,
    maxPaymentAtomic: 400n,
    recoveryMaxPaymentAtomic: 100n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    policyHash: `0x${'77'.repeat(32)}`,
    cartMandateHash: `0x${'88'.repeat(32)}`,
    allowedMerchants: new Set([merchant.toLowerCase()]),
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    idempotencyKey: `idem-${randomUUID()}`,
    agentNonce: 5,
    actionType: 'HSP_PAYMENT',
    payload: {
      merchantAddress: merchant,
      tokenAddress: token,
      amountAtomic: '100',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    },
    ...overrides,
  };
}

async function headersFor(
  requestBody: Record<string, unknown>,
  options: { nonce?: string; timestamp?: number; signer?: typeof account } = {}
) {
  const nonce = options.nonce ?? '1';
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const requestId = String(requestBody['requestId']);
  const typedData = buildSuccraRequestTypedData({
    chainId: 177,
    verifyingContract: missionAddress,
    missionId: missionAddress,
    requestId: requestIdToBytes32(requestId),
    nonce: BigInt(nonce),
    timestamp: BigInt(timestamp),
    methodHash: hashMethodAndPath('POST', `/api/missions/${MISSION_ID}/actions`),
    bodyHash: hashCanonicalBody(requestBody),
  });
  const signature = await (options.signer ?? account).signTypedData(typedData);
  return {
    'content-type': 'application/json',
    'x-succra-agent-address': account.address,
    'x-succra-timestamp': String(timestamp),
    'x-succra-nonce': nonce,
    'x-succra-signature': signature,
  };
}

async function call(
  requestBody: Record<string, unknown>,
  options: {
    headers?: Record<string, string>;
    missionId?: string;
  } = {}
) {
  const request = new Request(
    `http://localhost/api/missions/${options.missionId ?? MISSION_ID}/actions`,
    {
      method: 'POST',
      headers: options.headers ?? (await headersFor(requestBody)),
      body: JSON.stringify(requestBody),
    }
  );
  return POST(request, { params: Promise.resolve({ id: options.missionId ?? MISSION_ID }) });
}

beforeEach(() => {
  mocks.missions.clear();
  mocks.agents.clear();
  mocks.rows.length = 0;
  mocks.consumed.clear();
  mocks.replayNonce = null;
  mocks.ownerWallet = ownerWallet;
  mocks.onchain = onchainState();
  mocks.missions.set(MISSION_ID, {
    id: MISSION_ID,
    owner_id: randomUUID(),
    name: 'Mission',
    objective: 'Pay',
    pda_address: missionAddress,
    vault_address: 'unused',
    mint_address: token,
    budget_atomic: '1000',
    remaining_budget_atomic: '1000',
    status: 'ACTIVE',
    current_agent_id: randomUUID(),
    current_agent_public_key: account.address,
    policy_version: 1,
    policy_hash: `0x${'77'.repeat(32)}`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  mocks.agents.set(account.address.toLowerCase(), {
    id: 'agent-1',
    owner_id: randomUUID(),
    name: 'Alpha',
    public_key: account.address,
    endpoint_url: null,
    capabilities: [],
    status: 'ACTIVE',
    last_heartbeat_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
});

describe('POST /api/missions/:id/actions preflight', () => {
  it('returns ALLOW with an unsigned mandate, digest, and typed data', async () => {
    const requestBody = body();
    const response = await call(requestBody);
    expect(response.status).toEqual(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json['decision']).toEqual('ALLOW');
    expect(json['requestId']).toEqual(requestBody.requestId);
    expect(String(json['mandateHash'])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(json['paymentMandate']).toBeTypeOf('object');
    expect(json['typedData']).toBeTypeOf('object');
    expect(mocks.rows).toHaveLength(1);
    expect((mocks.rows[0] as Record<string, unknown>)['decision']).toEqual('ALLOW');
    expect((mocks.rows[0] as Record<string, unknown>)['mandate_hash']).toEqual(json['mandateHash']);
  });

  it('rejects a malformed body', async () => {
    const response = await call({});
    expect(response.status).toEqual(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toEqual(
      'INVALID_BODY'
    );
  });

  it('rejects missing auth', async () => {
    const response = await call(body(), { headers: {} });
    expect(response.status).toEqual(401);
  });

  it('rejects a stale timestamp', async () => {
    const requestBody = body();
    const headers = await headersFor(requestBody, {
      timestamp: Math.floor(Date.now() / 1000) - 120,
    });
    const response = await call(requestBody, { headers });
    expect(response.status).toEqual(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toEqual(
      'STALE_REQUEST'
    );
  });

  it('rejects a replayed nonce', async () => {
    const requestBody = body();
    mocks.replayNonce = '1';
    const response = await call(requestBody);
    expect(response.status).toEqual(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toEqual(
      'REPLAY_DETECTED'
    );
  });

  it('rejects a non-current agent', async () => {
    mocks.onchain = onchainState({ currentAgent: other.address });
    const response = await call(body());
    expect(response.status).toEqual(403);
  });

  it('returns 404 for a missing mission', async () => {
    const response = await call(body(), { missionId: randomUUID() });
    expect(response.status).toEqual(404);
  });

  it('returns BLOCK for a non-ACTIVE mission', async () => {
    mocks.onchain = onchainState({ status: 'QUARANTINED' });
    const response = await call(body());
    const json = (await response.json()) as { decision: string; reasonCode: string };
    expect(response.status).toEqual(200);
    expect(json.decision).toEqual('BLOCK');
    expect(json.reasonCode).toEqual('MISSION_NOT_ACTIVE');
    expect((mocks.rows[0] as Record<string, unknown>)['mandate_hash']).toBeNull();
  });

  it('returns BLOCK for a merchant outside the allowlist', async () => {
    const requestBody = body({
      payload: {
        merchantAddress: other.address,
        tokenAddress: token,
        amountAtomic: '100',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    const json = (await (await call(requestBody)).json()) as { reasonCode: string };
    expect(json.reasonCode).toEqual('MERCHANT_NOT_ALLOWED');
  });

  it('returns BLOCK for a token mismatch', async () => {
    const requestBody = body({
      payload: {
        merchantAddress: merchant,
        tokenAddress: other.address,
        amountAtomic: '100',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    const json = (await (await call(requestBody)).json()) as { reasonCode: string };
    expect(json.reasonCode).toEqual('TOKEN_NOT_ALLOWED');
  });

  it('returns BLOCK for an amount above the per-payment cap', async () => {
    const requestBody = body({
      payload: {
        merchantAddress: merchant,
        tokenAddress: token,
        amountAtomic: '401',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });
    const json = (await (await call(requestBody)).json()) as { reasonCode: string };
    expect(json.reasonCode).toEqual('AMOUNT_EXCEEDS_MAX');
  });

  it('returns BLOCK on a stale mirror budget', async () => {
    const mission = mocks.missions.get(MISSION_ID) as Record<string, unknown>;
    mission['remaining_budget_atomic'] = '50';
    const json = (await (await call(body())).json()) as { reasonCode: string };
    expect(json.reasonCode).toEqual('BUDGET_EXHAUSTED');
  });

  it('returns BLOCK for an expired mission', async () => {
    mocks.onchain = onchainState({ expiresAt: BigInt(Math.floor(Date.now() / 1000) - 1) });
    const json = (await (await call(body())).json()) as { reasonCode: string };
    expect(json.reasonCode).toEqual('MISSION_EXPIRED');
  });

  it('returns BLOCK for a stale nonce', async () => {
    const requestBody = body({ agentNonce: 4 });
    const json = (await (await call(requestBody)).json()) as { reasonCode: string };
    expect(json.reasonCode).toEqual('STALE_NONCE');
  });

  it('returns the original result for a duplicate idempotency key without a second row', async () => {
    const firstBody = body();
    const first = (await (await call(firstBody)).json()) as { mandateHash: string };
    const secondBody = { ...firstBody, requestId: randomUUID() };
    const second = (await (
      await call(secondBody, { headers: await headersFor(secondBody, { nonce: '2' }) })
    ).json()) as {
      mandateHash: string;
    };
    expect(second.mandateHash).toEqual(first.mandateHash);
    expect(mocks.rows).toHaveLength(1);
  });

  it('blocks a duplicate requestId with a new idempotency key', async () => {
    const firstBody = body();
    await call(firstBody);
    const secondBody = { ...body(), requestId: firstBody.requestId, agentNonce: 6 };
    const json = (await (
      await call(secondBody, { headers: await headersFor(secondBody, { nonce: '2' }) })
    ).json()) as {
      decision: string;
      reasonCode: string;
    };
    expect(json.decision).toEqual('BLOCK');
    expect(json.reasonCode).toEqual('DUPLICATE_REQUEST');
    expect(mocks.rows).toHaveLength(2);
  });

  it('does not call HSP during ALLOW', async () => {
    const hsp = await startMockHspServer();
    try {
      const response = await call(body());
      const json = (await response.json()) as { decision: string };
      expect(json.decision).toEqual('ALLOW');
      expect(hsp.requests).toHaveLength(0);
      expect(mocks.rows).toHaveLength(1);
    } finally {
      await hsp.close();
    }
  });
});
