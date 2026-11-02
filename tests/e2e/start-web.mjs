/* global process, fetch, setTimeout */

// Playwright demo-stack launcher.
//
// Starts a local Hardhat node (chain 177), deploys GuardianRegistry +
// MissionFactory, starts the mock HSP, and boots Next.js with the test-only
// PGlite Supabase shim. All child processes are cleaned up together.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RPC_PORT = 8545;
const HSP_PORT = 8787;
const WEB_PORT = 3100;
const CHAIN_ID = 177;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const APP_URL = `http://127.0.0.1:${WEB_PORT}`;
const TOKEN = `0x${'77'.repeat(20)}`;
const MERCHANT = `0x${'88'.repeat(20)}`;

const KEYS = {
  owner: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  guardian: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  alpha: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  beta: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
};

const accounts = {
  owner: privateKeyToAccount(KEYS.owner),
  guardian: privateKeyToAccount(KEYS.guardian),
  alpha: privateKeyToAccount(KEYS.alpha),
  beta: privateKeyToAccount(KEYS.beta),
};

const logDir = join(ROOT, 'tests', 'e2e', '.logs');
mkdirSync(logDir, { recursive: true });
const logs = {
  hardhat: openSync(join(logDir, 'hardhat.log'), 'a'),
  hsp: openSync(join(logDir, 'hsp.log'), 'a'),
  web: openSync(join(logDir, 'web.log'), 'a'),
};
const children = [];

function start(command, args, env, log) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', log, log],
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`${command} exited with ${code}\n`);
    }
  });
  return child;
}

function stop(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) stop(child);
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // retry
    }
    if (Date.now() >= deadline) throw new Error(`${label} did not start at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

function artifact(name) {
  const path = join(ROOT, 'contracts', 'artifacts', 'src', `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function deploy() {
  execFileSync('pnpm', ['--filter', '@succra/contracts', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  start(
    'pnpm',
    [
      '--filter',
      '@succra/contracts',
      'exec',
      'hardhat',
      'node',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(RPC_PORT),
    ],
    { HARDHAT_CHAIN_ID: String(CHAIN_ID) },
    logs.hardhat
  );
  await waitFor(RPC_URL, 30_000, 'Hardhat');
  if (Number(await rpc('eth_chainId')) !== CHAIN_ID) {
    throw new Error(`Hardhat chain id is not ${CHAIN_ID}`);
  }

  const chain = {
    id: CHAIN_ID,
    name: 'Hardhat',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const wallet = createWalletClient({
    account: accounts.owner,
    chain,
    transport: http(RPC_URL),
  });
  const registryArtifact = artifact('GuardianRegistry');
  const registryHash = await wallet.deployContract({
    abi: registryArtifact.abi,
    bytecode: registryArtifact.bytecode,
    args: [accounts.guardian.address],
  });
  const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryHash });
  if (!registryReceipt.contractAddress) throw new Error('GuardianRegistry deployment failed.');
  const registryAddress = registryReceipt.contractAddress;

  const factoryArtifact = artifact('MissionFactory');
  const factoryHash = await wallet.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode,
    args: [registryAddress],
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: factoryHash });
  if (!factoryReceipt.contractAddress) throw new Error('MissionFactory deployment failed.');
  return factoryReceipt.contractAddress;
}

async function main() {
  const factory = await deploy();

  start(
    'pnpm',
    ['exec', 'tsx', 'tests/e2e/mock-hsp.ts'],
    { E2E_HSP_PORT: String(HSP_PORT), HSP_HMAC_SECRET: 'test-hmac-secret' },
    logs.hsp
  );
  await waitFor(`http://127.0.0.1:${HSP_PORT}/health`, 15_000, 'mock HSP');

  const env = {
    SUCCRA_E2E_MODE: '1',
    SUCCRA_E2E_WALLET: accounts.owner.address,
    SUCCRA_E2E_MIGRATIONS_DIR: join(ROOT, 'supabase', 'migrations'),
    NEXT_PUBLIC_APP_URL: APP_URL,
    NEXT_PUBLIC_HASHKEY_CHAIN_ID: String(CHAIN_ID),
    NEXT_PUBLIC_HASHKEY_RPC_URL: RPC_URL,
    SUCCRA_RPC_URL: RPC_URL,
    NEXT_PUBLIC_HASHKEY_EXPLORER_URL: 'https://hashkey.blockscout.com',
    SUCCRA_MISSION_FACTORY_ADDRESS: factory,
    SUCCRA_GUARDIAN_ADDRESS: accounts.guardian.address,
    HASHKEY_GUARDIAN_SECRET_KEY: KEYS.guardian,
    SUCCRA_RUNTIME_SIGNER_SECRET_KEY: KEYS.guardian,
    HSP_API_BASE_URL: `http://127.0.0.1:${HSP_PORT}`,
    HSP_HMAC_SECRET: 'test-hmac-secret',
    HSP_MERCHANT_ID: 'e2e-merchant',
    NEXT_PUBLIC_DEFAULT_PAYMENT_TOKEN_ADDRESS: TOKEN,
    NEXT_PUBLIC_TOKEN_DECIMALS: `${TOKEN}:6`,
    NEXT_PUBLIC_TOKEN_SYMBOLS: `${TOKEN}:USDC`,
    NEXT_TELEMETRY_DISABLED: '1',
    E2E_TOKEN: TOKEN,
    E2E_MERCHANT: MERCHANT,
  };

  start(
    'pnpm',
    ['--filter', '@succra/web', 'exec', 'next', 'dev', '-p', String(WEB_PORT)],
    env,
    logs.web
  );
  await waitFor(APP_URL, 120_000, 'Next.js');
  process.stdout.write(`demo stack ready: ${APP_URL} factory=${factory}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  shutdown(1);
});
