import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import {
  buildEip3009TypedData,
  hashTransferWithAuthorization,
  signTransferWithAuthorization,
} from '@succra/x402-client';

const RPC_URL = process.env.SUCCRA_DEMO_RPC_URL ?? 'http://127.0.0.1:8545';
const CHAIN_ID = 31337;

const chain = defineChain({
  id: CHAIN_ID,
  name: 'Succra local demo',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const HARDHAT_KEYS = {
  owner: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  guardian: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  primary: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  successor: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  merchant: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
} as const;

const owner = privateKeyToAccount(HARDHAT_KEYS.owner);
const guardian = privateKeyToAccount(HARDHAT_KEYS.guardian);
const primary = privateKeyToAccount(HARDHAT_KEYS.primary);
const successor = privateKeyToAccount(HARDHAT_KEYS.successor);
const merchant = privateKeyToAccount(HARDHAT_KEYS.merchant);

const walletFor = (account: PrivateKeyAccount) =>
  createWalletClient({ account, chain, transport: http(RPC_URL) });

type Artifact = { abi: Abi; bytecode: Hex };

function repoRoot(): string {
  const candidates = [
    process.env.SUCCRA_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'contracts', 'artifacts'))) return candidate;
  }
  throw new Error('Could not find contracts/artifacts. Compile contracts first.');
}

function artifact(relative: string): Artifact {
  const file = path.join(
    repoRoot(),
    'contracts',
    'artifacts',
    'src',
    relative
  );
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { abi: Abi; bytecode: Hex };
  return { abi: json.abi, bytecode: json.bytecode };
}

const artifacts = {
  registry: artifact('GuardianRegistry.sol/GuardianRegistry.json'),
  factory: artifact('MissionFactory.sol/MissionFactory.json'),
  mission: artifact('SuccraMission.sol/SuccraMission.json'),
  token: artifact('mocks/MockERC3009Token.sol/MockERC3009Token.json'),
};

export type DemoEvent = {
  label: string;
  hash: string;
  block: number;
  kind: 'deploy' | 'deposit' | 'payment' | 'violation' | 'quarantine' | 'succession' | 'recovery' | 'withdraw';
};

export type DemoMission = {
  key: 'usdg' | 'wif';
  label: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  missionAddress: string;
  status: string;
  deposited: string;
  spent: string;
  available: string;
  sessionKey: string;
  successor: string;
  recoveryCap: string;
};

export type DemoState = {
  initialized: boolean;
  phase: string;
  chainId: number;
  label: string;
  registry: string;
  factory: string;
  owner: string;
  guardian: string;
  primary: string;
  successor: string;
  merchant: string;
  missions: DemoMission[];
  events: DemoEvent[];
  note: string;
};

type Runtime = {
  usdg: Address;
  wif: Address;
  usdgMission: Address;
  wifMission: Address;
  session1: PrivateKeyAccount;
  session2: PrivateKeyAccount;
  session3: PrivateKeyAccount;
  nonce: number;
};

type GlobalDemo = {
  state?: DemoState | undefined;
  runtime?: Runtime | undefined;
};

const globalForDemo = globalThis as unknown as { __succraDemo?: GlobalDemo };
const store: GlobalDemo = (globalForDemo.__succraDemo ??= {});

const STATUS = [
  'DRAFT',
  'ACTIVE',
  'DEGRADED',
  'QUARANTINED',
  'RECOVERING',
  'ACTIVE_RECOVERY',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'HALTED',
];

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function wait(hash: Hex): Promise<{ block: number }> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  return { block: Number(receipt.blockNumber) };
}

async function deploy(kind: keyof typeof artifacts, args: unknown[], account = owner): Promise<Address> {
  const wallet = walletFor(account);
  const hash = await wallet.deployContract({
    abi: artifacts[kind].abi,
    bytecode: artifacts[kind].bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`Deployment failed: ${kind}`);
  }
  return receipt.contractAddress;
}

async function write(
  kind: keyof typeof artifacts,
  address: Address,
  functionName: string,
  args: unknown[],
  account: PrivateKeyAccount
): Promise<Hex> {
  const wallet = walletFor(account);
  const hash = await wallet.writeContract({
    abi: artifacts[kind].abi,
    address,
    functionName,
    args,
  });
  await wait(hash);
  return hash;
}

async function read<T>(
  kind: keyof typeof artifacts,
  address: Address,
  functionName: string,
  args: unknown[] = []
): Promise<T> {
  return publicClient.readContract({
    abi: artifacts[kind].abi,
    address,
    functionName,
    args,
  }) as Promise<T>;
}

