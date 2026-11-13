import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
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

const MAINNET_MODE =
  process.env['SUCCRA_DEMO_MODE'] === 'mainnet' || process.env['RENDER'] === 'true';
const RPC_URL =
  process.env['SUCCRA_DEMO_RPC_URL'] ??
  (MAINNET_MODE
    ? 'https://rpc.mainnet.chain.robinhood.com'
    : 'http://127.0.0.1:8545');
const CHAIN_ID = MAINNET_MODE ? 4663 : 31337;
const MAINNET_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address;
const MAINNET_WIF = '0x5173b8eA6923c2d40267890D45C46a3480954773' as Address;
const MAINNET_FACTORY =
  (process.env.SUCCRA_MAINNET_FACTORY as Address | undefined) ??
  '0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917';
const MAINNET_REGISTRY =
  (process.env.SUCCRA_MAINNET_REGISTRY as Address | undefined) ??
  '0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B';
const MAINNET_USDG_MISSION =
  (process.env.SUCCRA_MAINNET_USDG_MISSION as Address | undefined) ??
  '0x37522496E38f7859C96bCAC058d23f7296BB646b';
const MAINNET_WIF_MISSION =
  (process.env.SUCCRA_MAINNET_WIF_MISSION as Address | undefined) ??
  '0x5bdC628D1b0c7DE78579E076398f4c5216e10e08';

const chain = defineChain({
  id: CHAIN_ID,
  name: MAINNET_MODE ? 'Robinhood Chain' : 'Succra local demo',
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

function envFileValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '../..'),
    path.resolve(process.cwd(), '../../..'),
  ];
  for (const candidate of candidates) {
    const file = path.join(candidate, 'contracts', '.env.local');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.startsWith(`${name}=`)) continue;
      return line.slice(name.length + 1).trim();
    }
  }
  return undefined;
}

const MAINNET_KEY = envFileValue('ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY');
const owner = MAINNET_MODE
  ? privateKeyToAccount((MAINNET_KEY ?? (() => { throw new Error('Missing mainnet signer.'); })()) as Hex)
  : privateKeyToAccount(HARDHAT_KEYS.owner);
const guardian = MAINNET_MODE ? owner : privateKeyToAccount(HARDHAT_KEYS.guardian);
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

const REGISTRY_ABI = parseAbi([
  'function guardian() view returns (address)',
]);

const FACTORY_ABI = parseAbi([
  'function createMission((address paymentToken,uint256 budgetAtomic,uint256 initialDepositAtomic,uint256 maxPaymentAtomic,uint256 recoveryMaxPaymentAtomic,address[] merchantAllowlist,uint64 expiresAt,bytes32 policyHash,address primaryAgent,(address agent,uint16 priority,bool active)[] successors,uint16 violationThreshold,uint64 violationWindowSeconds,bytes32 cartMandateHash) config) returns (address)',
  'function totalMissions() view returns (uint256)',
  'function getMissionAt(uint256 index) view returns (address)',
  'function setAllowedTokens(address[] tokens)',
  'event MissionFactoryMissionDeployed(address indexed owner, address indexed mission)',
]);

const MISSION_ABI = parseAbi([
  'function authority() view returns (address currentAgent,uint8 status,uint64 agentNonce,uint64 stateVersion,uint16 violationCount,uint64 lastViolationAt,uint256 confirmedSpentAtomic,address sessionKey,uint256 depositedAtomic,uint256 withdrawnAtomic,uint256 reservedAtomic,uint256 releasedAtomic,bytes32 lastCheckpointHash,uint64 lastCheckpointSequence,uint64 checkpointCount)',
  'function config() view returns (address paymentToken,uint256 budgetAtomic,uint256 initialDepositAtomic,uint256 maxPaymentAtomic,uint256 recoveryMaxPaymentAtomic,address[] merchantAllowlist,uint64 expiresAt,bytes32 policyHash,address primaryAgent,(address agent,uint16 priority,bool active)[] successors,uint16 violationThreshold,uint64 violationWindowSeconds,bytes32 cartMandateHash)',
  'function availableBalance() view returns (uint256)',
  'function deposit(uint256 amountAtomic)',
  'function withdraw(uint256 amountAtomic)',
  'function registerSessionKey(address sessionKey,uint64 expectedVersion)',
  'function approvePayment(bytes32 authorizationHash,uint256 amountAtomic,address merchant,uint64 expectedVersion)',
  'function executeERC20Transfer(address token,address to,uint256 amountAtomic) returns (bool)',
  'function releaseForPayment(address sessionKey,uint256 amountAtomic,uint64 expectedVersion)',
  'function recordSettlement(bytes32 paymentId,uint256 amountAtomic,bytes32 txHash,uint64 expectedVersion)',
  'function recordViolation(bytes32 requestId,uint64 expectedVersion)',
  'function quarantine(uint64 expectedVersion)',
  'function activateSuccessor(address successor,uint64 expectedVersion)',
  'function acknowledgeRecovery(uint64 expectedVersion,bytes signature)',
  'function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)',
  'event PaymentApproved(bytes32 indexed authorizationHash,uint256 amount,address merchant)',
  'event PaymentReleased(address indexed sessionKey,uint256 amount)',
  'event FundsDeposited(address indexed owner,uint256 amount)',
  'event FundsWithdrawn(address indexed owner,uint256 amount)',
  'event SessionKeyRegistered(address indexed sessionKey,uint64 stateVersion)',
  'event SessionKeyRevoked(address indexed sessionKey,uint64 stateVersion)',
  'event TreasuryTransfer(address indexed token,address indexed to,uint256 amountAtomic,uint64 stateVersion)',
]);

