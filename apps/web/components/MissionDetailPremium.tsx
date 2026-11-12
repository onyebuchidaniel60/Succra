'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import CopyButton from '@/components/CopyButton';
import {
  backendUrl,
  compact,
  DemoAuthError,
  fetchDemoState,
  formatAtomic,
  postDemoAction,
  type DemoMission,
  type DemoState,
} from '@/lib/demo/client';
import { useOwnerSession } from '@/lib/demo/use-owner-session';

const SIMULATOR_ACTIONS = [
  { action: 'usdg-payment', label: 'Run USDG payment', tone: 'emerald' },
  { action: 'violations', label: 'Inject 3 violations', tone: 'amber' },
  { action: 'quarantine', label: 'Quarantine + withdraw', tone: 'red' },
  { action: 'succession', label: 'Activate successor', tone: 'blue' },
  { action: 'recovery', label: 'Recovery payment', tone: 'emerald' },
  { action: 'deposit-usdg', label: 'Top up 0.10 USDG', tone: 'violet' },
] as const;

function statusClass(status: string): string {
  if (status === 'ACTIVE') return 'border-[#e8ff63]/40 bg-[#e8ff63]/10 text-[#e8ff63]';
  if (status === 'QUARANTINED') return 'border-red-400/30 bg-red-400/10 text-red-200';
  return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
}

function toneClass(tone: string): string {
  if (tone === 'red') return 'border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/15';
  if (tone === 'amber') return 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15';
  if (tone === 'violet') return 'border-violet-400/30 bg-violet-400/10 text-violet-200 hover:bg-violet-400/15';
  if (tone === 'blue') return 'border-sky-400/30 bg-sky-400/10 text-sky-200 hover:bg-sky-400/15';
  return 'border-[#e8ff63]/40 bg-[#e8ff63] text-black hover:bg-[#f2ff92]';
}

