'use client';

import { useEffect, useState } from 'react';
import { fetchDemoState, postDemoAction, type DemoState } from '@/lib/demo/client';

export default function NewMissionPremium() {
  const [state, setState] = useState<DemoState | null>(null);
  const [token, setToken] = useState<'usdg' | 'wif'>('usdg');
  const [amount, setAmount] = useState('0.10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDemoState().then(setState).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load live state.');
    });
  }, []);

  const deposit = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await postDemoAction('deposit-usdg'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Deposit failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="reference-grid min-h-screen bg-[#07090c] px-6 py-8 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <a href="/dashboard" className="font-mono text-xs uppercase tracking-[0.3em] text-[#e8ff63]">← Succra dashboard</a>
          <span className="rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-3 py-1 font-mono text-[11px] text-[#e8ff63]">Live mainnet · {state?.chainId ?? '4663'}</span>
        </header>

        <section className="mt-12 grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#e8ff63]">New mission</p>
            <h1 className="mt-3 text-5xl font-semibold leading-[1.02] tracking-tight">Define bounded authority.</h1>
            <p className="mt-5 max-w-xl text-zinc-400">
              Choose the settlement token, fund the vault, and register a runtime-held session key. The owner
              keeps an unconditional withdrawal right and never signs per payment.
            </p>

            <div className="mt-8 space-y-3">
              {[
                ['01', 'Mission + policy', 'Budget, merchants, expiry, successor list'],
                ['02', 'Settlement token', 'USDG for live x402; WIF is vault-only'],
                ['03', 'Deposit', 'Funds move into SuccraMission'],
                ['04', 'Session key', 'Runtime-held, revocable, never agent-held'],
              ].map(([n, title, body]) => (
                <div key={n} className="flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="font-mono text-xs text-[#e8ff63]">{n}</span>
                  <div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-zinc-500">{body}</p></div>
                </div>
              ))}
            </div>
          </div>

          <div className="reference-glow rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">Mission setup</p>
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
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">{option}</p>
                  <p className="mt-2 text-lg font-semibold">{option === 'usdg' ? 'Paxos USDG' : 'World is Flat'}</p>
                  <p className="mt-1 text-xs text-zinc-500">{option === 'usdg' ? '6 decimals · x402' : '18 decimals · ERC-20 only'}</p>
                </button>
              ))}
            </div>

            <label className="mt-6 block text-xs uppercase tracking-[0.18em] text-zinc-500" htmlFor="deposit-amount">Deposit amount</label>
            <input
              id="deposit-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-lg outline-none focus:border-[#e8ff63]/60"
            />

            {token === 'wif' ? (
              <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4 text-xs leading-6 text-amber-100/80">
                The live WIF token is a plain ERC-20. It can be held in the vault, but it does not implement
                EIP-3009 or ERC-1271, so it cannot settle through x402. Use USDG for live payments.
              </div>
            ) : null}

            {error ? <p className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

            <button
              type="button"
              onClick={deposit}
              disabled={busy || token === 'wif'}
              className="mt-6 w-full rounded-full bg-[#e8ff63] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#f2ff92] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Depositing…' : token === 'usdg' ? `Deposit ${amount} USDG` : 'WIF x402 unavailable'}
            </button>
            <p className="mt-3 text-center text-[11px] text-zinc-600">
              Live mission: {state?.missions.find((m) => m.key === 'usdg')?.missionAddress.slice(0, 10)}…
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
