// Shared Ed25519 sign/verify round-trip tests (no chain).
import { describe, expect, it } from 'vitest';
import { sign } from 'tweetnacl';
import { bytesToBase58 } from '../src/base.js';
import { buildCanonicalString } from '../src/canonical.js';
import {
  publicKeyBase58ForSecret,
  signCanonicalString,
  verifyCanonicalSignature,
} from '../src/signing.js';

describe('request signing', () => {
  it('signs and verifies a canonical string', () => {
    const keypair = sign.keyPair();
    const canonical = buildCanonicalString({
      timestamp: '1720000000000',
      nonce: 'n-1',
      missionId: 'm-1',
      method: 'POST',
      path: '/api/missions/m-1/actions',
      body: '{"a":1}',
    });
    const signature = signCanonicalString(canonical, keypair.secretKey);
    expect(
      verifyCanonicalSignature({
        publicKeyBase58: bytesToBase58(keypair.publicKey),
        canonical,
        signatureBase64: signature,
      })
    ).toEqual(true);
  });

  it('rejects wrong key, tampered body, and malformed inputs', () => {
    const keypair = sign.keyPair();
    const other = sign.keyPair();
    const canonical = buildCanonicalString({
      timestamp: '1',
      nonce: 'n',
      missionId: 'm',
      method: 'POST',
      path: '/p',
      body: '{}',
    });
    const signature = signCanonicalString(canonical, keypair.secretKey);
    const base = {
      publicKeyBase58: bytesToBase58(keypair.publicKey),
      canonical,
      signatureBase64: signature,
    };
    expect(verifyCanonicalSignature({ ...base, canonical: `${canonical} ` })).toEqual(false);
    expect(
      verifyCanonicalSignature({ ...base, publicKeyBase58: bytesToBase58(other.publicKey) })
    ).toEqual(false);
    expect(verifyCanonicalSignature({ ...base, signatureBase64: '!!!' })).toEqual(false);
    expect(verifyCanonicalSignature({ ...base, publicKeyBase58: 'nope' })).toEqual(false);
  });

  it('derives the public key for a secret', () => {
    const keypair = sign.keyPair();
    expect(publicKeyBase58ForSecret(keypair.secretKey)).toEqual(bytesToBase58(keypair.publicKey));
    expect(() => publicKeyBase58ForSecret(new Uint8Array(32))).toThrow();
    expect(() => signCanonicalString('x', new Uint8Array(32))).toThrow();
  });
});
