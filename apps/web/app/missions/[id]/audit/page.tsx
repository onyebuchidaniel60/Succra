// `/missions/:id/audit` — two-column audit explorer (PROJECT_SPEC §14 screen 7).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import AuditExplorer from '@/components/AuditExplorer';
import StatusBadge from '@/components/StatusBadge';
import type { AuditEvent } from '@/lib/audit/format';
import { getSessionWallet } from '@/lib/auth/session';
import { getMissionDetail } from '@/lib/missions/detail';
import { server } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function AuditPage({
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

  const { data: auditData, error } = await supabase
    .from('audit_events')
    .select(
      'id,mission_id,event_type,actor_type,actor_id,payload_public,onchain_tx_hash,created_at'
    )
    .eq('mission_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <div
          role="alert"
          className="rounded-lg border border-red-900 bg-red-950 p-4 text-sm text-red-200"
        >
          Could not load the audit trail.{' '}
          <Link href={`/missions/${id}/audit`} className="underline underline-offset-4">
            Retry
          </Link>
        </div>
      </main>
    );
  }

  const events = (auditData as unknown as AuditEvent[] | null) ?? [];
  const { mission, onchain, tokenDecimals, tokenSymbol } = detail;
  return (
    <main className="mx-auto max-w-6xl px-6 py-10 sm:py-14">
      <Link
        href={`/missions/${mission.id}`}
        className="text-sm text-zinc-400 underline underline-offset-4"
      >
        ← Mission
      </Link>
      <header className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Audit</p>
          <h1 className="mt-1 text-2xl font-bold">{mission.name}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Deterministic facts and HashKey proofs. AI explanations are never shown as proof.
          </p>
        </div>
        <StatusBadge status={onchain?.status ?? mission.status} />
      </header>

      <div className="mt-8">
        <AuditExplorer
          missionId={mission.id}
          events={events}
          decimals={tokenDecimals}
          symbol={tokenSymbol}
        />
      </div>
    </main>
  );
}
