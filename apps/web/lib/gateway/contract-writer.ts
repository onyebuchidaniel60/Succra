// Succra web — server-only viem writers for authoritative mission calls.
//
// Two distinct keys:
// - SUCCRA_RUNTIME_SIGNER_SECRET_KEY submits authorizePayment (any caller is
//   allowed; it only pays gas and relays the agent's signature).
// - HASHKEY_GUARDIAN_SECRET_KEY submits recordSettlement (guardian-only).
// Neither key ever holds mission funds or can authorize a payment alone.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PrivateKeyAccount,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const SUCCRA_MISSION_WRITE_ABI = [
  {
    type: 'function',
    name: 'authorizePayment',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'auth',
        type: 'tuple',
        components: [
          { name: 'requestId', type: 'bytes32' },
          { name: 'agent', type: 'address' },
          { name: 'merchant', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'amountAtomic', type: 'uint256' },
          { name: 'paymentNonce', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'mandateHash', type: 'bytes32' },
          { name: 'agentSignature', type: 'bytes' },
        ],
      },
      { name: 'expectedVersion', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recordSettlement',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'paymentId', type: 'bytes32' },
      { name: 'amountAtomic', type: 'uint256' },
      { name: 'txHash', type: 'bytes32' },
      { name: 'expectedVersion', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recordedSettlements',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'quarantine',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'expectedVersion', type: 'uint64' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'commitCheckpoint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sequence', type: 'uint64' },
      { name: 'checkpointHash', type: 'bytes32' },
      { name: 'expectedVersion', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'activateSuccessor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'successor', type: 'address' },
      { name: 'expectedVersion', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acknowledgeRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'expectedVersion', type: 'uint64' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

export interface PaymentAuthorizationInput {
  requestId: `0x${string}`;
  agent: `0x${string}`;
  merchant: `0x${string}`;
  token: `0x${string}`;
  amountAtomic: bigint;
  paymentNonce: bigint;
  expiresAt: bigint;
  mandateHash: `0x${string}`;
  agentSignature: `0x${string}`;
}

export interface MissionWriteResult {
  txHash: `0x${string}`;
  blockNumber: bigint;
}

export class MissionTransactionError extends Error {
  readonly errorName: string | undefined;

  constructor(message: string, errorName?: string) {
    super(message);
    this.name = 'MissionTransactionError';
    this.errorName = errorName;
  }
}

function rpcUrl(): string {
  const url = process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!url) throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  return url;
}

function chainId(): number {
  const raw = process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? '177';
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('NEXT_PUBLIC_HASHKEY_CHAIN_ID must be a positive integer.');
  }
  return value;
}

export function succraChain(): Chain {
  return {
    id: chainId(),
    name: 'Succra',
    nativeCurrency: { name: 'HashKey', symbol: 'HSK', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl()] } },
  };
}

export function getPublicClient(): PublicClient {
  return createPublicClient({ chain: succraChain(), transport: http(rpcUrl()) });
}

function signerSecret(
  name: 'SUCCRA_RUNTIME_SIGNER_SECRET_KEY' | 'HASHKEY_GUARDIAN_SECRET_KEY'
): `0x${string}` {
  const raw = process.env[name];
  if (!raw) throw new Error(`Missing ${name}.`);
  const key = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-f]{64}$/i.test(key)) {
    throw new Error(`${name} must be a 32-byte hex private key.`);
  }
  return key as `0x${string}`;
}

export function loadRuntimeSigner(): PrivateKeyAccount {
  return privateKeyToAccount(signerSecret('SUCCRA_RUNTIME_SIGNER_SECRET_KEY'));
}

export function loadGuardianSigner(): PrivateKeyAccount {
  return privateKeyToAccount(signerSecret('HASHKEY_GUARDIAN_SECRET_KEY'));
}

function walletFor(account: PrivateKeyAccount) {
  return createWalletClient({ account, chain: succraChain(), transport: http(rpcUrl()) });
}

function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName;
  }
  return undefined;
}

function missionError(error: unknown): MissionTransactionError {
  const name = revertName(error);
  const message = name ? `Mission transaction reverted: ${name}.` : 'Mission transaction failed.';
  return new MissionTransactionError(message, name);
}

