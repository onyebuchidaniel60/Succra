// Succra web — HSP webhook processing.
//
// Security rules (ARCHITECTURE.md §11, §13):
// - HMAC-SHA256 is verified before any state change.
// - A webhook alone never confirms settlement; HashKey is checked first.
// - Event ids/hashes are unique; duplicate deliveries are no-ops.
// - The guardian (not an arbitrary caller) records settlement on-chain.
import { createHash } from 'node:crypto';
import { verifyHmac } from '@succra/hsp-client';
import type { HspPaymentRow, HspPaymentStatusName, NewHspPayment } from './store-settlement';

export interface WebhookEventInput {
  hsp_payment_mandate_id: string;
  event_id: string;
  event_hash: string;
  payload: unknown;
  signature_verified: boolean;
  processed_at?: string | null;
}

export interface WebhookPersistence {
  insertEvent(
    row: WebhookEventInput
  ): Promise<{ outcome: 'INSERTED'; id: string } | { outcome: 'DUPLICATE' }>;
  getPaymentByMandateId(id: string): Promise<HspPaymentRow | null>;
  getActionRequestOnchainRequestId(actionRequestId: string): Promise<string | null>;
  getMissionContractAddress(missionId: string): Promise<string | null>;
  transitionPayment(
    id: string,
    fromStatus: HspPaymentStatusName,
    patch: Partial<NewHspPayment>
  ): Promise<HspPaymentRow | null>;
  mirrorConfirmedSpend(missionId: string, amountAtomic: string): Promise<void>;
  markProcessed(eventRowId: string, processedAt: string): Promise<void>;
}

export interface WebhookChain {
  verifySettlement(txHash: string): Promise<{ ok: boolean; blockNumber?: number }>;
  recordSettlement(args: {
    missionAddress: `0x${string}`;
    paymentId: `0x${string}`;
    amountAtomic: bigint;
    txHash: `0x${string}`;
  }): Promise<{ alreadyRecorded?: boolean }>;
}

export interface WebhookArgs {
  rawBody: string;
  signature: string;
  secret: string;
  persistence: WebhookPersistence;
  chain: WebhookChain;
  postSettlement?(missionId: string): Promise<void>;
  nowMs?: number;
}

