'use client';

// Settings network panel: reads the live wallet connection.
import { useEffect, useState } from 'react';
import { useAccount, useChainId } from 'wagmi';
import AgentIdentityChip from '@/components/AgentIdentityChip';

const CHAINS: Record<number, string> = {
  177: 'HashKey mainnet',
  133: 'HashKey testnet',
};

export default function SettingsWalletInfo(): React.JSX.Element {
  const { address, status } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <p className="text-sm text-zinc-400">Checking wallet connection…</p>;
  }
  if (status !== 'connected' || !address) {
    return <p className="text-sm text-zinc-400">No wallet connected.</p>;
  }
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-zinc-400">Connected address</dt>
        <dd className="mt-1">
          <AgentIdentityChip address={address} label="Connected wallet" />
        </dd>
      </div>
      <div>
        <dt className="text-zinc-400">Network</dt>
        <dd className="mt-1 text-zinc-200">{CHAINS[chainId] ?? `Unsupported chain ${chainId}`}</dd>
      </div>
    </dl>
  );
}
