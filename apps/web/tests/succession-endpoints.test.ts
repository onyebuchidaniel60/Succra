import { beforeEach, describe, expect, it, vi } from 'vitest';

const CREDENTIAL = 'phase6-guardian-credential';
const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const SUCCESSION_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ADDRESS = `0x${'aa'.repeat(20)}`;

const mocks = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
  mission: null as unknown,
  successions: [] as unknown[],
  trigger: vi.fn(),
  writeCheckpoint: vi.fn(),
  acknowledge: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  admin: () => ({}),
  server: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: mocks.sessionUser } }) },
  }),
}));

vi.mock('@/lib/gateway/succession-runner', () => ({
  triggerSuccessionForMission: mocks.trigger,
}));

vi.mock('@/lib/gateway/store-succession', () => ({
  getSuccessionMission: vi.fn(async () => mocks.mission),
  listSuccessions: vi.fn(async () => mocks.successions),
  getSuccessionById: vi.fn(async () => mocks.successions[0] ?? null),
  getMissionAgentStatus: vi.fn(async () => 'REGISTERED'),
  markSuccessionAcknowledged: vi.fn(),
  updateMissionAgentStatus: vi.fn(),
  updateMissionCurrentAgent: vi.fn(),
  updateMissionStatus: vi.fn(),
}));

vi.mock('@/lib/gateway/store-checkpoints', () => ({
  getCheckpointMission: vi.fn(async () => mocks.mission),
}));

vi.mock('@/lib/gateway/checkpoint-writer', () => ({
  writeCheckpoint: mocks.writeCheckpoint,
}));

vi.mock('@/lib/gateway/contract-reader', () => ({
  readMissionState: vi.fn(async () => ({
    stateVersion: 5n,
    status: 'RECOVERING',
    currentAgent: AGENT_ADDRESS,
  })),
}));

vi.mock('@/lib/gateway/succession-ack', () => ({
  acknowledgeRecovery: mocks.acknowledge,
}));

vi.mock('@/lib/gateway/agent-auth', () => ({
  verifyAgentRequest: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/gateway/store-preflight', () => ({
  getAgentByAddress: vi.fn(async () => ({
    id: AGENT_ID,
    public_key: AGENT_ADDRESS,
    address: AGENT_ADDRESS,
  })),
  consumeAgentNonce: vi.fn(async () => 'CONSUMED'),
  isAgentAssigned: vi.fn(async () => true),
}));

const { GET: getSuccession, POST: postSuccession } =
  await import('../app/api/missions/[id]/succession/route');
const { POST: postCheckpoint } = await import('../app/api/missions/[id]/checkpoints/route');
const { POST: postAcknowledge } =
  await import('../app/api/missions/[id]/succession/[successionId]/acknowledge/route');

