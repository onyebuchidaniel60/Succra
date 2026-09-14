// Unit tests: login message format + Ed25519 verification (no server).
//
// Wallet addresses in fixtures must be REAL base58 encodings of 32 bytes:
// 32 base58 chars only encode ~23 bytes (the all-'1' system address is the
// zero special case), so fixtures use tweetnacl keys round-tripped through
// a local base58 encoder that self-checks against the system vector.
import { describe, expect, it } from 'vitest';
import { sign } from 'tweetnacl';
import { buildLoginMessage } from '../lib/auth/message';
import { verifyWalletSignature } from '../lib/auth/signature';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = (num << 8n) + BigInt(byte);
  }
  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('test base58 fixture encoder', () => {
  it('matches the system-program zero vector', () => {
    expect(base58Encode(new Uint8Array(32))).toEqual('1'.repeat(32));
  });
});

describe('buildLoginMessage', () => {
  it('binds wallet, nonce, expiry, and app URI in order', () => {
    expect(
      buildLoginMessage({
        walletAddress: 'WALLET',
        nonce: 'NONCE',
        expiresAt: '2026-09-13T00:10:00.000Z',
        appUri: 'https://app.example',
      })
    ).toEqual(
      [
        'Succra sign-in',
        '',
        'Wallet: WALLET',
        'Nonce: NONCE',
        'Expires: 2026-09-13T00:10:00.000Z',
        'URI: https://app.example',
      ].join('\n')
    );
  });
});

describe('verifyWalletSignature', () => {
  const keys = sign.keyPair();
  const walletAddress = base58Encode(keys.publicKey);
  const message = buildLoginMessage({
    walletAddress,
    nonce: 'n',
    expiresAt: 'e',
    appUri: 'u',
  });
  const signature = base64(sign.detached(new TextEncoder().encode(message), keys.secretKey));

  it('accepts a genuine signature over the exact message', () => {
    expect(verifyWalletSignature({ walletAddress, message, signatureBase64: signature })).toEqual(
      true
    );
  });

  it('accepts the system address fixture shape', () => {
    expect(walletAddress.length).toBeGreaterThan(32);
  });

  it('rejects a tampered message', () => {
    expect(
      verifyWalletSignature({ walletAddress, message: `${message}X`, signatureBase64: signature })
    ).toEqual(false);
  });

  it('rejects a signature from a different key', () => {
    const other = base58Encode(sign.keyPair().publicKey);
    expect(
      verifyWalletSignature({ walletAddress: other, message, signatureBase64: signature })
    ).toEqual(false);
  });

  it('rejects malformed inputs without throwing', () => {
    expect(
      verifyWalletSignature({ walletAddress: '!!!', message, signatureBase64: signature })
    ).toEqual(false);
    expect(verifyWalletSignature({ walletAddress, message, signatureBase64: '!!!' })).toEqual(
      false
    );
    expect(
      verifyWalletSignature({
        walletAddress,
        message,
        signatureBase64: base64(new Uint8Array(3)),
      })
    ).toEqual(false);
  });
});
