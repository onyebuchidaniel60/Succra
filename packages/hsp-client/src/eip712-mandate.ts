import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { SUCCRA_EIP712_DOMAIN } from '@succra/shared';
import type { HspPaymentMandate } from './types.js';

// PROVISIONAL — validate against live HSP docs in Phase 9.
export const HSP_PAYMENT_MANDATE_TYPES = {
  PaymentMandate: [
    { name: 'cartMandateHash', type: 'bytes32' },
    { name: 'onchainRequestId', type: 'bytes32' },
    { name: 'missionAddress', type: 'address' },
    { name: 'agent', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amountAtomic', type: 'uint256' },
    { name: 'paymentNonce', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

const DOMAIN_TYPEHASH = keccak_256(
  utf8ToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
);
const NAME_HASH = keccak_256(utf8ToBytes('Succra'));
const VERSION_HASH = keccak_256(utf8ToBytes('1'));
const PAYMENT_MANDATE_TYPEHASH = keccak_256(
  utf8ToBytes(
    'PaymentMandate(bytes32 cartMandateHash,bytes32 onchainRequestId,address missionAddress,address agent,address merchant,address token,uint256 amountAtomic,uint256 paymentNonce,uint256 expiresAt)'
  )
);

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function word(value: bigint | number | string): Uint8Array {
  const bigint = BigInt(value);
  if (bigint < 0n) throw new Error('EIP-712 uint256 cannot be negative.');
  const hex = bigint.toString(16).padStart(64, '0');
  if (hex.length > 64) throw new Error('EIP-712 uint256 overflow.');
  return hexToBytes(hex);
}

function bytes32(value: string): Uint8Array {
  const clean = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new Error('Expected a bytes32 value.');
  return hexToBytes(clean);
}

function address(value: string): Uint8Array {
  const clean = value.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error('Expected an EVM address.');
  return hexToBytes(clean.padStart(64, '0'));
}

export function buildPaymentMandateTypedData(
  mandate: HspPaymentMandate,
  chainId: bigint | number = 177n
) {
  return {
    domain: SUCCRA_EIP712_DOMAIN(chainId, mandate.missionAddress as `0x${string}`),
    types: HSP_PAYMENT_MANDATE_TYPES,
    primaryType: 'PaymentMandate' as const,
    message: {
      cartMandateHash: mandate.cartMandateHash as `0x${string}`,
      onchainRequestId: mandate.onchainRequestId as `0x${string}`,
      missionAddress: mandate.missionAddress as `0x${string}`,
      agent: mandate.agent as `0x${string}`,
      merchant: mandate.merchant as `0x${string}`,
      token: mandate.token as `0x${string}`,
      amountAtomic: BigInt(mandate.amountAtomic),
      paymentNonce: BigInt(mandate.paymentNonce),
      expiresAt: BigInt(mandate.expiresAt),
    },
  };
}

/**
 * Computes the EIP-712 digest the agent signs and the Phase 1 contract
 * ecrecovers. This is a direct digest, not an EIP-191 personal message.
 */
export function hashPaymentMandate(
  mandate: HspPaymentMandate,
  chainId: bigint | number = 177n
): string {
  const domainSeparator = keccak_256(
    concatBytes(
      DOMAIN_TYPEHASH,
      NAME_HASH,
      VERSION_HASH,
      word(chainId),
      address(mandate.missionAddress)
    )
  );
  const structHash = keccak_256(
    concatBytes(
      PAYMENT_MANDATE_TYPEHASH,
      bytes32(mandate.cartMandateHash),
      bytes32(mandate.onchainRequestId),
      address(mandate.missionAddress),
      address(mandate.agent),
      address(mandate.merchant),
      address(mandate.token),
      word(mandate.amountAtomic),
      word(mandate.paymentNonce),
      word(mandate.expiresAt)
    )
  );
  return `0x${bytesToHex(keccak_256(concatBytes(hexToBytes('1901'), domainSeparator, structHash)))}`;
}