export default function MissionDetailPremium({
  missionId,
  demo = false,
}: {
  missionId: string;
  demo?: boolean;
}) {
  const session = useOwnerSession();
  const { address, isConnected, ownerChecked, needsUnlock, unlocking } = session;
  const [state, setState] = useState<DemoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const expire = session.expire;

  const load = useCallback(async () => {
    if (demo) {
      setLoading(true);
      try {
        setState(await fetchDemoState({ demo: true }));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the demo mission.');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!address || !ownerChecked) {
      setState(null);
      setLoading(Boolean(address));
      return;
    }
    if (needsUnlock) {
      setState(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setState(await fetchDemoState({ owner: address }));
      setError(null);
    } catch (cause) {
      if (cause instanceof DemoAuthError) {
        expire();
        setState(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not load the mission.');
      }
    } finally {
      setLoading(false);
    }
  }, [demo, address, ownerChecked, needsUnlock, expire]);

  useEffect(() => {
    void load();
  }, [load]);

  const mission: DemoMission | undefined = useMemo(() => {
    if (!state) return undefined;
    if (demo || missionId === 'demo') {
      return state.missions.find((candidate) => candidate.key === 'usdg') ?? state.missions[0];
    }
    return state.missions.find(
      (candidate) => candidate.missionAddress.toLowerCase() === missionId.toLowerCase()
    );
  }, [state, demo, missionId]);

  const run = async (action: string) => {
    setPending(action);
    setActionError(null);
    try {
      setState(await postDemoAction(action, { demo: true }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Mission action failed.');
    } finally {
      setPending(null);
    }
  };

  const agentSnippet = `const MISSION_VAULT = "${mission?.missionAddress ?? '0x...'}";

// Public simulation for this live mission.
await fetch("${backendUrl()}/api/demo?demo=true", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "usdg-payment" }),
});

// Production agents use EIP-712 signed requests:
// POST /api/agents/:agentId/challenge
// POST /api/agents/:agentId/verify
// POST /api/missions/:missionId/actions
// Headers: x-succra-agent-address, x-succra-timestamp,
//          x-succra-nonce, x-succra-signature`;

  return (
    <main className="reference-grid min-h-screen bg-[#07090c] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-6xl">
        <nav className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-5">
            <Link
              href="/dashboard"
              className="font-mono text-xs uppercase tracking-[0.22em] text-[#e8ff63] transition hover:text-[#f2ff92]"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/missions/new"
              className="rounded-full border border-white/10 px-4 py-2 text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              New Mission
            </Link>
            <ConnectWalletButton />
          </div>
        </nav>

        {demo ? (
          <div className="mt-5 rounded-2xl border border-[#e8ff63]/25 bg-[#e8ff63]/[0.05] px-4 py-3 text-xs leading-6 text-[#e8ff63]/90">
            <span className="font-mono uppercase tracking-[0.18em]">Live demo view</span> · This
            mission is owned by the Succra deployer. Simulator controls below execute real{' '}
            {state?.chainId === 4663 ? 'mainnet' : 'local'} transactions so you can inspect the full
            continuity lifecycle.
          </div>
        ) : null}

        {error ? (
          <p className="mt-8 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-200">
            {error}
          </p>
        ) : null}

        {!demo && !isConnected ? (
          <section className="mt-10 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">
              Wallet required
            </p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              Connect the mission owner wallet.
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
              Mission detail is scoped to the connected wallet. Connect the owner wallet or open the
              live demo mission instead.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/missions/demo"
                className="rounded-full bg-[#e8ff63] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#f2ff92]"
              >
                View Live Demo Mission
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-200 transition hover:border-white/30"
              >
                Back to Dashboard
              </Link>
            </div>
          </section>
        ) : !demo && needsUnlock ? (
          <section className="mt-10 rounded-3xl border border-[#e8ff63]/25 bg-[#e8ff63]/[0.05] px-6 py-12">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">
              Owner verification required
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Verify this wallet to view the mission.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
              Sign a short message to prove wallet ownership. No transaction is sent and no gas is
              required.
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
        ) : loading ? (
          <div className="mt-10 grid gap-5 lg:grid-cols-2" aria-label="Loading mission">
            <div className="h-72 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.025]" />
            <div className="h-72 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.025]" />
          </div>
        ) : !state || !mission ? (
          <section className="mt-10 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Mission not found.</h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-500">
              This wallet does not own a mission at that address.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-full bg-[#e8ff63] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#f2ff92]"
              >
                Back to Dashboard
              </Link>
              <Link
                href="/missions/demo"
                className="rounded-full border border-white/15 bg-white/[0.03] px-5 py-2.5 text-sm text-zinc-200 transition hover:border-white/30"
              >
                View Live Demo Mission
              </Link>
            </div>
          </section>
        ) : (
          <>
            <section className="mt-10 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#e8ff63]">
                  {mission.symbol} mission · {state.chainId}
                </p>
                <h1 className="mt-3 text-5xl font-semibold tracking-tight">{mission.label}</h1>
                <p className="mt-4 max-w-xl text-zinc-400">
                  Program-controlled vault with a revocable session key. The mission survives the
                  current agent; the successor inherits a lower recovery ceiling, never unrestricted
                  authority.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <span className={`rounded-full border px-3 py-1 text-xs ${statusClass(mission.status)}`}>
                    {mission.status}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400">
                    {compact(mission.missionAddress, 12, 8)}
                  </span>
                  {state.chainId === 4663 ? (
                    <a
                      href={`https://robinhoodchain.blockscout.com/address/${mission.missionAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400 transition hover:border-white/25 hover:text-zinc-200"
                    >
                      Blockscout ↗
                    </a>
                  ) : null}
                </div>

                {demo ? (
                  <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                        Mission simulator
                      </p>
                      <button
                        type="button"
                        onClick={() => void run('reset')}
                        disabled={pending !== null}
                        className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-zinc-400 transition hover:border-white/25 disabled:opacity-50"
                      >
                        Reset demo
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {SIMULATOR_ACTIONS.map((item) => (
                        <button
                          key={item.action}
                          type="button"
                          data-testid={`action-${item.action}`}
                          onClick={() => void run(item.action)}
                          disabled={pending !== null}
                          className={`rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-wait disabled:opacity-50 ${toneClass(item.tone)}`}
                        >
                          {pending === item.action ? 'Working…' : item.label}
                        </button>
                      ))}
                    </div>
                    {actionError ? (
                      <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                        {actionError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="reference-glow succra-lift succra-rise rounded-3xl border border-white/10 bg-white/[0.03] p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  Vault position
                </p>
                <p className="mt-3 font-mono text-5xl text-[#e8ff63]">
                  {formatAtomic(mission.available, mission.decimals)}
                </p>
                <p className="mt-1 text-sm text-zinc-500">available {mission.symbol}</p>
                <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-zinc-500">Deposited</dt>
                    <dd className="mt-1 font-mono">{formatAtomic(mission.deposited, mission.decimals)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Settled</dt>
                    <dd className="mt-1 font-mono">{formatAtomic(mission.spent, mission.decimals)}</dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Recovery cap</dt>
                    <dd className="mt-1 font-mono">
                      {formatAtomic(mission.recoveryCap, mission.decimals)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-zinc-500">Successor</dt>
                    <dd className="mt-1 font-mono">{compact(mission.successor, 8, 6)}</dd>
                  </div>
                </dl>
                <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/20 p-3 font-mono text-[11px] leading-5 text-zinc-500">
                  <div className="flex justify-between gap-3">
                    <span>owner</span>
                    <span className="text-zinc-300">{compact(state.owner, 10, 8)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>session key</span>
                    <span className="text-zinc-300">
                      {mission.sessionKey === '0x0000000000000000000000000000000000000000'
                        ? 'revoked'
                        : compact(mission.sessionKey, 10, 8)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="mt-8 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="succra-lift succra-rise rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-400">
                  Authority boundary
                </h2>
                <div className="mt-5 grid gap-4 text-sm">
                  <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-3">
                    <span className="shrink-0 text-zinc-500">Vault</span>
                    <span className="min-w-0 truncate font-mono">{mission.missionAddress}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-3">
                    <span className="shrink-0 text-zinc-500">Token</span>
                    <span className="min-w-0 truncate font-mono">{mission.tokenAddress}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-3">
                    <span className="shrink-0 text-zinc-500">Session key</span>
                    <span className="min-w-0 truncate font-mono">
                      {mission.sessionKey === '0x0000000000000000000000000000000000000000'
                        ? 'revoked'
                        : mission.sessionKey}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="shrink-0 text-zinc-500">Owner</span>
                    <span className="min-w-0 truncate font-mono">{state.owner}</span>
                  </div>
                </div>
                <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-6 text-amber-100/80">
                  WIF is shown as a vault asset, but the live WIF token is a plain ERC-20 without
                  EIP-3009 or ERC-1271. Only USDG settles through x402 on this deployment.
                </div>
              </div>

              <div className="succra-lift succra-rise rounded-3xl border border-white/10 bg-white/[0.02] p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-400">
                    Recent proof
                  </h2>
                  <span className="text-[11px] text-zinc-600">{state.events.length} events</span>
                </div>
                <ol className="mt-5 space-y-3">
                  {state.events.slice(0, 6).map((event, index) => (
                    <li
                      key={`${event.hash}-${index}`}
                      className="rounded-xl border border-white/[0.06] bg-black/20 p-3"
                    >
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

            <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.02] p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-[#e8ff63]">
                    Connect Agent
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
                    Wire a bot to this mission with an EIP-712 signed request. The agent receives
                    bounded authority; the vault and policy stay on-chain.
                  </p>
                </div>
                <CopyButton value={agentSnippet} label="Connect Agent snippet" />
              </div>
              <pre className="mt-5 overflow-x-auto rounded-2xl border border-white/[0.06] bg-black/40 p-5 font-mono text-[11px] leading-6 text-zinc-300">
                <code>{agentSnippet}</code>
              </pre>
              <div className="mt-4 grid gap-2 font-mono text-[10px] text-zinc-600 sm:grid-cols-3">
                <span>challenge → verify → action</span>
                <span>manifest: SuccraRequest</span>
                <span>settlement: x402 + EIP-3009</span>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
