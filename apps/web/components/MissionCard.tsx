// Succra — mission summary card used by the dashboard.
import Link from 'next/link';
import { formatAtomicUnknown, formatTokenAmount, shortenAddress, statusTone } from '@/lib/format';

export interface MissionCardData {
  id: string;
  name: string;
  objective: string;
  status: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  contract_address: string;
  current_agent_address: string;
  updated_at: string;
  created_at: string;
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

export default function MissionCard({
  mission,
  decimals,
  latestEvent,
  successionStatus,
}: {
  mission: MissionCardData;
  decimals: number | null;
  latestEvent?: { title: string; severity: string } | undefined;
  successionStatus?: string | null | undefined;
}): React.JSX.Element {
  const tone = statusTone(mission.status);
  const lastActivity = mission.updated_at || mission.created_at;
  const remaining =
    decimals === null
      ? formatAtomicUnknown(mission.remaining_budget_atomic)
      : formatTokenAmount(mission.remaining_budget_atomic, decimals);
  const budget =
    decimals === null
      ? formatAtomicUnknown(mission.budget_atomic)
      : formatTokenAmount(mission.budget_atomic, decimals);
  return (
    <Link
      href={`/missions/${mission.id}`}
      className="block h-full rounded-lg border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-zinc-600"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-semibold text-zinc-100">{mission.name}</h2>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone.className}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dotClassName}`} />
          {tone.label}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{mission.objective}</p>
      {latestEvent ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              latestEvent.severity === 'danger'
                ? 'bg-red-400'
                : latestEvent.severity === 'warning'
                  ? 'bg-amber-400'
                  : latestEvent.severity === 'success'
                    ? 'bg-emerald-400'
                    : 'bg-blue-400'
            }`}
          />
          <span className="truncate">{latestEvent.title}</span>
        </p>
      ) : null}
      {successionStatus ? (
        <p className="mt-2 inline-flex rounded-full border border-amber-800/60 bg-amber-950/40 px-2 py-0.5 text-xs text-amber-300">
          Succession: {successionStatus.replaceAll('_', ' ')}
        </p>
      ) : null}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="text-zinc-500">Remaining budget</dt>
          <dd className="mt-0.5 font-mono text-sm text-zinc-200">
            {remaining} / {budget}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Current agent</dt>
          <dd
            className="mt-0.5 font-mono text-sm text-zinc-200"
            title={mission.current_agent_address}
          >
            {shortenAddress(mission.current_agent_address)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Contract</dt>
          <dd className="mt-0.5 font-mono text-sm text-zinc-200" title={mission.contract_address}>
            {shortenAddress(mission.contract_address)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Last activity</dt>
          <dd className="mt-0.5 text-sm text-zinc-300">
            <time dateTime={lastActivity}>{relativeTime(lastActivity)}</time>
          </dd>
        </div>
      </dl>
    </Link>
  );
}
