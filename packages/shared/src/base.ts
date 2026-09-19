// Succra shared — base encodings + hashing for security paths.
//
// @solana/kit's base58 codecs throw internally on valid inputs in this
// toolchain (see apps/web/lib/auth/signature.ts), so every security path
// (key decode, signature decode, hash preimages) uses these local,
// fixture-tested primitives instead of kit codecs. Kit is used only for
// transaction message STRUCTURE (compile/decode/decompile), which is
// proven working by packages/shared/tests/tx-message.test.ts.
import { createHash } from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decode base58 to bytes of any length; throws on invalid input. */
export function base58ToBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length > 128) {
    throw new Error('Value has an invalid base58 length.');
  }
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new Error('Value is not valid base58.');
    }
    num = num * 58n + BigInt(digit);
  }
  const raw: number[] = [];
  while (num > 0n) {
    raw.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  let leadingZeros = 0;
  for (const char of value) {
    if (char !== '1') break;
    leadingZeros += 1;
  }
  const out = new Uint8Array(leadingZeros + raw.length);
  out.set(raw, leadingZeros);
  return out;
}

/** Decode base58 to exactly 32 bytes; throws on invalid input. */
export function base58ToBytes32(value: string): Uint8Array {
  if (value.length === 0 || value.length > 64) {
    throw new Error('Value has an invalid base58 length.');
  }
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) {
      throw new Error('Value is not valid base58.');
    }
    num = num * 58n + BigInt(digit);
  }
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) {
    bytes[i] = Number(num & 0xffn);
    num >>= 8n;
  }
  if (num !== 0n) {
    throw new Error('Value decodes to more than 32 bytes.');
  }
  return bytes;
}

/** Encode bytes as base58 (Bitcoin alphabet). */
export function bytesToBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = (num << 8n) + BigInt(byte);
  }
  let out = '';
  while (num > 0n) {
    const digit = Number(num % 58n);
    out = (BASE58_ALPHABET[digit] ?? '') + out;
    num /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out === '' ? '1' : out;
}

/** Decode base64; throws on invalid input. */
export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    throw new Error('Value is not valid base64.');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Value is not valid base64.');
  }
  return new Uint8Array(Buffer.from(normalized, 'base64'));
}

/** Encode bytes as base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Decode even-length hex; throws on invalid input. */
export function hexToBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error('Value is not valid hex.');
  }
  return new Uint8Array(Buffer.from(value, 'hex'));
}

/** Encode bytes as lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** SHA-256 over bytes, hex-encoded. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 over a UTF-8 string, hex-encoded. */
export function sha256HexUtf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