async function readAuthority(mission: Address) {
  const authority = await read<readonly unknown[]>(
    'mission',
    mission,
    'authority'
  );
  return {
    currentAgent: authority[0] as Address,
    status: Number(authority[1]),
    agentNonce: authority[2] as bigint,
    stateVersion: authority[3] as bigint,
    violationCount: Number(authority[4]),
    confirmedSpentAtomic: authority[6] as bigint,
    sessionKey: authority[7] as Address,
    depositedAtomic: authority[8] as bigint,
    withdrawnAtomic: authority[9] as bigint,
  };
}

async function missionView(args: {
  key: 'usdg' | 'wif';
  label: string;
  symbol: string;
  decimals: number;
  token: Address;
  mission: Address;
  recoveryCap: bigint;
}): Promise<DemoMission> {
  const authority = await readAuthority(args.mission);
  const available = await read<bigint>('mission', args.mission, 'availableBalance');
  return {
    key: args.key,
    label: args.label,
    symbol: args.symbol,
    decimals: args.decimals,
    tokenAddress: args.token,
    missionAddress: args.mission,
    status: STATUS[authority.status] ?? String(authority.status),
    deposited: authority.depositedAtomic.toString(),
    spent: authority.confirmedSpentAtomic.toString(),
    available: available.toString(),
    sessionKey: authority.sessionKey,
    successor: successor.address,
    recoveryCap: args.recoveryCap.toString(),
  };
}

function event(
  state: DemoState,
  label: string,
  hash: Hex,
  block: number,
  kind: DemoEvent['kind']
): void {
  state.events.unshift({ label, hash, block, kind });
  state.events = state.events.slice(0, 24);
}

function missionConfig(args: {
  token: Address;
  budget: bigint;
  initial: bigint;
  max: bigint;
  recovery: bigint;
  label: string;
}) {
  return {
    paymentToken: args.token,
    budgetAtomic: args.budget,
    initialDepositAtomic: args.initial,
    maxPaymentAtomic: args.max,
    recoveryMaxPaymentAtomic: args.recovery,
    merchantAllowlist: [merchant.address],
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60),
    policyHash: keccak256(stringToHex(`succra-policy-${args.label}-${Date.now()}`)),
    primaryAgent: primary.address,
    successors: [{ agent: successor.address, priority: 1, active: true }],
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    cartMandateHash: keccak256(stringToHex(`x402-offer-${args.label}-${Date.now()}`)),
  };
}

async function setup(): Promise<DemoState> {
  const state: DemoState = {
    initialized: true,
    phase: 'Mission created',
    chainId: CHAIN_ID,
    label: 'Robinhood Chain · local deterministic demo',
    registry: '',
    factory: '',
    owner: owner.address,
    guardian: guardian.address,
    primary: primary.address,
    successor: successor.address,
    merchant: merchant.address,
    missions: [],
    events: [],
    note: 'Local Hardhat chain. Contracts, tokens, EIP-3009 signatures, and state transitions are real.',
  };

  const registry = await deploy('registry', [guardian.address]);
  const factory = await deploy('factory', [registry]);
  const usdg = await deploy('token', ['Global Dollar', 'USDG', 6]);
  const wif = await deploy('token', ['World is Flat', 'WIF', 18]);
  state.registry = registry;
  state.factory = factory;

  await write('factory', factory, 'setAllowedTokens', [[usdg, wif]], owner);
  await write('token', usdg, 'mint', [owner.address, 1_000_000_000_000n], owner);
  await write('token', wif, 'mint', [owner.address, 1_000_000n * 10n ** 18n], owner);

  const usdgConfig = missionConfig({
    token: usdg,
    budget: 1_000_000_000n,
    initial: 1_000_000n,
    max: 100_000_000n,
    recovery: 50_000_000n,
    label: 'usdg',
  });
  const wifConfig = missionConfig({
    token: wif,
    budget: 1_000n * 10n ** 18n,
    initial: 10n ** 18n,
    max: 100n * 10n ** 18n,
    recovery: 50n * 10n ** 18n,
    label: 'wif',
  });

  await write('factory', factory, 'createMission', [usdgConfig], owner);
  await write('factory', factory, 'createMission', [wifConfig], owner);
  const count = await read<bigint>('factory', factory, 'totalMissions');
  const usdgMission = await read<Address>('factory', factory, 'getMissionAt', [count - 2n]);
  const wifMission = await read<Address>('factory', factory, 'getMissionAt', [count - 1n]);

  const session1 = privateKeyToAccount(generatePrivateKey());
  const session2 = privateKeyToAccount(generatePrivateKey());
  const session3 = privateKeyToAccount(generatePrivateKey());

  await write('mission', usdgMission, 'registerSessionKey', [session1.address, 0n], owner);
  await write('mission', wifMission, 'registerSessionKey', [session2.address, 0n], owner);

  await write('token', usdg, 'approve', [usdgMission, 1_000_000n], owner);
  await write('mission', usdgMission, 'deposit', [1_000_000n], owner);
  await write('token', wif, 'approve', [wifMission, 10n ** 18n], owner);
  await write('mission', wifMission, 'deposit', [10n ** 18n], owner);

  state.missions = [
    await missionView({
      key: 'usdg',
      label: 'USDG Treasury',
      symbol: 'USDG',
      decimals: 6,
      token: usdg,
      mission: usdgMission,
      recoveryCap: 50_000_000n,
    }),
    await missionView({
      key: 'wif',
      label: 'WIF Procurement',
      symbol: 'WIF',
      decimals: 18,
      token: wif,
      mission: wifMission,
      recoveryCap: 50n * 10n ** 18n,
    }),
  ];
  event(state, 'GuardianRegistry + MissionFactory deployed', keccak256(stringToHex(factory)), 0, 'deploy');
  event(state, 'USDG and WIF missions funded', keccak256(stringToHex(usdgMission)), 0, 'deposit');

  store.state = state;
  store.runtime = { usdg, wif, usdgMission, wifMission, session1, session2, session3, nonce: 0 };
  return state;
}

