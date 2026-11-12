'use client';

import { useEffect, useState } from 'react';
import {
  compact,
  fetchDemoState,
  formatAtomic,
  type DemoMission,
  type DemoState,
} from '@/lib/demo/client';

function statusClass(status: string): string {
  if (status === 'ACTIVE') return 'border-[#e8ff63]/40 bg-[#e8ff63]/10 text-[#e8ff63]';
  if (status === 'QUARANTINED') return 'border-red-400/30 bg-red-400/10 text-red-200';
  return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
}

export default function MissionDetailPremium({ missionId }: { missionId: string }) {
  const [state, setState] = useState<DemoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchDemoState().then(setState).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load mission.');
    });
  }, []);

  const mission: DemoMission | undefined =
    state?.missions.find((candidate) => candidate.missionAddress.toLowerCase() === missionId.toLowerCase()) ??
    state?.missions[0];

  return (
    <main className="reference-grid min-h-screen bg-[#07090c] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <a href="/dashboard" className="font-mono text-xs uppercase tracking-[0.3em] text-[#e8ff63]">
            ← Succra dashboard
          </a>
          <span className="rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-3 py-1 font-mono text-[11px] text-[#e8ff63]">
            {state?.label ?? 'Live mainnet'}
          </span>
        </header>

        {error ? <p className="mt-8 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-200">{error}</p> : null}
        {!state || !mission ? (
          <p className="mt-10 text-zinc-500">Loading live mission…</p>
        ) : (
          <>
            <section className="mt-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#e8ff63]">
                  {mission.symbol} mission · {state.chainId}
                </p>
                <h1 className="mt-3 text-5xl font-semibold tracking-tight">{mission.label}</h1>
                <p className="mt-4 max-w-xl text-zinc-400">
                  Program-controlled vault with a revocable session key. The mission survives the current
                  agent; the successor inherits a lower recovery ceiling, never unrestricted authority.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <span className={`rounded-full border px-3 py-1 text-xs ${statusClass(mission.status)}`}>
                    {mission.status}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400">
                    {compact(mission.missionAddress, 12, 8)}
                  </span>
                </div>
              </div>
              <div className="reference-glow rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">Vault position</p>
                <p className="mt-3 font-mono text-5xl text-[#e8ff63]">
                  {formatAtomic(mission.available, mission.decimals)}
                </p>
                <p className="mt-1 text-sm text-zinc-500">available {mission.symbol}</p>
                <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                  <div><dt className="text-zinc-500">Deposited</dt><dd className="mt-1 font-mono">{formatAtomic(mission.deposited, mission.decimals)}</dd></div>
                  <div><dt className="text-zinc-500">Settled</dt><dd className="mt-1 font-mono">{formatAtomic(mission.spent, mission.decimals)}</dd></div>
                  <div><dt className="text-zinc-500">Recovery cap</dt><dd className="mt-1 font-mono">{formatAtomic(mission.recoveryCap, mission.decimals)}</dd></div>
                  <div><dt className="text-zinc-500">Successor</dt><dd className="mt-1 font-mono">{compact(mission.successor, 8, 6)}</dd></div>
                </dl>
              </div>
            </section>

            <section className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-400">Authority boundary</h2>
                <div className="mt-5 grid gap-4 text-sm">
                  <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Vault</span><span className="font-mono">{mission.missionAddress}</span></div>
                  <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Token</span><span className="font-mono">{mission.tokenAddress}</span></div>
                  <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Session key</span><span className="font-mono">{mission.sessionKey === '0x0000000000000000000000000000000000000000' ? 'revoked' : compact(mission.sessionKey, 12, 8)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-zinc-500">Owner</span><span className="font-mono">{compact(state.owner, 12, 8)}</span></div>
                </div>
                <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-6 text-amber-100/80">
                  WIF is shown as a vault asset, but the live WIF token is a plain ERC-20 without EIP-3009 or ERC-1271. Only USDG settles through x402 on this deployment.
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-400">Recent proof</h2>
                <ol className="mt-5 space-y-3">
                  {state.events.slice(0, 6).map((event, index) => (
                    <li key={`${event.hash}-${index}`} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                      <p className="text-sm text-zinc-200">{event.label}</p>
                      <a
                        className="mt-1 block truncate font-mono text-[10px] text-[#e8ff63]/80 hover:text-[#e8ff63]"
                        href={`https://robinhoodchain.blockscout.com/tx/${event.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {event.hash}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
