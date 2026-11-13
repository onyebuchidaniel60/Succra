'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatUnits, parseAbi, parseUnits } from 'viem';
import { usePublicClient, useWriteContract } from 'wagmi';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import CopyButton from '@/components/CopyButton';
import Footer from '@/components/Footer';
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

const WITHDRAW_ABI = parseAbi(['function withdraw(uint256 amountAtomic)']);

const SIMULATOR_ACTIONS = [
  { action: 'usdg-payment', label: 'Run USDG payment', tone: 'emerald' },
  { action: 'wif-payment', label: 'Run WIF Treasury Transfer', tone: 'violet' },
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
  const { address, isConnected, isOwner, ownerChecked, needsUnlock, unlocking } = session;
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<DemoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawNotice, setWithdrawNotice] = useState<string | null>(null);
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

  const availableAtomic = mission ? BigInt(mission.available) : 0n;
  const parsedWithdrawAtomic = useMemo(() => {
    if (!mission || !withdrawAmount.trim()) return null;
    try {
      return parseUnits(withdrawAmount.trim(), mission.decimals);
    } catch {
      return null;
    }
  }, [mission, withdrawAmount]);
  const withdrawValid =
    parsedWithdrawAtomic !== null &&
    parsedWithdrawAtomic > 0n &&
    parsedWithdrawAtomic <= availableAtomic;

  const setMaxWithdraw = () => {
    if (!mission) return;
    setWithdrawError(null);
    setWithdrawNotice(null);
    setWithdrawAmount(formatUnits(BigInt(mission.available), mission.decimals));
  };

  const withdraw = async () => {
    if (!mission || !address) return;
    if (!withdrawValid || parsedWithdrawAtomic === null) {
      setWithdrawError(
        `Enter an amount up to ${formatAtomic(mission.available, mission.decimals)} ${mission.symbol}.`
      );
      return;
    }
    if (!publicClient) {
      setWithdrawError('Wallet network client is unavailable. Reconnect and try again.');
      return;
    }

    const amount = parsedWithdrawAtomic;
    const symbol = mission.symbol;
    const decimals = mission.decimals;
    setWithdrawBusy(true);
    setWithdrawError(null);
    setWithdrawNotice(null);
    try {
      const hash = await writeContractAsync({
        address: mission.missionAddress as `0x${string}`,
        abi: WITHDRAW_ABI,
        functionName: 'withdraw',
        args: [amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error('The withdrawal transaction reverted.');
      }
      const next = await postDemoAction('init', { owner: address });
      setState(next);
      setWithdrawAmount('');
      setWithdrawNotice(`Withdrew ${formatUnits(amount, decimals)} ${symbol} to the owner wallet.`);
    } catch (cause) {
      if (cause instanceof DemoAuthError) {
        expire();
        setWithdrawError('Wallet verification expired. Unlock the dashboard and refresh the mission.');
      } else {
        setWithdrawError(cause instanceof Error ? cause.message : 'Withdrawal failed.');
      }
    } finally {
      setWithdrawBusy(false);
    }
  };

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
    <main className="reference-grid min-h-screen overflow-x-hidden bg-[#07090c] px-4 py-6 text-zinc-100 md:px-6 md:py-8">
      <div className="mx-auto max-w-6xl">
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <Link href="/" className="flex items-center gap-3">
              <img src="/logo.svg" alt="Succra" className="h-8 w-8 text-[#e8ff63]" />
              <span className="font-mono text-xs uppercase tracking-[0.28em] text-[#e8ff63]">
                Succra
              </span>
            </Link>
            <Link
              href="/dashboard"
              className="font-mono text-xs uppercase tracking-[0.22em] text-zinc-400 transition hover:text-[#e8ff63]"
            >
              ← Back to Dashboard
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/dashboard"
              className="rounded-full border border-white/10 px-4 py-2 text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              Dashboard
            </Link>
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
          <div className="mt-5 rounded-2xl border border-[#e8ff63]/25 bg-[#e8ff63]/[0.05] px-3 py-3 text-[11px] leading-5 text-[#e8ff63]/90 sm:px-4 sm:text-xs sm:leading-6">
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
          <section className="mt-8 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center sm:px-6 sm:py-16 md:mt-10">
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
          <section className="mt-8 rounded-3xl border border-[#e8ff63]/25 bg-[#e8ff63]/[0.05] px-4 py-9 sm:px-6 sm:py-12 md:mt-10">
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
          <section className="mt-8 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-10 text-center sm:px-6 sm:py-16 md:mt-10">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Mission not found.</h1>
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
            <section className="mt-8 grid gap-7 md:mt-10 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#e8ff63] sm:text-xs sm:tracking-[0.28em]">
                  {mission.symbol} mission · {state.chainId}
                </p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">{mission.label}</h1>
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
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                      {SIMULATOR_ACTIONS.map((item) => (
                        <button
                          key={item.action}
                          type="button"
                          data-testid={`action-${item.action}`}
                          onClick={() => void run(item.action)}
                          disabled={pending !== null}
                          className={`w-full rounded-lg border px-3 py-2.5 text-xs font-medium transition disabled:cursor-wait disabled:opacity-50 sm:w-auto ${toneClass(item.tone)}`}
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

              <div className="reference-glow succra-lift succra-rise rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                  Vault position
                </p>
                <p className="mt-3 font-mono text-4xl text-[#e8ff63] sm:text-5xl">
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

            {!demo && isOwner ? (
              <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                      Vault management
                    </p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight">Owner Controls</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">
                      Withdraw unallocated {mission.symbol} at any mission status. Funds return
                      directly to the connected owner wallet.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                    Owner only
                  </span>
                </div>

                <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor="withdraw-amount"
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500"
                    >
                      Amount ({mission.symbol})
                    </label>
                    <div className="mt-2 flex overflow-hidden rounded-xl border border-white/10 bg-black/20 focus-within:border-white/30">
                      <input
                        id="withdraw-amount"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={withdrawAmount}
                        onChange={(event) => {
                          setWithdrawAmount(event.target.value);
                          setWithdrawError(null);
                          setWithdrawNotice(null);
                        }}
                        className="min-w-0 flex-1 bg-transparent px-4 py-3 font-mono text-lg text-zinc-100 outline-none placeholder:text-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={setMaxWithdraw}
                        className="shrink-0 border-l border-white/10 px-4 py-3 font-mono text-xs text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
                      >
                        Max
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-600">
                      Available: {formatAtomic(mission.available, mission.decimals)} {mission.symbol}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void withdraw()}
                    disabled={!withdrawValid || withdrawBusy}
                    className="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                  >
                    {withdrawBusy ? 'Withdrawing…' : 'Withdraw Funds'}
                  </button>
                </div>

                {!withdrawValid && withdrawAmount ? (
                  <p className="mt-3 text-[11px] text-amber-200/80">
                    Enter an amount up to {formatAtomic(mission.available, mission.decimals)}{' '}
                    {mission.symbol}.
                  </p>
                ) : null}
                {withdrawError ? (
                  <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                    {withdrawError}
                  </p>
                ) : null}
                {withdrawNotice ? (
                  <p className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                    {withdrawNotice}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="mt-8 grid min-w-0 gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="min-w-0 succra-lift succra-rise rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
                <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-400">
                  Authority boundary
                </h2>
                <div className="mt-5 grid min-w-0 gap-4 text-sm">
                  <div className="flex min-w-0 flex-col gap-1 border-b border-white/[0.06] pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-zinc-500">Vault</span>
                    <span className="min-w-0 break-all font-mono text-xs sm:truncate">{mission.missionAddress}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 border-b border-white/[0.06] pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-zinc-500">Token</span>
                    <span className="min-w-0 break-all font-mono text-xs sm:truncate">{mission.tokenAddress}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 border-b border-white/[0.06] pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-zinc-500">Session key</span>
                    <span className="min-w-0 break-all font-mono text-xs sm:truncate">
                      {mission.sessionKey === '0x0000000000000000000000000000000000000000'
                        ? 'revoked'
                        : mission.sessionKey}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <span className="shrink-0 text-zinc-500">Owner</span>
                    <span className="min-w-0 break-all font-mono text-xs sm:truncate">{state.owner}</span>
                  </div>
                </div>
                <p className="mt-6 rounded-2xl border border-white/[0.06] bg-black/20 p-4 text-xs leading-6 text-zinc-400">
                  WIF is a standard ERC-20 token. Succra acts as a secure treasury vault, allowing
                  the agent to distribute WIF to approved contributors while protecting against
                  unauthorized drains.
                </p>
                <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-6 text-amber-100/80">
                  WIF is secured as a vault asset. While it doesn&apos;t support x402 API payments
                  (unlike USDG), Succra enforces strict ERC-20 transfer policies to protect the
                  treasury from rogue agents.
                </div>
              </div>

              <div className="min-w-0 succra-lift succra-rise rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-mono text-xs uppercase tracking-[0.24em] text-zinc-400">
                    Recent proof
                  </h2>
                  <span className="text-[11px] text-zinc-600">{state.events.length} events</span>
                </div>
                <ol className="mt-5 min-w-0 space-y-3">
                  {state.events.slice(0, 6).map((event, index) => (
                    <li
                      key={`${event.hash}-${index}`}
                      className="min-w-0 rounded-xl border border-white/[0.06] bg-black/20 p-3"
                    >
                      <p className="break-words text-sm text-zinc-200">{event.label}</p>
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

            <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
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
              <pre className="mt-5 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-white/[0.06] bg-black/40 p-3 font-mono text-[10px] leading-5 text-zinc-300 sm:p-5 sm:text-[11px] sm:leading-6">
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
      <Footer />
    </main>
  );
}
