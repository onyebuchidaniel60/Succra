// Succra web — wagmi configuration for HashKey mainnet and testnet.
//
// Injected wallets cover MetaMask/OKX/TokenPocket browser extensions;
// WalletConnect covers mobile wallets when a project id is configured.
// The config is created once at module scope and shared by <Providers>.
import { createConfig, http, type Config, type CreateConnectorFn } from 'wagmi';
import { injected } from 'wagmi/connectors/injected';
import { walletConnect } from 'wagmi/connectors/walletConnect';
import { hashkey, hashkeyTestnet } from 'viem/chains';
import type { Chain } from 'viem';

export const hashkeyMainnet: Chain = hashkey;
export const hashkeyTestnetChain: Chain = hashkeyTestnet;

export function supportedChainIds(): number[] {
  return [hashkeyMainnet.id, hashkeyTestnetChain.id];
}

function mainnetRpc(): string {
  return process.env.NEXT_PUBLIC_HASHKEY_RPC_URL ?? 'https://mainnet.hsk.xyz';
}

function testnetRpc(): string | undefined {
  return process.env.NEXT_PUBLIC_HASHKEY_TESTNET_RPC_URL;
}

export function createSuccraWagmiConfig(): Config {
  const connectors = [injected({ shimDisconnect: true })] as CreateConnectorFn[];
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (projectId) {
    connectors.push(
      walletConnect({
        projectId,
        showQrModal: true,
      })
    );
  }

  return createConfig({
    chains: [hashkeyMainnet, hashkeyTestnetChain],
    connectors,
    transports: {
      [hashkeyMainnet.id]: http(mainnetRpc()),
      [hashkeyTestnetChain.id]: http(testnetRpc()),
    },
    ssr: true,
  });
}

export const wagmiConfig: Config = createSuccraWagmiConfig();
