// Succra web — Ed25519 wallet-signature verification.
//
// Solana wallet signatures are Ed25519 detached signatures over the raw
// message bytes. Base58/base64 decoding is implemented locally (20 lines,
// fixture-tested below via verifyWalletSignature): @solana/kit is used for
// address *validation* (lib/solana-address.ts), but its v8.3.0 base58
// codecs throw internally on valid inputs in this toolchain, so the
// security-critical decode path does not depend on them. The signature
// check itself uses tweetnacl (audited Ed25519 primitive).
import { sign } from 'tweetnacl';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decode base58 to exactly 32 bytes; throws on invalid input. */
export function base58ToBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length > 64) {
    throw new Error('Address has an invalid length.');
  }
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new Error('Address is not valid base58.');
    }
    num = num * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) {
    bytes[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  if (num !== 0n) {
    throw new Error('Address decodes to more than 32 bytes.');
  }
  return bytes;
}

/** Decode base64 to exactly 64 bytes (Ed25519 signature); throws otherwise. */
export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error('Signature is not valid base64.');
  }
  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.length !== 64) {
    throw new Error('Signature must decode to exactly 64 bytes.');
  }
  return new Uint8Array(bytes);
}

/**
 * Verify a wallet's detached Ed25519 signature over the login message.
 * Returns true only when the signature is valid for the given public key.
 * Never throws on invalid input — callers treat false as 401.
 */
export function verifyWalletSignature(args: {
  walletAddress: string;
  message: string;
  signatureBase64: string;
}): boolean {
  try {
    const publicKey = base58ToBytes(args.walletAddress);
    const signature = base64ToBytes(args.signatureBase64);
    const messageBytes = new TextEncoder().encode(args.message);
    return sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}
