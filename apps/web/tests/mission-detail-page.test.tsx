// @vitest-environment jsdom
// Mission detail page smoke test with mocked session/detail/audit data.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionDetail } from '../lib/missions/detail';
import type { AuditEvent } from '../lib/audit/format';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const session = vi.hoisted(() => ({ userId: 'owner-1' }));
const detail = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionWallet: vi.fn(async () => ({
    userId: session.userId,
    walletAddress: `0x${'11'.repeat(20)}`,
  })),
}));

vi.mock('@/lib/missions/detail', () => ({
  getMissionDetail: vi.fn(async () => detail.value),
}));

vi.mock('@/lib/supabase', () => ({
  server: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [
              {
                id: 'event-1',
                mission_id: MISSION_ID,
                event_type: 'mission.created',
                actor_type: 'owner',
                actor_id: 'owner-1',
                payload_public: {
                  contractAddress: `0x${'aa'.repeat(20)}`,
                  policyHash: `0x${'bb'.repeat(32)}`,
                },
                onchain_tx_hash: `0x${'cc'.repeat(32)}`,
                created_at: '2026-11-02T10:00:00.000Z',
              } satisfies AuditEvent,
            ],
            error: null,
          }),
        }),
      }),
    }),
  })),
}));

const { default: MissionDetailPage } = await import('../app/missions/[id]/page');

beforeEach(() => {
  detail.value = {
    mission: {
      id: MISSION_ID,
      owner_id: 'owner-1',
      name: 'Treasury run',
      objective: 'Pay vendors',
      status: 'ACTIVE',
      contract_address: `0x${'aa'.repeat(20)}`,
      payment_token_address: `0x${'dd'.repeat(20)}`,
      current_agent_address: `0x${'ee'.repeat(20)}`,
      budget_atomic: '100000000',
      remaining_budget_atomic: '75000000',
      policy_version: 1,
      policy_hash: `0x${'bb'.repeat(32)}`,
      expires_at: '2030-01-01T00:00:00.000Z',
      created_at: '2026-11-02T10:00:00.000Z',
      updated_at: '2026-11-02T10:00:00.000Z',
    },
    policy: {
      version: 1,
      payment_token_address: `0x${'dd'.repeat(20)}`,
      budget_atomic: '100000000',
      max_payment_atomic: '10000000',
      recovery_max_payment_atomic: '5000000',
      merchant_allowlist: [`0x${'ff'.repeat(20)}`],
      expires_at: '2030-01-01T00:00:00.000Z',
      primary_agent_address: `0x${'ee'.repeat(20)}`,
      successors: [{ address: `0x${'22'.repeat(20)}`, priority: 1 }],
      violation_threshold: 3,
      violation_window_seconds: 900,
      cart_mandate_id: 'mock-cart-1',
      cart_mandate_hash: `0x${'33'.repeat(32)}`,
    },
    onchain: {
      contractAddress: `0x${'aa'.repeat(20)}`,
      currentAgent: `0x${'ee'.repeat(20)}`,
      status: 'ACTIVE',
      agentNonce: 0n,
      stateVersion: 0n,
      violationCount: 1,
      lastViolationAt: 0n,
      confirmedSpentAtomic: 25000000n,
      lastCheckpointHash: `0x${'44'.repeat(32)}`,
      lastCheckpointSequence: 1n,
      checkpointCount: 2n,
      successors: [{ agent: `0x${'22'.repeat(20)}`, priority: 1, active: true }],
      paymentToken: `0x${'dd'.repeat(20)}`,
      budgetAtomic: 100000000n,
      maxPaymentAtomic: 10000000n,
      recoveryMaxPaymentAtomic: 5000000n,
      expiresAt: 1893456000n,
      policyHash: `0x${'bb'.repeat(32)}`,
      cartMandateHash: `0x${'33'.repeat(32)}`,
      violationThreshold: 3,
      violationWindowSeconds: 900n,
      allowedMerchants: new Set([`0x${'ff'.repeat(20)}`]),
    },
    tokenDecimals: 6,
    tokenSymbol: 'USDC',
    checkpoints: [
      {
        sequence: 1,
        checkpoint_hash: `0x${'44'.repeat(32)}`,
        committed_tx_hash: `0x${'55'.repeat(32)}`,
        created_at: '2026-11-02T10:00:00.000Z',
      },
    ],
    successions: [],
    agents: [],
  } satisfies MissionDetail;
});

afterEach(() => {
  cleanup();
});

describe('Mission detail page', () => {
  it('renders HashKey mission data, token-decimals budget, and timeline', async () => {
    const page = await MissionDetailPage({ params: Promise.resolve({ id: MISSION_ID }) });
    render(page);

    expect(screen.getByText('Treasury run')).toBeTruthy();
    expect(screen.getAllByText('75').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('Mission timeline')).toBeTruthy();
    expect(screen.getAllByText('Mission created').length).toBeGreaterThan(0);
    expect(screen.getByText('Decision receipt')).toBeTruthy();
    expect(screen.getByText('Latest checkpoint')).toBeTruthy();
  });
});
