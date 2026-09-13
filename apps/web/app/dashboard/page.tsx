// Succra dashboard `/dashboard` (PROJECT_SPEC.md §14 screen 2, read path).
//
// Server component: requires an authenticated session (otherwise redirects
// to landing), then lists the owner's missions. Read-only in Phase 3: no
// creation UI, no detail page. Budgets shown are DB mirrors, not authority
// (AGENTS.md invariant #3).
import { redirect } from 'next/navigation';
import { server } from '@/lib/supabase';

// Session-dependent: never statically prerendered.
export const dynamic = 'force-dynamic';

interface MissionRow {
  id: string;
  name: string;
  objective: string;
  status: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  mint_address: string;
  current_agent_public_key: string;
  expires_at: string;
  created_at: string;
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect('/');
  }
  const { data, error } = await supabase
    .from('missions')
    .select(
      'id,name,objective,status,budget_atomic,remaining_budget_atomic,mint_address,current_agent_public_key,expires_at,created_at'
    )
    .eq('owner_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p role="alert" className="mt-4 rounded-lg border border-red-900 bg-red-950 p-4 text-sm">
          Could not load missions. Retry.
        </p>
      </main>
    );
  }
  const missions = (data ?? []) as MissionRow[];
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      {missions.length === 0 ? (
        <p className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-300">
          Create your first mission.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {missions.map((mission) => (
            <li key={mission.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-semibold">{mission.name}</h2>
                <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs">
                  Status: {mission.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-zinc-400">{mission.objective}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs text-zinc-300">
                <div>
                  <dt className="text-zinc-500">Budget</dt>
                  <dd>{mission.budget_atomic}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Remaining (mirror)</dt>
                  <dd>{mission.remaining_budget_atomic}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Agent</dt>
                  <dd className="break-all">{mission.current_agent_public_key}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Expires</dt>
                  <dd>{mission.expires_at}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
