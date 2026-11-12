'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useChainId,
  useConnect,
  useConnectors,
  useDisconnect,
} from 'wagmi';
import { shortenAddress } from '@/lib/format';

const ROBINHOOD_MAINNET = 4663;
const ROBINHOOD_TESTNET = 46630;

function chainLabel(chainId: number): string {
  if (chainId === ROBINHOOD_MAINNET) return 'Robinhood';
  if (chainId === ROBINHOOD_TESTNET) return 'Robinhood testnet';
  return `Chain ${chainId}`;
}

export default function ConnectWalletButton(): React.JSX.Element {
  const { address, status } = useAccount();
  const chainId = useChainId();
  const connectors = useConnectors();
  const { connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [address]);

  const available = useMemo(
    () => connectors.map((connector) => ({ id: connector.uid, name: connector.name, connector })),
    [connectors]
  );
  const connected = status === 'connected' && Boolean(address);

  if (!mounted) {
    return (
      <button
        type="button"
        className="rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300"
        disabled
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="connect-wallet"
        onClick={() => setOpen((value) => !value)}
        className={
          connected
            ? 'rounded-full border border-[#e8ff63]/35 bg-[#e8ff63]/10 px-4 py-2 font-mono text-xs text-[#e8ff63]'
            : 'rounded-full bg-[#e8ff63] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#f2ff92]'
        }
      >
        {connected && address
          ? `${shortenAddress(address, 5)} · ${chainLabel(chainId)}`
          : isPending
            ? 'Connecting…'
            : 'Connect Wallet'}
      </button>

      {open ? (
        <div className="absolute right-0 z-[60] mt-2 w-64 rounded-2xl border border-white/10 bg-[#0b0e12]/95 p-2 shadow-2xl backdrop-blur">
          {connected ? (
            <>
              <p className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Connected
              </p>
              <p className="break-all px-3 pb-3 font-mono text-xs text-zinc-200">{address}</p>
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="w-full rounded-xl border border-white/10 px-3 py-2 text-left text-sm text-zinc-300 hover:border-white/20"
              >
                Disconnect
              </button>
            </>
          ) : available.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-400">
              No browser wallet detected. Install MetaMask or another injected EVM wallet.
            </p>
          ) : (
            available.map(({ id, name, connector }) => (
              <button
                key={id}
                type="button"
                disabled={isPending}
                onClick={async () => {
                  setError('');
                  try {
                    await connectAsync({ connector });
                    setOpen(false);
                  } catch {
                    setError('Wallet connection was rejected.');
                  }
                }}
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.06] disabled:opacity-50"
              >
                Connect {name}
              </button>
            ))
          )}
          {error ? <p className="px-3 py-2 text-xs text-red-300">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
