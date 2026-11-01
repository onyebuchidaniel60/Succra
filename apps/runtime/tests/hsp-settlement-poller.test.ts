import { describe, expect, it, vi } from 'vitest';
import {
  pollHspSettlements,
  type PollableHspPayment,
  type SettlementPollerDeps,
} from '../src/monitor/hsp-settlement-poller.js';

const payment: PollableHspPayment = {
  id: 'payment-1',
  mission_id: 'mission-1',
  action_request_id: 'action-1',
  onchain_request_id: `0x${'11'.repeat(32)}`,
  hsp_payment_mandate_id: 'hsp-1',
  amount_atomic: '100',
  status: 'SUBMITTED',
  submitted_at: new Date(1_700_000_000_000).toISOString(),
};

function deps(overrides: Partial<SettlementPollerDeps> = {}): SettlementPollerDeps {
  return {
    listSubmitted: vi.fn(async () => [payment]),
    getStatus: vi.fn(async () => ({
      hspPaymentMandateId: 'hsp-1',
      status: 'CONFIRMED' as const,
      transactionHash: `0x${'aa'.repeat(32)}` as `0x${string}`,
      blockNumber: 7,
    })),
    recordSettlement: vi.fn(async () => undefined),
    confirmPayment: vi.fn(async () => undefined),
    failPayment: vi.fn(async () => undefined),
    now: () => 1_700_000_100_000,
    ageMs: 30_000,
    ...overrides,
  };
}

describe('HSP settlement poller', () => {
  it('queries only rows older than the age cutoff', async () => {
    const listSubmitted = vi.fn(async () => [payment]);
    await pollHspSettlements(deps({ listSubmitted }));
    expect(listSubmitted).toHaveBeenCalledWith(new Date(1_700_000_100_000 - 30_000).toISOString());
  });

  it('records a confirmed settlement and marks the mirror confirmed', async () => {
    const d = deps();
    const result = await pollHspSettlements(d);
    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0 });
    expect(d.recordSettlement).toHaveBeenCalledWith({
      payment,
      txHash: `0x${'aa'.repeat(32)}`,
    });
    expect(d.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ payment, nowIso: expect.any(String) })
    );
  });

  it('marks a failed settlement failed without recording it', async () => {
    const d = deps({
      getStatus: vi.fn(async () => ({
        hspPaymentMandateId: 'hsp-1',
        status: 'FAILED' as const,
        error: { code: 'HSP_NO', message: 'No.' },
      })),
    });
    const result = await pollHspSettlements(d);
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 1 });
    expect(d.recordSettlement).not.toHaveBeenCalled();
    expect(d.failPayment).toHaveBeenCalledTimes(1);
  });

  it('leaves the row SUBMITTED when HSP is still pending or unavailable', async () => {
    const d = deps({
      getStatus: vi.fn(async () => ({
        hspPaymentMandateId: 'hsp-1',
        status: 'SUBMITTED' as const,
      })),
    });
    const result = await pollHspSettlements(d);
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0 });
    expect(d.confirmPayment).not.toHaveBeenCalled();
    expect(d.failPayment).not.toHaveBeenCalled();
  });

  it('retries a confirmed row if settlement recording throws', async () => {
    const d = deps({
      recordSettlement: vi.fn(async () => {
        throw new Error('guardian unavailable');
      }),
    });
    const result = await pollHspSettlements(d);
    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0 });
    expect(d.confirmPayment).not.toHaveBeenCalled();
  });
});
