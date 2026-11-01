import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

export const SUCCRA_REQUEST_TYPES = {
  SuccraRequest: [
    { name: 'missionId', type: 'address' },
    { name: 'requestId', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'methodHash', type: 'bytes32' },
    { name: 'bodyHash', type: 'bytes32' },
  ],
} as const;

/** Purpose binding prevents a registration signature from being reused elsewhere. */
export const AGENT_CHALLENGE_PURPOSE = 'succra.agent-registration.v1';

export const AGENT_CHALLENGE_TYPES = {
  AgentChallenge: [
    { name: 'agentAddress', type: 'address' },
    { name: 'challenge', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'purpose', type: 'string' },
  ],
} as const;

export function SUCCRA_EIP712_DOMAIN(
  chainId: bigint | number,
  verifyingContract: `0x${string}`
): { name: 'Succra'; version: '1'; chainId: bigint; verifyingContract: `0x${string}` } {
  return {
    name: 'Succra',
    version: '1',
    chainId: BigInt(chainId),
    verifyingContract,
  };
}

export interface SuccraRequestMessage {
  missionId: `0x${string}`;
  requestId: `0x${string}`;
  nonce: bigint;
  timestamp: bigint;
  methodHash: `0x${string}`;
  bodyHash: `0x${string}`;
}

export interface SuccraRequestInput extends SuccraRequestMessage {
  chainId: bigint | number;
  verifyingContract: `0x${string}`;
}

export function buildSuccraRequestTypedData(input: SuccraRequestInput) {
  return {
    domain: SUCCRA_EIP712_DOMAIN(input.chainId, input.verifyingContract),
    types: SUCCRA_REQUEST_TYPES,
    primaryType: 'SuccraRequest' as const,
    message: {
      missionId: input.missionId,
      requestId: input.requestId,
      nonce: input.nonce,
      timestamp: input.timestamp,
      methodHash: input.methodHash,
      bodyHash: input.bodyHash,
    },
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortKeys(record[key]);
        return result;
      }, {});
  }
  return value;
}

/** Deterministic JSON body hash: lexicographically sorted object keys. */
export function hashCanonicalBody(body: unknown): `0x${string}` {
  const json = JSON.stringify(sortKeys(body));
  if (json === undefined) {
    throw new Error('Body is not JSON-serializable.');
  }
  return `0x${bytesToHex(keccak_256(utf8ToBytes(json)))}`;
}

export function hashMethodAndPath(method: string, path: string): `0x${string}` {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(`${method} ${path}`)))}`;
}

export function requestIdToBytes32(requestId: string): `0x${string}` {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(requestId)))}`;
}

export interface AgentChallengeInput {
  agentAddress: `0x${string}`;
  challenge: string;
  expiresAt: bigint | number | string;
  chainId: bigint | number;
}

export interface AgentChallengeMessage {
  agentAddress: `0x${string}`;
  challenge: `0x${string}`;
  expiresAt: bigint;
  purpose: string;
}

function normalizeBytes32(value: string): `0x${string}` {
  const clean = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-f]{64}$/i.test(clean)) {
    throw new Error('Agent challenge must be a 32-byte hex value.');
  }
  return `0x${clean.toLowerCase()}`;
}

/**
 * EIP-712 typed data for agent address-possession challenges.
 * The domain intentionally has no verifyingContract, matching the wallet-login
 * domain pattern in ARCHITECTURE.md §7.
 */
export function buildAgentChallengeTypedData(input: AgentChallengeInput) {
  return {
    domain: {
      name: 'Succra' as const,
      version: '1' as const,
      chainId: BigInt(input.chainId),
    },
    types: AGENT_CHALLENGE_TYPES,
    primaryType: 'AgentChallenge' as const,
    message: {
      agentAddress: input.agentAddress,
      challenge: normalizeBytes32(input.challenge),
      expiresAt: BigInt(input.expiresAt),
      purpose: AGENT_CHALLENGE_PURPOSE,
    } satisfies AgentChallengeMessage,
  };
}
