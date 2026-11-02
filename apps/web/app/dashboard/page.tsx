// Succra dashboard `/dashboard` (PROJECT_SPEC.md §14 screen 2).
//
// Server component: requires an authenticated session (otherwise redirects
// to landing), then lists the owner's missions from the HashKey-shaped
// mirror columns. Budgets shown are DB mirrors, not authority
// (AGENTS.md invariant #3).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import MissionCard, { type MissionCardData } from '@/components/MissionCard';
import { formatAuditEvent, type AuditEvent } from '@/lib/audit/format';
import { readTokenDecimals, readTokenSymbol } from '@/lib/token-decimals';
import { server } from '@/lib/supabase';

// Session-dependent: never statically prerendered.
export const dynamic = 'force-dynamic';

interface MissionRow extends MissionCardData {
  payment_token_address: string;
  expires_at: string;
}

const DASHBOARD_COLUMNS =
  'id,name,objective,status,budget_atomic,remaining_budget_atomic,contract_address,' +
  'payment_token_address,current_agent_address,expires_at,created_at,updated_at';

export default async function DashboardPage(): Promise<React.JSX.Element> {
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect('/');
  }
  const { data, error } = await supabase
    .from('missions')
    .select(DASHBOARD_COLUMNS)
    .eq('owner_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div
          role="alert"
          className="mt-4 flex flex-col gap-3 rounded-lg border border-red-900 bg-red-950 p-4 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Could not load missions.</span>
          <Link
            href="/dashboard"
            className="rounded-md border border-red-800 px-3 py-1.5 font-medium text-red-100"
          >
            Retry
          </Link>
        </div>
      </main>
    );
  }
  const missions = (data ?? []) as unknown as MissionRow[];
  const decimalsByToken = new Map<string, number | null>();
  const symbolsByToken = new Map<string, string | null>();
  await Promise.all(
    [...new Set(missions.map((mission) => mission.payment_token_address))].map(async (token) => {
      const [decimals, symbol] = await Promise.all([
        readTokenDecimals(token).catch(() => null),
        readTokenSymbol(token).catch(() => null),
      ]);
      decimalsByToken.set(token, decimals);
      symbolsByToken.set(token, symbol);
    })
  );
  const latestByMission = new Map<string, { title: string; severity: string } | null>();
  const successionByMission = new Map<string, string | null>();
  await Promise.all(
    missions.map(async (mission) => {
      const { data: audit } = await supabase
        .from('audit_events')
        .select(
          'id,mission_id,event_type,actor_type,actor_id,payload_public,onchain_tx_hash,created_at'
        )
        .eq('mission_id', mission.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (audit) {
        const formatted = formatAuditEvent(audit as unknown as AuditEvent, {
          decimals: decimalsByToken.get(mission.payment_token_address) ?? null,
          symbol: symbolsByToken.get(mission.payment_token_address) ?? null,
        });
        latestByMission.set(mission.id, {
          title: formatted.title,
          severity: formatted.severity,
        });
      } else {
        latestByMission.set(mission.id, null);
      }
      if (mission.status !== 'ACTIVE') {
        const { data: succession } = await supabase
          .from('succession_events')
          .select('status')
          .eq('mission_id', mission.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        successionByMission.set(
          mission.id,
          (succession as { status?: string } | null)?.status ?? null
        );
      }
    })
  );
  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">Mission control</p>
          <h1 className="mt-1 text-2xl font-bold">Dashboard</h1>
        </div>
        <div className="flex w-full gap-3 sm:w-auto">
          <Link
            href="/settings"
            className="inline-flex flex-1 items-center justify-center rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500 sm:flex-none"
          >
            Settings
          </Link>
          <Link
            href="/missions/new"
            className="inline-flex flex-1 items-center justify-center rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 sm:flex-none"
          >
            New mission
          </Link>
        </div>
      </div>

      {missions.length === 0 ? (
        <section className="mt-10 rounded-lg border border-dashed border-zinc-800 bg-zinc-900/50 p-10 text-center">
          <h2 className="text-lg font-semibold">Create your first mission</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
            Define a budget, allowlisted merchants, a primary agent, and pre-approved successors.
          </p>
          <Link
            href="/missions/new"
            className="mt-5 inline-flex rounded-md border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-950"
          >
            Start mission setup
          </Link>
        </section>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {missions.map((mission) => (
            <li key={mission.id}>
              <MissionCard
                mission={mission}
                decimals={decimalsByToken.get(mission.payment_token_address) ?? null}
                latestEvent={latestByMission.get(mission.id) ?? undefined}
                successionStatus={successionByMission.get(mission.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
