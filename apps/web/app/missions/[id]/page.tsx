// `/missions/:id` — owner-scoped mission overview.
//
// Phase 7a: surfaces the newly created on-chain mission so the wizard has a
// real landing page. The audit timeline and decision receipts are added in
// Phase 7b without changing this route.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { formatAtomic, shortenAddress, statusTone } from '@/lib/format';
import { server } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface MissionRow {
  id: string;
  name: string;
  objective: string;
  status: string;
  contract_address: string;
  payment_token_address: string;
  current_agent_address: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  policy_hash: string;
  expires_at: string;
  created_at: string;
}

interface PolicyDocument {
  max_payment_atomic?: string;
  recovery_max_payment_atomic?: string;
  violation_threshold?: number;
  violation_window_seconds?: number;
  cart_mandate_id?: string;
}

export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/');

  const { data, error } = await supabase
    .from('missions')
    .select(
      'id,name,objective,status,contract_address,payment_token_address,current_agent_address,' +
        'budget_atomic,remaining_budget_atomic,policy_hash,expires_at,created_at'
    )
    .eq('id', id)
    .eq('owner_id', auth.user.id)
    .maybeSingle();
  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16">
        <div
          role="alert"
          className="rounded-lg border border-red-900 bg-red-950 p-4 text-sm text-red-200"
        >
          Could not load this mission.{' '}
          <Link href={`/missions/${id}`} className="underline underline-offset-4">
            Retry
          </Link>
        </div>
      </main>
    );
  }
  if (!data) notFound();
  const mission = data as unknown as MissionRow;

  const { data: policyData } = await supabase
    .from('mission_policies')
    .select('policy_json')
    .eq('mission_id', mission.id)
    .eq('version', 1)
    .maybeSingle();
  const policy = (policyData?.policy_json ?? {}) as PolicyDocument;
  const tone = statusTone(mission.status);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 sm:py-14">
      <Link href="/dashboard" className="text-sm text-zinc-400 underline underline-offset-4">
        ← Dashboard
      </Link>
      <header className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/70 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{mission.name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">{mission.objective}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${tone.className}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dotClassName}`} />
            {tone.label}
          </span>
        </div>
        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-zinc-500">Remaining budget</dt>
            <dd className="mt-1 font-mono text-lg text-zinc-100">
              {formatAtomic(mission.remaining_budget_atomic)} /{' '}
              {formatAtomic(mission.budget_atomic)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Per-payment ceiling</dt>
            <dd className="mt-1 font-mono text-lg text-zinc-100">
              {formatAtomic(policy.max_payment_atomic)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Current agent</dt>
            <dd
              className="mt-1 break-all font-mono text-sm text-zinc-200"
              title={mission.current_agent_address}
            >
              {shortenAddress(mission.current_agent_address, 6)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Contract</dt>
            <dd
              className="mt-1 break-all font-mono text-xs text-zinc-300"
              title={mission.contract_address}
            >
              {mission.contract_address}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Settlement token</dt>
            <dd
              className="mt-1 break-all font-mono text-xs text-zinc-300"
              title={mission.payment_token_address}
            >
              {mission.payment_token_address}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Expires</dt>
            <dd className="mt-1 text-zinc-200">{new Date(mission.expires_at).toLocaleString()}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-lg font-semibold">Mission authority</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Policy hash</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-300">
              {mission.policy_hash}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Recovery ceiling</dt>
            <dd className="mt-1 font-mono text-zinc-200">
              {formatAtomic(policy.recovery_max_payment_atomic)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Violation threshold</dt>
            <dd className="mt-1 text-zinc-200">
              {policy.violation_threshold ?? '—'} within {policy.violation_window_seconds ?? '—'}s
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Cart Mandate (mock)</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-300">
              {policy.cart_mandate_id ?? '—'}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
