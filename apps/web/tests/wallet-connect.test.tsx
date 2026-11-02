// @vitest-environment jsdom
// Component smoke test: wallet connection states with wagmi hooks mocked.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wagmiState = vi.hoisted(() => ({
  account: { address: undefined as `0x${string}` | undefined, status: 'disconnected' },
  connectors: [
    {
      uid: 'injected',
      name: 'MetaMask',
      type: 'injected',
    },
  ],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => wagmiState.account,
  useChainId: () => 177,
  useConnect: () => ({ connectAsync: vi.fn(), isPending: false }),
  useConnectors: () => wagmiState.connectors,
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSignTypedData: () => ({ signTypedDataAsync: vi.fn(), isPending: false }),
}));

import WalletConnect from '../components/WalletConnect';

beforeEach(() => {
  wagmiState.account = { address: undefined, status: 'disconnected' };
});

afterEach(() => {
  cleanup();
});

describe('WalletConnect', () => {
  it('offers injected connectors when disconnected', () => {
    render(<WalletConnect />);
    expect(screen.getByRole('button', { name: 'Connect MetaMask' })).toBeTruthy();
    expect(screen.getByText('Your keys never leave your wallet.')).toBeTruthy();
  });

  it('shows the connected address, chain badge, and sign-in action', () => {
    wagmiState.account = {
      address: '0x1111111111111111111111111111111111111111',
      status: 'connected',
    };
    render(<WalletConnect />);
    expect(screen.getByText('HashKey mainnet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with wallet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('marks an already-authenticated session as signed in', () => {
    wagmiState.account = {
      address: '0x1111111111111111111111111111111111111111',
      status: 'connected',
    };
    render(<WalletConnect authenticated />);
    expect(screen.getByRole('status').textContent).toContain('Signed in');
  });
});
