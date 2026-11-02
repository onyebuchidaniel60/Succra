// `/missions/:id` — full mission detail with timeline and decision receipts.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import MissionActions from '@/components/MissionActions';
import MissionTimelinePanel from '@/components/MissionTimelinePanel';
import SuccessionPanel from '@/components/SuccessionPanel';
import { formatAtomicUnknown, formatTokenAmount, shortenAddress, statusTone } from '@/lib/format';
import type { AuditEvent } from '@/lib/audit/format';
import { getSessionWallet } from '@/lib/auth/session';
import { getMissionDetail } from '@/lib/missions/detail';
import { server } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function amount(value: bigint | string | null | undefined, decimals: number | null): string {
  if (value === null || value === undefined) return '—';
  return decimals === null ? formatAtomicUnknown(value) : formatTokenAmount(value, decimals, 2);
}

export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSessionWallet();
  if (!session) redirect('/');

  const supabase = await server();
  const detail = await getMissionDetail(supabase, id, session.userId).catch(() => null);
  if (!detail) notFound();

  const { data: auditData, error: auditError } = await supabase
    .from('audit_events')
    .select(
      'id,mission_id,event_type,actor_type,actor_id,payload_public,onchain_tx_hash,created_at'
    )
    .eq('mission_id', id)
    .order('created_at', { ascending: true });
  if (auditError) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <div
          role="alert"
          className="rounded-lg border border-red-900 bg-red-950 p-4 text-sm text-red-200"
        >
          Could not load the mission timeline.{' '}
          <Link href={`/missions/${id}`} className="underline underline-offset-4">
            Retry
          </Link>
        </div>
      </main>
    );
  }
  const events = (auditData as unknown as AuditEvent[] | null) ?? [];
  const { mission, policy, onchain, tokenDecimals, checkpoints, successions } = detail;
  const tone = statusTone(mission.status);
  const succession = successions[0] ?? null;
  const latestCheckpoint = checkpoints[0] ?? null;

  const budget = onchain?.budgetAtomic ?? BigInt(mission.budget_atomic);
  const spent = onchain?.confirmedSpentAtomic ?? budget - BigInt(mission.remaining_budget_atomic);
  const remaining = budget > spent ? budget - spent : 0n;
  const perPayment =
    onchain?.maxPaymentAtomic ??
    (policy?.max_payment_atomic ? BigInt(policy.max_payment_atomic) : null);
  const recoveryCeiling =
    onchain?.recoveryMaxPaymentAtomic ??
    (policy?.recovery_max_payment_atomic ? BigInt(policy.recovery_max_payment_atomic) : null);
  const violationCount = onchain?.violationCount ?? null;
  const currentAgent = onchain?.currentAgent ?? mission.current_agent_address;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
      <Link href="/dashboard" className="text-sm text-zinc-400 underline underline-offset-4">
        ← Dashboard
      </Link>

      <header className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Mission</p>
            <h1 className="mt-1 text-2xl font-bold">{mission.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">{mission.objective}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tone.className}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dotClassName}`} />
            {tone.label}
          </span>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-500">Remaining budget</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">
              {amount(remaining, tokenDecimals)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-500">Per-payment ceiling</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">
              {amount(perPayment, tokenDecimals)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-500">Current agent</p>
            <p className="mt-1 font-mono text-sm text-zinc-100" title={currentAgent}>
              {shortenAddress(currentAgent, 6)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-500">Violations</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">
              {violationCount === null
                ? '—'
                : `${violationCount} / ${policy?.violation_threshold ?? '—'}`}
            </p>
          </div>
        </div>
      </header>

      {mission.status === 'QUARANTINED' ||
      mission.status === 'RECOVERING' ||
      mission.status === 'ACTIVE_RECOVERY' ? (
        <div className="mt-6">
          <SuccessionPanel
            missionId={mission.id}
            status={mission.status}
            succession={succession}
            events={events}
            tokenDecimals={tokenDecimals}
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Mission budget">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">Total budget</p>
              <p className="mt-1 font-mono text-zinc-200">{amount(budget, tokenDecimals)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">Spent</p>
              <p className="mt-1 font-mono text-zinc-200">{amount(spent, tokenDecimals)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">Remaining</p>
              <p className="mt-1 font-mono text-zinc-200">{amount(remaining, tokenDecimals)}</p>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <MissionTimelinePanel events={events} />
          </section>
        </div>

        <aside className="space-y-4">
          <MissionActions
            missionId={mission.id}
            status={mission.status}
            hasPendingSuccession={succession?.status === 'PENDING_ACK'}
          />

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
            <h2 className="text-sm font-semibold text-zinc-200">Latest checkpoint</h2>
            {latestCheckpoint ? (
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Sequence</dt>
                  <dd className="font-mono text-zinc-300">#{latestCheckpoint.sequence}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Hash</dt>
                  <dd className="mt-1 break-all font-mono text-zinc-300">
                    {latestCheckpoint.checkpoint_hash}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Committed</dt>
                  <dd className="mt-1 text-zinc-300">
                    {new Date(latestCheckpoint.created_at).toLocaleString()}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">No verified checkpoint yet.</p>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
            <h2 className="text-sm font-semibold text-zinc-200">Authority</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Recovery ceiling</dt>
                <dd className="font-mono text-zinc-300">
                  {amount(recoveryCeiling, tokenDecimals)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">Violation window</dt>
                <dd className="text-zinc-300">{policy?.violation_window_seconds ?? '—'}s</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Contract</dt>
                <dd className="mt-1 break-all font-mono text-zinc-300">
                  {mission.contract_address}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Payment token</dt>
                <dd className="mt-1 break-all font-mono text-zinc-300">
                  {mission.payment_token_address}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Policy hash</dt>
                <dd className="mt-1 break-all font-mono text-zinc-300">{mission.policy_hash}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
