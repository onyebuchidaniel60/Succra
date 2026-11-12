'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { demoUrl } from '@/lib/demo/client';

type DemoEvent = {
  label: string;
  hash: string;
  block: number;
  kind: string;
};

type DemoMission = {
  key: 'usdg' | 'wif';
  label: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  missionAddress: string;
  status: string;
  deposited: string;
  spent: string;
  available: string;
  sessionKey: string;
  successor: string;
  recoveryCap: string;
};

type DemoState = {
  initialized: boolean;
  phase: string;
  chainId: number;
  label: string;
  registry: string;
  factory: string;
  owner: string;
  guardian: string;
  primary: string;
  successor: string;
  merchant: string;
  missions: DemoMission[];
  events: DemoEvent[];
  note: string;
};

const ACTIONS = [
  { action: 'usdg-payment', label: 'Run USDG payment', tone: 'emerald' },
  { action: 'wif-payment', label: 'Run WIF payment', tone: 'violet' },
  { action: 'violations', label: 'Inject 3 violations', tone: 'amber' },
  { action: 'quarantine', label: 'Quarantine + withdraw', tone: 'red' },
  { action: 'succession', label: 'Activate successor', tone: 'blue' },
  { action: 'recovery', label: 'Recovery payment', tone: 'emerald' },
] as const;

const SCENE_COPY = [
  { title: 'The fatal flaw', body: 'Money-managing agents die with the agent.' },
  { title: 'The continuity layer', body: 'Agents can fail. Missions continue.' },
  { title: 'Vault + session key', body: 'Deposit USDG or WIF. Withdraw any time.' },
  { title: 'x402 payment', body: 'EIP-3009 signed by the session key; ERC-1271 verifies.' },
  { title: 'Quarantine → succession', body: 'Three violations revoke authority. A successor continues.' },
  { title: 'Recovery', body: 'New authority. Same mission.' },
] as const;

