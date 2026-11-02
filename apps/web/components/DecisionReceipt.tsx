'use client';

// Decision receipt: the full public payload and cryptographic proof for one
// audit event. Never presents an AI explanation as proof.
import { useState } from 'react';
import TransactionProof from '@/components/TransactionProof';
import {
  actorLabel,
  formatAuditEvent,
  formatEventAmount,
  type AuditEvent,
} from '@/lib/audit/format';

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isCopyable(value: string): boolean {
  return /^0x[0-9a-fA-F]{40,}$/.test(value) || /^[0-9a-fA-F]{64}$/.test(value);
}

function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 hover:border-zinc-500"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function DecisionReceipt({
  event,
  decimals = null,
  symbol = null,
}: {
  event: AuditEvent;
  decimals?: number | null;
  symbol?: string | null;
}): React.JSX.Element {
  const formatted = formatAuditEvent(event, { decimals, symbol });
  const payload = event.payload_public ?? {};
  const entries = Object.entries(payload);
  const txHashRaw = event.onchain_tx_hash ?? payload['txHash'];
  const txHash = typeof txHashRaw === 'string' ? txHashRaw : null;
  const mandateId =
    typeof payload['hspPaymentMandateId'] === 'string' ? payload['hspPaymentMandateId'] : null;
  const merchant =
    typeof payload['merchantAddress'] === 'string' ? payload['merchantAddress'] : null;
  const amount =
    typeof payload['amountAtomic'] === 'string'
      ? payload['amountAtomic']
      : typeof payload['amount_atomic'] === 'string'
        ? payload['amount_atomic']
        : null;
  const formattedAmount = amount ? formatEventAmount(amount, { decimals, symbol }) : null;

  return (
    <aside
      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5"
      aria-label="Decision receipt"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Decision receipt</p>
          <h2 className="mt-1 text-base font-semibold text-zinc-100">{formatted.title}</h2>
          <p className="mt-1 text-sm text-zinc-400">{formatted.description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
          {actorLabel(event.actor_type)}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-400">Event</dt>
          <dd className="font-mono text-zinc-300">{event.event_type}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-400">Timestamp</dt>
          <dd className="text-zinc-300">{new Date(event.created_at).toLocaleString()}</dd>
        </div>
        {mandateId ? (
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-400">HSP mandate</dt>
            <dd className="break-all font-mono text-zinc-300">{mandateId}</dd>
          </div>
        ) : null}
        {merchant ? (
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-400">Merchant</dt>
            <dd className="break-all font-mono text-zinc-300">{merchant}</dd>
          </div>
        ) : null}
        {formattedAmount ? (
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-400">Amount</dt>
            <dd className="font-mono text-zinc-300">{formattedAmount}</dd>
          </div>
        ) : null}
      </dl>

      {txHash ? (
        <div className="mt-4 rounded-md border border-emerald-900/60 bg-emerald-950/20 px-3 py-2">
          <TransactionProof txHash={txHash} label="HashKey transaction" />
        </div>
      ) : null}

      <div className="mt-5 border-t border-zinc-800 pt-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">
          Public payload
        </p>
        <dl className="mt-3 space-y-3">
          {entries.length === 0 ? (
            <p className="text-xs text-zinc-400">No public payload fields.</p>
          ) : (
            entries.map(([key, value]) => {
              const text =
                key === 'amountAtomic' || key === 'amount_atomic'
                  ? formatEventAmount(value, { decimals, symbol })
                  : displayValue(value);
              return (
                <div key={key}>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-400">{key}</dt>
                  <dd className="mt-0.5 flex items-start gap-2">
                    <span className="break-all font-mono text-xs text-zinc-300">{text}</span>
                    {isCopyable(text) ? <CopyButton value={text} label={key} /> : null}
                  </dd>
                </div>
              );
            })
          )}
        </dl>
      </div>
    </aside>
  );
}
