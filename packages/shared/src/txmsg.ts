// Succra shared — transaction message wire helpers (pure, kit-free).
//
// Wire shapes (amended §10):
// - `unsignedTransaction` = base64(compiled legacy message bytes).
// - `signedTransaction` = base64(wire transaction: sig-count + signatures
//   + message bytes). The agent places 64 zero bytes in the fee-payer
//   slot (it cannot sign as fee payer); the gateway overwrites slot 0
//   with its own fee-payer signature at submit time.
//
// Kit-free by design (see execute-ix.ts): parsing/assembly here is exact
// for legacy messages (the only kind the gateway builds), and byte
// interop with kit is proven by apps/web/tests/txkit-interop.test.ts
// (kit builds, this module parses) plus the live Alpha test where the
// cluster accepts gateway-assembled transactions.
import { base58ToBytes32, base64ToBytes, bytesToBase58, bytesToBase64, sha256Hex } from './base.js';
import type { AccountRoleName } from './execute-ix.js';

/** Base64 of compiled message bytes (`unsignedTransaction`). */
export function messageToBase64(messageBytes: Uint8Array): string {
  return bytesToBase64(messageBytes);
}

/** Decode base64 to message bytes. Throws on invalid input. */
export function messageFromBase64(value: string): Uint8Array {
  const bytes = base64ToBytes(value);
  if (bytes.length === 0 || bytes.length > 1232) {
    throw new Error('Transaction message has an invalid length.');
  }
  return bytes;
}

/** SHA-256 hex of message bytes (`unsigned_tx_hash`). */
export function hashMessageBytes(messageBytes: Uint8Array): string {
  return sha256Hex(messageBytes);
}

export interface ParsedWireTransaction {
  signatures: Uint8Array[];
  messageBytes: Uint8Array;
}

/**
 * Parse a legacy wire transaction: u8 sig-count, 64 bytes per signature,
 * then the message. Strict: trailing bytes and short reads throw.
 */
export function parseWireTransaction(bytes: Uint8Array): ParsedWireTransaction {
  if (bytes.length < 1) {
    throw new Error('Transaction is empty.');
  }
  const count = bytes[0] ?? 0;
  if (count === 0 || count > 16) {
    throw new Error('Transaction has an invalid signature count.');
  }
  const end = 1 + count * 64;
  if (bytes.length <= end) {
    throw new Error('Transaction is truncated.');
  }
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < count; i += 1) {
    signatures.push(bytes.subarray(1 + i * 64, 1 + (i + 1) * 64));
  }
  const messageBytes = bytes.subarray(end);
  if (messageBytes.length === 0 || messageBytes.length > 1232) {
    throw new Error('Transaction message has an invalid length.');
  }
  if ((messageBytes[0] ?? 0) >= 0x80) {
    throw new Error('Versioned transactions are not supported.');
  }
  return { signatures, messageBytes };
}

/** Assemble a legacy wire transaction from signatures + message bytes. */
export function encodeWireTransaction(
  signatures: Uint8Array[],
  messageBytes: Uint8Array
): Uint8Array {
  if (signatures.length === 0 || signatures.length > 16) {
    throw new Error('Transaction has an invalid signature count.');
  }
  for (const sig of signatures) {
    if (sig.length !== 64) {
      throw new Error('Transaction signature must be 64 bytes.');
    }
  }
  const out = new Uint8Array(1 + signatures.length * 64 + messageBytes.length);
  out[0] = signatures.length;
  signatures.forEach((sig, i) => {
    out.set(sig, 1 + i * 64);
  });
  out.set(messageBytes, 1 + signatures.length * 64);
  return out;
}

/** 64 zero bytes: the agent's fee-payer-slot placeholder (see header). */
export function emptySignature(): Uint8Array {
  return new Uint8Array(64);
}

export function isEmptySignature(sig: Uint8Array): boolean {
  return sig.length === 64 && sig.every((byte) => byte === 0);
}

export interface InspectedAccount {
  address: string;
  role: AccountRoleName;
}

export interface InspectedInstruction {
  programAddress: string;
  accounts: InspectedAccount[];
  data: Uint8Array;
}