const TOKEN_ABI = parseAbi([
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function mint(address to,uint256 amount)',
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)',
]);

type AbiKind = 'registry' | 'factory' | 'mission' | 'token';

function abiFor(kind: AbiKind): Abi {
  switch (kind) {
    case 'registry':
      return REGISTRY_ABI;
    case 'factory':
      return FACTORY_ABI;
    case 'mission':
      return MISSION_ABI;
    case 'token':
      return TOKEN_ABI;
  }
}

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

async function deploy(kind: AbiKind, args: unknown[], account = owner): Promise<Address> {
  const wallet = walletFor(account);
  const compiled = artifact(
    kind === 'registry'
      ? 'GuardianRegistry.sol/GuardianRegistry.json'
      : kind === 'factory'
        ? 'MissionFactory.sol/MissionFactory.json'
        : kind === 'mission'
          ? 'SuccraMission.sol/SuccraMission.json'
          : 'mocks/MockERC3009Token.sol/MockERC3009Token.json'
  );
  const hash = await wallet.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`Deployment failed: ${kind}`);
  }
  return receipt.contractAddress;
}

async function write(
  kind: AbiKind,
  address: Address,
  functionName: string,
  args: unknown[],
  account: PrivateKeyAccount
): Promise<Hex> {
  const wallet = walletFor(account);
  const hash = await wallet.writeContract({
    abi: abiFor(kind),
    address,
    functionName,
    args,
  });
  await wait(hash);
  return hash;
}

