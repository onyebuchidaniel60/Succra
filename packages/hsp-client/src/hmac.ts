import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 over a UTF-8 payload, returned as lowercase hex. */
export function signHmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Constant-time HMAC verification. Invalid hex or length fails closed. */
export function verifyHmac(payload: string, signature: string, secret: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signHmac(payload, secret), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}
