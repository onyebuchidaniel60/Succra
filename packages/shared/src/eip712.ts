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
