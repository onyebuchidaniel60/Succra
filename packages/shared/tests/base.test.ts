// Shared base-encoding unit tests (run everywhere, no chain).
import { describe, expect, it } from 'vitest';
import {
  base58ToBytes32,
  base64ToBytes,
  bytesToBase58,
  bytesToBase64,
  bytesToHex,
  hexToBytes,
  sha256Hex,
  sha256HexUtf8,
} from '../src/base.js';

describe('base encodings', () => {
  it('base58 round-trips 32 bytes, including leading zeros', () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 0;
    bytes[31] = 7;
    expect(base58ToBytes32(bytesToBase58(bytes))).toEqual(bytes);
  });

  it('base58 encodes the system program id to itself', () => {
    expect(bytesToBase58(base58ToBytes32('11111111111111111111111111111111'))).toEqual(
      '11111111111111111111111111111111'
    );
  });

  it('base58 rejects invalid input', () => {
    expect(() => base58ToBytes32('')).toThrow();
    expect(() => base58ToBytes32('0OIl')).toThrow();
    expect(() => base58ToBytes32('1'.repeat(65))).toThrow();
  });

  it('base64 round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(() => base64ToBytes('!!!')).toThrow();
  });

  it('hex round-trips', () => {
    const bytes = new Uint8Array([0xab, 0xcd, 0x00]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    expect(bytesToHex(bytes)).toEqual('abcd00');
    expect(() => hexToBytes('xyz')).toThrow();
  });

  it('sha256 matches the empty-string vector', () => {
    expect(sha256HexUtf8('')).toEqual(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256Hex(new Uint8Array(0))).toEqual(sha256HexUtf8(''));
  });
});
