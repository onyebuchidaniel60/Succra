// Gateway fee-payer key loading tests (no chain).
import { describe, expect, it } from 'vitest';
import { sign as naclSign } from 'tweetnacl';
import { bytesToBase58, bytesToBase64 } from '@succra/shared';
import { loadFeePayer } from '../lib/gateway/chain.js';

describe('fee-payer key loading', () => {
  it('accepts exactly one format (base58 64-byte secret key)', () => {
    const secretKey = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) secretKey[i] = (i * 7 + 1) & 0xff;
    // base64 of the same bytes is rejected even though the length matches.
    expect(() => loadFeePayer(bytesToBase64(secretKey))).toThrow();
  });

  it('round-trips a base58 secret to the expected address', () => {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) seed[i] = i + 1;
    const pair = naclSign.keyPair.fromSeed(seed);
    const secret = new Uint8Array(64);
    secret.set(seed, 0);
    secret.set(pair.publicKey, 32);
    const payer = loadFeePayer(bytesToBase58(secret));
    expect(payer.address).toEqual(bytesToBase58(pair.publicKey));
    const message = new TextEncoder().encode('hello');
    expect(payer.signBytes(message)).toEqual(naclSign.detached(message, secret));
    expect(payer.signBytes(message)).toEqual(payer.signBytes(message));
  });

  it('rejects missing and malformed configuration', () => {
    const saved = process.env.SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY;
    delete process.env.SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY;
    try {
      expect(() => loadFeePayer()).toThrow();
      expect(() => loadFeePayer('not-base58!!!')).toThrow();
      expect(() => loadFeePayer(bytesToBase58(new Uint8Array(32)))).toThrow();
    } finally {
      if (saved !== undefined) {
        process.env.SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY = saved;
      }
    }
  });
});
