// Succra landing `/` (PROJECT_SPEC.md §14 screen 1).
import Link from 'next/link';
import ConnectWallet from '@/components/ConnectWallet';

const LIFECYCLE = [
  'Mission funded',
  'Agent executes',
  'Violation blocked',
  'Agent quarantined',
  'Successor continues',
];

const PROOF_POINTS = [
  'Mission vaults are program-controlled — agents never custody funds.',
  'Policy violations block on-chain; three in a row quarantines the agent.',
  'Pre-approved successors continue with restricted recovery authority.',
];

export default function LandingPage(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">Agents can fail. Missions continue.</h1>
        <p className="mt-4 text-zinc-400">
          Succra is a Solana-native continuity layer for autonomous economic missions.
        </p>
      </section>
      <section aria-label="Continuity lifecycle" className="w-full">
        <ol className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono text-sm">
          {LIFECYCLE.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="text-emerald-400">{String(index + 1).padStart(2, '0')}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Proof points" className="w-full">
        <ul className="flex flex-col gap-2 text-sm text-zinc-300">
          {PROOF_POINTS.map((point) => (
            <li key={point} className="flex gap-2">
              <span aria-hidden="true" className="text-emerald-400">
                ✓
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </section>
      <ConnectWallet />
      <p className="text-sm text-zinc-500">
        <Link href="/dashboard" className="underline underline-offset-4">
          Explore the dashboard
        </Link>{' '}
        (sign-in required)
      </p>
    </main>
  );
}
