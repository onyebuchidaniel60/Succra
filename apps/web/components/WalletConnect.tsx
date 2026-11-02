'use client';

// EVM wallet connection + EIP-712 sign-in (PROJECT_SPEC.md §4 Flow A).
//
// Injected wallets are offered directly; WalletConnect is offered when the
// deployment configures a project id. The sign-in signature is over the
// SuccraLogin typed data returned by the API, never a home-rolled message.
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useChainId,
  useConnect,
  useConnectors,
  useDisconnect,
  useSignTypedData,
} from 'wagmi';
import type { LoginTypedData } from '@/lib/auth/message';
import { shortenAddress } from '@/lib/format';

const HASHKEY_MAINNET = 177;
const HASHKEY_TESTNET = 133;

interface NonceResponse {
  nonce: string;
  typedData: LoginTypedData;
  expiresAt: string;
}

function chainLabel(chainId: number): string {
  if (chainId === HASHKEY_MAINNET) return 'HashKey mainnet';
  if (chainId === HASHKEY_TESTNET) return 'HashKey testnet';
  return `Unsupported chain ${chainId}`;
}

export interface WalletConnectProps {
  redirectTo?: string;
  onSignedIn?: () => void;
  authenticated?: boolean;
}

export default function WalletConnect({
  redirectTo,
  onSignedIn,
  authenticated = false,
}: WalletConnectProps): React.JSX.Element {
  const router = useRouter();
  const { address, status } = useAccount();
  const chainId = useChainId();
  const connectors = useConnectors();
  const { connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signTypedDataAsync, isPending: isSigning } = useSignTypedData();
  const [signedIn, setSignedIn] = useState(authenticated);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setSignedIn(authenticated);
    setError('');
  }, [address, authenticated]);

  const supportedChain = chainId === HASHKEY_MAINNET || chainId === HASHKEY_TESTNET;
  const connected = status === 'connected' && Boolean(address);
  const busy = working || isConnecting || isSigning;

  const connectorButtons = useMemo(
    () =>
      connectors.map((connector) => ({
        id: connector.uid,
        name: connector.name,
        connector,
      })),
    [connectors]
  );

  async function connect(connector: (typeof connectorButtons)[number]['connector']): Promise<void> {
    setWorking(true);
    setError('');
    try {
      await connectAsync({ connector });
    } catch {
      setError('Wallet connection was rejected. Try again.');
    } finally {
      setWorking(false);
    }
  }

  async function signIn(): Promise<void> {
    if (!address) {
      setError('Connect a wallet first.');
      return;
    }
    if (!supportedChain) {
      setError('Switch your wallet to HashKey mainnet (177) or testnet (133).');
      return;
    }
    setWorking(true);
    setError('');
    try {
      const nonceResponse = await fetch('/api/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: address, chainId }),
      });
      if (!nonceResponse.ok) {
        setError('Could not start sign-in. Retry.');
        return;
      }
      const { typedData } = (await nonceResponse.json()) as NonceResponse;
      const signature = await signTypedDataAsync({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
      const verifyResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress: address, nonce: typedData.message.nonce, signature }),
      });
      if (!verifyResponse.ok) {
        setError('Signature rejected. Retry sign-in.');
        return;
      }
      setSignedIn(true);
      onSignedIn?.();
      router.refresh();
      if (redirectTo) router.push(redirectTo);
    } catch {
      setError('Sign-in failed. Retry.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900/80 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Wallet</h2>
        {connected ? (
          <span className="rounded-full border border-zinc-700 px-3 py-1 font-mono text-xs text-zinc-300">
            {chainLabel(chainId)}
          </span>
        ) : null}
      </div>

      {connected && address ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Connected address</p>
            <p className="mt-1 break-all font-mono text-sm text-zinc-200" title={address}>
              {shortenAddress(address, 6)}
            </p>
          </div>
          {!supportedChain ? (
            <p role="alert" className="text-sm text-amber-300">
              Unsupported network. Switch to HashKey mainnet (177) or testnet (133) before signing
              in.
            </p>
          ) : null}
          {signedIn ? (
            <p role="status" className="text-sm text-emerald-300">
              Signed in. Your session is active.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={busy || !supportedChain}
              className="w-full rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSigning ? 'Waiting for signature…' : 'Sign in with wallet'}
            </button>
          )}
          <button
            type="button"
            onClick={() => disconnect()}
            className="w-full rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {connectorButtons.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No EVM wallet detected. Install MetaMask, OKX Wallet, or TokenPocket, then reload.
            </p>
          ) : (
            connectorButtons.map(({ id, name, connector }) => (
              <button
                key={id}
                type="button"
                onClick={() => void connect(connector)}
                disabled={busy}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-4 py-2 text-left text-sm text-zinc-200 transition-colors hover:border-emerald-700 disabled:opacity-50"
              >
                {isConnecting ? 'Connecting…' : `Connect ${name}`}
              </button>
            ))
          )}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {!connected ? (
        <p className="mt-3 text-xs text-zinc-500">Your keys never leave your wallet.</p>
      ) : null}
    </div>
  );
}
