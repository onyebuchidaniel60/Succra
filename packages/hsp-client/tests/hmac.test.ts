import { describe, expect, it } from 'vitest';
import { signHmac, verifyHmac } from '../src/hmac.js';

describe('HSP HMAC-SHA256', () => {
  const secret = 'test-hmac-secret';
  const payload = JSON.stringify({ cartMandateId: 'cart-1', amountAtomic: '1000' });

  it('signs and verifies a matching payload', () => {
    const signature = signHmac(payload, secret);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyHmac(payload, signature, secret)).toEqual(true);
  });

  it('rejects a tampered payload', () => {
    const signature = signHmac(payload, secret);
    expect(verifyHmac(`${payload} `, signature, secret)).toEqual(false);
  });

  it('rejects a tampered signature and wrong secret', () => {
    const signature = signHmac(payload, secret);
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    expect(verifyHmac(payload, tampered, secret)).toEqual(false);
    expect(verifyHmac(payload, signature, 'wrong-secret')).toEqual(false);
  });

  it('fails closed on malformed signatures', () => {
    expect(verifyHmac(payload, 'not-hex', secret)).toEqual(false);
    expect(verifyHmac(payload, '', secret)).toEqual(false);
  });
});
