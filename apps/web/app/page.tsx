// Succra landing `/` (PROJECT_SPEC.md §14 screen 1).
import Link from 'next/link';
import WalletConnect from '@/components/WalletConnect';

const PROOF_POINTS = [
  {
    title: 'Bounded authority',
    body: 'Every mission commits its budget, merchant allowlist, per-payment ceiling, and expiry on HashKey Chain.',
    icon: '◎',
  },
  {
    title: 'Unsafe authority is quarantined',
    body: 'Policy violations block on-chain. Three consecutive violations quarantine the current agent.',
    icon: '⛨',
  },
  {
    title: 'A successor continues',
    body: 'A pre-approved successor receives verified mission state and a reduced recovery ceiling. Funds never leave the owner’s wallet.',
    icon: '↪',
  },
];

const LIFECYCLE = [
  'Mission created',
  'Agent executes',
  'Violation blocked',
  'Agent quarantined',
  'Successor continues',
];

export default function LandingPage(): React.JSX.Element {
  const demoMissionId = process.env.NEXT_PUBLIC_DEMO_MISSION_ID;
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10 sm:py-16">
      <nav className="flex items-center justify-between gap-4">
        <Link href="/" className="font-mono text-sm font-semibold tracking-[0.18em] text-zinc-100">
          SUCCRA
        </Link>
        <div className="flex items-center gap-4 text-sm">
          {demoMissionId ? (
            <Link
              href={`/missions/${demoMissionId}`}
              className="hidden text-zinc-400 underline underline-offset-4 sm:inline"
            >
              Demo mission
            </Link>
          ) : null}
          <Link href="/dashboard" className="text-zinc-400 underline underline-offset-4">
            Dashboard
          </Link>
        </div>
      </nav>

      <section className="mt-20 grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-emerald-400">
            Mission continuity on HashKey Chain
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Agents can fail.
            <br />
            Missions continue.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-zinc-400">
            Succra is the continuity layer for autonomous agent payments on HashKey Chain. It
            controls authority, never custody.
          </p>
          <div className="mt-8">
            <WalletConnect redirectTo="/dashboard" />
          </div>
          {!demoMissionId ? (
            <p className="mt-4 text-xs text-zinc-400">
              No demo mission configured. Set NEXT_PUBLIC_DEMO_MISSION_ID to link one here.
            </p>
          ) : null}
        </div>

        <ol className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 font-mono text-sm">
          {LIFECYCLE.map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-3 border-b border-zinc-800 py-3 last:border-0"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-800 text-[11px] text-emerald-300">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span
                className={index === LIFECYCLE.length - 1 ? 'text-emerald-300' : 'text-zinc-300'}
              >
                {step}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-3" aria-label="Why Succra">
        {PROOF_POINTS.map((point) => (
          <article
            key={point.title}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors duration-150 hover:border-zinc-700"
          >
            <span aria-hidden="true" className="text-xl text-emerald-400">
              {point.icon}
            </span>
            <h2 className="mt-3 font-semibold text-zinc-100">{point.title}</h2>
            <p className="mt-2 text-sm text-zinc-400">{point.body}</p>
          </article>
        ))}
      </section>

      <footer className="mt-auto pt-16 text-xs text-zinc-400">
        Funds remain in the owner’s wallet. Succra controls authority, not custody.
      </footer>
    </main>
  );
}
