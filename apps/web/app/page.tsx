import Link from 'next/link';
import ConnectWalletButton from '@/components/ConnectWalletButton';
import Footer from '@/components/Footer';

export default function LandingPage(): React.JSX.Element {
  return (
    <main className="reference-grid relative min-h-screen overflow-hidden bg-[#07090c] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(232,255,99,0.13),transparent_34%),radial-gradient(circle_at_85%_15%,rgba(139,92,246,0.12),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <nav className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <img src="/logo.svg" alt="Succra" className="h-8 w-8 text-[#e8ff63]" />
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#e8ff63]">Succra</p>
              <p className="text-sm text-zinc-500">Mission continuity layer</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/dashboard" className="rounded-full border border-white/10 px-4 py-2 text-zinc-300 transition hover:border-white/25 hover:text-white">Dashboard</Link>
            <Link href="/missions/new" className="rounded-full bg-[#e8ff63] px-4 py-2 font-semibold text-black transition hover:bg-[#f2ff92]">New Mission</Link>
            <ConnectWalletButton />
          </div>
        </nav>

        <section className="grid items-center gap-10 py-12 md:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#e8ff63] sm:px-4 sm:text-[11px] sm:tracking-[0.18em]">
              Live on Robinhood Chain · USDG + WIF
            </span>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-8xl">
              Agents can fail.
              <br />
              Missions continue.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg sm:leading-8">
              Succra is the continuity layer for autonomous economic missions. The mission owns the vault,
              the policy, the session key, and the succession rules. Agents get bounded authority. The owner
              keeps the exit.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/dashboard" className="w-full rounded-full bg-[#e8ff63] px-6 py-3 text-center font-semibold text-black transition hover:bg-[#f2ff92] sm:w-auto">
                Open Dashboard →
              </Link>
              <Link href="/missions/demo" className="w-full rounded-full border border-white/15 bg-white/[0.03] px-6 py-3 text-center text-zinc-200 transition hover:border-white/30 sm:w-auto">
                View Live Demo Mission
              </Link>
            </div>
            <div className="mt-10 grid max-w-2xl grid-cols-1 gap-4 border-t border-white/10 pt-6 text-sm sm:grid-cols-3">
              <div><p className="font-mono text-2xl text-[#e8ff63]">115</p><p className="mt-1 text-zinc-500">contract tests</p></div>
              <div><p className="font-mono text-2xl text-[#e8ff63]">ERC-1271</p><p className="mt-1 text-zinc-500">mainnet USDG verified</p></div>
              <div><p className="font-mono text-2xl text-[#e8ff63]">3→1</p><p className="mt-1 text-zinc-500">violations → quarantine</p></div>
            </div>
          </div>

          <div className="reference-glow rounded-[2rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="rounded-[1.4rem] border border-white/10 bg-black/40 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">Mission state</span>
                <span className="rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-2.5 py-1 text-[10px] text-[#e8ff63]">ACTIVE_RECOVERY</span>
              </div>
              <p className="mt-6 font-mono text-5xl text-[#e8ff63]">0.96</p>
              <p className="mt-1 text-sm text-zinc-500">USDG available in vault</p>
              <div className="mt-7 space-y-3">
                {[
                  ['01', 'Owner deposits USDG', 'Vault holds funds, not the agent'],
                  ['02', 'Session key signs x402', 'EIP-3009 + ERC-1271'],
                  ['03', 'Three violations', 'Quarantine revokes the key'],
                  ['04', 'Successor continues', 'Lower recovery ceiling'],
                ].map(([n, title, body]) => (
                  <div key={n} className="flex gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <span className="font-mono text-[10px] text-[#e8ff63]">{n}</span>
                    <div><p className="text-sm text-zinc-200">{title}</p><p className="mt-0.5 text-xs text-zinc-600">{body}</p></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-6" aria-label="Succra system">
          <article className="succra-lift succra-rise lg:col-span-4 rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">01 · Vault</p>
                <h2 className="mt-3 max-w-lg text-2xl font-semibold tracking-tight sm:text-3xl">The mission owns the money. The agent only gets authority.</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500">Deposit USDG into SuccraMission. The owner keeps an unconditional exit; the contract enforces caps, merchants, expiry, and recovery limits.</p>
              </div>
              <div className="hidden shrink-0 rounded-2xl border border-white/10 bg-black/30 p-4 sm:block">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">available</p>
                <p className="mt-2 font-mono text-3xl text-[#e8ff63]">0.96</p>
                <p className="mt-1 text-[11px] text-zinc-600">USDG · live mainnet</p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {[
                ['Deposit', 'owner'],
                ['Policy', 'on-chain'],
                ['Withdraw', 'any status'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">{label}</p>
                  <p className="mt-1 font-mono text-xs text-zinc-300">{value}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="succra-lift succra-rise lg:col-span-2 rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#e8ff63]">02 · ERC-1271</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Contract as signer.</h2>
            <p className="mt-3 text-sm leading-6 text-zinc-500">Paxos USDG code-routed to <span className="font-mono text-zinc-300">isValidSignature</span> and returned MAGIC on mainnet.</p>
            <div className="mt-6 rounded-xl border border-[#e8ff63]/20 bg-[#e8ff63]/[0.06] p-3 font-mono text-xs text-[#e8ff63]">0x1626ba7e</div>
          </article>

          <article className="succra-lift succra-rise lg:col-span-2 rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">03 · Quarantine</p>
            <p className="mt-4 font-mono text-4xl text-[#e8ff63]">3 → 1</p>
            <p className="mt-2 text-sm leading-6 text-zinc-500">Three blocked policy requests revoke the session key and freeze the current agent.</p>
          </article>

          <article className="succra-lift succra-rise lg:col-span-2 rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">04 · Succession</p>
            <p className="mt-4 text-2xl font-semibold tracking-tight">New authority.<br />Same mission.</p>
            <p className="mt-3 text-sm leading-6 text-zinc-500">A pre-approved successor gets a fresh session key and a lower recovery ceiling.</p>
          </article>

          <article className="succra-lift succra-rise lg:col-span-2 rounded-[1.6rem] border border-amber-300/15 bg-amber-300/[0.04] p-5 sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-200/80">05 · WIF</p>
            <p className="mt-4 text-2xl font-semibold tracking-tight">Treasury asset.</p>
            <p className="mt-3 text-sm leading-6 text-amber-100/60">WIF is a standard ERC-20. Succra enforces strict treasury transfer policies while USDG handles x402 API payments.</p>
          </article>
        </section>

      </div>
      <Footer />
    </main>
  );
}