export interface WebhookResult {
  status: number;
  json: unknown;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseJson(rawBody: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(rawBody) as unknown;
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function eventType(record: Record<string, unknown>): 'CONFIRMED' | 'FAILED' | 'UNKNOWN' {
  const value = stringField(record, ['type', 'event', 'eventType', 'status'])?.toUpperCase();
  if (!value) return 'UNKNOWN';
  if (value === 'CONFIRMED' || value === 'PAYMENT_CONFIRMED' || value === 'PAYMENT.SETTLED') {
    return 'CONFIRMED';
  }
  if (value === 'FAILED' || value === 'PAYMENT_FAILED' || value === 'PAYMENT.REJECTED') {
    return 'FAILED';
  }
  return 'UNKNOWN';
}

function badSignature(rawBody: string): { eventHash: string; eventId: string; payload: unknown } {
  const eventHash = sha256(rawBody);
  const parsed = parseJson(rawBody);
  const eventId =
    parsed !== null
      ? (stringField(parsed, ['eventId', 'event_id', 'id']) ?? `invalid-${eventHash}`)
      : `invalid-${eventHash}`;
  return { eventHash, eventId, payload: parsed ?? { raw: rawBody } };
}

export async function handleHspWebhook(args: WebhookArgs): Promise<WebhookResult> {
  const { rawBody, signature, secret, persistence, chain } = args;
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!secret || !verifyHmac(rawBody, signature, secret)) {
    const invalid = badSignature(rawBody);
    await persistence.insertEvent({
      hsp_payment_mandate_id:
        (parseJson(rawBody) &&
          stringField(parseJson(rawBody) as Record<string, unknown>, [
            'paymentMandateId',
            'hspPaymentMandateId',
          ])) ||
        'unknown',
      event_id: invalid.eventId,
      event_hash: invalid.eventHash,
      payload: invalid.payload,
      signature_verified: false,
      processed_at: null,
    });
    return {
      status: 400,
      json: { error: { code: 'INVALID_SIGNATURE', message: 'Webhook HMAC is invalid.' } },
    };
  }

  const parsed = parseJson(rawBody);
  if (!parsed) {
    return { status: 400, json: { error: { code: 'INVALID_BODY', message: 'Expected JSON.' } } };
  }
  const eventId = stringField(parsed, ['eventId', 'event_id', 'id']);
  const mandateId = stringField(parsed, [
    'paymentMandateId',
    'hspPaymentMandateId',
    'payment_mandate_id',
  ]);
  if (!eventId || !mandateId) {
    return {
      status: 400,
      json: { error: { code: 'INVALID_BODY', message: 'Expected eventId and mandate id.' } },
    };
  }

  const inserted = await persistence.insertEvent({
    hsp_payment_mandate_id: mandateId,
    event_id: eventId,
    event_hash: sha256(rawBody),
    payload: parsed,
    signature_verified: true,
    processed_at: null,
  });
  if (inserted.outcome === 'DUPLICATE') {
    return { status: 200, json: { ok: true, duplicate: true } };
  }

  const payment = await persistence.getPaymentByMandateId(mandateId);
  if (!payment) {
    // Do not retry or leak whether the mandate exists.
    return { status: 200, json: { ok: true, ignored: true } };
  }

  const type = eventType(parsed);
  if (type === 'CONFIRMED') {
    if (payment.status === 'CONFIRMED') {
      await persistence.markProcessed(inserted.id, nowIso);
      return { status: 200, json: { ok: true, duplicate: true } };
    }
    if (payment.status !== 'SUBMITTED') {
      return { status: 200, json: { ok: true, ignored: true } };
    }

    const txHash = stringField(parsed, ['transactionHash', 'settlementTxHash', 'txHash']);
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return { status: 200, json: { ok: true, pending: true } };
    }
    const verified = await chain.verifySettlement(txHash);
    if (!verified.ok) {
      // Never confirm from the webhook alone. Leave unprocessed for the poller.
      return { status: 200, json: { ok: true, pending: true } };
    }

    const missionAddress = await persistence.getMissionContractAddress(payment.mission_id);
    const onchainRequestId = await persistence.getActionRequestOnchainRequestId(
      payment.action_request_id
    );
    if (
      !missionAddress ||
      !/^0x[0-9a-fA-F]{40}$/.test(missionAddress) ||
      !onchainRequestId ||
      !/^0x[0-9a-fA-F]{64}$/.test(onchainRequestId)
    ) {
      return { status: 200, json: { ok: true, pending: true } };
    }

    try {
      await chain.recordSettlement({
        missionAddress: missionAddress as `0x${string}`,
        paymentId: onchainRequestId as `0x${string}`,
        amountAtomic: BigInt(payment.amount_atomic),
        txHash: txHash as `0x${string}`,
      });
    } catch {
      return {
        status: 500,
        json: {
          error: { code: 'SETTLEMENT_RECORD_FAILED', message: 'Settlement recording failed.' },
        },
      };
    }

    const confirmed = await persistence.transitionPayment(payment.id, 'SUBMITTED', {
      status: 'CONFIRMED',
      settlement_tx_hash: txHash,
      block_number: verified.blockNumber ?? null,
      settled_at: nowIso,
    });
    if (confirmed) {
      // Separate statement by design: the on-chain confirmedSpentAtomic is
      // authoritative, so a stale mirror can only block conservatively and
      // reconciliation can replay it. No overspend is possible.
      await persistence.mirrorConfirmedSpend(payment.mission_id, payment.amount_atomic);
      if (args.postSettlement) {
        try {
          await args.postSettlement(payment.mission_id);
        } catch {
          // Settlement is authoritative; checkpoint reconciliation retries.
        }
      }
    } else {
      const current = await persistence.getPaymentByMandateId(mandateId);
      if (current?.status !== 'CONFIRMED') {
        return { status: 200, json: { ok: true, ignored: true } };
      }
    }
    await persistence.markProcessed(inserted.id, nowIso);
    return { status: 200, json: { ok: true, status: 'CONFIRMED' } };
  }

  if (type === 'FAILED') {
    if (payment.status !== 'SUBMITTED') {
      return { status: 200, json: { ok: true, ignored: true } };
    }
    const rawError = parsed['error'] ?? {
      code: 'HSP_REJECTION',
      message: 'HSP reported a failed settlement.',
    };
    await persistence.transitionPayment(payment.id, 'SUBMITTED', {
      status: 'FAILED',
      raw_error: rawError,
    });
    await persistence.markProcessed(inserted.id, nowIso);
    return { status: 200, json: { ok: true, status: 'FAILED' } };
  }

  return { status: 200, json: { ok: true, ignored: true } };
}
