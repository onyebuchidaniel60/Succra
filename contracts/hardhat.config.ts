import '@nomicfoundation/hardhat-chai-matchers';
import '@nomicfoundation/hardhat-ethers';
import type { HardhatUserConfig } from 'hardhat/config';

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
    },
  },
  networks: {
    hashkeyMainnet: {
      url: process.env.NEXT_PUBLIC_HASHKEY_RPC_URL || 'https://mainnet.hsk.xyz',
      chainId: 177,
    },
    hashkeyTestnet: {
      url: 'https://testnet.hsk.xyz',
      chainId: 133,
    },
  },
};

export default config;
