// `/missions/:id` — full mission detail with timeline and decision receipts.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AgentIdentityChip from '@/components/AgentIdentityChip';
import AuthorityMeter from '@/components/AuthorityMeter';
import CheckpointCard from '@/components/CheckpointCard';
import MissionActions from '@/components/MissionActions';
import MissionTimelinePanel from '@/components/MissionTimelinePanel';
import PolicyRuleList from '@/components/PolicyRuleList';
import StatusBadge from '@/components/StatusBadge';
import SuccessionPanel from '@/components/SuccessionPanel';
import { formatAtomicUnknown, formatTokenAmount } from '@/lib/format';
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
  const { mission, policy, onchain, tokenDecimals, tokenSymbol, checkpoints, successions, agents } =
    detail;
  const effectiveStatus = onchain?.status ?? mission.status;
  const succession = successions[0] ?? null;
  const latestCheckpoint = checkpoints[0] ?? null;
  const currentAgentRecord = agents.find(
    (agent) =>
      agent.address.toLowerCase() ===
      (onchain?.currentAgent ?? mission.current_agent_address).toLowerCase()
  );

  const budget = onchain?.budgetAtomic ?? BigInt(mission.budget_atomic);
  const spent = onchain?.confirmedSpentAtomic ?? budget - BigInt(mission.remaining_budget_atomic);
  const remaining = budget > spent ? budget - spent : 0n;
  const perPayment =
    onchain?.maxPaymentAtomic ??
    (policy?.max_payment_atomic ? BigInt(policy.max_payment_atomic) : null);
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
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Mission</p>
            <h1 className="mt-1 text-2xl font-bold">{mission.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">{mission.objective}</p>
          </div>
          <StatusBadge status={effectiveStatus} />
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link
            href={`/missions/${mission.id}/audit`}
            className="text-emerald-400 underline underline-offset-4"
          >
            Full audit
          </Link>
          {effectiveStatus !== 'ACTIVE' ? (
            <Link
              href={`/missions/${mission.id}/succession`}
              className="text-amber-300 underline underline-offset-4"
            >
              Succession record
            </Link>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Remaining budget</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">
              {amount(remaining, tokenDecimals)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Per-payment ceiling</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">
              {amount(perPayment, tokenDecimals)}
            </p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Current agent</p>
            <div className="mt-1">
              <AgentIdentityChip address={currentAgent} role="Agent" />
              {currentAgentRecord ? (
                <Link
                  href={`/agents/${currentAgentRecord.agent_id}`}
                  className="mt-2 inline-block text-xs text-emerald-400 underline underline-offset-2"
                >
                  Agent page
                </Link>
              ) : null}
            </div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <p className="text-xs text-zinc-400">Violations</p>
            <p className="mt-1 font-mono text-lg text-zinc-100">
              {violationCount === null
                ? '—'
                : `${violationCount} / ${policy?.violation_threshold ?? '—'}`}
            </p>
          </div>
        </div>
      </header>

      {effectiveStatus === 'QUARANTINED' ||
      effectiveStatus === 'RECOVERING' ||
      effectiveStatus === 'ACTIVE_RECOVERY' ? (
        <div className="mt-6">
          <SuccessionPanel
            missionId={mission.id}
            status={effectiveStatus}
            succession={succession}
            events={events}
            tokenDecimals={tokenDecimals}
            tokenSymbol={tokenSymbol}
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <section
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5"
            aria-label="Mission budget"
          >
            <h2 className="mb-4 text-sm font-semibold text-zinc-200">Authority meter</h2>
            <AuthorityMeter
              spentAtomic={spent}
              budgetAtomic={budget}
              perPaymentAtomic={perPayment}
              decimals={tokenDecimals}
              symbol={tokenSymbol}
            />
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <MissionTimelinePanel events={events} decimals={tokenDecimals} symbol={tokenSymbol} />
          </section>
        </div>

        <aside className="space-y-4">
          <MissionActions
            missionId={mission.id}
            status={effectiveStatus}
            hasPendingSuccession={succession?.status === 'PENDING_ACK'}
          />

          <CheckpointCard checkpoint={latestCheckpoint} />

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
            <h2 className="text-sm font-semibold text-zinc-200">Authority</h2>
            <div className="mt-3">
              <PolicyRuleList policy={policy} decimals={tokenDecimals} symbol={tokenSymbol} />
            </div>
            <dl className="mt-4 space-y-2 border-t border-zinc-800 pt-4 text-xs">
              <div>
                <dt className="text-zinc-400">Contract</dt>
                <dd className="mt-1 break-all font-mono text-zinc-300">
                  {mission.contract_address}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Payment token</dt>
                <dd className="mt-1 break-all font-mono text-zinc-300">
                  {mission.payment_token_address}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-400">Policy hash</dt>
                <dd className="mt-1 break-all font-mono text-zinc-300">{mission.policy_hash}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}