function request(
  path: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

beforeEach(() => {
  process.env.HASHKEY_GUARDIAN_CREDENTIAL = CREDENTIAL;
  mocks.sessionUser = { id: OWNER_ID };
  mocks.mission = {
    id: MISSION_ID,
    owner_id: OWNER_ID,
    contract_address: `0x${'11'.repeat(20)}`,
    pda_address: `0x${'11'.repeat(20)}`,
    status: 'QUARANTINED',
    current_agent_id: 'primary-agent',
    current_agent_address: `0x${'bb'.repeat(20)}`,
    policy_version: 1,
  };
  mocks.successions = [
    {
      id: SUCCESSION_ID,
      mission_id: MISSION_ID,
      from_agent_id: 'primary-agent',
      from_agent_address: `0x${'bb'.repeat(20)}`,
      to_agent_id: AGENT_ID,
      to_agent_address: AGENT_ADDRESS,
      trigger_type: 'quarantine',
      checkpoint_hash: `0x${'01'.repeat(32)}`,
      checkpoint_sequence: 0,
      recovery_max_payment_atomic: '100',
      status: 'PENDING_ACK',
      activation_tx_hash: `0x${'02'.repeat(32)}`,
      acknowledgement_tx_hash: null,
      created_at: new Date().toISOString(),
      acknowledged_at: null,
    },
  ];
  mocks.trigger.mockReset();
  mocks.trigger.mockResolvedValue({
    outcome: 'ACTIVATED',
    successionId: SUCCESSION_ID,
    toAgentAddress: AGENT_ADDRESS,
  });
  mocks.writeCheckpoint.mockReset();
  mocks.writeCheckpoint.mockResolvedValue({
    sequence: 1,
    checkpointHash: `0x${'03'.repeat(32)}`,
    txHash: `0x${'04'.repeat(32)}`,
  });
  mocks.acknowledge.mockReset();
  mocks.acknowledge.mockResolvedValue({
    status: 200,
    json: { successionId: SUCCESSION_ID, status: 'ACKNOWLEDGED', txHash: `0x${'05'.repeat(32)}` },
  });
});

describe('Phase 6 succession endpoints', () => {
  it('POST /succession works with an owner session', async () => {
    const response = await postSuccession(request(`/api/missions/${MISSION_ID}/succession`, {}), {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(response.status).toEqual(200);
    await expect(response.json()).resolves.toMatchObject({
      successionId: SUCCESSION_ID,
      activatedAddress: AGENT_ADDRESS,
      status: 'PENDING_ACK',
    });
    expect(mocks.trigger).toHaveBeenCalledWith(
      MISSION_ID,
      expect.objectContaining({ triggerType: 'owner_manual' })
    );
  });

  it('POST /succession works with a guardian credential', async () => {
    mocks.sessionUser = null;
    const response = await postSuccession(
      request(
        `/api/missions/${MISSION_ID}/succession`,
        {},
        { authorization: `Bearer ${CREDENTIAL}` }
      ),
      { params: Promise.resolve({ id: MISSION_ID }) }
    );
    expect(response.status).toEqual(200);
    expect(mocks.trigger).toHaveBeenCalledTimes(1);
  });

  it('GET /succession returns the latest history and current agent', async () => {
    const response = await getSuccession(getRequest(`/api/missions/${MISSION_ID}/succession`), {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(response.status).toEqual(200);
    await expect(response.json()).resolves.toMatchObject({
      mission: { id: MISSION_ID, status: 'QUARANTINED' },
      currentAgent: `0x${'bb'.repeat(20)}`,
      previousAgent: `0x${'bb'.repeat(20)}`,
    });
  });

  it('POST /checkpoints requires the guardian credential and writes a checkpoint', async () => {
    const response = await postCheckpoint(
      request(
        `/api/missions/${MISSION_ID}/checkpoints`,
        {},
        { authorization: `Bearer ${CREDENTIAL}` }
      ),
      { params: Promise.resolve({ id: MISSION_ID }) }
    );
    expect(response.status).toEqual(200);
    expect(mocks.writeCheckpoint).toHaveBeenCalledWith(MISSION_ID, 5n);
  });

  it('POST acknowledge returns the successor acknowledgement result', async () => {
    const response = await postAcknowledge(
      request(
        `/api/missions/${MISSION_ID}/succession/${SUCCESSION_ID}/acknowledge`,
        { expectedVersion: 5, signature: `0x${'06'.repeat(65)}` },
        {
          'x-succra-agent-address': AGENT_ADDRESS,
          'x-succra-timestamp': '1700000000',
          'x-succra-nonce': '1',
          'x-succra-signature': `0x${'07'.repeat(65)}`,
        }
      ),
      { params: Promise.resolve({ id: MISSION_ID, successionId: SUCCESSION_ID }) }
    );
    expect(response.status).toEqual(200);
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: MISSION_ID,
        successionId: SUCCESSION_ID,
        expectedVersion: 5n,
        agentId: AGENT_ID,
      })
    );
  });

  it('POST acknowledge propagates an invalid signature failure', async () => {
    mocks.acknowledge.mockResolvedValue({
      status: 400,
      json: { error: { code: 'INVALID_ACK_SIGNATURE', message: 'bad' } },
    });
    const response = await postAcknowledge(
      request(
        `/api/missions/${MISSION_ID}/succession/${SUCCESSION_ID}/acknowledge`,
        { expectedVersion: 5, signature: `0x${'06'.repeat(65)}` },
        {
          'x-succra-agent-address': AGENT_ADDRESS,
          'x-succra-timestamp': '1700000000',
          'x-succra-nonce': '1',
          'x-succra-signature': `0x${'07'.repeat(65)}`,
        }
      ),
      { params: Promise.resolve({ id: MISSION_ID, successionId: SUCCESSION_ID }) }
    );
    expect(response.status).toEqual(400);
  });
});
