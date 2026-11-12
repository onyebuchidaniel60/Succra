// Succra x402 client — HTTP 402 accepts[] parsing, EIP-3009 typed data,
// session-key signing, and a deterministic mock facilitator.
//
// The facilitator is the settlement authority for x402. This package does
// not authorize money movement; it only constructs and signs the payload
// that the facilitator and token verify.

import {
  hashTypedData,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
  type LocalAccount,
} from 'viem';

export interface X402Accept {
  scheme: 'exact';
  network: string;
  asset: Address;
  payTo: Address;
  maxAmountRequired: string;
  resource?: string | undefined;
  description?: string | undefined;
  maxTimeoutSeconds?: number | undefined;
  extra?: Record<string, unknown> | undefined;
}

export interface PaymentRequired {
  x402Version: number;
  accepts: X402Accept[];
  error?: string | undefined;
}

export interface TransferWithAuthorizationMessage {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface Eip3009Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface TransferWithAuthorizationTypedData {
  domain: Eip3009Domain;
  types: typeof TRANSFER_WITH_AUTHORIZATION_TYPES;
  primaryType: 'TransferWithAuthorization';
  message: TransferWithAuthorizationMessage;
}

function asObject(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      return asObject(JSON.parse(input));
    } catch {
      throw new Error('PaymentRequired is not valid JSON.');
    }
  }
  if (typeof input !== 'object' || input === null) {
    throw new Error('PaymentRequired must be an object.');
  }
  return input as Record<string, unknown>;
}

