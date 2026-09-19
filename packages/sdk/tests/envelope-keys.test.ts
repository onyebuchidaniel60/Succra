// SDK envelope + keys tests (no chain).
import { describe, expect, it } from 'vitest';
import { parseGatewayError, SdkError, SdkRefusal } from '../src/errors.js';
import {
  agentKeypairFromSecretKey,
  agentPublicKeyBase58,
  agentSecretKeyBase64,
  createAgentKeypair,
} from '../src/keys.js';

describe('gateway error envelope', () => {
  it('parses the §10 envelope', () => {
    const error = parseGatewayError(401, {
      error: { code: 'INVALID_SIGNATURE', message: 'Bad signature.', requestId: 'r-1' },
    });
    expect(error).toBeInstanceOf(SdkError);
    expect(error.status).toEqual(401);
    expect(error.code).toEqual('INVALID_SIGNATURE');
    expect(error.message).toEqual('Bad signature.');
    expect(error.requestId).toEqual('r-1');
  });

  it('falls back on malformed payloads without throwing', () => {
    for (const payload of [null, 42, {}, { error: null }, { error: { code: 1 } }]) {
      const error = parseGatewayError(500, payload);
      expect(error.code).toEqual('UNKNOWN_ERROR');
      expect(error.status).toEqual(500);
    }
  });

  it('SdkRefusal is distinct from SdkError', () => {
    expect(new SdkRefusal('nope')).not.toBeInstanceOf(SdkError);
  });
});

describe('agent keys', () => {
  it('creates and reloads a keypair', () => {
    const pair = createAgentKeypair();
    expect(pair.publicKey.length).toEqual(32);
    expect(pair.secretKey.length).toEqual(64);
    const reloaded = agentKeypairFromSecretKey(agentSecretKeyBase64(pair));
    expect(reloaded.publicKey).toEqual(pair.publicKey);
    expect(agentPublicKeyBase58(pair).length).toBeGreaterThan(30);
    expect(() => agentKeypairFromSecretKey('!!!')).toThrow();
    expect(() =>
      agentKeypairFromSecretKey(Buffer.from(new Uint8Array(32)).toString('base64'))
    ).toThrow();
  });
});
