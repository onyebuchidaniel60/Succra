// `/settings` — wallet, network, and developer details (PROJECT_SPEC §14 screen 8).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import EmptyState from '@/components/EmptyState';
import SettingsWalletInfo from '@/components/SettingsWalletInfo';
import WalletConnect from '@/components/WalletConnect';
import { getSessionWallet } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<React.JSX.Element> {
  const session = await getSessionWallet();
  if (!session) redirect('/');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
      <Link href="/dashboard" className="text-sm text-zinc-400 underline underline-offset-4">
        ← Dashboard
      </Link>
      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">Settings</p>
        <h1 className="mt-1 text-2xl font-bold">Wallet and network</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Succra never stores private keys. Disconnect at any time; the mission authority remains
          on-chain.
        </p>
      </header>

      <div className="mt-6 space-y-6">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Wallet</h2>
          <div className="mt-3">
            <WalletConnect authenticated />
          </div>
          <div className="mt-4 border-t border-zinc-800 pt-4">
            <SettingsWalletInfo />
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Notifications</h2>
          <div className="mt-3">
            <EmptyState
              title="Notification preferences are not available yet"
              description="MVP sends no email, push, or webhook notifications. Mission state is visible in the dashboard and audit trail."
            />
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Developer integration</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Agents authenticate with EIP-712 signed requests and never hold mission funds. The
            integration reference lives in the project documentation.
          </p>
          <a
            href="https://github.com/onyebuchidaniel60/Succra#readme"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-emerald-400 underline underline-offset-4"
          >
            Open integration documentation ↗
          </a>
        </section>
      </div>
    </main>
  );
}
