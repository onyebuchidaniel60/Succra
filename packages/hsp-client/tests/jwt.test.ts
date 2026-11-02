import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { describe, expect, it } from 'vitest';
import { publicKeyFromPrivateKey, signJwtES256K, verifyJwtES256K } from '../src/jwt.js';

const privateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
const publicKey = publicKeyFromPrivateKey(privateKey);

describe('HSP ES256K JWT', () => {
  it('signs and verifies a matching token', () => {
    const token = signJwtES256K(
      { sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      'kid-1'
    );
    expect(token.split('.')).toHaveLength(3);
    expect(verifyJwtES256K(token, publicKey)).toEqual(true);
  });

  it('rejects a tampered token', () => {
    const token = signJwtES256K(
      { sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      'kid-1'
    );
    const [header, payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 60 })
    ).toString('base64url');
    expect(verifyJwtES256K(`${header}.${tamperedPayload}.${signature}`, publicKey)).toEqual(false);
    const signatureBytes = Buffer.from(signature ?? '', 'base64url');
    signatureBytes.writeUInt8(signatureBytes.readUInt8(0) ^ 0x01, 0);
    expect(
      verifyJwtES256K(`${header}.${payload}.${signatureBytes.toString('base64url')}`, publicKey)
    ).toEqual(false);
  });

  it('rejects an expired token', () => {
    const token = signJwtES256K(
      { sub: 'agent-1', exp: Math.floor(Date.now() / 1000) - 1 },
      privateKey,
      'kid-1'
    );
    expect(verifyJwtES256K(token, publicKey)).toEqual(false);
  });

  it('rejects a token signed by a different key', () => {
    const otherPrivate = bytesToHex(secp256k1.utils.randomPrivateKey());
    const otherPublic = publicKeyFromPrivateKey(otherPrivate);
    const token = signJwtES256K(
      { sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      'kid-1'
    );
    expect(verifyJwtES256K(token, otherPublic)).toEqual(false);
  });

  it('exposes a 65-byte uncompressed public key', () => {
    expect(hexToBytes(publicKey)).toHaveLength(65);
  });
});
