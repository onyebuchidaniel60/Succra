'use client';

// Mission detail centerpiece: timeline plus the selected decision receipt.
import { useState } from 'react';
import DecisionReceipt from '@/components/DecisionReceipt';
import Timeline from '@/components/Timeline';
import type { AuditEvent } from '@/lib/audit/format';

export default function MissionTimelinePanel({
  events,
  decimals = null,
  symbol = null,
}: {
  events: AuditEvent[];
  decimals?: number | null;
  symbol?: string | null;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    events.length > 0 ? (events[events.length - 1]?.id ?? null) : null
  );
  const selected = events.find((event) => event.id === selectedId) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-label="Mission activity">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Mission timeline</p>
            <h2 className="mt-1 text-lg font-semibold">Everything that happened</h2>
          </div>
          <span className="text-xs text-zinc-400">{events.length} events</span>
        </div>
        <Timeline
          events={events}
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
          <div className="rounded-xl border border-dashed border-zinc-800 p-6 text-sm text-zinc-400">
            Select a timeline event to inspect its decision receipt.
          </div>
        )}
      </div>
    </div>
  );
}
