'use client';

// Succession visualization for QUARANTINED / RECOVERING / ACTIVE_RECOVERY.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import TransactionProof from '@/components/TransactionProof';
import { formatAtomicUnknown, formatTokenAmount, shortenAddress } from '@/lib/format';
import type { AuditEvent } from '@/lib/audit/format';

export interface SuccessionRecordView {
  id: string;
  from_agent_address: string;
  to_agent_address: string;
  trigger_type: string;
  checkpoint_hash: string | null;
  checkpoint_sequence: number | null;
  recovery_max_payment_atomic: string;
  status: string;
  activation_tx_hash: string | null;
  acknowledgement_tx_hash: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface SuccessionPanelProps {
  missionId: string;
  status: string;
  succession: SuccessionRecordView | null;
  events: AuditEvent[];
  tokenDecimals: number | null;
  tokenSymbol?: string | null;
}

function eventPayload(event: AuditEvent): Record<string, unknown> {
  return event.payload_public ?? {};
}

function stepState(
  step: 'triggered' | 'activated' | 'acknowledged',
  succession: SuccessionRecordView | null
): 'done' | 'current' | 'todo' {
  if (!succession) return step === 'triggered' ? 'current' : 'todo';
  if (step === 'triggered') return 'done';
  if (step === 'activated') return succession.status === 'PENDING_ACK' ? 'current' : 'done';
  return succession.status === 'ACKNOWLEDGED' ? 'done' : 'todo';
}

const STEP_LABEL: Record<string, string> = {
  triggered: 'Triggered',
  activated: 'Activated',
  acknowledged: 'Acknowledged',
};

export default function SuccessionPanel({
  missionId,
  status,
  succession,
  events,
  tokenDecimals,
  tokenSymbol = null,
}: SuccessionPanelProps): React.JSX.Element {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const triggered = [...events]
    .reverse()
    .find((event) => event.event_type === 'succession.triggered');
  const triggerPayload = triggered ? eventPayload(triggered) : {};
  const candidateEvents = events.filter(
    (event) => event.event_type === 'succession.candidate_selected'
  );
  const candidates = candidateEvents.map((event) => {
    const data = eventPayload(event);
    return {
      address: typeof data['candidate'] === 'string' ? data['candidate'] : '—',
      priority: data['priority'] === undefined ? '—' : String(data['priority']),
    };
  });
  const recovery =
    tokenDecimals === null
      ? formatAtomicUnknown(succession?.recovery_max_payment_atomic)
      : `${formatTokenAmount(succession?.recovery_max_payment_atomic, tokenDecimals)}${
          tokenSymbol ? ` ${tokenSymbol}` : ''
        }`;

  async function prompt(): Promise<void> {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      const response = await fetch(`/api/missions/${missionId}/succession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError('Could not prompt the successor. Retry when the runtime is available.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not prompt the successor. Retry.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-amber-900/50 bg-amber-950/10 p-5"
      aria-label="Succession status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-amber-400">Succession</p>
          <h2 className="mt-1 text-lg font-semibold text-amber-100">
            {status === 'ACTIVE_RECOVERY'
              ? 'Mission recovered under reduced authority'
              : status === 'RECOVERING'
                ? 'Successor activated — awaiting acknowledgement'
                : 'Mission quarantined'}
          </h2>
        </div>
        {succession?.status === 'PENDING_ACK' ? (
          <button
            type="button"
            onClick={() => void prompt()}
            disabled={working}
            className="rounded-md border border-amber-700 px-3 py-1.5 text-sm text-amber-200 disabled:opacity-50"
          >
            {working ? 'Prompting…' : 'Prompt successor'}
          </button>
        ) : null}
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-3" aria-label="Succession progress">
        {(['triggered', 'activated', 'acknowledged'] as const).map((step) => {
          const state = stepState(step, succession);
          return (
            <li
              key={step}
              className={`rounded-md border px-3 py-2 text-xs ${
                state === 'done'
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
                  : state === 'current'
                    ? 'border-amber-700 bg-amber-950/40 text-amber-200'
                    : 'border-zinc-800 text-zinc-400'
              }`}
            >
              {state === 'done' ? '✓ ' : state === 'current' ? '● ' : '○ '}
              {STEP_LABEL[step]}
            </li>
          );
        })}
      </ol>

      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-400">Why succession occurred</dt>
          <dd className="mt-1 text-zinc-200">
            {typeof triggerPayload['trigger'] === 'string'
              ? triggerPayload['trigger'].replaceAll('_', ' ')
              : (succession?.trigger_type ?? 'Not triggered yet')}
            {typeof triggerPayload['outcome'] === 'string'
              ? ` — ${triggerPayload['outcome'].replaceAll('_', ' ')}`
              : ''}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Recovery authority</dt>
          <dd className="mt-1 font-mono text-zinc-200">{recovery} per payment</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Selected successor</dt>
          <dd className="mt-1 font-mono text-zinc-200">
            {succession ? shortenAddress(succession.to_agent_address, 6) : 'None selected'}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Recovery checkpoint</dt>
          <dd className="mt-1 break-all font-mono text-xs text-zinc-300">
            {succession?.checkpoint_hash
              ? `#${succession.checkpoint_sequence ?? '—'} ${shortenAddress(succession.checkpoint_hash, 6)}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Acknowledgement</dt>
          <dd className="mt-1 text-zinc-200">
            {succession?.status === 'ACKNOWLEDGED'
              ? `Acknowledged${succession.acknowledged_at ? ` at ${new Date(succession.acknowledged_at).toLocaleString()}` : ''}`
              : succession?.status === 'PENDING_ACK'
                ? 'Waiting for the successor to acknowledge'
                : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Activation proof</dt>
          <dd className="mt-1">
            {succession?.activation_tx_hash ? (
              <TransactionProof txHash={succession.activation_tx_hash} label="Activation" />
            ) : (
              <span className="font-mono text-xs text-zinc-400">—</span>
            )}
          </dd>
        </div>
      </dl>

      {candidates.length > 0 ? (
        <div className="mt-5 border-t border-amber-900/40 pt-4">
          <p className="text-xs uppercase tracking-[0.14em] text-zinc-400">Candidates considered</p>
          <ul className="mt-2 space-y-1">
            {candidates.map((candidate) => (
              <li
                key={`${candidate.address}-${candidate.priority}`}
                className="flex justify-between gap-4 text-xs"
              >
                <span className="break-all font-mono text-zinc-300">
                  {shortenAddress(candidate.address, 6)}
                </span>
                <span className="text-zinc-400">priority {candidate.priority}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {status === 'ACTIVE_RECOVERY' && succession ? (
        <p className="mt-5 rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
          Recovered under {shortenAddress(succession.to_agent_address, 6)} with the reduced recovery
          ceiling. The successor cannot expand policy or name a new successor.
        </p>
      ) : null}
      {status === 'RECOVERING' && succession?.status === 'PENDING_ACK' ? (
        <p className="mt-5 rounded-md border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          Waiting for {shortenAddress(succession.to_agent_address, 6)} to acknowledge the handoff.
          Payments remain blocked until ACTIVE_RECOVERY.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