async function refresh(state: DemoState, runtime: Runtime): Promise<DemoState> {
  state.missions = [
    await missionView({
      key: 'usdg',
      label: 'USDG Treasury',
      symbol: 'USDG',
      decimals: 6,
      token: runtime.usdg,
      mission: runtime.usdgMission,
      recoveryCap: 50_000_000n,
    }),
    await missionView({
      key: 'wif',
      label: 'WIF Procurement',
      symbol: 'WIF',
      decimals: 18,
      token: runtime.wif,
      mission: runtime.wifMission,
      recoveryCap: 50n * 10n ** 18n,
    }),
  ];
  return state;
}

async function runPayment(
  state: DemoState,
  runtime: Runtime,
  key: 'usdg' | 'wif'
): Promise<DemoState> {
  const isUsdg = key === 'usdg';
  const token = isUsdg ? runtime.usdg : runtime.wif;
  const mission = isUsdg ? runtime.usdgMission : runtime.wifMission;
  const session = isUsdg ? runtime.session1 : runtime.session2;
  const amount = isUsdg ? 10_000n : 10n ** 16n;
  const domainName = isUsdg ? 'Global Dollar' : 'World is Flat';

  const authority = await readAuthority(mission);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3_600);
  runtime.nonce += 1;
  const nonce = keccak256(stringToHex(`${key}-payment-${runtime.nonce}-${Date.now()}`));
  const typedData = buildEip3009TypedData({
    domain: {
      name: domainName,
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: token,
    },
    message: {
      from: mission,
      to: merchant.address,
      value: amount,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  const hash = hashTransferWithAuthorization(typedData);
  const signature = await signTransferWithAuthorization(session, typedData);

  const approvalHash = await write(
    'mission',
    mission,
    'approvePayment',
    [hash, amount, merchant.address, authority.stateVersion],
    guardian
  );
  const transferHash = await write(
    'token',
    token,
    'transferWithAuthorization',
    [mission, merchant.address, amount, 0n, validBefore, nonce, signature],
    owner
  );
  const settlementHash = await write(
    'mission',
    mission,
    'recordSettlement',
    [hash, amount, keccak256(transferHash), authority.stateVersion + 1n],
    guardian
  );

  state.phase = `${isUsdg ? 'USDG' : 'WIF'} x402 payment settled`;
  event(state, `${isUsdg ? 'USDG' : 'WIF'} EIP-3009 payment · ${amount} atomic`, transferHash, 0, 'payment');
  event(state, 'Variant A approved hash', approvalHash, 0, 'payment');
  event(state, 'Settlement recorded', settlementHash, 0, 'payment');
  return refresh(state, runtime);
}

async function runViolations(state: DemoState, runtime: Runtime, key: 'usdg' | 'wif') {
  const mission = key === 'usdg' ? runtime.usdgMission : runtime.wifMission;
  let authority = await readAuthority(mission);
  for (let index = 1; index <= 3; index += 1) {
    const requestId = keccak256(stringToHex(`violation-${key}-${index}-${Date.now()}`));
    const hash = await write(
      'mission',
      mission,
      'recordViolation',
      [requestId, authority.stateVersion],
      guardian
    );
    event(state, `Policy violation ${index}/3`, hash, 0, 'violation');
    authority = await readAuthority(mission);
  }
  state.phase = 'Three violations · threshold reached';
  return refresh(state, runtime);
}

async function quarantine(state: DemoState, runtime: Runtime) {
  for (const key of ['usdg', 'wif'] as const) {
    const mission = key === 'usdg' ? runtime.usdgMission : runtime.wifMission;
    const authority = await readAuthority(mission);
    const hash = await write('mission', mission, 'quarantine', [authority.stateVersion], guardian);
    event(state, `${key.toUpperCase()} mission quarantined`, hash, 0, 'quarantine');
  }
  const usdgAuthority = await readAuthority(runtime.usdgMission);
  const withdrawAmount = 500_000n;
  const withdrawHash = await write(
    'mission',
    runtime.usdgMission,
    'withdraw',
    [withdrawAmount],
    owner
  );
  event(state, 'Owner withdrew 0.50 USDG while quarantined', withdrawHash, 0, 'withdraw');
  state.phase = 'Quarantined · session keys revoked · owner withdrawal works';
  void usdgAuthority;
  return refresh(state, runtime);
}

async function succession(state: DemoState, runtime: Runtime) {
  const mission = runtime.usdgMission;
  let authority = await readAuthority(mission);
  const activateHash = await write(
    'mission',
    mission,
    'activateSuccessor',
    [successor.address, authority.stateVersion],
    guardian
  );
  event(state, 'Successor Beta activated', activateHash, 0, 'succession');
  authority = await readAuthority(mission);
  const ackHash = await write(
    'mission',
    mission,
    'acknowledgeRecovery',
    [authority.stateVersion, '0x'],
    successor
  );
  event(state, 'Recovery acknowledged', ackHash, 0, 'succession');
  authority = await readAuthority(mission);
  const keyHash = await write(
    'mission',
    mission,
    'registerSessionKey',
    [runtime.session3.address, authority.stateVersion],
    owner
  );
  event(state, 'New session key registered with recovery cap', keyHash, 0, 'succession');
  state.phase = 'Recovery authority active';
  return refresh(state, runtime);
}

async function recovery(state: DemoState, runtime: Runtime) {
  const mission = runtime.usdgMission;
  const token = runtime.usdg;
  const amount = 20_000n;
  const authority = await readAuthority(mission);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3_600);
  runtime.nonce += 1;
  const nonce = keccak256(stringToHex(`recovery-${runtime.nonce}-${Date.now()}`));
  const typedData = buildEip3009TypedData({
    domain: {
      name: 'Global Dollar',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: token,
    },
    message: {
      from: mission,
      to: merchant.address,
      value: amount,
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  const hash = hashTransferWithAuthorization(typedData);
  const signature = await signTransferWithAuthorization(runtime.session3, typedData);
  const approvalHash = await write(
    'mission',
    mission,
    'approvePayment',
    [hash, amount, merchant.address, authority.stateVersion],
    guardian
  );
  const transferHash = await write(
    'token',
    token,
    'transferWithAuthorization',
    [mission, merchant.address, amount, 0n, validBefore, nonce, signature],
    owner
  );
  const settlementHash = await write(
    'mission',
    mission,
    'recordSettlement',
    [hash, amount, keccak256(transferHash), authority.stateVersion + 1n],
    guardian
  );
  event(state, 'Successor recovery payment settled', transferHash, 0, 'recovery');
  event(state, 'Recovery approval recorded', approvalHash, 0, 'recovery');
  event(state, 'Recovery settlement recorded', settlementHash, 0, 'recovery');
  state.phase = 'Mission continued under recovery authority';
  return refresh(state, runtime);
}

export async function getDemoState(): Promise<DemoState> {
  if (!store.state) return setup();
  return store.state;
}

export async function runDemoAction(action: string): Promise<DemoState> {
  if (action === 'reset') {
    store.state = undefined;
    store.runtime = undefined;
    return setup();
  }
  if (!store.state || !store.runtime) {
    await setup();
  }
  const state = store.state!;
  const runtime = store.runtime!;
  switch (action) {
    case 'init':
      return refresh(state, runtime);
    case 'usdg-payment':
      return runPayment(state, runtime, 'usdg');
    case 'wif-payment':
      return runPayment(state, runtime, 'wif');
    case 'violations':
      return runViolations(state, runtime, 'usdg');
    case 'quarantine':
      return quarantine(state, runtime);
    case 'succession':
      return succession(state, runtime);
    case 'recovery':
      return recovery(state, runtime);
    default:
      throw new Error(`Unknown demo action: ${action}`);
  }
}

export function demoAddresses(state: DemoState): string {
  return [
    `factory=${state.factory}`,
    `registry=${state.registry}`,
    ...state.missions.map((mission) => `${mission.symbol}=${mission.missionAddress}`),
  ].join(' ');
}

export { short };
