import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildSuccraRequestTypedData,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '@succra/shared';
import { verifyAgentRequest, type AgentAuthStore } from '../lib/gateway/agent-auth';

const missionAddress = `0x${'11'.repeat(20)}` as const;
const chainId = 177;
const path = '/api/missions/11111111-1111-4111-8111-111111111111/actions';
const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${'33'.repeat(32)}`);
const agent = { id: randomUUID(), address: account.address };

function body() {
  return {
    requestId: randomUUID(),
    idempotencyKey: `idem-${randomUUID()}`,
    agentNonce: 5,
    actionType: 'HSP_PAYMENT',
    payload: {
      merchantAddress: `0x${'44'.repeat(20)}`,
      tokenAddress: `0x${'55'.repeat(20)}`,
      amountAtomic: '100',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    },
  };
}

async function headersFor(
  requestBody: ReturnType<typeof body>,
  options: { nonce?: string; timestamp?: number; signer?: typeof account } = {}
) {
  const nonce = options.nonce ?? '1';
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const typedData = buildSuccraRequestTypedData({
    chainId,
    verifyingContract: missionAddress,
    missionId: missionAddress,
    requestId: requestIdToBytes32(requestBody.requestId),
    nonce: BigInt(nonce),
    timestamp: BigInt(timestamp),
    methodHash: hashMethodAndPath('POST', path),
    bodyHash: hashCanonicalBody(requestBody),
  });
  const signature = await (options.signer ?? account).signTypedData(typedData);
  return new Headers({
    'x-succra-agent-address': account.address,
    'x-succra-timestamp': String(timestamp),
    'x-succra-nonce': nonce,
    'x-succra-signature': signature,
  });
}

function store(overrides: Partial<AgentAuthStore> = {}): AgentAuthStore {
  return {
    consumeAgentNonce: vi.fn(async () => 'CONSUMED' as const),
    isAgentAssigned: vi.fn(async () => true),
    ...overrides,
  };
}

async function verify(
  requestBody: ReturnType<typeof body>,
  opts: {
    headers?: Headers;
    currentAgent?: string;
    agentOverride?: { id: string; address: string };
    store?: AgentAuthStore;
    timestamp?: number;
  } = {}
) {
  return verifyAgentRequest({
    headers: opts.headers ?? (await headersFor(requestBody)),
    method: 'POST',
    path,
    body: requestBody,
    missionId: '11111111-1111-4111-8111-111111111111',
    missionAddress,
    chainId,
    currentAgent: opts.currentAgent ?? account.address,
    agent: opts.agentOverride ?? agent,
    store: opts.store ?? store(),
    nowMs: opts.timestamp ?? Date.now(),
  });
}

describe('agent EIP-712 request authentication', () => {
  it('accepts a valid signed request', async () => {
    const requestBody = body();
    await expect(verify(requestBody)).resolves.toEqual({ ok: true });
  });

  it('rejects missing auth headers', async () => {
    const requestBody = body();
    await expect(verify(requestBody, { headers: new Headers() })).resolves.toEqual({
      ok: false,
      reason: 'UNAUTHENTICATED',
    });
  });

  it('rejects a stale timestamp', async () => {
    const requestBody = body();
    const old = Math.floor(Date.now() / 1000) - 120;
    const headers = await headersFor(requestBody, { timestamp: old });
    await expect(verify(requestBody, { headers, timestamp: Date.now() })).resolves.toEqual({
      ok: false,
      reason: 'STALE_REQUEST',
    });
  });

  it('rejects a replayed nonce', async () => {
    const requestBody = body();
    const authStore = store({ consumeAgentNonce: vi.fn(async () => 'REPLAY_DETECTED' as const) });
    await expect(verify(requestBody, { store: authStore })).resolves.toEqual({
      ok: false,
      reason: 'REPLAY_DETECTED',
    });
  });

  it('rejects a signature from a different signer', async () => {
    const requestBody = body();
    const headers = await headersFor(requestBody, { signer: otherAccount });
    await expect(verify(requestBody, { headers })).resolves.toEqual({
      ok: false,
      reason: 'INVALID_SIGNATURE',
    });
  });

  it('burns the nonce even when the signature is invalid', async () => {
    const requestBody = body();
    const headers = await headersFor(requestBody, { signer: otherAccount });
    const authStore = store();
    await verify(requestBody, { headers, store: authStore });
    expect(authStore.consumeAgentNonce).toHaveBeenCalledOnce();
  });

  it('rejects an agent that is not current', async () => {
    const requestBody = body();
    await expect(verify(requestBody, { currentAgent: otherAccount.address })).resolves.toEqual({
      ok: false,
      reason: 'AGENT_NOT_CURRENT',
    });
  });

  it('rejects an agent that is not assigned to the mission', async () => {
    const requestBody = body();
    const authStore = store({ isAgentAssigned: vi.fn(async () => false) });
    await expect(verify(requestBody, { store: authStore })).resolves.toEqual({
      ok: false,
      reason: 'AGENT_NOT_CURRENT',
    });
  });
});
