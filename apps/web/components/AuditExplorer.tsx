'use client';

// Audit page explorer: full timeline + selected receipt + JSON export.
import { useMemo, useState } from 'react';
import DecisionReceipt from '@/components/DecisionReceipt';
import EmptyState from '@/components/EmptyState';
import Timeline from '@/components/Timeline';
import type { AuditEvent } from '@/lib/audit/format';

export default function AuditExplorer({
  missionId,
  events,
  decimals,
  symbol,
}: {
  missionId: string;
  events: AuditEvent[];
  decimals: number | null;
  symbol: string | null;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    events.length > 0 ? (events[events.length - 1]?.id ?? null) : null
  );
  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? null,
    [events, selectedId]
  );

  function exportJson(): void {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            missionId,
            exportedAt: new Date().toISOString(),
            events,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `succra-audit-${missionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (events.length === 0) {
    return (
      <EmptyState title="No audit events" description="This mission has no immutable events yet." />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="Full mission audit timeline">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Audit trail</p>
            <h2 className="mt-1 text-lg font-semibold">All immutable events</h2>
          </div>
          <button
            type="button"
            onClick={exportJson}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors duration-150 hover:border-zinc-500"
          >
            Export JSON
          </button>
        </div>
        <Timeline
          events={events}
          groupByDay={false}
          highlight={selectedId ?? undefined}
          onSelect={(event) => setSelectedId(event.id)}
          decimals={decimals}
          symbol={symbol}
        />
      </section>
      <div className="lg:sticky lg:top-6 lg:self-start">
        {selected ? (
          <DecisionReceipt event={selected} decimals={decimals} symbol={symbol} />
        ) : (
          <EmptyState
            title="Select an event"
            description="Choose a timeline event to inspect its receipt."
          />
        )}
      </div>
    </div>
  );
}
