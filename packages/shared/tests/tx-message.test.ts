// Transaction message wire tests (run everywhere, no chain, kit-free).
// Covers base64/hash helpers, wire parse/assemble, and the structural
// message inspector against a hand-built legacy message vector.
// Kit interop (kit builds, this module parses) lives in
// apps/web/tests/txkit-interop.test.ts, where @solana/kit resolves.
import { describe, expect, it } from 'vitest';
import { bytesToBase58 } from '../src/base.js';
import {
  emptySignature,
  encodeWireTransaction,
  hashMessageBytes,
  inspectMessage,
  isEmptySignature,
  messageFromBase64,
  messageToBase64,
  parseWireTransaction,
} from '../src/txmsg.js';

/** Hand-built legacy message: header [2,1,1], 4 keys, 1 instruction. */
function buildVector(): { bytes: Uint8Array; keys: Uint8Array[] } {
  const keys = [
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(2),
    new Uint8Array(32).fill(3),
    new Uint8Array(32).fill(4),
  ];
  const out: number[] = [2, 1, 0, 4];
  for (const key of keys) out.push(...key);
  out.push(...new Uint8Array(32).fill(5)); // blockhash
  out.push(1); // one instruction
  out.push(2); // program index
  out.push(2, 1, 3); // account indexes
  out.push(3, 9, 9, 9); // data
  return { bytes: new Uint8Array(out), keys };
}

describe('transaction message wire format', () => {
  it('round-trips base64 and hashes stably', () => {
    const { bytes } = buildVector();
    const b64 = messageToBase64(bytes);
    expect(messageFromBase64(b64)).toEqual(bytes);
    expect(hashMessageBytes(bytes)).toEqual(hashMessageBytes(messageFromBase64(b64)));
    expect(hashMessageBytes(bytes)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => messageFromBase64('!!!')).toThrow();
  });

  it('inspects the hand-built vector with correct roles', () => {
    const { bytes, keys } = buildVector();
    const view = inspectMessage(bytes);
    expect(view.feePayer).toEqual(bytesToBase58(keys[0] ?? new Uint8Array(32)));
    expect(view.signerAddresses).toEqual([
      bytesToBase58(keys[0] ?? new Uint8Array(32)),
      bytesToBase58(keys[1] ?? new Uint8Array(32)),
    ]);
    expect(view.instructions.length).toEqual(1);
    const ix = view.instructions[0];
    expect(ix?.programAddress).toEqual(bytesToBase58(keys[2] ?? new Uint8Array(32)));
    expect(ix?.accounts).toEqual([
      { address: bytesToBase58(keys[1] ?? new Uint8Array(32)), role: 'readonly-signer' },
      { address: bytesToBase58(keys[3] ?? new Uint8Array(32)), role: 'writable' },
    ]);
    expect(ix?.data).toEqual(new Uint8Array([9, 9, 9]));
  });

  it('rejects malformed messages', () => {
    expect(() => inspectMessage(new Uint8Array(0))).toThrow();
    expect(() => inspectMessage(new Uint8Array([0x81, 0, 0]))).toThrow();
    const { bytes } = buildVector();
    expect(() => inspectMessage(bytes.subarray(0, bytes.length - 1))).toThrow();
    const trailing = new Uint8Array([...bytes, 0]);
    expect(() => inspectMessage(trailing)).toThrow();
  });

  it('wire parse/assemble round-trips', () => {
    const { bytes } = buildVector();
    const sigs = [new Uint8Array(64).fill(7), new Uint8Array(64).fill(8)];
    const wire = encodeWireTransaction(sigs, bytes);
    const parsed = parseWireTransaction(wire);
    expect(parsed.signatures).toEqual(sigs);
    expect(parsed.messageBytes).toEqual(bytes);
    expect(hashMessageBytes(parsed.messageBytes)).toEqual(hashMessageBytes(bytes));
  });

  it('empty-signature placeholder helpers behave', () => {
    expect(isEmptySignature(emptySignature())).toEqual(true);
    expect(isEmptySignature(new Uint8Array(64).fill(1))).toEqual(false);
  });

  it('rejects malformed wire transactions', () => {
    expect(() => parseWireTransaction(new Uint8Array(0))).toThrow();
    expect(() => parseWireTransaction(new Uint8Array([0]))).toThrow();
    expect(() => parseWireTransaction(new Uint8Array([17]))).toThrow();
    expect(() => parseWireTransaction(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => encodeWireTransaction([], new Uint8Array([1]))).toThrow();
    expect(() => encodeWireTransaction([new Uint8Array(32)], new Uint8Array([1]))).toThrow();
  });
});