async function read<T>(
  kind: AbiKind,
  address: Address,
  functionName: string,
  args: unknown[] = []
): Promise<T> {
  return publicClient.readContract({
    abi: abiFor(kind),
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
    reservedAtomic: authority[10] as bigint,
    releasedAtomic: authority[11] as bigint,
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
  // Historical missions were deployed before availableBalance() included
  // owner withdrawals. Compute the committed amount here so the live API is
  // correct for both old and new bytecode.
  const committed =
    authority.confirmedSpentAtomic +
    authority.reservedAtomic +
    authority.releasedAtomic +
    authority.withdrawnAtomic;
  const available =
    authority.depositedAtomic > committed ? authority.depositedAtomic - committed : 0n;
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
  hash: string,
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

async function setupMainnet(): Promise<DemoState> {
  const state: DemoState = {
    initialized: true,
    phase: 'Mainnet missions live',
    chainId: CHAIN_ID,
    label: 'Robinhood Chain · live mainnet',
    registry: MAINNET_REGISTRY,
    factory: MAINNET_FACTORY,
    owner: owner.address,
    guardian: guardian.address,
    primary: primary.address,
    successor: successor.address,
    merchant: merchant.address,
    missions: [],
    events: [],
    note: 'Live Robinhood mainnet. USDG settles through x402 EIP-3009; WIF uses policy-bounded ERC-20 treasury transfers.',
  };

  const session1 = privateKeyToAccount(generatePrivateKey());
  const session2 = privateKeyToAccount(generatePrivateKey());
  const session3 = privateKeyToAccount(generatePrivateKey());

  const usdgAuthority = await readAuthority(MAINNET_USDG_MISSION);
  await write(
    'mission',
    MAINNET_USDG_MISSION,
    'registerSessionKey',
    [session1.address, usdgAuthority.stateVersion],
    owner
  );

  state.missions = [
    await missionView({
      key: 'usdg',
      label: 'USDG Treasury',
      symbol: 'USDG',
      decimals: 6,
      token: MAINNET_USDG,
      mission: MAINNET_USDG_MISSION,
      recoveryCap: 500_000n,
    }),
    await missionView({
      key: 'wif',
      label: 'WIF Treasury',
      symbol: 'WIF',
      decimals: 18,
      token: MAINNET_WIF,
      mission: MAINNET_WIF_MISSION,
      recoveryCap: 5n * 10n ** 16n,
    }),
  ];
  const evidence: Array<[string, string, DemoEvent['kind']]> = [
    ['Mainnet USDG mission created', '0x159d48af15282f927323e22149dd0a509fb767ab47ad7b298ee80232fb2181fd', 'deploy'],
    ['Mainnet WIF treasury mission deployed', '0x74645d94a5619c4ff7d22d92834c8377ed757ee52f63ff4ed108ee2443d296ea', 'deploy'],
    ['Mainnet USDG ERC-1271 probe PASS', '0x7024fd4153b3d378952118002122ea9861ded8998bac032d5eaeae0de0cea3a8', 'payment'],
    ['USDG EIP-3009 payment · 0.01 USDG', '0xbcb910b839c792160325abd00c515455560d0f0e68a356bc9f24d143f9528000', 'payment'],
    ['Variant A approved hash', '0x5018cb2cf8fa53935c3f24f8abcd9657ac74800f0567deba1ad26589b4c09f62', 'payment'],
    ['Settlement recorded', '0x5f37a4230c91becf065487d515c38e18e671102c2d8184062d81c93b027c30b6', 'payment'],
    ['Policy violation 1/3', '0x2e0803af28d51d1f071c1cc0f5eed0fc9c55e8512bb056b706022caf343a61dd', 'violation'],
    ['Policy violation 2/3', '0xc2950eed41441cef34ca5759a846bbd83e119b3837b0ac951acda36ac44df53d', 'violation'],
    ['Policy violation 3/3', '0x9997d68f984a29c28f3109662f7e937fb725fc2ebf9a26adc40abd59ed20e5df', 'violation'],
    ['USDG mission quarantined', '0xb4177d9487ab6e30412770d547d5838a33f6637d9ac7d52b01d536132b251e4f', 'quarantine'],
    ['Legacy WIF mission quarantined', '0xf8d0ff3283eeb98348e943be46e899fb42575ae6130b105f61b7ef22f5105aeb', 'quarantine'],
    ['Owner withdrew 0.50 USDG while quarantined', '0xcf0134577703090575699c452a008a23b272fc841a701efa311710326eb4aada', 'withdraw'],
    ['Successor Beta activated', '0x6594d51e6fee11696425780222cb675a4b92514f4248b7eab95f6053adebdf06', 'succession'],
    ['Recovery acknowledged by guardian relay', '0x08dde2cedae2c7fc6f3942ec8fbeaef8177b88647e86fe74f82607e329ea9a0b', 'succession'],
    ['New session key registered with recovery cap', '0x96db4d40836b68ee3f5d8f4ef5a88bf445a9c6221c97008b11cc18b81b0d07e1', 'succession'],
    ['Successor recovery payment settled', '0x0049f7fc029b92f093257b6dab49605794dc271bb8f57360251d89a7a655b8fc', 'recovery'],
    ['Recovery approval recorded', '0xce48a62e4d3e18df25f4c2c91707f6663ec4d35d7da8a17cc26c7f051fed2444', 'recovery'],
    ['Recovery settlement recorded', '0x1150e6637e2140332bc40bebe8966bc485d8d7bb1c80b06089e958588d9a06aa', 'recovery'],
  ];
  for (const [label, hash, kind] of evidence) event(state, label, hash, 0, kind);

  store.state = state;
  store.runtime = {
    usdg: MAINNET_USDG,
    wif: MAINNET_WIF,
    usdgMission: MAINNET_USDG_MISSION,
    wifMission: MAINNET_WIF_MISSION,
    session1,
    session2,
    session3,
    nonce: 0,
  };
  return state;
}

async function setup(): Promise<DemoState> {
  if (MAINNET_MODE) return setupMainnet();
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
      label: 'WIF Treasury',
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
      label: 'WIF Treasury',
      symbol: 'WIF',
      decimals: 18,
      token: runtime.wif,
      mission: runtime.wifMission,
      recoveryCap: 50n * 10n ** 18n,
    }),
  ];
  return state;
}

async function runWifTreasuryTransfer(
  state: DemoState,
  runtime: Runtime
): Promise<DemoState> {
  const amount = 10n ** 16n; // 0.01 WIF
  let allowed = false;
  try {
    const simulated = await publicClient.simulateContract({
      account: guardian,
      address: runtime.wifMission,
      abi: MISSION_ABI,
      functionName: 'executeERC20Transfer',
      args: [runtime.wif, merchant.address, amount],
    });
    allowed = Boolean(simulated.result);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'simulation failed';
    throw new Error(`WIF treasury transfer is unavailable on this deployment: ${reason}`);
  }
  if (!allowed) {
    throw new Error('WIF treasury transfer was blocked by mission policy.');
  }

  const transferHash = await write(
    'mission',
    runtime.wifMission,
    'executeERC20Transfer',
    [runtime.wif, merchant.address, amount],
    guardian
  );
  state.phase = 'WIF treasury transfer settled';
  event(state, `WIF treasury transfer · ${formatUnits(amount, 18)} WIF`, transferHash, 0, 'payment');
  event(state, 'ERC-20 policy checks passed · allowlisted merchant', transferHash, 0, 'payment');
  return refresh(state, runtime);
}

