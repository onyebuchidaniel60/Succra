'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import {
  compact,
  DemoAuthError,
  fetchDemoState,
  postDemoAction,
  type DemoState,
} from '@/lib/demo/client';
import { useOwnerSession } from '@/lib/demo/use-owner-session';

export default function NewMissionPremium() {
  const router = useRouter();
  const session = useOwnerSession();
  const { address, isConnected, ownerChecked, isOwner, needsUnlock, unlocking } = session;
  const [state, setState] = useState<DemoState | null>(null);
  const [token, setToken] = useState<'usdg' | 'wif'>('usdg');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expire = session.expire;

  const load = useCallback(async () => {
    if (!address || !ownerChecked || needsUnlock) {
      setState(null);
      return;
    }
    try {
      const next = await fetchDemoState({ owner: address });
      setState(next);
      setError(null);
    } catch (cause) {
      if (cause instanceof DemoAuthError) {
        expire();
        setState(null);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not load live mission state.');
      }
    }
  }, [address, ownerChecked, needsUnlock, expire]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!address) {
      setError('Connect a wallet before creating a mission.');
      return;
    }
    if (!isOwner) {
      setError('This live deployment is owner-operated. Open the live demo mission to explore the flow.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await postDemoAction('deposit-usdg', { owner: address });
      setState(next);
      const created =
        next.missions.find((mission) => mission.key === 'usdg') ?? next.missions[0];
      if (!created) throw new Error('The mission was not returned after creation.');
      router.push(`/missions/${created.missionAddress}`);
    } catch (cause) {
      if (cause instanceof DemoAuthError) {
        expire();
        setError('Verify the owner wallet before creating a mission.');
      } else {
        setError(cause instanceof Error ? cause.message : 'Mission creation failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const locked = isConnected && ownerChecked && needsUnlock;
  const checking = isConnected && !ownerChecked;
  const usdgMission = state?.missions.find((mission) => mission.key === 'usdg');

  return (
    <main className="reference-grid min-h-screen bg-[#07090c] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <nav className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <Link
            href="/dashboard"
            className="font-mono text-xs uppercase tracking-[0.24em] text-[#e8ff63] transition hover:text-[#f2ff92]"
          >
            ← Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/dashboard"
              className="rounded-full border border-white/10 px-4 py-2 text-zinc-300 transition hover:border-white/25 hover:text-white"
            >
              Dashboard
            </Link>
            <span className="rounded-full bg-[#e8ff63] px-4 py-2 font-semibold text-black">
              New Mission
            </span>
            <ConnectWalletButton />
          </div>
        </nav>

        <section className="mt-12 grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#e8ff63]">New mission</p>
            <h1 className="mt-3 text-5xl font-semibold leading-[1.02] tracking-tight">
              Define bounded authority.
            </h1>
            <p className="mt-5 max-w-xl text-zinc-400">
              Choose the settlement token, fund the vault, and register a runtime-held session key.
              The owner keeps an unconditional withdrawal right and never signs per payment.
            </p>

            <div className="mt-8 space-y-3">
              {[
                ['01', 'Mission + policy', 'Budget, merchants, expiry, successor list'],
                ['02', 'Settlement token', 'USDG for live x402; WIF is vault-only'],
                ['03', 'Deposit', 'Funds move into SuccraMission'],
                ['04', 'Session key', 'Runtime-held, revocable, never agent-held'],
              ].map(([n, title, body]) => (
                <div
                  key={n}
                  className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <span className="font-mono text-xs text-[#e8ff63]">{n}</span>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="mt-1 text-sm text-zinc-500">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-white/[0.06] bg-black/20 p-4 font-mono text-[11px] leading-6 text-zinc-500">
              <p>after create → /missions/&lt;vault&gt;</p>
              <p>deposit → 0.10 USDG into the live vault</p>
              <p>controls → mission detail only</p>
            </div>
          </div>

          <div className="reference-glow rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
                Mission setup
              </p>
              <span className="rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-2.5 py-1 font-mono text-[10px] text-[#e8ff63]">
                {isConnected ? (isOwner ? 'Owner wallet' : 'Wallet scoped') : 'Connect wallet'}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {(['usdg', 'wif'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setToken(option)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    token === option
                      ? 'border-[#e8ff63]/60 bg-[#e8ff63]/10'
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
                    {option}
                  </p>
                  <p className="mt-2 text-lg font-semibold">
                    {option === 'usdg' ? 'Paxos USDG' : 'World is Flat'}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {option === 'usdg' ? '6 decimals · x402' : 'ERC-20 only'}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                  Initial deposit
                </span>
                <span className="font-mono text-lg text-zinc-200">0.10 USDG</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-zinc-600">
                The live demo route funds the existing USDG vault. The owner can withdraw at any time.
              </p>
            </div>

            {token === 'wif' ? (
              <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-6 text-amber-100/80">
                The live WIF token is a plain ERC-20. It can be held in the vault, but it does not
                implement EIP-3009 or ERC-1271, so it cannot settle through x402. Use USDG for live
                payments.
              </div>
            ) : null}

            {!isConnected ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-zinc-400">
                Connect MetaMask, OKX, or another injected EVM wallet to create a mission.
              </div>
            ) : checking ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-zinc-400">
                Checking wallet access…
              </div>
            ) : locked ? (
              <div className="mt-4 rounded-xl border border-[#e8ff63]/25 bg-[#e8ff63]/[0.05] p-4">
                <p className="text-sm font-medium">Verify the owner wallet.</p>
                <p className="mt-1 text-xs leading-6 text-zinc-400">
                  Sign a short message to prove ownership before creating a funded mission.
                </p>
                {session.error ? (
                  <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                    {session.error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void session.unlock()}
                  disabled={unlocking}
                  className="mt-3 rounded-full bg-[#e8ff63] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#f2ff92] disabled:cursor-wait disabled:opacity-60"
                >
                  {unlocking ? 'Waiting for signature…' : 'Sign to unlock'}
                </button>
              </div>
            ) : !isOwner ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-zinc-400">
                This live deployment has one owner-operated vault. Your dashboard stays empty until
                that owner wallet creates a mission. You can still explore the public simulation.
                <Link
                  href="/missions/demo"
                  className="mt-3 inline-flex rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-3 py-1.5 text-[#e8ff63] transition hover:bg-[#e8ff63]/15"
                >
                  View Live Demo Mission →
                </Link>
              </div>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void create()}
              disabled={busy || !isConnected || locked || !isOwner || token === 'wif'}
              className="mt-6 w-full rounded-full bg-[#e8ff63] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#f2ff92] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy
                ? 'Creating mission…'
                : token === 'wif'
                  ? 'WIF x402 unavailable'
                  : !isConnected
                    ? 'Connect wallet to continue'
                    : locked
                      ? 'Verify wallet to continue'
                      : !isOwner
                        ? 'Owner wallet required'
                        : 'Create mission · deposit 0.10 USDG'}
            </button>
            <p className="mt-3 text-center text-[11px] text-zinc-600">
              {usdgMission
                ? `Live vault ${compact(usdgMission.missionAddress, 10, 8)} · you will be redirected to the mission detail.`
                : 'The mission detail page contains all simulator controls.'}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