export async function sendAuthorizePayment(args: {
  missionAddress: `0x${string}`;
  authorization: PaymentAuthorizationInput;
  expectedVersion: bigint;
  account?: PrivateKeyAccount;
  publicClient?: PublicClient;
}): Promise<MissionWriteResult> {
  const account = args.account ?? loadRuntimeSigner();
  const wallet = walletFor(account);
  const publicClient = args.publicClient ?? getPublicClient();
  try {
    const txHash = await wallet.writeContract({
      address: args.missionAddress,
      abi: SUCCRA_MISSION_WRITE_ABI,
      functionName: 'authorizePayment',
      args: [args.authorization, args.expectedVersion],
      account,
      chain: wallet.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new MissionTransactionError('authorizePayment receipt was not successful.');
    }
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (error) {
    if (error instanceof MissionTransactionError) throw error;
    throw missionError(error);
  }
}

export async function sendRecordSettlement(args: {
  missionAddress: `0x${string}`;
  paymentId: `0x${string}`;
  amountAtomic: bigint;
  txHash: `0x${string}`;
  expectedVersion: bigint;
  account?: PrivateKeyAccount;
  publicClient?: PublicClient;
}): Promise<MissionWriteResult> {
  const account = args.account ?? loadGuardianSigner();
  const wallet = walletFor(account);
  const publicClient = args.publicClient ?? getPublicClient();
  try {
    const txHash = await wallet.writeContract({
      address: args.missionAddress,
      abi: SUCCRA_MISSION_WRITE_ABI,
      functionName: 'recordSettlement',
      args: [args.paymentId, args.amountAtomic, args.txHash, args.expectedVersion],
      account,
      chain: wallet.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new MissionTransactionError('recordSettlement receipt was not successful.');
    }
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (error) {
    if (error instanceof MissionTransactionError) throw error;
    throw missionError(error);
  }
}

/**
 * Guardian-signed manual quarantine. The owner route uses this same key: the
 * guardian acts on the owner's behalf and cannot spend mission funds.
 */
export async function sendQuarantine(args: {
  missionAddress: `0x${string}`;
  expectedVersion: bigint;
  account?: PrivateKeyAccount;
  publicClient?: PublicClient;
}): Promise<MissionWriteResult> {
  const account = args.account ?? loadGuardianSigner();
  const wallet = walletFor(account);
  const publicClient = args.publicClient ?? getPublicClient();
  try {
    const txHash = await wallet.writeContract({
      address: args.missionAddress,
      abi: SUCCRA_MISSION_WRITE_ABI,
      functionName: 'quarantine',
      args: [args.expectedVersion],
      account,
      chain: wallet.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new MissionTransactionError('quarantine receipt was not successful.');
    }
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (error) {
    if (error instanceof MissionTransactionError) throw error;
    throw missionError(error);
  }
}

export async function sendCommitCheckpoint(args: {
  missionAddress: `0x${string}`;
  sequence: bigint;
  checkpointHash: `0x${string}`;
  expectedVersion: bigint;
  account?: PrivateKeyAccount;
  publicClient?: PublicClient;
}): Promise<MissionWriteResult> {
  const account = args.account ?? loadGuardianSigner();
  const wallet = walletFor(account);
  const publicClient = args.publicClient ?? getPublicClient();
  try {
    const txHash = await wallet.writeContract({
      address: args.missionAddress,
      abi: SUCCRA_MISSION_WRITE_ABI,
      functionName: 'commitCheckpoint',
      args: [args.sequence, args.checkpointHash, args.expectedVersion],
      account,
      chain: wallet.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new MissionTransactionError('commitCheckpoint receipt was not successful.');
    }
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (error) {
    if (error instanceof MissionTransactionError) throw error;
    throw missionError(error);
  }
}

export async function sendActivateSuccessor(args: {
  missionAddress: `0x${string}`;
  successor: `0x${string}`;
  expectedVersion: bigint;
  account?: PrivateKeyAccount;
  publicClient?: PublicClient;
}): Promise<MissionWriteResult> {
  const account = args.account ?? loadGuardianSigner();
  const wallet = walletFor(account);
  const publicClient = args.publicClient ?? getPublicClient();
  try {
    const txHash = await wallet.writeContract({
      address: args.missionAddress,
      abi: SUCCRA_MISSION_WRITE_ABI,
      functionName: 'activateSuccessor',
      args: [args.successor, args.expectedVersion],
      account,
      chain: wallet.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new MissionTransactionError('activateSuccessor receipt was not successful.');
    }
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (error) {
    if (error instanceof MissionTransactionError) throw error;
    throw missionError(error);
  }
}

export async function sendAcknowledgeRecovery(args: {
  missionAddress: `0x${string}`;
  expectedVersion: bigint;
  signature: `0x${string}`;
  account?: PrivateKeyAccount;
  publicClient?: PublicClient;
}): Promise<MissionWriteResult> {
  const account = args.account ?? loadGuardianSigner();
  const wallet = walletFor(account);
  const publicClient = args.publicClient ?? getPublicClient();
  try {
    const txHash = await wallet.writeContract({
      address: args.missionAddress,
      abi: SUCCRA_MISSION_WRITE_ABI,
      functionName: 'acknowledgeRecovery',
      args: [args.expectedVersion, args.signature],
      account,
      chain: wallet.chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') {
      throw new MissionTransactionError('acknowledgeRecovery receipt was not successful.');
    }
    return { txHash, blockNumber: receipt.blockNumber };
  } catch (error) {
    if (error instanceof MissionTransactionError) throw error;
    throw missionError(error);
  }
}

export async function readRecordedSettlement(args: {
  missionAddress: `0x${string}`;
  paymentId: `0x${string}`;
  publicClient?: PublicClient;
}): Promise<boolean> {
  const publicClient = args.publicClient ?? getPublicClient();
  return publicClient.readContract({
    address: args.missionAddress,
    abi: SUCCRA_MISSION_WRITE_ABI,
    functionName: 'recordedSettlements',
    args: [args.paymentId],
  });
}
