'use client';

// Connect Wallet — Wallet Standard discovery only (no custom wallet
// integration). Lists every registered Wallet Standard wallet
// (Phantom, Solflare, Backpack, or any standard wallet), connects the
// chosen one, signs the Succra login message, and verifies it with the
// backend to establish a Supabase session. Unsupported wallets
// (no account, no solana:signMessage feature) surface an inline error.
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';

interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

const SIGN_MESSAGE_FEATURE = 'solana:signMessage';

interface SignMessageFeature {
  signMessage: (input: {
    message: Uint8Array;
    account?: unknown;
  }) => Promise<{ signature: Uint8Array }>;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export default function ConnectWallet(): React.JSX.Element {
  const router = useRouter();
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const api = getWallets();
    const refresh = (): void => {
      setWallets(api.get());
    };
    refresh();
    const offRegister = api.on('register', refresh);
    const offUnregister = api.on('unregister', refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);

  const fail = useCallback((message: string): void => {
    setStatus('error');
    setError(message);
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    setStatus('working');
    setError('');
    try {
      const wallet = wallets.find((entry) => entry.name === selected);
      if (!wallet) {
        fail('Select a wallet first.');
        return;
      }
      if (!('standard:connect' in wallet.features)) {
        fail(`${wallet.name} does not support standard connection.`);
        return;
      }
      const connectFeature = wallet.features['standard:connect'] as {
        connect: () => Promise<{ accounts: readonly { address: string }[] }>;
      };
      const { accounts } = await connectFeature.connect();
      const account = accounts[0];
      if (!account) {
        fail(`${wallet.name} exposed no account.`);
        return;
      }
      const walletAddress = account.address;
      if (!(SIGN_MESSAGE_FEATURE in wallet.features)) {
        fail(`${wallet.name} does not support message signing.`);
        return;
      }

      const nonceRes = await fetch('/api/auth/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      if (!nonceRes.ok) {
        fail('Could not start sign-in. Retry.');
        return;
      }
      const { message, nonce } = (await nonceRes.json()) as NonceResponse;
      const signFeature = wallet.features[SIGN_MESSAGE_FEATURE] as SignMessageFeature;
      const { signature } = await signFeature.signMessage({
        message: new TextEncoder().encode(message),
      });

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress, nonce, signature: toBase64(signature) }),
      });
      if (!verifyRes.ok) {
        fail('Signature rejected. Retry sign-in.');
        return;
      }
      router.push('/dashboard');
    } catch {
      fail('Sign-in failed. Retry.');
    }
  }, [fail, router, selected, wallets]);

  return (
    <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-lg font-semibold">Connect wallet</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Any Wallet Standard wallet works. Your keys never leave your wallet.
      </p>
      {wallets.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">
          No wallet detected. Install Phantom, Solflare, or Backpack, then reload.
        </p>
      ) : (
        <label className="mt-4 block text-sm">
          <span className="text-zinc-300">Wallet</span>
          <select
            aria-label="Wallet"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2"
            value={selected}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setSelected(event.currentTarget.value);
            }}
          >
            <option value="">Select…</option>
            {wallets.map((wallet) => (
              <option key={wallet.name} value={wallet.name}>
                {wallet.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={() => void connect()}
        disabled={status === 'working' || wallets.length === 0}
        className="mt-4 w-full rounded-md bg-emerald-500 px-4 py-2 font-semibold text-zinc-950 disabled:opacity-50"
      >
        {status === 'working' ? 'Signing in…' : 'Connect Wallet'}
      </button>
      {status === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {status !== 'error' && wallets.length > 0 && selected !== '' ? (
        <p className="mt-3 font-mono text-xs text-zinc-500">{shortAddress(selected)}</p>
      ) : null}
    </div>
  );
}
