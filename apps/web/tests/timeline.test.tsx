// @vitest-environment jsdom
// Component tests: timeline, decision receipt, and succession visualization.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Timeline from '../components/Timeline';
import DecisionReceipt from '../components/DecisionReceipt';
import SuccessionPanel from '../components/SuccessionPanel';
import type { AuditEvent } from '../lib/audit/format';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const TX = `0x${'aa'.repeat(32)}`;

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: overrides.id ?? 'event-1',
    mission_id: MISSION_ID,
    event_type: overrides.event_type ?? 'mission.created',
    actor_type: overrides.actor_type ?? 'owner',
    actor_id: null,
    payload_public: overrides.payload_public ?? {},
    onchain_tx_hash: overrides.onchain_tx_hash ?? null,
    created_at: overrides.created_at ?? '2026-11-02T10:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
});

describe('Timeline', () => {
  it('renders audit events, actors, and proof links', () => {
    render(
      <Timeline
        events={[
          event({
            id: 'created',
            payload_public: {
              contractAddress: `0x${'11'.repeat(20)}`,
              policyHash: `0x${'22'.repeat(32)}`,
            },
            onchain_tx_hash: TX,
          }),
          event({
            id: 'violation',
            event_type: 'violation.counted',
            actor_type: 'agent',
            payload_public: { reasonCode: 'MERCHANT_NOT_ALLOWED', violationCountAfter: 1 },
          }),
        ]}
      />
    );
    expect(screen.getByText('Mission created')).toBeTruthy();
    expect(screen.getByText('Policy violation (merchant not allowed)')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByLabelText('View on Blockscout').getAttribute('href')).toContain(TX);
  });

  it('shows checkpoint pending and duplicate sequence badges defensively', () => {
    render(
      <Timeline
        events={[
          event({
            id: 'settlement',
            event_type: 'payment.confirmed',
            created_at: '2026-11-02T10:00:00.000Z',
            payload_public: { amountAtomic: '1' },
          }),
          event({
            id: 'settlement-2',
            event_type: 'payment.confirmed',
            created_at: '2026-11-02T10:10:00.000Z',
            payload_public: { amountAtomic: '1' },
          }),
          event({
            id: 'checkpoint-1',
            event_type: 'checkpoint.verified',
            created_at: '2026-11-02T10:01:00.000Z',
            payload_public: { sequence: 1 },
          }),
          event({
            id: 'checkpoint-2',
            event_type: 'checkpoint.verified',
            created_at: '2026-11-02T10:02:00.000Z',
            payload_public: { sequence: 1 },
          }),
        ]}
      />
    );
    expect(screen.getByText('⚠ Checkpoint pending')).toBeTruthy();
    expect(screen.getAllByText('⛔ Duplicate checkpoint sequence 1')).toHaveLength(2);
  });

  it('renders an empty state', () => {
    render(<Timeline events={[]} />);
    expect(screen.getByText(/No mission events yet/)).toBeTruthy();
  });
});

describe('DecisionReceipt', () => {
  it('shows payload fields and a Blockscout link when a tx exists', () => {
    render(
      <DecisionReceipt
        event={event({
          event_type: 'mission.created',
          payload_public: {
            contractAddress: `0x${'11'.repeat(20)}`,
            policyHash: `0x${'22'.repeat(32)}`,
          },
          onchain_tx_hash: TX,
        })}
      />
    );
    expect(screen.getByText('Decision receipt')).toBeTruthy();
    expect(screen.getByText('View on Blockscout ↗').getAttribute('href')).toContain(TX);
    expect(screen.getByText('contractAddress')).toBeTruthy();
  });
});

describe('SuccessionPanel', () => {
  it('shows PENDING_ACK and the prompt control', () => {
    render(
      <SuccessionPanel
        missionId={MISSION_ID}
        status="RECOVERING"
        tokenDecimals={6}
        succession={{
          id: 'succ-1',
          from_agent_address: `0x${'11'.repeat(20)}`,
          to_agent_address: `0x${'22'.repeat(20)}`,
          trigger_type: 'quarantine',
          checkpoint_hash: `0x${'33'.repeat(32)}`,
          checkpoint_sequence: 0,
          recovery_max_payment_atomic: '50000000',
          status: 'PENDING_ACK',
          activation_tx_hash: TX,
          acknowledgement_tx_hash: null,
          created_at: '2026-11-02T10:00:00.000Z',
          acknowledged_at: null,
        }}
        events={[
          event({
            event_type: 'succession.triggered',
            payload_public: { trigger: 'quarantine', outcome: 'candidate_found' },
          }),
          event({
            event_type: 'succession.candidate_selected',
            payload_public: { candidate: `0x${'22'.repeat(20)}`, priority: 1 },
          }),
        ]}
      />
    );
    expect(screen.getAllByText(/Waiting for/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Prompt successor' })).toBeTruthy();
    expect(screen.getByText('50 per payment')).toBeTruthy();
  });

  it('shows the recovered banner in ACTIVE_RECOVERY', () => {
    render(
      <SuccessionPanel
        missionId={MISSION_ID}
        status="ACTIVE_RECOVERY"
        tokenDecimals={18}
        succession={{
          id: 'succ-1',
          from_agent_address: `0x${'11'.repeat(20)}`,
          to_agent_address: `0x${'22'.repeat(20)}`,
          trigger_type: 'quarantine',
          checkpoint_hash: `0x${'33'.repeat(32)}`,
          checkpoint_sequence: 0,
          recovery_max_payment_atomic: '500000000000000000',
          status: 'ACKNOWLEDGED',
          activation_tx_hash: TX,
          acknowledgement_tx_hash: `0x${'44'.repeat(32)}`,
          created_at: '2026-11-02T10:00:00.000Z',
          acknowledged_at: '2026-11-02T10:05:00.000Z',
        }}
        events={[]}
      />
    );
    expect(screen.getByText(/Mission recovered under reduced authority/)).toBeTruthy();
    expect(screen.getByText('0.5 per payment')).toBeTruthy();
  });
});
