// Succra web — EIP-712 login typed data (PROJECT_SPEC.md §4 Flow A).
//
// Wallet login is a separate `SuccraLogin` typed-data domain with no
// verifying contract (ARCHITECTURE.md §7). The message binds the wallet,
// nonce, and issuance time; the nonce is single-use and server-stored.
// The API returns this exact object to the wallet, and verification uses
// the stored copy so a format change cannot silently invalidate outstanding
// nonces.
import { isAddress } from 'viem';

export const SUCCRA_LOGIN_DOMAIN_NAME = 'Succra';
export const SUCCRA_LOGIN_DOMAIN_VERSION = '1';

export const SUCCRA_LOGIN_TYPES = {
  SuccraLogin: [
    { name: 'walletAddress', type: 'address' },
    { name: 'nonce', type: 'string' },
    { name: 'issuedAt', type: 'string' },
  ],
} as const;

export interface LoginTypedData {
  domain: {
    name: typeof SUCCRA_LOGIN_DOMAIN_NAME;
    version: typeof SUCCRA_LOGIN_DOMAIN_VERSION;
    chainId: number;
  };
  types: typeof SUCCRA_LOGIN_TYPES;
  primaryType: 'SuccraLogin';
  message: {
    walletAddress: `0x${string}`;
    nonce: string;
    issuedAt: string;
  };
}

export interface BuildLoginTypedDataInput {
  walletAddress: string;
  nonce: string;
  issuedAt: string;
  chainId: number;
}

export function normalizeWalletAddress(value: string): `0x${string}` | null {
  if (!isAddress(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

export function buildLoginTypedData(input: BuildLoginTypedDataInput): LoginTypedData {
  const walletAddress = normalizeWalletAddress(input.walletAddress);
  if (!walletAddress) {
    throw new Error('walletAddress must be a valid EVM address.');
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error('chainId must be a positive integer.');
  }
  return {
    domain: {
      name: SUCCRA_LOGIN_DOMAIN_NAME,
      version: SUCCRA_LOGIN_DOMAIN_VERSION,
      chainId: input.chainId,
    },
    types: SUCCRA_LOGIN_TYPES,
    primaryType: 'SuccraLogin',
    message: {
      walletAddress,
      nonce: input.nonce,
      issuedAt: input.issuedAt,
    },
  };
}

/** Application URI is retained for display/metadata; it is not signed. */
export function appUri(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/**
 * Parse and validate serialized login typed data stored with a nonce.
 * Returns null for anything that is not the canonical SuccraLogin shape.
 */
export function parseLoginTypedData(serialized: string): LoginTypedData | null {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<LoginTypedData>;
  const domain = candidate.domain;
  const message = candidate.message;
  if (
    !domain ||
    domain.name !== SUCCRA_LOGIN_DOMAIN_NAME ||
    domain.version !== SUCCRA_LOGIN_DOMAIN_VERSION ||
    !Number.isSafeInteger(domain.chainId) ||
    domain.chainId <= 0 ||
    candidate.primaryType !== 'SuccraLogin' ||
    !message ||
    typeof message.nonce !== 'string' ||
    typeof message.issuedAt !== 'string'
  ) {
    return null;
  }
  const walletAddress = normalizeWalletAddress(message.walletAddress);
  if (!walletAddress) return null;
  return {
    domain: {
      name: SUCCRA_LOGIN_DOMAIN_NAME,
      version: SUCCRA_LOGIN_DOMAIN_VERSION,
      chainId: domain.chainId,
    },
    types: SUCCRA_LOGIN_TYPES,
    primaryType: 'SuccraLogin',
    message: {
      walletAddress,
      nonce: message.nonce,
      issuedAt: message.issuedAt,
    },
  };
}
