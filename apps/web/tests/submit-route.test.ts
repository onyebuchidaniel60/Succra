import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildSuccraRequestTypedData,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '@succra/shared';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const MISSION_ADDRESS = `0x${'11'.repeat(20)}` as const;
const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);

const mocks = vi.hoisted(() => ({
  mission: null as unknown,
  agent: null as unknown,
  action: null as unknown,
  submitted: {
    status: 200,
    json: { decision: 'ALLOW', requestId: 'req', status: 'CONFIRMED' },
  },
  submit: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ admin: () => ({}) }));

vi.mock('@/lib/gateway/store-preflight', () => ({
  getMissionById: vi.fn(async () => mocks.mission),
  getAgentByAddress: vi.fn(async () => mocks.agent),
  getActionRequestByRequestId: vi.fn(async () => mocks.action),
  consumeAgentNonce: vi.fn(async () => 'CONSUMED'),
  isAgentAssigned: vi.fn(async () => true),
  missionContractAddress: vi.fn(() => MISSION_ADDRESS),
  missionCurrentAgentAddress: vi.fn(() => account.address),
}));

vi.mock('@/lib/gateway/submit-production', () => ({
  createSubmitChain: vi.fn(() => ({})),
  createSubmitHsp: vi.fn(() => ({})),
  createSubmitPersistence: vi.fn(() => ({})),
}));

vi.mock('@/lib/gateway/submit-handler', () => ({
  submitApprovedAction: mocks.submit,
}));

const { POST } = await import('../app/api/missions/[id]/actions/[requestId]/submit/route');

async function headersFor(body: Record<string, unknown>) {
  const timestamp = Math.floor(Date.now() / 1000);
  const typedData = buildSuccraRequestTypedData({
    chainId: 177,
    verifyingContract: MISSION_ADDRESS,
    missionId: MISSION_ADDRESS,
    requestId: requestIdToBytes32(REQUEST_ID),
    nonce: 1n,
    timestamp: BigInt(timestamp),
    methodHash: hashMethodAndPath(
      'POST',
      `/api/missions/${MISSION_ID}/actions/${REQUEST_ID}/submit`
    ),
    bodyHash: hashCanonicalBody(body),
  });
  const signature = await account.signTypedData(typedData);
  return {
    'content-type': 'application/json',
    'x-succra-agent-address': account.address,
    'x-succra-timestamp': String(timestamp),
    'x-succra-nonce': '1',
    'x-succra-signature': signature,
  };
}

function request(body: Record<string, unknown>, headers: Record<string, string>) {
  return new Request(`http://localhost/api/missions/${MISSION_ID}/actions/${REQUEST_ID}/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.submit.mockReset();
  mocks.submit.mockResolvedValue(mocks.submitted);
  mocks.mission = {
    id: MISSION_ID,
    owner_id: randomUUID(),
    name: 'Mission',
    objective: 'Pay',
    pda_address: MISSION_ADDRESS,
    vault_address: 'unused',
    mint_address: `0x${'33'.repeat(20)}`,
    budget_atomic: '1000',
    remaining_budget_atomic: '1000',
    status: 'ACTIVE',
    current_agent_id: 'agent-1',
    current_agent_public_key: account.address,
    policy_version: 1,
    policy_hash: `0x${'44'.repeat(32)}`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    contract_address: MISSION_ADDRESS,
    current_agent_address: account.address,
  };
  mocks.agent = {
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
  };
  mocks.action = {
    id: 'action-1',
    mission_id: MISSION_ID,
    agent_id: 'agent-1',
    decision: 'ALLOW',
  };
});

describe('POST /api/missions/:id/actions/:requestId/submit', () => {
  it('authenticates the agent and delegates to the settlement core', async () => {
    const body = { mandateHash: `0x${'55'.repeat(32)}`, signature: `0x${'66'.repeat(65)}` };
    const response = await POST(request(body, await headersFor(body)), {
      params: Promise.resolve({ id: MISSION_ID, requestId: REQUEST_ID }),
    });
    expect(response.status).toEqual(200);
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        mandateHash: body.mandateHash,
        signature: body.signature,
        missionAddress: MISSION_ADDRESS,
      })
    );
  });

  it('rejects a malformed body before touching the database', async () => {
    const body = { mandateHash: 'nope', signature: 'nope' };
    const response = await POST(request(body, await headersFor(body)), {
      params: Promise.resolve({ id: MISSION_ID, requestId: REQUEST_ID }),
    });
    expect(response.status).toEqual(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('returns 404 when the action request is unknown', async () => {
    mocks.action = null;
    const body = { mandateHash: `0x${'55'.repeat(32)}`, signature: `0x${'66'.repeat(65)}` };
    const response = await POST(request(body, await headersFor(body)), {
      params: Promise.resolve({ id: MISSION_ID, requestId: REQUEST_ID }),
    });
    expect(response.status).toEqual(404);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