export interface InspectedMessage {
  /** First account key (the fee payer), or null when the message has no keys. */
  feePayer: string | null;
  /** First numRequiredSignatures keys, in slot order. */
  signerAddresses: string[];
  instructions: InspectedInstruction[];
}

function readShortvec(reader: { bytes: Uint8Array; offset: number }): number {
  let value = 0;
  let shift = 0;
  for (;;) {
    if (reader.offset >= reader.bytes.length) {
      throw new Error('Transaction message is truncated.');
    }
    const byte = reader.bytes[reader.offset] ?? 0;
    reader.offset += 1;
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) {
      return value;
    }
    if (shift >= 32) {
      throw new Error('Transaction message has an invalid length prefix.');
    }
  }
}

/**
 * Structurally parse a legacy compiled message (no address lookup
 * tables). Throws on any malformed input. Roles follow the Solana
 * message-header convention.
 */
export function inspectMessage(messageBytes: Uint8Array): InspectedMessage {
  if (messageBytes.length < 3 || (messageBytes[0] ?? 0) >= 0x80) {
    throw new Error('Transaction message is not a legacy message.');
  }
  const required = messageBytes[0] ?? 0;
  const readonlySigned = messageBytes[1] ?? 0;
  const readonlyUnsigned = messageBytes[2] ?? 0;
  const reader = { bytes: messageBytes, offset: 3 };
  const keyCount = readShortvec(reader);
  if (keyCount === 0 || keyCount > 64) {
    throw new Error('Transaction message has an invalid account count.');
  }
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i += 1) {
    if (reader.offset + 32 > reader.bytes.length) {
      throw new Error('Transaction message is truncated.');
    }
    keys.push(bytesToBase58(reader.bytes.subarray(reader.offset, reader.offset + 32)));
    reader.offset += 32;
  }
  if (required > keys.length) {
    throw new Error('Transaction message requires more signers than keys.');
  }
  if (reader.offset + 32 > reader.bytes.length) {
    throw new Error('Transaction message is truncated.');
  }
  reader.offset += 32; // recent blockhash (opaque here; expiry is enforced separately)
  const roleOf = (index: number): AccountRoleName => {
    const isSigner = index < required;
    const writable = isSigner
      ? index < required - readonlySigned
      : index < keys.length - readonlyUnsigned;
    if (isSigner) {
      return writable ? 'writable-signer' : 'readonly-signer';
    }
    return writable ? 'writable' : 'readonly';
  };
  const ixCount = readShortvec(reader);
  if (ixCount === 0 || ixCount > 16) {
    throw new Error('Transaction message has an invalid instruction count.');
  }
  const instructions: InspectedInstruction[] = [];
  for (let i = 0; i < ixCount; i += 1) {
    if (reader.offset >= reader.bytes.length) {
      throw new Error('Transaction message is truncated.');
    }
    const programIndex = reader.bytes[reader.offset] ?? 255;
    reader.offset += 1;
    const programAddress = keys[programIndex];
    if (programAddress === undefined) {
      throw new Error('Instruction references an unknown program.');
    }
    const accountCount = readShortvec(reader);
    const accounts: InspectedAccount[] = [];
    for (let a = 0; a < accountCount; a += 1) {
      if (reader.offset >= reader.bytes.length) {
        throw new Error('Transaction message is truncated.');
      }
      const keyIndex = reader.bytes[reader.offset] ?? 255;
      reader.offset += 1;
      const address = keys[keyIndex];
      if (address === undefined) {
        throw new Error('Instruction references an unknown account.');
      }
      accounts.push({ address, role: roleOf(keyIndex) });
    }
    const dataLen = readShortvec(reader);
    if (reader.offset + dataLen > reader.bytes.length) {
      throw new Error('Transaction message is truncated.');
    }
    const data = reader.bytes.subarray(reader.offset, reader.offset + dataLen);
    reader.offset += dataLen;
    instructions.push({ programAddress, accounts, data });
  }
  if (reader.offset !== reader.bytes.length) {
    throw new Error('Transaction message has trailing bytes.');
  }
  return {
    feePayer: keys[0] ?? null,
    signerAddresses: keys.slice(0, required),
    instructions,
  };
}

/** Decode a base58 address to bytes, re-exported for SDK/gateway convenience. */
export function addressToBytes(value: string): Uint8Array {
  return base58ToBytes32(value);
}
