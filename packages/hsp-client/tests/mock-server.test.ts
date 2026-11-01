import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { signHmac } from '../src/hmac.js';
import { publicKeyFromPrivateKey, signJwtES256K } from '../src/jwt.js';
import { startMockHspServer, type MockHspServer } from '../test/mock-server.js';

let mock: MockHspServer | undefined;
const hmacSecret = 'test-hmac-secret';
const privateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
const publicKey = publicKeyFromPrivateKey(privateKey);

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('HSP mock server', () => {
  it('echoes an HMAC-signed cart mandate and rejects a bad signature', async () => {
    mock = await startMockHspServer({ hmacSecret });
    const body = JSON.stringify({ cartMandateId: 'cart-1' });
    const ok = await fetch(`${mock.url}/v1/cart-mandates/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-succra-hmac': signHmac(body, hmacSecret),
      },
      body,
    });
    expect(ok.status).toEqual(200);

    const bad = await fetch(`${mock.url}/v1/cart-mandates/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-succra-hmac': '0'.repeat(64) },
      body,
    });
    expect(bad.status).toEqual(401);
    expect(mock.requests.length).toEqual(2);
  });

  it('echoes a JWT-authenticated payment mandate and rejects a bad token', async () => {
    mock = await startMockHspServer({ jwtPublicKey: publicKey });
    const body = JSON.stringify({ requestId: 'req-1' });
    const token = signJwtES256K(
      { sub: 'agent-1', exp: Math.floor(Date.now() / 1000) + 60 },
      privateKey,
      'kid-1'
    );
    const ok = await fetch(`${mock.url}/v1/payment-mandates/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body,
    });
    expect(ok.status).toEqual(200);

    const bad = await fetch(`${mock.url}/v1/payment-mandates/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' },
      body,
    });
    expect(bad.status).toEqual(401);
  });
});