function asAddress(value: unknown, field: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${field} must be a valid EVM address.`);
  }
  return value;
}

function asAtomic(value: unknown, field: string): string {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+$/.test(text)) {
    throw new Error(`${field} must be a decimal atomic amount.`);
  }
  return text;
}

/** Parse a 402 response body (object or JSON string) into a validated offer list. */
export function parsePaymentRequired(input: unknown): PaymentRequired {
  const body = asObject(input);
  const version = Number(body['x402Version'] ?? 1);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('x402Version must be a positive integer.');
  }
  const rawAccepts = body['accepts'];
  if (!Array.isArray(rawAccepts) || rawAccepts.length === 0) {
    throw new Error('accepts[] must contain at least one offer.');
  }
  const accepts = rawAccepts.map((raw, index): X402Accept => {
    const offer = asObject(raw);
    if (offer['scheme'] !== 'exact') {
      throw new Error(`accepts[${index}].scheme must be "exact".`);
    }
    const network = offer['network'];
    if (typeof network !== 'string' || !/^eip155:\d+$/.test(network)) {
      throw new Error(`accepts[${index}].network must be an eip155 CAIP-2 id.`);
    }
    return {
      scheme: 'exact',
      network,
      asset: asAddress(offer['asset'], `accepts[${index}].asset`),
      payTo: asAddress(offer['payTo'], `accepts[${index}].payTo`),
      maxAmountRequired: asAtomic(
        offer['maxAmountRequired'] ?? offer['maxAmount'],
        `accepts[${index}].maxAmountRequired`
      ),
      resource: typeof offer['resource'] === 'string' ? offer['resource'] : undefined,
      description: typeof offer['description'] === 'string' ? offer['description'] : undefined,
      maxTimeoutSeconds:
        typeof offer['maxTimeoutSeconds'] === 'number' ? offer['maxTimeoutSeconds'] : undefined,
      extra:
        typeof offer['extra'] === 'object' && offer['extra'] !== null
          ? (offer['extra'] as Record<string, unknown>)
          : undefined,
    };
  });
  return { x402Version: version, accepts, error: typeof body['error'] === 'string' ? body['error'] : undefined };
}

/** Select the first offer matching the mission's network, asset, payee, and cap. */
export function selectAccept(
  accepts: X402Accept[],
  criteria: { network: string; asset: Address; payTo: Address; maxAmountAtomic: bigint }
): X402Accept {
  const match = accepts.find(
    (offer) =>
      offer.network === criteria.network &&
      offer.asset.toLowerCase() === criteria.asset.toLowerCase() &&
      offer.payTo.toLowerCase() === criteria.payTo.toLowerCase() &&
      BigInt(offer.maxAmountRequired) <= criteria.maxAmountAtomic
  );
  if (!match) throw new Error('No x402 accept matches the mission policy.');
  return match;
}

export function buildEip3009TypedData(args: {
  domain: Eip3009Domain;
  message: TransferWithAuthorizationMessage;
}): TransferWithAuthorizationTypedData {
  return {
    domain: args.domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: args.message,
  };
}

export function hashTransferWithAuthorization(data: TransferWithAuthorizationTypedData): Hex {
  return hashTypedData(data);
}

/** Sign the EIP-3009 payload with the owner/session key. */
export async function signTransferWithAuthorization(
  account: LocalAccount,
  data: TransferWithAuthorizationTypedData
): Promise<Hex> {
  return account.signTypedData(data);
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: 'exact';
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

export function buildPaymentPayload(args: {
  accept: X402Accept;
  message: TransferWithAuthorizationMessage;
  signature: Hex;
}): X402PaymentPayload {
  return {
    x402Version: 1,
    scheme: 'exact',
    network: args.accept.network,
    payload: {
      signature: args.signature,
      authorization: {
        from: args.message.from,
        to: args.message.to,
        value: args.message.value.toString(),
        validAfter: args.message.validAfter.toString(),
        validBefore: args.message.validBefore.toString(),
        nonce: args.message.nonce,
      },
    },
  };
}

export interface FacilitatorReceipt {
  success: boolean;
  transactionHash: Hex;
  network: string;
  payer: Address;
  amountAtomic: string;
  error?: string | undefined;
}

/**
 * Deterministic local facilitator. It validates binding only; the caller
 * must still verify the on-chain Transfer log before confirming settlement.
 */
export class MockFacilitator {
  private counter = 0;

  verify(payload: X402PaymentPayload, accept: X402Accept): { valid: boolean; reason?: string } {
    if (payload.network !== accept.network) return { valid: false, reason: 'network mismatch' };
    if (payload.payload.authorization.to.toLowerCase() !== accept.payTo.toLowerCase()) {
      return { valid: false, reason: 'payee mismatch' };
    }
    if (BigInt(payload.payload.authorization.value) > BigInt(accept.maxAmountRequired)) {
      return { valid: false, reason: 'amount exceeds offer' };
    }
    if (!payload.payload.signature.startsWith('0x')) {
      return { valid: false, reason: 'invalid signature encoding' };
    }
    return { valid: true };
  }

  settle(payload: X402PaymentPayload, accept: X402Accept): FacilitatorReceipt {
    const check = this.verify(payload, accept);
    if (!check.valid) {
      return {
        success: false,
        transactionHash: '0x',
        network: payload.network,
        payer: payload.payload.authorization.from,
        amountAtomic: payload.payload.authorization.value,
        error: check.reason,
      };
    }
    this.counter += 1;
    const transactionHash = keccak256(
      stringToHex(
        `${payload.network}:${payload.payload.authorization.nonce}:${payload.payload.signature}:${this.counter}`
      )
    );
    return {
      success: true,
      transactionHash,
      network: payload.network,
      payer: payload.payload.authorization.from,
      amountAtomic: payload.payload.authorization.value,
    };
  }
}

export interface TransferLog {
  from: Address;
  to: Address;
  value: bigint;
  transactionHash: Hex;
  nonce?: Hex;
}

/** Settlement is confirmed only if the Transfer log matches the preflighted payment. */
export function verifyTransferLog(args: {
  log: TransferLog;
  expectedFrom: Address;
  expectedTo: Address;
  expectedValue: bigint;
  expectedTransactionHash: Hex;
  expectedNonce?: Hex;
}): { valid: boolean; reason?: string } {
  if (args.log.transactionHash.toLowerCase() !== args.expectedTransactionHash.toLowerCase()) {
    return { valid: false, reason: 'transaction hash mismatch' };
  }
  if (args.log.from.toLowerCase() !== args.expectedFrom.toLowerCase()) {
    return { valid: false, reason: 'from mismatch' };
  }
  if (args.log.to.toLowerCase() !== args.expectedTo.toLowerCase()) {
    return { valid: false, reason: 'to mismatch' };
  }
  if (args.log.value !== args.expectedValue) return { valid: false, reason: 'value mismatch' };
  if (
    args.expectedNonce &&
    args.log.nonce &&
    args.log.nonce.toLowerCase() !== args.expectedNonce.toLowerCase()
  ) {
    return { valid: false, reason: 'nonce mismatch' };
  }
  return { valid: true };
}
