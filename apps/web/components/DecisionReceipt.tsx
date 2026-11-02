'use client';

// Decision receipt: the full public payload and cryptographic proof for one
// audit event. Never presents an AI explanation as proof.
import { useState } from 'react';
import { actorLabel, explorerTxUrl, formatAuditEvent, type AuditEvent } from '@/lib/audit/format';

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

export default function DecisionReceipt({ event }: { event: AuditEvent }): React.JSX.Element {
  const formatted = formatAuditEvent(event);
  const payload = event.payload_public ?? {};
  const entries = Object.entries(payload);
  const txHashRaw = event.onchain_tx_hash ?? payload['txHash'];
  const txHash = typeof txHashRaw === 'string' ? txHashRaw : null;
  const mandateId =
    typeof payload['hspPaymentMandateId'] === 'string' ? payload['hspPaymentMandateId'] : null;
  const merchant =
    typeof payload['merchantAddress'] === 'string' ? payload['merchantAddress'] : null;
  const amount = typeof payload['amountAtomic'] === 'string' ? payload['amountAtomic'] : null;

  return (
    <aside
      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5"
      aria-label="Decision receipt"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Decision receipt</p>
          <h2 className="mt-1 text-base font-semibold text-zinc-100">{formatted.title}</h2>
          <p className="mt-1 text-sm text-zinc-400">{formatted.description}</p>
        </div>
        <span className="shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
          {actorLabel(event.actor_type)}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Event</dt>
          <dd className="font-mono text-zinc-300">{event.event_type}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-zinc-500">Timestamp</dt>
          <dd className="text-zinc-300">{new Date(event.created_at).toLocaleString()}</dd>
        </div>
        {mandateId ? (
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">HSP mandate</dt>
            <dd className="break-all font-mono text-zinc-300">{mandateId}</dd>
          </div>
        ) : null}
        {merchant ? (
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Merchant</dt>
            <dd className="break-all font-mono text-zinc-300">{merchant}</dd>
          </div>
        ) : null}
        {amount ? (
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-500">Amount</dt>
            <dd className="font-mono text-zinc-300">{amount} atomic</dd>
          </div>
        ) : null}
      </dl>

      {txHash ? (
        <a
          href={explorerTxUrl(txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex rounded-md border border-emerald-800 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-950"
        >
          View on Blockscout ↗
        </a>
      ) : null}

      <div className="mt-5 border-t border-zinc-800 pt-4">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">
          Public payload
        </p>
        <dl className="mt-3 space-y-3">
          {entries.length === 0 ? (
            <p className="text-xs text-zinc-500">No public payload fields.</p>
          ) : (
            entries.map(([key, value]) => {
              const text = displayValue(value);
              return (
                <div key={key}>
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{key}</dt>
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
