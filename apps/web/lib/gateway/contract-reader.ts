import { createPublicClient, http, isAddress, type PublicClient } from 'viem';
import type { HspMissionStatus } from './policy-hsp';

const MISSION_ABI = [
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'paymentToken', type: 'address' },
      { name: 'budgetAtomic', type: 'uint256' },
      { name: 'maxPaymentAtomic', type: 'uint256' },
      { name: 'recoveryMaxPaymentAtomic', type: 'uint256' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'policyHash', type: 'bytes32' },
      { name: 'primaryAgent', type: 'address' },
      { name: 'violationThreshold', type: 'uint16' },
      { name: 'violationWindowSeconds', type: 'uint64' },
      { name: 'cartMandateHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'authority',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'currentAgent', type: 'address' },
      { name: 'status', type: 'uint8' },
      { name: 'agentNonce', type: 'uint64' },
      { name: 'stateVersion', type: 'uint64' },
      { name: 'violationCount', type: 'uint16' },
      { name: 'lastViolationAt', type: 'uint64' },
      { name: 'confirmedSpentAtomic', type: 'uint256' },
      { name: 'lastCheckpointHash', type: 'bytes32' },
      { name: 'lastCheckpointSequence', type: 'uint64' },
      { name: 'checkpointCount', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'getSuccessors',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'agent', type: 'address' },
          { name: 'priority', type: 'uint16' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getMerchantAllowlist',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'allowedMerchants',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const STATUS_NAMES: HspMissionStatus[] = [
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

export interface MissionOnChainState {
  contractAddress: `0x${string}`;
  currentAgent: string;
  status: HspMissionStatus;
  agentNonce: bigint;
  stateVersion: bigint;
  violationCount: number;
  lastViolationAt: bigint;
  confirmedSpentAtomic: bigint;
  lastCheckpointHash: string;
  lastCheckpointSequence: bigint;
  checkpointCount: bigint;
  successors: Array<{ agent: string; priority: number; active: boolean }>;
  paymentToken: string;
  budgetAtomic: bigint;
  maxPaymentAtomic: bigint;
  recoveryMaxPaymentAtomic: bigint;
  expiresAt: bigint;
  policyHash: string;
  cartMandateHash: string;
  violationThreshold: number;
  violationWindowSeconds: bigint;
  allowedMerchants: Set<string>;
}

export interface ReadMissionOptions {
  rpcUrl?: string;
  client?: PublicClient;
}

function rpcUrl(): string {
  const url = process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!url) {
    throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  }
  return url;
}

export async function readMissionState(
  contractAddress: `0x${string}`,
  options: ReadMissionOptions = {}
): Promise<MissionOnChainState> {
  if (!isAddress(contractAddress)) {
    throw new Error('Mission contract address is invalid.');
  }

  const client =
    options.client ??
    createPublicClient({
      transport: http(options.rpcUrl ?? rpcUrl()),
    });

  try {
    const [config, authority, allowlist, successors] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi: MISSION_ABI,
        functionName: 'config',
      }),
      client.readContract({
        address: contractAddress,
        abi: MISSION_ABI,
        functionName: 'authority',
      }),
      client.readContract({
        address: contractAddress,
        abi: MISSION_ABI,
        functionName: 'getMerchantAllowlist',
      }),
      client.readContract({
        address: contractAddress,
        abi: MISSION_ABI,
        functionName: 'getSuccessors',
      }),
    ]);

    const status = STATUS_NAMES[Number(authority[1])];
    if (!status) {
      throw new Error('Mission contract returned an unknown status.');
    }

    return {
      contractAddress,
      currentAgent: authority[0],
      status,
      agentNonce: authority[2],
      stateVersion: authority[3],
      violationCount: Number(authority[4]),
      lastViolationAt: authority[5],
      confirmedSpentAtomic: authority[6],
      lastCheckpointHash: authority[7],
      lastCheckpointSequence: authority[8],
      checkpointCount: authority[9],
      successors: successors.map((successor) => ({
        agent: successor.agent,
        priority: Number(successor.priority),
        active: successor.active,
      })),
      paymentToken: config[0],
      budgetAtomic: config[1],
      maxPaymentAtomic: config[2],
      recoveryMaxPaymentAtomic: config[3],
      expiresAt: config[4],
      policyHash: config[5],
      cartMandateHash: config[9],
      violationThreshold: Number(config[7]),
      violationWindowSeconds: config[8],
      allowedMerchants: new Set(allowlist.map((merchant) => merchant.toLowerCase())),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(`MISSION_STATE_UNAVAILABLE: ${message}`);
  }
}
