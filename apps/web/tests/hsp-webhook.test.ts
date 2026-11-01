import { describe, expect, it, vi } from 'vitest';
import { signHmac } from '@succra/hsp-client';
import { handleHspWebhook, type WebhookPersistence } from '../lib/gateway/hsp-webhook';
import type { HspPaymentRow } from '../lib/gateway/store-settlement';

const SECRET = 'webhook-secret';
const MANDATE = 'hsp-1';
const TX_HASH = `0x${'aa'.repeat(32)}`;
const ONCHAIN_REQUEST = `0x${'bb'.repeat(32)}`;
const MISSION_ADDRESS = `0x${'cc'.repeat(20)}`;

function payment(overrides: Partial<HspPaymentRow> = {}): HspPaymentRow {
  return {
    id: 'payment-1',
    mission_id: 'mission-1',
    action_request_id: 'action-1',
    hsp_payment_mandate_id: MANDATE,
    mandate_hash: `0x${'dd'.repeat(32)}`,
    amount_atomic: '100',
    token_address: `0x${'ee'.repeat(20)}`,
    merchant_address: `0x${'ff'.repeat(20)}`,
    status: 'SUBMITTED',
    authorization_tx_hash: `0x${'11'.repeat(32)}`,
    settlement_tx_hash: null,
    block_number: null,
    raw_error: null,
    submitted_at: new Date().toISOString(),
    settled_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function world(options: { existing?: HspPaymentRow | null; duplicate?: boolean } = {}) {
  let row: HspPaymentRow | null = options.existing === undefined ? payment() : options.existing;
  let inserted = false;
  const persistence: WebhookPersistence = {
    insertEvent: vi.fn(async () => {
      if (options.duplicate) return { outcome: 'DUPLICATE' as const };
      if (inserted) return { outcome: 'DUPLICATE' as const };
      inserted = true;
      return { outcome: 'INSERTED' as const, id: 'event-row-1' };
    }),
    getPaymentByMandateId: vi.fn(async () => row),
    getActionRequestOnchainRequestId: vi.fn(async () => ONCHAIN_REQUEST),
    getMissionContractAddress: vi.fn(async () => MISSION_ADDRESS),
    transitionPayment: vi.fn(async (_id, _from, patch) => {
      row = payment({ ...row, ...patch });
      return row;
    }),
    mirrorConfirmedSpend: vi.fn(async () => undefined),
    markProcessed: vi.fn(async () => undefined),
  };
  const chain = {
    verifySettlement: vi.fn(async () => ({ ok: true, blockNumber: 7 })),
    recordSettlement: vi.fn(async () => ({})),
  };
  return { persistence, chain, row: () => row };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'evt-1',
    type: 'PAYMENT_CONFIRMED',
    paymentMandateId: MANDATE,
    transactionHash: TX_HASH,
    blockNumber: 7,
    ...overrides,
  };
}

async function call(
  worldValue: ReturnType<typeof world>,
  payload: Record<string, unknown> = event(),
  signature?: string
) {
  const rawBody = JSON.stringify(payload);
  return handleHspWebhook({
    rawBody,
    signature: signature ?? signHmac(rawBody, SECRET),
    secret: SECRET,
    persistence: worldValue.persistence,
    chain: worldValue.chain,
    nowMs: 1_700_000_000_000,
  });
}

describe('HSP webhook', () => {
  it('rejects a bad HMAC, records signature_verified=false, and changes nothing', async () => {
    const w = world();
    const result = await call(w, event(), '0'.repeat(64));
    expect(result.status).toEqual(400);
    expect(w.persistence.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ signature_verified: false })
    );
    expect(w.chain.verifySettlement).not.toHaveBeenCalled();
    expect(w.persistence.transitionPayment).not.toHaveBeenCalled();
  });

  it('treats a duplicate event as a no-op', async () => {
    const w = world({ duplicate: true });
    const result = await call(w);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ duplicate: true });
    expect(w.chain.recordSettlement).not.toHaveBeenCalled();
  });

  it('returns 200 without leaking when the mandate is unknown', async () => {
    const w = world({ existing: null });
    const result = await call(w);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ ignored: true });
  });

  it('verifies RPC, records settlement, updates the mirror, and marks processed', async () => {
    const w = world();
    const result = await call(w);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ status: 'CONFIRMED' });
    expect(w.persistence.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ signature_verified: true, processed_at: null })
    );
    expect(w.chain.verifySettlement).toHaveBeenCalledWith(TX_HASH);
    expect(w.chain.recordSettlement).toHaveBeenCalledWith({
      missionAddress: MISSION_ADDRESS,
      paymentId: ONCHAIN_REQUEST,
      amountAtomic: 100n,
      txHash: TX_HASH,
    });
    expect(w.persistence.transitionPayment).toHaveBeenCalledWith(
      'payment-1',
      'SUBMITTED',
      expect.objectContaining({ status: 'CONFIRMED', settlement_tx_hash: TX_HASH })
    );
    expect(w.persistence.mirrorConfirmedSpend).toHaveBeenCalledWith('mission-1', '100');
    expect(w.persistence.markProcessed).toHaveBeenCalledWith('event-row-1', expect.any(String));
  });

  it('never confirms from the webhook alone when RPC verification fails', async () => {
    const w = world();
    w.chain.verifySettlement.mockResolvedValueOnce({ ok: false, blockNumber: 0 });
    const result = await call(w);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ pending: true });
    expect(w.chain.recordSettlement).not.toHaveBeenCalled();
    expect(w.persistence.transitionPayment).not.toHaveBeenCalled();
  });

  it('records a failed settlement and marks it processed', async () => {
    const w = world();
    const result = await call(w, event({ type: 'PAYMENT_FAILED', error: { code: 'HSP_NO' } }));
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ status: 'FAILED' });
    expect(w.persistence.transitionPayment).toHaveBeenCalledWith(
      'payment-1',
      'SUBMITTED',
      expect.objectContaining({ status: 'FAILED' })
    );
    expect(w.persistence.markProcessed).toHaveBeenCalled();
  });

  it('accepts the x-succra-hmac style signature value (raw HMAC hex)', async () => {
    const w = world();
    const payload = event({ eventId: 'evt-2' });
    const rawBody = JSON.stringify(payload);
    const result = await handleHspWebhook({
      rawBody,
      signature: signHmac(rawBody, SECRET),
      secret: SECRET,
      persistence: w.persistence,
      chain: w.chain,
    });
    expect(result.status).toEqual(200);
  });
});
