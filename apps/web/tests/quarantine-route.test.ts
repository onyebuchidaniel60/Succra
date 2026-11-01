import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CREDENTIAL = 'phase5-guardian-credential';

const mocks = vi.hoisted(() => ({
  sessionUser: null as { id: string } | null,
  mission: null as unknown,
  onchain: null as unknown,
  sendQuarantine: vi.fn(),
  insertAuditEvent: vi.fn(),
  updateMissionStatus: vi.fn(),
  updateAgentStatus: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  admin: () => ({}),
  server: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: mocks.sessionUser } }),
    },
  }),
}));

vi.mock('@/lib/gateway/store-quarantine', () => ({
  auditEventHash: () => `0x${'00'.repeat(32)}`,
  getQuarantineMission: vi.fn(async () => mocks.mission),
  insertAuditEvent: mocks.insertAuditEvent,
  updateCurrentAgentStatusToQuarantined: mocks.updateAgentStatus,
  updateMissionStatusToQuarantined: mocks.updateMissionStatus,
}));

vi.mock('@/lib/gateway/contract-reader', () => ({
  readMissionState: vi.fn(async () => mocks.onchain),
}));

vi.mock('@/lib/gateway/contract-writer', () => ({
  sendQuarantine: mocks.sendQuarantine,
}));

const { POST } = await import('../app/api/missions/[id]/quarantine/route');

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const TX_HASH = `0x${'aa'.repeat(32)}`;

function request(credential?: string): Request {
  return new Request(`http://localhost/api/missions/${MISSION_ID}/quarantine`, {
    method: 'POST',
    headers: credential ? { authorization: `Bearer ${credential}` } : {},
  });
}

function context() {
  return { params: Promise.resolve({ id: MISSION_ID }) };
}

beforeEach(() => {
  process.env.HASHKEY_GUARDIAN_CREDENTIAL = CREDENTIAL;
  mocks.sessionUser = { id: OWNER_ID };
  mocks.mission = {
    id: MISSION_ID,
    owner_id: OWNER_ID,
    contract_address: `0x${'11'.repeat(20)}`,
    pda_address: `0x${'11'.repeat(20)}`,
    status: 'ACTIVE',
    current_agent_id: randomUUID(),
  };
  mocks.onchain = { status: 'ACTIVE', stateVersion: 0n, violationCount: 0 };
  mocks.sendQuarantine.mockReset();
  mocks.sendQuarantine.mockResolvedValue({ txHash: TX_HASH, blockNumber: 1n });
  mocks.insertAuditEvent.mockReset();
  mocks.insertAuditEvent.mockResolvedValue(undefined);
  mocks.updateMissionStatus.mockReset();
  mocks.updateMissionStatus.mockResolvedValue(undefined);
  mocks.updateAgentStatus.mockReset();
  mocks.updateAgentStatus.mockResolvedValue(undefined);
});

describe('POST /api/missions/:id/quarantine', () => {
  it('quarantines with an owner session', async () => {
    const response = await POST(request(), context());
    expect(response.status).toEqual(200);
    await expect(response.json()).resolves.toMatchObject({
      missionId: MISSION_ID,
      status: 'QUARANTINED',
      txHash: TX_HASH,
      idempotent: false,
    });
    expect(mocks.sendQuarantine).toHaveBeenCalledWith({
      missionAddress: `0x${'11'.repeat(20)}`,
      expectedVersion: 0n,
    });
    expect(mocks.insertAuditEvent).toHaveBeenCalledTimes(2);
    expect(mocks.updateMissionStatus).toHaveBeenCalledWith(expect.anything(), MISSION_ID);
    expect(mocks.updateAgentStatus).toHaveBeenCalledWith(expect.anything(), MISSION_ID);
  });

  it('quarantines with a guardian credential without an owner session', async () => {
    mocks.sessionUser = null;
    const response = await POST(request(CREDENTIAL), context());
    expect(response.status).toEqual(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'QUARANTINED' });
    expect(mocks.sendQuarantine).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-owner session', async () => {
    mocks.mission = { ...(mocks.mission as Record<string, unknown>), owner_id: randomUUID() };
    const response = await POST(request(), context());
    expect(response.status).toEqual(404);
    expect(mocks.sendQuarantine).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent mission', async () => {
    mocks.mission = null;
    const response = await POST(request(), context());
    expect(response.status).toEqual(404);
    expect(mocks.sendQuarantine).not.toHaveBeenCalled();
  });

  it('returns idempotent 200 for an already-quarantined mission', async () => {
    mocks.onchain = { status: 'QUARANTINED', stateVersion: 1n, violationCount: 3 };
    const response = await POST(request(), context());
    expect(response.status).toEqual(200);
    await expect(response.json()).resolves.toMatchObject({
      missionId: MISSION_ID,
      status: 'QUARANTINED',
      txHash: null,
      idempotent: true,
    });
    expect(mocks.sendQuarantine).not.toHaveBeenCalled();
    expect(mocks.insertAuditEvent).not.toHaveBeenCalled();
    expect(mocks.updateMissionStatus).toHaveBeenCalledWith(expect.anything(), MISSION_ID);
  });
});
