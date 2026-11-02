// Succra web — server-side MissionFactory transaction preparation and
// deployment verification.
//
// The owner's wallet signs the unsigned transaction; the server never holds
// the owner key and never submits the create call itself. Finalization reads
// the authoritative receipt and MissionCreated events before the off-chain
// mirror becomes ACTIVE.
import {
  createPublicClient,
  encodeFunctionData,
  getContractAddress,
  http,
  isAddress,
  parseEventLogs,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from 'viem';
import { readMissionState, type MissionOnChainState } from '@/lib/gateway/contract-reader';
import type { MissionPolicyDocument } from '@/lib/missions';

export const MISSION_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createMission',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'paymentToken', type: 'address' },
          { name: 'budgetAtomic', type: 'uint256' },
          { name: 'maxPaymentAtomic', type: 'uint256' },
          { name: 'recoveryMaxPaymentAtomic', type: 'uint256' },
          { name: 'merchantAllowlist', type: 'address[]' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'policyHash', type: 'bytes32' },
          { name: 'primaryAgent', type: 'address' },
          {
            name: 'successors',
            type: 'tuple[]',
            components: [
              { name: 'agent', type: 'address' },
              { name: 'priority', type: 'uint16' },
              { name: 'active', type: 'bool' },
            ],
          },
          { name: 'violationThreshold', type: 'uint16' },
          { name: 'violationWindowSeconds', type: 'uint64' },
          { name: 'cartMandateHash', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ name: 'missionAddress', type: 'address' }],
  },
  {
    type: 'event',
    name: 'MissionFactoryMissionDeployed',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'mission', type: 'address', indexed: true },
    ],
  },
] as const;

export const MISSION_CREATED_EVENT_ABI = [
  {
    type: 'event',
    name: 'MissionCreated',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'mission', type: 'address', indexed: true },
      { name: 'policyHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export interface UnsignedMissionTransaction {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: '0';
}

export interface VerifiedMissionDeployment {
  txHash: `0x${string}`;
  blockNumber: bigint;
  contractAddress: `0x${string}`;
  ownerAddress: `0x${string}`;
  policyHash: `0x${string}`;
  state: MissionOnChainState;
}

export type MissionDeploymentErrorCode =
  | 'TX_NOT_FOUND'
  | 'TX_FAILED'
  | 'EVENT_MISSING'
  | 'OWNER_MISMATCH'
  | 'ADDRESS_MISMATCH'
  | 'POLICY_MISMATCH'
  | 'STATE_MISMATCH';

export class MissionDeploymentError extends Error {
  constructor(
    readonly code: MissionDeploymentErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MissionDeploymentError';
  }
}

export interface MissionChain {
  chainId: number;
  factoryAddress: `0x${string}`;
  getNextMissionAddress(): Promise<`0x${string}`>;
  buildCreateTransaction(
    policy: MissionPolicyDocument,
    policyHash: `0x${string}`
  ): UnsignedMissionTransaction;
  verifyDeployment(args: {
    txHash: `0x${string}`;
    expectedOwner: `0x${string}`;
    expectedMission: `0x${string}`;
    expectedPolicyHash: `0x${string}`;
  }): Promise<VerifiedMissionDeployment>;
}

function rpcUrl(): string {
  const url = process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!url) throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  return url;
}

export function missionFactoryAddress(): `0x${string}` {
  const value = process.env.SUCCRA_MISSION_FACTORY_ADDRESS;
  if (!value || !isAddress(value)) {
    throw new Error('Missing or invalid SUCCRA_MISSION_FACTORY_ADDRESS.');
  }
  return value.toLowerCase() as `0x${string}`;
}

export function missionChainId(): number {
  const raw = process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? '177';
  const chainId = Number(raw);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('NEXT_PUBLIC_HASHKEY_CHAIN_ID must be a positive integer.');
  }
  return chainId;
}

function onchainConfig(policy: MissionPolicyDocument) {
  return {
    paymentToken: policy.payment_token_address,
    budgetAtomic: BigInt(policy.budget_atomic),
    maxPaymentAtomic: BigInt(policy.max_payment_atomic),
    recoveryMaxPaymentAtomic: BigInt(policy.recovery_max_payment_atomic),
    merchantAllowlist: policy.merchant_allowlist,
    expiresAt: BigInt(Math.floor(Date.parse(policy.expires_at) / 1000)),
    policyHash: '' as `0x${string}`,
    primaryAgent: policy.primary_agent_address,
    successors: policy.successors.map((successor) => ({
      agent: successor.address,
      priority: successor.priority,
      active: true,
    })),
    violationThreshold: policy.violation_threshold,
    violationWindowSeconds: BigInt(policy.violation_window_seconds),
    cartMandateHash: policy.cart_mandate_hash,
  };
}

