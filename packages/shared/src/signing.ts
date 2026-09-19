// Succra shared — Ed25519 request signing/verification (tweetnacl).
//
// Both sides of agent authentication use this exact code: the SDK signs,
// the gateway verifies. Keys are raw 32-byte Ed25519 public keys and
// 64-byte secret keys; signatures are detached over the §12 canonical
// string bytes, base64-encoded for transport.
import { sign } from 'tweetnacl';
import { base58ToBytes32, base64ToBytes, bytesToBase58, bytesToBase64 } from './base.js';

/** Sign canonical-string bytes. The secret key never leaves the caller. */
export function signCanonicalString(canonical: string, secretKey: Uint8Array): string {
  if (secretKey.length !== 64) {
    throw new Error('Secret key must be 64 bytes.');
  }
  const signature = sign.detached(new TextEncoder().encode(canonical), secretKey);
  return bytesToBase64(signature);
}

/**
 * Verify a base64 Ed25519 signature over canonical-string bytes.
 * Returns false (never throws) on any invalid input.
 */
export function verifyCanonicalSignature(args: {
  publicKeyBase58: string;
  canonical: string;
  signatureBase64: string;
}): boolean {
  try {
    const publicKey = base58ToBytes32(args.publicKeyBase58);
    const signature = base64ToBytes(args.signatureBase64);
    if (signature.length !== 64) {
      return false;
    }
    return sign.detached.verify(new TextEncoder().encode(args.canonical), signature, publicKey);
  } catch {
    return false;
  }
}

/** Derive the base58 public key for a 64-byte secret key (test/agent use). */
export function publicKeyBase58ForSecret(secretKey: Uint8Array): string {
  if (secretKey.length !== 64) {
    throw new Error('Secret key must be 64 bytes.');
  }
  return bytesToBase58(sign.keyPair.fromSecretKey(secretKey).publicKey);
}
