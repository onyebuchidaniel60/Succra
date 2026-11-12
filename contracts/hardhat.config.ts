import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import type { HardhatUserConfig } from 'hardhat/config';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

// Local-only deployer keys. The file is gitignored; shell env still works.
try {
  loadEnvFile(resolve(__dirname, '.env.local'));
} catch {
  // .env.local is optional for read-only and local-network commands.
}

const config: HardhatUserConfig = {
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: Number(process.env.HARDHAT_CHAIN_ID ?? '31337'),
    },
    hashkeyMainnet: {
      url: process.env.NEXT_PUBLIC_HASHKEY_RPC_URL || 'https://mainnet.hsk.xyz',
      chainId: 177,
    },
    hashkeyTestnet: {
      url: 'https://testnet.hsk.xyz',
      chainId: 133,
    },
    robinhoodMainnet: {
      url: 'https://rpc.mainnet.chain.robinhood.com',
      chainId: 4663,
      accounts: process.env.ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY
        ? [process.env.ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY]
        : [],
    },
    robinhoodTestnet: {
      url: 'https://rpc.testnet.chain.robinhood.com',
      chainId: 46630,
      accounts: process.env.ROBINHOOD_TESTNET_DEPLOYER_PRIVATE_KEY
        ? [process.env.ROBINHOOD_TESTNET_DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
