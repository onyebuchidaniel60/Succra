// Succra web — wagmi configuration for Robinhood mainnet and testnet.
//
// Injected wallets cover MetaMask/OKX/TokenPocket browser extensions;
// WalletConnect covers mobile wallets when a project id is configured.
import { createConfig, type Config, type CreateConnectorFn } from 'wagmi';
import { defineChain, http, type Chain } from 'viem';
import { injected } from 'wagmi/connectors/injected';
import { walletConnect } from 'wagmi/connectors/walletConnect';

export const robinhoodMainnet: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Robinhood Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

const TESTNET_RPC =
  process.env.NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com';

export const robinhoodTestnet: Chain = defineChain({
  id: 46630,
  name: 'Robinhood Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [TESTNET_RPC] } },
  blockExplorers: {
    default: { name: 'Robinhood Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export function supportedChainIds(): number[] {
  return [robinhoodMainnet.id, robinhoodTestnet.id];
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
    chains: [robinhoodMainnet, robinhoodTestnet],
    connectors,
    transports: {
      [robinhoodMainnet.id]: http(),
      [robinhoodTestnet.id]: http(TESTNET_RPC),
    },
    ssr: true,
  });
}

export const wagmiConfig: Config = createSuccraWagmiConfig();