/** Pure calldata builder; policyHash is injected separately. */
export function buildCreateMissionCalldata(
  policy: MissionPolicyDocument,
  policyHash: `0x${string}`
): `0x${string}` {
  const config = { ...onchainConfig(policy), policyHash };
  return encodeFunctionData({
    abi: MISSION_FACTORY_ABI,
    functionName: 'createMission',
    args: [config],
  });
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameBytes32(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function createdEvent(logs: readonly Log[], missionAddress: `0x${string}`) {
  const events = parseEventLogs({
    abi: MISSION_CREATED_EVENT_ABI,
    logs: [...logs],
    eventName: 'MissionCreated',
  });
  return events.find((event) => sameAddress(event.address, missionAddress)) ?? null;
}

export interface CreateMissionChainOptions {
  client?: PublicClient;
  /** Test-only override; production reads the configured HashKey RPC. */
  readState?: (address: `0x${string}`) => Promise<MissionOnChainState>;
}

/** Production chain adapter. Tests inject MissionChain directly. */
export function createMissionChain(options: CreateMissionChainOptions = {}): MissionChain {
  const factoryAddress = missionFactoryAddress();
  const chainId = missionChainId();
  const client =
    options.client ??
    createPublicClient({
      transport: http(rpcUrl()),
    });
  const readState = options.readState ?? readMissionState;

  return {
    chainId,
    factoryAddress,

    async getNextMissionAddress() {
      // Factory nonce increments only on CREATE. Pending is intentional:
      // a previously broadcast create must be counted before predicting.
      const nonce = await client.getTransactionCount({
        address: factoryAddress,
        blockTag: 'pending',
      });
      return getContractAddress({ from: factoryAddress, nonce: BigInt(nonce) });
    },

    buildCreateTransaction(policy, policyHash) {
      return {
        chainId,
        to: factoryAddress,
        data: buildCreateMissionCalldata(policy, policyHash),
        value: '0',
      };
    },

    async verifyDeployment(args) {
      let receipt: TransactionReceipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: args.txHash });
      } catch {
        throw new MissionDeploymentError('TX_NOT_FOUND', 'Mission creation transaction not found.');
      }
      if (receipt.status !== 'success') {
        throw new MissionDeploymentError('TX_FAILED', 'Mission creation transaction reverted.');
      }
      if (!receipt.to || !sameAddress(receipt.to, factoryAddress)) {
        throw new MissionDeploymentError(
          'ADDRESS_MISMATCH',
          'Transaction was not sent to the configured MissionFactory.'
        );
      }

      let factoryEvents;
      try {
        factoryEvents = parseEventLogs({
          abi: MISSION_FACTORY_ABI,
          logs: receipt.logs,
          eventName: 'MissionFactoryMissionDeployed',
        });
      } catch {
        throw new MissionDeploymentError('EVENT_MISSING', 'Mission deployment event is malformed.');
      }
      const factoryEvent = factoryEvents.find(
        (event) =>
          sameAddress(event.address, factoryAddress) &&
          sameAddress(event.args.mission, args.expectedMission) &&
          sameAddress(event.args.owner, args.expectedOwner)
      );
      if (!factoryEvent) {
        throw new MissionDeploymentError(
          'OWNER_MISMATCH',
          'MissionFactory deployment event does not match the expected owner and mission.'
        );
      }

      const missionEvent = createdEvent(receipt.logs, args.expectedMission);
      if (!missionEvent) {
        throw new MissionDeploymentError(
          'ADDRESS_MISMATCH',
          'No MissionCreated event was emitted by the predicted mission address.'
        );
      }
      if (!sameAddress(missionEvent.args.owner, args.expectedOwner)) {
        throw new MissionDeploymentError('OWNER_MISMATCH', 'Mission owner does not match session.');
      }
      if (!sameBytes32(missionEvent.args.policyHash, args.expectedPolicyHash)) {
        throw new MissionDeploymentError(
          'POLICY_MISMATCH',
          'Mission policy hash does not match the prepared policy.'
        );
      }

      const state = await readState(args.expectedMission);
      if (state.status !== 'ACTIVE' || !sameAddress(state.policyHash, args.expectedPolicyHash)) {
        throw new MissionDeploymentError(
          'STATE_MISMATCH',
          'Mission contract is not ACTIVE with the expected policy hash.'
        );
      }

      return {
        txHash: args.txHash,
        blockNumber: receipt.blockNumber,
        contractAddress: args.expectedMission,
        ownerAddress: args.expectedOwner,
        policyHash: args.expectedPolicyHash,
        state,
      };
    },
  };
}

/** Narrow helper used by finalize to verify deployed config against DB. */
export function missionMatchesPolicy(
  state: MissionOnChainState,
  policy: MissionPolicyDocument,
  policyHash: `0x${string}`
): boolean {
  const expiresAt = BigInt(Math.floor(Date.parse(policy.expires_at) / 1000));
  if (
    !sameAddress(state.paymentToken, policy.payment_token_address) ||
    state.budgetAtomic !== BigInt(policy.budget_atomic) ||
    state.maxPaymentAtomic !== BigInt(policy.max_payment_atomic) ||
    state.recoveryMaxPaymentAtomic !== BigInt(policy.recovery_max_payment_atomic) ||
    state.expiresAt !== expiresAt ||
    !sameAddress(state.policyHash, policyHash) ||
    !sameAddress(state.currentAgent, policy.primary_agent_address) ||
    state.violationThreshold !== policy.violation_threshold ||
    state.violationWindowSeconds !== BigInt(policy.violation_window_seconds)
  ) {
    return false;
  }
  if (!sameBytes32(state.cartMandateHash, policy.cart_mandate_hash)) return false;
  if (state.allowedMerchants.size !== policy.merchant_allowlist.length) return false;
  for (const merchant of policy.merchant_allowlist) {
    if (!state.allowedMerchants.has(merchant.toLowerCase())) return false;
  }
  if (state.successors.length !== policy.successors.length) return false;
  for (const successor of policy.successors) {
    const onchain = state.successors.find((entry) => sameAddress(entry.agent, successor.address));
    if (!onchain || onchain.priority !== successor.priority || !onchain.active) return false;
  }
  return true;
}
