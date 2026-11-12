import Link from 'next/link';

export default function LandingPage(): React.JSX.Element {
  return (
    <main className="reference-grid relative min-h-screen overflow-hidden bg-[#07090c] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(232,255,99,0.13),transparent_34%),radial-gradient(circle_at_85%_15%,rgba(139,92,246,0.12),transparent_32%)]" />
      <div className="relative mx-auto max-w-7xl px-6 py-8">
        <nav className="flex items-center justify-between border-b border-white/10 pb-5">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8ff63] font-mono text-lg font-black text-black">S</div>
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.32em] text-[#e8ff63]">Succra</p>
              <p className="text-sm text-zinc-500">Mission continuity layer</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/missions/new" className="hidden rounded-full border border-white/10 px-4 py-2 text-zinc-300 hover:border-white/25 sm:block">New mission</Link>
            <Link href="/dashboard" className="rounded-full bg-[#e8ff63] px-5 py-2 font-semibold text-black">Open console</Link>
          </div>
        </nav>

        <section className="grid items-center gap-12 py-20 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#e8ff63]/30 bg-[#e8ff63]/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[#e8ff63]">
              Live on Robinhood Chain · USDG + WIF
            </span>
            <h1 className="mt-7 max-w-4xl text-6xl font-semibold leading-[0.98] tracking-tight sm:text-8xl">
              Agents can fail.
              <br />
              Missions continue.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-400">
              Succra is the continuity layer for autonomous economic missions. The mission owns the vault,
              the policy, the session key, and the succession rules. Agents get bounded authority. The owner
              keeps the exit.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/dashboard" className="rounded-full bg-[#e8ff63] px-6 py-3 font-semibold text-black transition hover:bg-[#f2ff92]">
                Enter live console →
              </Link>
              <Link href="/missions/new" className="rounded-full border border-white/15 bg-white/[0.03] px-6 py-3 text-zinc-200 transition hover:border-white/30">
                Create a mission
              </Link>
            </div>
            <div className="mt-12 grid max-w-2xl grid-cols-3 gap-4 border-t border-white/10 pt-6 text-sm">
              <div><p className="font-mono text-2xl text-[#e8ff63]">107</p><p className="mt-1 text-zinc-500">contract tests</p></div>
              <div><p className="font-mono text-2xl text-[#e8ff63]">ERC-1271</p><p className="mt-1 text-zinc-500">mainnet USDG verified</p></div>
              <div><p className="font-mono text-2xl text-[#e8ff63]">3→1</p><p className="mt-1 text-zinc-500">violations → quarantine</p></div>
            </div>
          </div>

          <div className="reference-glow rounded-[2rem] border border-white/10 bg-white/[0.03] p-5">
            <div className="rounded-[1.4rem] border border-white/10 bg-black/40 p-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
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

        <footer className="border-t border-white/10 py-6 text-xs text-zinc-600">
          Succra controls authority, not custody. Live USDG mission on Robinhood Chain mainnet.
        </footer>
      </div>
    </main>
  );
}
