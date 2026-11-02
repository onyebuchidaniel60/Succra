// `/missions/:id/succession` — detailed succession record (PROJECT_SPEC §14 screen 6).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import CheckpointCard from '@/components/CheckpointCard';
import EmptyState from '@/components/EmptyState';
import PolicyRuleList from '@/components/PolicyRuleList';
import StatusBadge from '@/components/StatusBadge';
import SuccessionPanel from '@/components/SuccessionPanel';
import Timeline from '@/components/Timeline';
import TransactionProof from '@/components/TransactionProof';
import type { AuditEvent } from '@/lib/audit/format';
import { getSessionWallet } from '@/lib/auth/session';
import { formatAtomicUnknown, formatTokenAmount, shortenAddress } from '@/lib/format';
import { getMissionDetail } from '@/lib/missions/detail';
import { server } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function amount(value: bigint | string | null | undefined, decimals: number | null): string {
  if (value === null || value === undefined) return '—';
  return decimals === null ? formatAtomicUnknown(value) : formatTokenAmount(value, decimals, 2);
}

export default async function SuccessionPage({
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

  const { data: auditData } = await supabase
    .from('audit_events')
    .select(
      'id,mission_id,event_type,actor_type,actor_id,payload_public,onchain_tx_hash,created_at'
    )
    .eq('mission_id', id)
    .order('created_at', { ascending: true });
  const events = (auditData as unknown as AuditEvent[] | null) ?? [];
  const successionEvents = events.filter((event) =>
    ['succession.', 'quarantine.', 'checkpoint.'].some((prefix) =>
      event.event_type.startsWith(prefix)
    )
  );

  const { mission, policy, onchain, tokenDecimals, tokenSymbol, checkpoints, successions } = detail;
  const succession = successions[0] ?? null;
  const latestCheckpoint = checkpoints[0] ?? null;
  const effectiveStatus = onchain?.status ?? mission.status;
  const triggered = [...events]
    .reverse()
    .find((event) => event.event_type === 'succession.triggered');
  const triggerPayload = triggered?.payload_public ?? {};
  const eligible = new Set(
    Array.isArray(triggerPayload['eligible_candidates'])
      ? (triggerPayload['eligible_candidates'] as unknown[]).filter(
          (value): value is string => typeof value === 'string'
        )
      : []
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 sm:py-14">
      <Link
        href={`/missions/${mission.id}`}
        className="text-sm text-zinc-400 underline underline-offset-4"
      >
        ← Mission
      </Link>

      <header className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Succession record</p>
          <h1 className="mt-1 text-2xl font-bold">{mission.name}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Why authority moved, which candidates were eligible, and what the successor received.
          </p>
        </div>
        <StatusBadge status={effectiveStatus} />
      </header>

      {!succession && events.every((event) => !event.event_type.startsWith('succession.')) ? (
        <div className="mt-8">
          <EmptyState
            title="No succession has been triggered"
            description="The mission has not entered quarantine and recovered through a successor."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <SuccessionPanel
            missionId={mission.id}
            status={effectiveStatus}
            succession={succession}
            events={events}
            tokenDecimals={tokenDecimals}
            tokenSymbol={tokenSymbol}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="text-sm font-semibold text-zinc-200">Trigger and checkpoint</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-zinc-400">Reason</dt>
                  <dd className="mt-1 text-zinc-200">
                    {typeof triggerPayload['trigger'] === 'string'
                      ? triggerPayload['trigger'].replaceAll('_', ' ')
                      : (succession?.trigger_type ?? '—')}
                    {typeof triggerPayload['outcome'] === 'string'
                      ? ` — ${triggerPayload['outcome'].replaceAll('_', ' ')}`
                      : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Recovery boundary</dt>
                  <dd className="mt-2">
                    <CheckpointCard
                      checkpoint={latestCheckpoint}
                      title="Latest verified checkpoint"
                    />
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="text-sm font-semibold text-zinc-200">Selected successor</h2>
              {succession ? (
                <dl className="mt-3 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-400">Address</dt>
                    <dd className="font-mono text-zinc-200">
                      {shortenAddress(succession.to_agent_address, 6)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-400">Priority</dt>
                    <dd className="text-zinc-200">
                      {detail.agents.find(
                        (agent) =>
                          agent.address.toLowerCase() === succession.to_agent_address.toLowerCase()
                      )?.priority ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Activation proof</dt>
                    <dd className="mt-1">
                      {succession.activation_tx_hash ? (
                        <TransactionProof
                          txHash={succession.activation_tx_hash}
                          label="Activation"
                        />
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-400">Acknowledgement</dt>
                    <dd className="mt-1 text-zinc-200">
                      {succession.status === 'ACKNOWLEDGED'
                        ? `Acknowledged${succession.acknowledged_at ? ` at ${new Date(succession.acknowledged_at).toLocaleString()}` : ''}`
                        : succession.status === 'PENDING_ACK'
                          ? 'Pending successor signature'
                          : succession.status}
                    </dd>
                  </div>
                  {succession.acknowledgement_tx_hash ? (
                    <div>
                      <dt className="text-zinc-400">ACK proof</dt>
                      <dd className="mt-1">
                        <TransactionProof
                          txHash={succession.acknowledgement_tx_hash}
                          label="Acknowledgement"
                        />
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-zinc-400">No successor selected yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="text-sm font-semibold text-zinc-200">Candidates considered</h2>
              {onchain && onchain.successors.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {onchain.successors.map((candidate) => {
                    const assignment = detail.agents.find(
                      (agent) => agent.address.toLowerCase() === candidate.agent.toLowerCase()
                    );
                    const isEligible =
                      eligible.has(candidate.agent) ||
                      (candidate.active &&
                        ['REGISTERED', 'ACTIVE_SUCCESSOR'].includes(assignment?.status ?? ''));
                    return (
                      <li
                        key={candidate.agent}
                        className="flex items-start justify-between gap-3 text-sm"
                      >
                        <div>
                          <p className="font-mono text-zinc-200" title={candidate.agent}>
                            {shortenAddress(candidate.agent, 6)}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-400">
                            priority {candidate.priority} · {assignment?.status ?? 'unknown'}
                          </p>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            isEligible
                              ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
                              : 'border-zinc-700 text-zinc-400'
                          }`}
                        >
                          {isEligible ? 'Eligible' : 'Not eligible'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-zinc-400">No pre-approved successors on-chain.</p>
              )}
            </section>

            <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="text-sm font-semibold text-zinc-200">Recovery authority</h2>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-400">Recovery ceiling</dt>
                  <dd className="font-mono text-zinc-300">
                    {amount(
                      succession?.recovery_max_payment_atomic ??
                        onchain?.recoveryMaxPaymentAtomic ??
                        policy?.recovery_max_payment_atomic,
                      tokenDecimals
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-400">Remaining budget</dt>
                  <dd className="font-mono text-zinc-300">
                    {amount(onchain?.budgetAtomic, tokenDecimals)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-400">Policy</dt>
                  <dd className="mt-2">
                    <PolicyRuleList policy={policy} decimals={tokenDecimals} symbol={tokenSymbol} />
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="mb-4 text-sm font-semibold text-zinc-200">Succession audit</h2>
            <Timeline events={successionEvents} decimals={tokenDecimals} symbol={tokenSymbol} />
          </section>
        </div>
      )}
    </main>
  );
}