async function runPayment(
  state: DemoState,
  runtime: Runtime,
  key: 'usdg' | 'wif'
): Promise<DemoState> {
  if (key === 'wif') return runWifTreasuryTransfer(state, runtime);

  const token = runtime.usdg;
  const mission = runtime.usdgMission;
  const session = runtime.session1;
  const amount = 10_000n;
  const domainName = 'Global Dollar';

  const authority = await readAuthority(mission);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3_600);
  runtime.nonce += 1;
  const nonce = keccak256(stringToHex(`usdg-payment-${runtime.nonce}-${Date.now()}`));
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

  state.phase = 'USDG x402 payment settled';
  event(state, `USDG EIP-3009 payment · ${formatUnits(amount, 6)} USDG`, transferHash, 0, 'payment');
  event(state, 'Variant A approved hash', approvalHash, 0, 'payment');
  event(state, 'Settlement recorded', settlementHash, 0, 'payment');
  return refresh(state, runtime);
}

async function depositToken(
  state: DemoState,
  runtime: Runtime,
  key: 'usdg' | 'wif',
  amountAtomic?: bigint
): Promise<DemoState> {
  const isUsdg = key === 'usdg';
  const symbol = isUsdg ? 'USDG' : 'WIF';
  const decimals = isUsdg ? 6 : 18;
  const token = isUsdg ? runtime.usdg : runtime.wif;
  const mission = isUsdg ? runtime.usdgMission : runtime.wifMission;
  const amount = amountAtomic ?? (isUsdg ? 100_000n : 10n ** 16n);
  if (amount <= 0n) throw new Error('Deposit amount must be greater than zero.');
  const display = formatUnits(amount, decimals);
  const approveHash = await write('token', token, 'approve', [mission, amount], owner);
  const depositHash = await write('mission', mission, 'deposit', [amount], owner);
  event(state, `Owner deposited ${display} ${symbol} into the vault`, depositHash, 0, 'deposit');
  event(state, `${symbol} approval for vault deposit · ${display} ${symbol}`, approveHash, 0, 'deposit');
  state.phase = `${display} ${symbol} vault deposit confirmed`;
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
  if (!(authority.status === 4 && authority.currentAgent === successor.address)) {
    const activateHash = await write(
      'mission',
      mission,
      'activateSuccessor',
      [successor.address, authority.stateVersion],
      guardian
    );
    event(state, 'Successor Beta activated', activateHash, 0, 'succession');
    authority = await readAuthority(mission);
  }
  const digest = keccak256(
    encodeAbiParameters(parseAbiParameters('string,address,uint64'), [
      'succra.recovery.ack.v1',
      mission,
      authority.stateVersion,
    ])
  );
  const signature = await successor.sign({ hash: digest });
  const ackHash = await write(
    'mission',
    mission,
    'acknowledgeRecovery',
    [authority.stateVersion, signature],
    guardian
  );
  event(state, 'Recovery acknowledged by guardian relay', ackHash, 0, 'succession');
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

export function demoOwnerAddress(): string {
  return owner.address;
}

export function isDemoOwner(address: string | null | undefined): boolean {
  return Boolean(address) && address!.toLowerCase() === owner.address.toLowerCase();
}

export function emptyDemoState(ownerAddress?: string | null): DemoState {
  return {
    initialized: false,
    phase: 'No missions',
    chainId: CHAIN_ID,
    label: MAINNET_MODE ? 'Robinhood Chain · live mainnet' : 'Robinhood Chain · local',
    registry: '',
    factory: '',
    owner: ownerAddress ?? '',
    guardian: '',
    primary: '',
    successor: '',
    merchant: '',
    missions: [],
    events: [],
    note: 'No active missions found for this wallet.',
  };
}

export async function runDemoAction(
  action: string,
  options?: { amountAtomic?: bigint | undefined; token?: 'usdg' | 'wif' | undefined }
): Promise<DemoState> {
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
    case 'deposit':
      return depositToken(state, runtime, options?.token ?? 'usdg', options?.amountAtomic);
    case 'deposit-usdg':
      return depositToken(state, runtime, 'usdg', options?.amountAtomic);
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
