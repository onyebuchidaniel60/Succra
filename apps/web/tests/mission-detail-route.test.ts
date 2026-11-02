// Route test: mission detail serializes on-chain bigints as strings.
import { describe, expect, it, vi } from 'vitest';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/auth/session', () => ({
  getSessionWallet: vi.fn(async () => ({
    userId: 'owner-1',
    walletAddress: `0x${'11'.repeat(20)}`,
  })),
}));

vi.mock('@/lib/supabase', () => ({
  server: vi.fn(async () => ({})),
}));

vi.mock('@/lib/missions/detail', () => ({
  getMissionDetail: vi.fn(async () => ({
    mission: {
      id: MISSION_ID,
      owner_id: 'owner-1',
      name: 'Treasury run',
      objective: 'Pay vendors',
      status: 'ACTIVE',
      contract_address: `0x${'aa'.repeat(20)}`,
      payment_token_address: `0x${'bb'.repeat(20)}`,
      current_agent_address: `0x${'cc'.repeat(20)}`,
      budget_atomic: '100',
      remaining_budget_atomic: '75',
      policy_version: 1,
      policy_hash: `0x${'dd'.repeat(32)}`,
      expires_at: '2030-01-01T00:00:00.000Z',
      created_at: '2026-11-02T00:00:00.000Z',
      updated_at: '2026-11-02T00:00:00.000Z',
    },
    policy: null,
    onchain: {
      contractAddress: `0x${'aa'.repeat(20)}`,
      currentAgent: `0x${'cc'.repeat(20)}`,
      status: 'ACTIVE',
      agentNonce: 0n,
      stateVersion: 0n,
      violationCount: 0,
      lastViolationAt: 0n,
      confirmedSpentAtomic: 25n,
      lastCheckpointHash: `0x${'ee'.repeat(32)}`,
      lastCheckpointSequence: 0n,
      checkpointCount: 1n,
      successors: [],
      paymentToken: `0x${'bb'.repeat(20)}`,
      budgetAtomic: 100n,
      maxPaymentAtomic: 10n,
      recoveryMaxPaymentAtomic: 5n,
      expiresAt: 1_893_456_000n,
      policyHash: `0x${'dd'.repeat(32)}`,
      cartMandateHash: `0x${'ff'.repeat(32)}`,
      violationThreshold: 3,
      violationWindowSeconds: 900n,
      allowedMerchants: new Set([`0x${'22'.repeat(20)}`]),
    },
    tokenDecimals: 6,
    checkpoints: [],
    successions: [],
    agents: [],
  })),
}));

const { GET } = await import('../app/api/missions/[id]/route');

describe('GET /api/missions/:id', () => {
  it('returns mission detail with bigint fields serialized as strings', async () => {
    const response = await GET(new Request(`http://localhost/api/missions/${MISSION_ID}`), {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as {
      onchain: { budgetAtomic: string; allowedMerchants: string[] };
    };
    expect(payload.onchain.budgetAtomic).toEqual('100');
    expect(payload.onchain.allowedMerchants).toEqual([`0x${'22'.repeat(20)}`]);
  });
});
