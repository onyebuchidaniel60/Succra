// Unit tests: audit display mapping, proof links, checkpoint-pending logic.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkpointPendingStates,
  duplicateCheckpointSequences,
  explorerTxUrl,
  formatAuditEvent,
  type AuditEvent,
} from '../lib/audit/format';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const TX = `0x${'aa'.repeat(32)}`;

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
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

beforeEach(() => {
  process.env.NEXT_PUBLIC_HASHKEY_EXPLORER_URL = 'https://hashkey.blockscout.com';
});

describe('formatAuditEvent', () => {
  it('maps mission creation and adds a Blockscout proof', () => {
    const formatted = formatAuditEvent(
      event({
        payload_public: {
          contractAddress: `0x${'11'.repeat(20)}`,
          policyHash: `0x${'22'.repeat(32)}`,
        },
        onchain_tx_hash: TX,
      })
    );
    expect(formatted.title).toEqual('Mission created');
    expect(formatted.severity).toEqual('success');
    expect(formatted.proofLink).toEqual(explorerTxUrl(TX));
  });

  it('maps violations with the reason code and amber severity', () => {
    const formatted = formatAuditEvent(
      event({
        event_type: 'violation.counted',
        payload_public: { reasonCode: 'MERCHANT_NOT_ALLOWED', violationCountAfter: 2 },
      })
    );
    expect(formatted.title).toContain('merchant not allowed');
    expect(formatted.description).toContain('violation count 2');
    expect(formatted.severity).toEqual('warning');
  });

  it('maps checkpoints, quarantine and succession events', () => {
    expect(
      formatAuditEvent(
        event({
          event_type: 'checkpoint.verified',
          payload_public: {
            sequence: 3,
            checkpointHash: `0x${'33'.repeat(32)}`,
            confirmedPaymentIds: ['a'],
          },
        })
      ).title
    ).toEqual('Checkpoint #3 committed');
    expect(formatAuditEvent(event({ event_type: 'quarantine.confirmed' })).severity).toEqual(
      'danger'
    );
    expect(
      formatAuditEvent(
        event({
          event_type: 'succession.triggered',
          payload_public: { outcome: 'no_eligible_successor', trigger: 'quarantine' },
        })
      ).title
    ).toEqual('No eligible successor — mission halted');
    expect(
      formatAuditEvent(
        event({
          event_type: 'succession.acknowledge.confirmed',
          payload_public: { successor: `0x${'44'.repeat(20)}` },
          onchain_tx_hash: TX,
        })
      )
    ).toMatchObject({ severity: 'success', proofLink: explorerTxUrl(TX) });
  });

  it('maps payment events when present and exposes mandate fields', () => {
    const formatted = formatAuditEvent(
      event({
        event_type: 'payment.confirmed',
        payload_public: {
          amountAtomic: '1000000',
          tokenAddress: `0x${'55'.repeat(20)}`,
          merchantAddress: `0x${'66'.repeat(20)}`,
          hspPaymentMandateId: 'mandate-1',
        },
        onchain_tx_hash: TX,
      })
    );
    expect(formatted.title).toContain('Payment of 1000000 atomic');
    expect(formatted.description).toContain('mandate-1');
  });

  it('falls back to the raw event type for unknown events', () => {
    const formatted = formatAuditEvent(event({ event_type: 'custom.event' }));
    expect(formatted.title).toEqual('custom.event');
    expect(formatted.severity).toEqual('info');
  });
});

describe('checkpoint pending/duplicate helpers', () => {
  it('marks a settlement pending when no checkpoint follows within five minutes', () => {
    const settlement = event({
      id: 'settle',
      event_type: 'payment.confirmed',
      created_at: '2026-11-02T10:00:00.000Z',
    });
    expect(checkpointPendingStates([settlement]).get('settle')).toEqual(true);
    const lateCheckpoint = event({
      id: 'checkpoint',
      event_type: 'checkpoint.verified',
      created_at: '2026-11-02T10:06:00.000Z',
      payload_public: { sequence: 1 },
    });
    expect(checkpointPendingStates([settlement, lateCheckpoint]).get('settle')).toEqual(true);
    const inWindow = event({
      id: 'checkpoint',
      event_type: 'checkpoint.verified',
      created_at: '2026-11-02T10:04:00.000Z',
      payload_public: { sequence: 1 },
    });
    expect(checkpointPendingStates([settlement, inWindow]).get('settle')).toEqual(false);
  });

  it('detects duplicate checkpoint sequences defensively', () => {
    const first = event({
      id: 'c1',
      event_type: 'checkpoint.verified',
      payload_public: { sequence: 2 },
    });
    const second = event({
      id: 'c2',
      event_type: 'checkpoint.verified',
      payload_public: { sequence: 2 },
    });
    const third = event({
      id: 'c3',
      event_type: 'checkpoint.verified',
      payload_public: { sequence: 3 },
    });
    expect([...duplicateCheckpointSequences([first, second, third])]).toEqual([2]);
  });
});
