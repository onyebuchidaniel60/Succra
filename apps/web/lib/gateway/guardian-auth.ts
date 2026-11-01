// Succra web — guardian bearer credential verification (server-only).
import { timingSafeEqual } from 'node:crypto';

export function guardianCredentialMatches(request: Request): boolean {
  const header = request.headers.get('authorization');
  const expected = process.env.HASHKEY_GUARDIAN_CREDENTIAL;
  if (!header?.startsWith('Bearer ') || !expected) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (presented.length === 0) return false;
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return (
    presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes)
  );
}
