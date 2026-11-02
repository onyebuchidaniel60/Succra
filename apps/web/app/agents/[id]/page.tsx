// `/agents/:id` — owner-scoped agent identity, health, and mission roles.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AgentIdentityChip from '@/components/AgentIdentityChip';
import EmptyState from '@/components/EmptyState';
import StatusBadge from '@/components/StatusBadge';
import { getSessionWallet } from '@/lib/auth/session';
import { agentStatusView } from '@/lib/gateway/status';
import { createSupabaseAgentStore } from '@/lib/gateway/store-agents';
import { admin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function relativeTime(value: string | null): string {
  if (!value) return 'Never';
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

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSessionWallet();
  if (!session) redirect('/');

  const db = admin();
  const store = createSupabaseAgentStore(db);
  const agent = await store.getAgentById(id).catch(() => null);
  if (!agent || agent.owner_id !== session.userId) notFound();

  const status = await agentStatusView({ store, agent });
  const missionIds = status.missions.map((mission) => mission.missionId);
  const { data: missionRows } = missionIds.length
    ? await db.from('missions').select('id,name,status').in('id', missionIds)
    : { data: [] };
  const nameById = new Map(
    ((missionRows as Array<{ id: string; name: string; status: string }> | null) ?? []).map(
      (mission) => [mission.id, mission]
    )
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 sm:py-14">
      <Link href="/dashboard" className="text-sm text-zinc-400 underline underline-offset-4">
        ← Dashboard
      </Link>

      <header className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Agent</p>
            <h1 className="mt-1 text-2xl font-bold">{status.name}</h1>
            <div className="mt-3">
              <AgentIdentityChip address={status.address} label="Agent address" />
            </div>
          </div>
          <StatusBadge status={status.status} />
        </div>

        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-400">Heartbeat</dt>
            <dd className="mt-1 text-zinc-200" title={status.lastHeartbeatAt ?? 'Never'}>
              {relativeTime(status.lastHeartbeatAt)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-400">Agent ID</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-300">{status.agentId}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">Capabilities</h2>
        {status.capabilities.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No capabilities declared.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {status.capabilities.map((capability) => (
              <li
                key={capability}
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300"
              >
                {capability}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <h2 className="text-sm font-semibold text-zinc-200">Missions</h2>
        {status.missions.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No mission assignments"
              description="This agent is not attached to a mission."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-800">
            {status.missions.map((assignment) => {
              const mission = nameById.get(assignment.missionId);
              return (
                <li
                  key={assignment.missionId}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/missions/${assignment.missionId}`}
                      className="truncate text-sm font-medium text-zinc-200 underline underline-offset-4"
                    >
                      {mission?.name ?? assignment.missionId}
                    </Link>
                    <p className="mt-0.5 text-xs text-zinc-400">{assignment.role}</p>
                  </div>
                  {mission ? <StatusBadge status={mission.status} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
