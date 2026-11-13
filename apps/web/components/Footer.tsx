import Link from 'next/link';

const RESOURCES = [
  {
    label: 'GitHub',
    href: 'https://github.com/onyebuchidaniel60/Succra',
  },
  {
    label: 'Documentation',
    href: 'https://github.com/onyebuchidaniel60/Succra/tree/main/docs',
  },
  {
    label: 'Smart Contracts',
    href: 'https://robinhoodchain.blockscout.com/address/0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917',
  },
] as const;

const NETWORK = [
  {
    label: 'Robinhood Chain',
    href: 'https://robinhoodchain.blockscout.com',
  },
  {
    label: 'USDG',
    href: 'https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  },
  {
    label: 'WIF',
    href: 'https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773',
  },
] as const;

export default function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-white/10 bg-[#07090c]">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <img
                src="/logo.svg"
                alt="Succra"
                className="h-8 w-8 text-[#e8ff63]"
              />
              <span className="text-lg font-semibold tracking-tight text-zinc-100">Succra</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-6 text-zinc-500">
              Agents can fail. Missions continue.
            </p>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Product
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li>
                <Link href="/" className="text-zinc-500 transition hover:text-[#e8ff63]">
                  Live App
                </Link>
              </li>
              <li>
                <Link
                  href="/dashboard"
                  className="text-zinc-500 transition hover:text-[#e8ff63]"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  href="/missions/new"
                  className="text-zinc-500 transition hover:text-[#e8ff63]"
                >
                  Create Mission
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Resources
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {RESOURCES.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-500 transition hover:text-[#e8ff63]"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              Network
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {NETWORK.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-500 transition hover:text-[#e8ff63]"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-2 border-t border-white/10 pt-6 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500 sm:mt-9 sm:flex-row sm:justify-between sm:gap-3 sm:text-left sm:tracking-[0.16em]">
          <p>© 2026 Succra. Built for World is Flat.</p>
          <p>Robinhood Chain · 4663</p>
        </div>
      </div>
    </footer>
  );
}
