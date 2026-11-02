'use client';

// Mission timeline. Read-only presentation of immutable audit_events.
import { useMemo } from 'react';
import {
  actorLabel,
  checkpointPendingStates,
  duplicateCheckpointSequences,
  formatAuditEvent,
  type AuditEvent,
} from '@/lib/audit/format';

export interface TimelineProps {
  events: AuditEvent[];
  highlight?: string | undefined;
  onSelect?: ((event: AuditEvent) => void) | undefined;
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const delta = Date.now() - time;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function dayKey(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toDateString() : value;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const SEVERITY_DOT: Record<string, string> = {
  success: 'bg-emerald-400 ring-emerald-950',
  warning: 'bg-amber-400 ring-amber-950',
  danger: 'bg-red-400 ring-red-950',
  info: 'bg-blue-400 ring-blue-950',
};

const SEVERITY_TEXT: Record<string, string> = {
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
  info: 'text-blue-300',
};

export default function Timeline({
  events,
  highlight,
  onSelect,
}: TimelineProps): React.JSX.Element {
  const pending = useMemo(() => checkpointPendingStates(events), [events]);
  const duplicateSequences = useMemo(() => duplicateCheckpointSequences(events), [events]);
  const ordered = useMemo(
    () =>
      [...events].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)),
    [events]
  );
  const grouped = useMemo(() => {
    const groups: Array<{ key: string; label: string; events: AuditEvent[] }> = [];
    for (const event of ordered) {
      const key = dayKey(event.created_at);
      const group = groups[groups.length - 1];
      if (!group || group.key !== key) {
        groups.push({ key, label: dayLabel(event.created_at), events: [event] });
      } else {
        group.events.push(event);
      }
    }
    return groups;
  }, [ordered]);

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-400">
        No mission events yet. The timeline will fill as the mission executes.
      </div>
    );
  }

  return (
    <div className="space-y-8" aria-label="Mission timeline">
      {grouped.map((group) => (
        <section key={group.key}>
          <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            {group.label}
          </h3>
          <ol className="space-y-0">
            {group.events.map((event, index) => {
              const formatted = formatAuditEvent(event);
              const isLast = index === group.events.length - 1;
              const sequence = Number(event.payload_public?.['sequence']);
              const duplicate =
                event.event_type === 'checkpoint.verified' && duplicateSequences.has(sequence);
              const checkpointPending = pending.get(event.id) === true;
              return (
                <li key={event.id} className="relative flex gap-4 pb-6">
                  {!isLast ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-zinc-800"
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={`relative mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-4 ${SEVERITY_DOT[formatted.severity] ?? SEVERITY_DOT['info']}`}
                  >
                    <span className="text-[9px] font-bold text-zinc-950">{formatted.icon}</span>
                  </span>
                  <div
                    className={`min-w-0 flex-1 rounded-lg border p-4 transition-colors ${
                      highlight === event.id
                        ? 'border-emerald-700 bg-emerald-950/20'
                        : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <button
                        type="button"
                        onClick={() => onSelect?.(event)}
                        className="min-w-0 text-left"
                      >
                        <span
                          className={`block text-sm font-semibold ${SEVERITY_TEXT[formatted.severity] ?? SEVERITY_TEXT['info']}`}
                        >
                          {formatted.title}
                        </span>
                        <span className="mt-1 block text-sm text-zinc-400">
                          {formatted.description}
                        </span>
                      </button>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
                          {actorLabel(event.actor_type)}
                        </span>
                        <time
                          dateTime={event.created_at}
                          title={new Date(event.created_at).toLocaleString()}
                          suppressHydrationWarning
                          className="text-[11px] text-zinc-500"
                        >
                          {relativeTime(event.created_at)}
                        </time>
                        {formatted.proofLink ? (
                          <a
                            href={formatted.proofLink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="View on Blockscout"
                            className="text-xs text-emerald-400 underline underline-offset-2"
                          >
                            Proof ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {checkpointPending ? (
                      <p className="mt-3 inline-flex rounded-full border border-amber-800 bg-amber-950/50 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                        ⚠ Checkpoint pending
                      </p>
                    ) : null}
                    {duplicate ? (
                      <p className="mt-3 inline-flex rounded-full border border-red-800 bg-red-950/50 px-2 py-0.5 text-[11px] font-medium text-red-300">
                        ⛔ Duplicate checkpoint sequence {sequence}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
