// Unit tests: settlement audit rows are derived from authoritative HSP mirrors.
import { describe, expect, it, vi } from 'vitest';
import { recordPaymentAudits, type PostSettlementDeps } from '../lib/gateway/post-settlement';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';

function deps(
  overrides: {
    audited?: string[];
    payments?: Array<Record<string, unknown>>;
  } = {}
): Pick<
  PostSettlementDeps,
  'listConfirmedPaymentDetails' | 'listPaymentAuditMandateIds' | 'insertAuditEvent'
> {
  return {
    listConfirmedPaymentDetails: vi.fn(async () => (overrides.payments ?? []) as never),
    listPaymentAuditMandateIds: vi.fn(async () => new Set(overrides.audited ?? [])),
    insertAuditEvent: vi.fn(async () => undefined),
  };
}

describe('recordPaymentAudits', () => {
  it('writes one payment.confirmed event with HSP mandate and HashKey proof', async () => {
    const d = deps({
      payments: [
        {
          hsp_payment_mandate_id: 'mandate-1',
          settlement_tx_hash: `0x${'aa'.repeat(32)}`,
          amount_atomic: '1000000',
          token_address: `0x${'11'.repeat(20)}`,
          merchant_address: `0x${'22'.repeat(20)}`,
          block_number: 42,
          settled_at: '2026-11-02T10:00:00.000Z',
        },
      ],
    });
    await expect(recordPaymentAudits(MISSION_ID, d)).resolves.toEqual(1);
    expect(d.insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: MISSION_ID,
        event_type: 'payment.confirmed',
        onchain_tx_hash: `0x${'aa'.repeat(32)}`,
        payload_public: expect.objectContaining({
          hspPaymentMandateId: 'mandate-1',
          amountAtomic: '1000000',
          tokenAddress: `0x${'11'.repeat(20)}`,
          merchantAddress: `0x${'22'.repeat(20)}`,
        }),
      })
    );
  });

  it('is idempotent by mandate id', async () => {
    const d = deps({
      audited: ['mandate-1'],
      payments: [
        {
          hsp_payment_mandate_id: 'mandate-1',
          settlement_tx_hash: `0x${'aa'.repeat(32)}`,
          amount_atomic: '1',
          token_address: `0x${'11'.repeat(20)}`,
          merchant_address: `0x${'22'.repeat(20)}`,
          block_number: null,
          settled_at: null,
        },
      ],
    });
    await expect(recordPaymentAudits(MISSION_ID, d)).resolves.toEqual(0);
    expect(d.insertAuditEvent).not.toHaveBeenCalled();
  });

  it('skips a payment without a settlement transaction', async () => {
    const d = deps({
      payments: [
        {
          hsp_payment_mandate_id: 'mandate-1',
          settlement_tx_hash: null,
          amount_atomic: '1',
          token_address: `0x${'11'.repeat(20)}`,
          merchant_address: `0x${'22'.repeat(20)}`,
          block_number: null,
          settled_at: null,
        },
      ],
    });
    await expect(recordPaymentAudits(MISSION_ID, d)).resolves.toEqual(0);
  });
});
