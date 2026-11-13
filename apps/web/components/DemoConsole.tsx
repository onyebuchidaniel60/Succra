'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import Footer from '@/components/Footer';
import {
  compact,
  DemoAuthError,
  fetchDemoState,
  formatAtomic,
  type DemoState,
} from '@/lib/demo/client';
import { useOwnerSession } from '@/lib/demo/use-owner-session';

function statusTone(status: string): string {
  if (status === 'ACTIVE') return 'border-[#e8ff63]/40 bg-[#e8ff63]/10 text-[#e8ff63]';
  if (status === 'QUARANTINED') return 'border-red-400/30 bg-red-400/10 text-red-300';
  if (status === 'RECOVERING' || status === 'ACTIVE_RECOVERY')
    return 'border-amber-400/30 bg-amber-400/10 text-amber-300';
  return 'border-zinc-700 bg-zinc-800/60 text-zinc-300';
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-2 font-mono text-2xl tracking-tight text-zinc-100">{value}</p>
      <p className="mt-1 text-[11px] text-zinc-600">{detail}</p>
    </div>
  );
}

export default function DemoConsole(): React.JSX.Element {
  const session = useOwnerSession();
  const { address, isConnected, ownerChecked, isOwner, needsUnlock, unlocking } = session;
  const [state, setState] = useState<DemoState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expire = session.expire;

  const load = useCallback(async () => {
    if (!address || !ownerChecked || needsUnlock) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchDemoState({ owner: address });
      setState(next);
      setError(null);
    } catch (cause) {
      if (cause instanceof DemoAuthError) {
        expire();
        setState(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not load missions.');
      }
    } finally {
      setLoading(false);
    }
  }, [address, ownerChecked, needsUnlock, expire]);

  useEffect(() => {
    void load();
  }, [load]);

  const missions = state?.missions ?? [];
  const hasMissions = missions.length > 0;

  const totals = useMemo(() => {
    return {
      deposited: missions.reduce(
        (sum, mission) =>
          sum + Number(formatAtomic(mission.deposited, mission.decimals).replace(/,/g, '')),
        0
      ),
      spent: missions.reduce(
        (sum, mission) =>
          sum + Number(formatAtomic(mission.spent, mission.decimals).replace(/,/g, '')),
        0
      ),
      active: missions.filter((mission) => mission.status === 'ACTIVE').length,
    };
  }, [missions]);

  const checking = isConnected && (!ownerChecked || loading || (unlocking && !state));

  return (
    <main className="reference-grid relative min-h-screen overflow-hidden bg-[#07090c] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(232,255,99,0.1),transparent_38%),radial-gradient(circle_at_85%_10%,rgba(139,92,246,0.1),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
          <Link href="/" className="flex min-w-0 items-center gap-3 sm:gap-4">
            <img src="/logo.svg" alt="Succra" className="h-8 w-8 text-[#e8ff63]" />
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#e8ff63]">Succra</p>
              <p className="text-sm text-zinc-500">Mission continuity console</p>
            </div>
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/dashboard"
              className="rounded-full border border-white/10 px-4 py-2 text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              Dashboard
            </Link>
            <Link
              href="/missions/new"
              className="rounded-full bg-[#e8ff63] px-4 py-2 font-semibold text-black transition hover:bg-[#f2ff92]"
            >
              New Mission
            </Link>
            <ConnectWalletButton />
          </div>
        </nav>

        <header className="grid gap-7 py-7 md:py-9 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#e8ff63] sm:text-xs sm:tracking-[0.24em]">
              Program-controlled vault · ERC-1271
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-tight sm:text-4xl lg:text-6xl">
              Mission control for
              <br />
              bounded agents.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
              Your dashboard is scoped to the connected wallet. Missions hold their own USDG or WIF,
              delegate revocable authority to an agent, and survive when that agent fails.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href="/missions/new"
                className="w-full rounded-full bg-[#e8ff63] px-5 py-2.5 text-center text-sm font-semibold text-black transition hover:bg-[#f2ff92] sm:w-auto"
              >
                New Mission
              </Link>
              <Link
                href="/missions/demo"
                className="w-full rounded-full border border-white/15 bg-white/[0.03] px-5 py-2.5 text-center text-sm text-zinc-200 transition hover:border-[#e8ff63]/40 hover:text-white sm:w-auto"
              >
                View Live Demo Mission →
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">Wallet access</p>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                  hasMissions
                    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                    : 'border-white/10 bg-white/[0.04] text-zinc-400'
                }`}
              >
                {hasMissions ? 'Verified owner' : isConnected ? 'No missions' : 'Not connected'}
              </span>
            </div>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                <dt className="text-zinc-500">Wallet</dt>
                <dd className="font-mono text-xs text-zinc-200">
                  {address ? compact(address, 6, 4) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                <dt className="text-zinc-500">Chain</dt>
                <dd className="font-mono text-xs text-zinc-200">
                  {state?.chainId ?? 4663}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500">Scope</dt>
                <dd className="font-mono text-xs text-zinc-200">owner-scoped</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-xl border border-white/[0.06] bg-black/20 p-3 text-[11px] leading-5 text-zinc-500">
              Private mission data requires a one-time wallet signature. Non-owner wallets only ever
              see their own empty dashboard.
            </p>
          </div>
        </header>

        {error ? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-full border border-red-300/30 px-3 py-1 text-xs transition hover:bg-red-400/10"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!isConnected ? (
          <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center sm:px-6 sm:py-16">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">No wallet</p>
            <h2 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">
              No active missions found for this wallet.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
              Connect your wallet or create a new mission.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/missions/new"
                className="rounded-full bg-[#e8ff63] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#f2ff92]"
              >
                New Mission
              </Link>
              <Link
                href="/missions/demo"
                className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-200 transition hover:border-white/30"
              >
                View Live Demo Mission
              </Link>
            </div>
          </section>
        ) : needsUnlock ? (
          <section className="rounded-3xl border border-[#e8ff63]/25 bg-[#e8ff63]/[0.05] px-4 py-9 sm:px-6 sm:py-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">
              Owner verification required
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">Verify this wallet to unlock.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
              This address owns the live mainnet missions. Sign a short message to prove wallet
              ownership. No transaction is sent and no gas is required.
            </p>
            {session.error ? (
              <p className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {session.error}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void session.unlock()}
                disabled={unlocking}
                className="rounded-full bg-[#e8ff63] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#f2ff92] disabled:cursor-wait disabled:opacity-60"
              >
                {unlocking ? 'Waiting for signature…' : 'Sign to unlock'}
              </button>
              <Link
                href="/missions/demo"
                className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-200 transition hover:border-white/30"
              >
                View Live Demo Mission
              </Link>
            </div>
          </section>
        ) : checking ? (
          <section className="grid gap-5 lg:grid-cols-2" aria-label="Loading missions">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="h-56 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.025]"
              />
            ))}
          </section>
        ) : hasMissions ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Mission totals">
              <StatCard label="Deposited" value={totals.deposited.toFixed(2)} detail="Across live vaults" />
              <StatCard label="Settled" value={totals.spent.toFixed(2)} detail="Verified x402 payments" />
              <StatCard label="Active" value={`${totals.active}/${missions.length}`} detail="Missions in force" />
              <StatCard label="Owner" value={isOwner ? 'Verified' : '—'} detail="Signature-gated access" />
            </section>

            <section className="mt-6 grid gap-5 lg:grid-cols-2" aria-label="Missions">
              {missions.map((mission) => {
                const progress = Math.min(
                  100,
                  Number(
                    (BigInt(mission.spent) * 100n) / (BigInt(mission.deposited) || 1n)
                  )
                );
                return (
                  <Link
                    key={mission.key}
                    href={`/missions/${mission.missionAddress}`}
                    data-testid={`mission-${mission.key}`}
                    className="reference-glow succra-lift succra-rise group block w-full rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.055] to-white/[0.02] p-4 sm:p-6"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
                          {mission.symbol} mission
                        </p>
                        <h2 className="mt-1 text-2xl font-semibold tracking-tight">{mission.label}</h2>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(mission.status)}`}
                      >
                        {mission.status}
                      </span>
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-zinc-500">Deposited</p>
                        <p className="mt-1 font-mono text-lg">
                          {formatAtomic(mission.deposited, mission.decimals)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Settled</p>
                        <p className="mt-1 font-mono text-lg">
                          {formatAtomic(mission.spent, mission.decimals)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Available</p>
                        <p className="mt-1 font-mono text-lg">
                          {formatAtomic(mission.available, mission.decimals)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[#e8ff63]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-zinc-500 sm:text-[11px]">
                      <span>vault {compact(mission.missionAddress, 10, 8)}</span>
                      <span className="text-[#e8ff63]/80 transition group-hover:text-[#e8ff63]">
                        Open mission →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </section>

            <section className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[1fr_0.85fr]">
              <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">
                    Continuity timeline
                  </h2>
                  <span className="text-[11px] text-zinc-600">newest first</span>
                </div>
                <ol className="mt-4 min-w-0 space-y-2">
                  {state?.events.slice(0, 8).map((item, index) => (
                    <li
                      key={`${item.hash}-${index}`}
                      className="flex min-w-0 items-start gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5"
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          item.kind === 'violation'
                            ? 'bg-amber-300'
                            : item.kind === 'quarantine'
                              ? 'bg-red-300'
                              : item.kind === 'succession'
                                ? 'bg-sky-300'
                                : item.kind === 'recovery' || item.kind === 'payment'
                                  ? 'bg-emerald-300'
                                  : 'bg-zinc-500'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-zinc-200">{item.label}</p>
                        {state?.chainId === 4663 ? (
                          <a
                            href={`https://robinhoodchain.blockscout.com/tx/${item.hash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block truncate font-mono text-[10px] text-[#e8ff63]/70 hover:text-[#e8ff63]"
                          >
                            {item.hash}
                          </a>
                        ) : (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
                            {item.hash}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.02] p-4 sm:p-6">
                <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">
                  Mission detail
                </h2>
                <p className="mt-4 text-sm leading-6 text-zinc-500">
                  Open a mission for vault balances, proof, and the Connect Agent snippet. Simulator
                  controls live in the public demo view, not on this dashboard.
                </p>
                <Link
                  href="/missions/demo"
                  className="mt-5 inline-flex rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-4 py-2 text-sm text-[#e8ff63] transition hover:bg-[#e8ff63]/15"
                >
                  Open live demo controls →
                </Link>
                <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[11px] leading-5 text-amber-100/80">
                  {state?.note ?? 'Live mainnet mode.'}
                </div>
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">
              {isOwner ? 'Owner wallet · no missions' : 'Wallet scoped'}
            </p>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">
              No active missions found for this wallet.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
              Connect your wallet or create a new mission.
            </p>
            <p className="mx-auto mt-2 max-w-md font-mono text-[11px] text-zinc-600">
              {address ? compact(address, 8, 6) : 'No wallet connected'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/missions/new"
                className="rounded-full bg-[#e8ff63] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#f2ff92]"
              >
                New Mission
              </Link>
              <Link
                href="/missions/demo"
                className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-200 transition hover:border-white/30"
              >
                View Live Demo Mission
              </Link>
            </div>
          </section>
        )}

      </div>
      <Footer />
    </main>
  );
}
