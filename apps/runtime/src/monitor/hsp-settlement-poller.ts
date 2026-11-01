// Succra runtime — HSP settlement polling fallback.
//
// MVP-grade: a plain interval, no job queue. Phase 9 replaces this with a
// durable worker. It is a fallback for delayed/missed webhooks; HashKey and HSP
// remain authoritative.
import type { HspPaymentStatus } from '@succra/hsp-client';

export interface PollableHspPayment {
  id: string;
  mission_id: string;
  action_request_id: string;
  onchain_request_id: string;
  hsp_payment_mandate_id: string;
  amount_atomic: string;
  status: string;
  submitted_at: string | null;
}

export interface SettlementPollerDeps {
  listSubmitted(olderThanIso: string): Promise<PollableHspPayment[]>;
  getStatus(hspPaymentMandateId: string): Promise<HspPaymentStatus>;
  recordSettlement(args: { payment: PollableHspPayment; txHash: `0x${string}` }): Promise<void>;
  confirmPayment(args: {
    payment: PollableHspPayment;
    status: HspPaymentStatus;
    nowIso: string;
  }): Promise<void>;
  failPayment(args: {
    payment: PollableHspPayment;
    status: HspPaymentStatus;
    nowIso: string;
  }): Promise<void>;
  postSettlement?(missionId: string): Promise<void>;
  now?: () => number;
  intervalMs?: number;
  ageMs?: number;
}

export interface PollResult {
  checked: number;
  confirmed: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_AGE_MS = 30_000;

export async function pollHspSettlements(deps: SettlementPollerDeps): Promise<PollResult> {
  const now = deps.now ?? Date.now;
  const nowMs = now();
  const ageMs = deps.ageMs ?? DEFAULT_AGE_MS;
  const cutoff = new Date(nowMs - ageMs).toISOString();
  const payments = await deps.listSubmitted(cutoff);
  const result: PollResult = { checked: 0, confirmed: 0, failed: 0 };

  for (const payment of payments) {
    result.checked += 1;
    let status: HspPaymentStatus;
    try {
      status = await deps.getStatus(payment.hsp_payment_mandate_id);
    } catch {
      continue;
    }
    if (status.status === 'CONFIRMED') {
      if (!status.transactionHash) continue;
      try {
        await deps.recordSettlement({
          payment,
          txHash: status.transactionHash as `0x${string}`,
        });
        await deps.confirmPayment({
          payment,
          status,
          nowIso: new Date(nowMs).toISOString(),
        });
        if (deps.postSettlement) {
          try {
            await deps.postSettlement(payment.mission_id);
          } catch {
            // Settlement remains authoritative; reconciliation can retry.
          }
        }
        result.confirmed += 1;
      } catch {
        // Leave the row SUBMITTED; the next interval retries.
      }
      continue;
    }
    if (status.status === 'FAILED') {
      await deps.failPayment({
        payment,
        status,
        nowIso: new Date(nowMs).toISOString(),
      });
      result.failed += 1;
    }
  }

  return result;
}

/** Starts the 30s loop. Returns a stop function for tests/shutdown. */
export function startHspSettlementPoller(deps: SettlementPollerDeps): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void pollHspSettlements(deps)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
}