function compact(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function formatAtomic(value: string, decimals: number): string {
  const raw = BigInt(value || '0');
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = raw % base;
  if (fraction === 0n) return whole.toLocaleString();
  const decimalsText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${decimalsText}`;
}

function statusTone(status: string): string {
  if (status === 'ACTIVE') return 'border-[#e8ff63]/40 bg-[#e8ff63]/10 text-[#e8ff63]';
  if (status === 'QUARANTINED') return 'border-red-400/30 bg-red-400/10 text-red-300';
  if (status === 'RECOVERING' || status === 'ACTIVE_RECOVERY')
    return 'border-amber-400/30 bg-amber-400/10 text-amber-300';
  return 'border-zinc-700 bg-zinc-800/60 text-zinc-300';
}

function toneClass(tone: string): string {
  if (tone === 'red') return 'border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/15';
  if (tone === 'amber') return 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15';
  if (tone === 'violet') return 'border-violet-400/30 bg-violet-400/10 text-violet-200 hover:bg-violet-400/15';
  if (tone === 'blue') return 'border-sky-400/30 bg-sky-400/10 text-sky-200 hover:bg-sky-400/15';
  return 'border-[#e8ff63]/40 bg-[#e8ff63] text-black hover:bg-[#f2ff92]';
}

export default function DemoConsole(): React.JSX.Element {
  const [state, setState] = useState<DemoState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch(demoUrl(), { cache: 'no-store' });
      const body = (await response.json()) as { ok: boolean; state?: DemoState; error?: string };
      if (!body.ok || !body.state) throw new Error(body.error ?? 'Could not initialize demo.');
      setState(body.state);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not initialize demo.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const apply = (value: number) => {
      if (Number.isInteger(value) && value >= 0 && value <= SCENE_COPY.length) setScene(value);
    };
    apply(Number(new URLSearchParams(window.location.search).get('scene') ?? '0'));
    const onScene = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      apply(Number(detail));
    };
    window.addEventListener('succra-scene', onScene);
    return () => window.removeEventListener('succra-scene', onScene);
  }, []);

  const run = async (action: string) => {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(demoUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as { ok: boolean; state?: DemoState; error?: string };
      if (!body.ok || !body.state) throw new Error(body.error ?? 'Demo action failed.');
      setState(body.state);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Demo action failed.');
    } finally {
      setPending(null);
    }
  };

  const totals = useMemo(() => {
    if (!state) return { deposited: 0, spent: 0, active: 0 };
    return {
      deposited: state.missions.reduce(
        (sum, mission) => sum + Number(formatAtomic(mission.deposited, mission.decimals).replace(/,/g, '')),
        0
      ),
      spent: state.missions.reduce(
        (sum, mission) => sum + Number(formatAtomic(mission.spent, mission.decimals).replace(/,/g, '')),
        0
      ),
      active: state.missions.filter((mission) => mission.status === 'ACTIVE').length,
    };
  }, [state]);

  return (
    <main className="reference-grid relative min-h-screen overflow-hidden bg-[#07090c] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(16,185,129,0.14),transparent_38%),radial-gradient(circle_at_85%_10%,rgba(139,92,246,0.12),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e8ff63]/40 bg-[#e8ff63] font-mono text-lg font-black text-black">
              S
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#e8ff63]">Succra</p>
              <p className="text-sm text-zinc-400">Mission continuity console</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-zinc-300">
              {state?.label ?? 'Robinhood Chain · local deterministic demo'}
            </span>
            <span className="rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-3 py-1 font-mono text-[#e8ff63]">
              x402 · USDG + WIF
            </span>
          </div>
        </header>

        <section className="grid gap-8 py-9 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#e8ff63]">
              Program-controlled vault · ERC-1271
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Agents can fail.
              <br />
              Missions continue.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
              The mission holds its own USDG or WIF. A runtime-held session key signs x402 EIP-3009
              authorizations. Three violations revoke the key, quarantine the agent, and hand reduced
              authority to a pre-approved successor.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              {ACTIONS.map((item) => (
                <button
                  key={item.action}
                  type="button"
                  data-testid={`action-${item.action}`}
                  onClick={() => void run(item.action)}
                  disabled={pending !== null}
                  className={`rounded-lg border px-3.5 py-2 text-sm font-medium transition disabled:cursor-wait disabled:opacity-50 ${toneClass(item.tone)}`}
                >
                  {pending === item.action ? 'Working…' : item.label}
                </button>
              ))}
              <button
                type="button"
                data-testid="action-reset"
                onClick={() => void run('reset')}
                disabled={pending !== null}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
              >
                Reset demo
              </button>
            </div>
            {error ? (
              <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            ) : null}
            <p className="mt-4 text-xs text-zinc-500">{state?.note ?? 'Local chain only. No mainnet transactions.'}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">Mission state</p>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300">
                {state?.phase ?? 'Booting local chain'}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <dt className="text-xs text-zinc-500">Deposited</dt>
                <dd className="mt-1 font-mono text-xl text-zinc-100">{totals.deposited.toFixed(2)}</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <dt className="text-xs text-zinc-500">Settled</dt>
                <dd className="mt-1 font-mono text-xl text-zinc-100">{totals.spent.toFixed(2)}</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <dt className="text-xs text-zinc-500">Active missions</dt>
                <dd className="mt-1 font-mono text-xl text-zinc-100">{totals.active}/2</dd>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <dt className="text-xs text-zinc-500">Chain</dt>
                <dd className="mt-1 font-mono text-xl text-zinc-100">{state?.chainId ?? '—'}</dd>
              </div>
            </dl>
            <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 font-mono text-[11px] leading-5 text-zinc-500">
              <div>vault {compact(state?.factory ?? '—', 10, 8)}</div>
              <div>owner {compact(state?.owner ?? '—', 10, 8)}</div>
              <div>guardian {compact(state?.guardian ?? '—', 10, 8)}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2" aria-label="Missions">
          {state?.missions.map((mission) => {
            const progress = Math.min(
              100,
              Number((BigInt(mission.spent) * 100n) / (BigInt(mission.deposited) || 1n))
            );
            return (
              <article
                key={mission.key}
                data-testid={`mission-${mission.key}`}
                className="reference-glow rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">{mission.symbol} mission</p>
                    <h2 className="mt-1 text-xl font-semibold">{mission.label}</h2>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusTone(mission.status)}`}>
                    {mission.status}
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-zinc-500">Deposited</p>
                    <p className="mt-1 font-mono text-lg">{formatAtomic(mission.deposited, mission.decimals)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Settled</p>
                    <p className="mt-1 font-mono text-lg">{formatAtomic(mission.spent, mission.decimals)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Available</p>
                    <p className="mt-1 font-mono text-lg">{formatAtomic(mission.available, mission.decimals)}</p>
                  </div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#e8ff63]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-4 grid gap-1.5 font-mono text-[11px] text-zinc-500">
                  <div className="flex justify-between gap-3"><span>token</span><span className="text-zinc-300">{compact(mission.tokenAddress, 10, 8)}</span></div>
                  <div className="flex justify-between gap-3"><span>vault</span><span className="text-zinc-300">{compact(mission.missionAddress, 10, 8)}</span></div>
                  <div className="flex justify-between gap-3"><span>session key</span><span className="text-zinc-300">{mission.sessionKey === '0x0000000000000000000000000000000000000000' ? 'revoked' : compact(mission.sessionKey, 10, 8)}</span></div>
                  <div className="flex justify-between gap-3"><span>recovery cap</span><span className="text-zinc-300">{formatAtomic(mission.recoveryCap, mission.decimals)} {mission.symbol}</span></div>
                </div>
              </article>
            );
          })}
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_0.85fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">Continuity timeline</h2>
              <span className="text-[11px] text-zinc-600">newest first</span>
            </div>
            <ol className="mt-4 space-y-2">
              {(state?.events ?? []).slice(0, 8).map((item, index) => (
                <li
                  key={`${item.hash}-${index}`}
                  className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5"
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
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200">{item.label}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{item.hash}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">Authority boundary</h2>
            <ul className="mt-4 space-y-3 text-sm text-zinc-400">
              <li className="flex gap-3"><span className="text-emerald-300">01</span> Vault holds USDG or WIF; owner withdraws unilaterally.</li>
              <li className="flex gap-3"><span className="text-emerald-300">02</span> Session key signs EIP-3009; it never holds funds at rest.</li>
              <li className="flex gap-3"><span className="text-emerald-300">03</span> Three blocked requests revoke the key on quarantine.</li>
              <li className="flex gap-3"><span className="text-emerald-300">04</span> Successor receives a lower recovery ceiling, not the old key.</li>
              <li className="flex gap-3"><span className="text-emerald-300">05</span> Settlement is confirmed from the token Transfer log.</li>
            </ul>
            <div className="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-[11px] leading-5 text-amber-100/80">
              Local Hardhat chain. This console performs real contract calls and real EIP-3009 signatures;
              it does not claim mainnet settlement.
            </div>
          </div>
        </section>
      </div>

      {scene > 0 ? (
        <div
          data-testid="scene-caption"
          data-scene={scene}
          className="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[min(92vw,760px)] -translate-x-1/2 rounded-xl border border-emerald-300/20 bg-[#080b0f]/90 px-5 py-3 shadow-2xl shadow-black/50 backdrop-blur"
        >
          <div className="flex items-center gap-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-300">
              Scene {String(scene).padStart(2, '0')} / 06
            </span>
            <span className="h-px flex-1 bg-white/10" />
            <span className="font-mono text-[10px] text-zinc-500">SUCCRA · continuity layer</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-lg font-semibold text-zinc-100">{SCENE_COPY[scene - 1]?.title}</p>
            <p className="text-sm text-zinc-400">{SCENE_COPY[scene - 1]?.body}</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
