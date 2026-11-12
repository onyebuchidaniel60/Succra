'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import {
  clearOwnerToken,
  fetchDemoOwner,
  getOwnerToken,
  requestOwnerChallenge,
  verifyOwnerAccess,
} from '@/lib/demo/client';

export type OwnerSession = {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  owner: string | null;
  ownerChecked: boolean;
  isOwner: boolean;
  unlocked: boolean;
  needsUnlock: boolean;
  unlocking: boolean;
  error: string | null;
  unlock: () => Promise<boolean>;
  expire: () => void;
};

/**
 * Resolves the deployer address and gates private state behind a one-time
 * wallet signature. Non-owner wallets never receive an unlock prompt.
 */
export function useOwnerSession(): OwnerSession {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [owner, setOwner] = useState<string | null>(null);
  const [ownerChecked, setOwnerChecked] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchDemoOwner()
      .then((value) => {
        if (active) setOwner(value);
      })
      .catch(() => {
        if (active) setOwner(null);
      })
      .finally(() => {
        if (active) setOwnerChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setToken(getOwnerToken());
    setError(null);
  }, [address]);

  const isOwner = Boolean(
    address && owner && address.toLowerCase() === owner.toLowerCase()
  );
  const unlocked = Boolean(token);
  const needsUnlock = isOwner && !unlocked;

  const expire = useCallback(() => {
    clearOwnerToken();
    setToken(null);
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    setUnlocking(true);
    setError(null);
    try {
      const message = await requestOwnerChallenge(address);
      const signature = await signMessageAsync({ message });
      await verifyOwnerAccess(address, signature);
      setToken(getOwnerToken());
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Wallet verification failed. Please try again.'
      );
      return false;
    } finally {
      setUnlocking(false);
    }
  }, [address, signMessageAsync]);

  return {
    address,
    isConnected,
    owner,
    ownerChecked,
    isOwner,
    unlocked,
    needsUnlock,
    unlocking,
    error,
    unlock,
    expire,
  };
}
