// §12 canonical signing string vectors (run everywhere, no chain).
import { describe, expect, it } from 'vitest';
import { buildCanonicalString, hashBody } from '../src/canonical.js';

describe('canonical signing string', () => {
  it('builds the exact §12 layout with real newlines', () => {
    const body = '{"idempotencyKey":"k-1"}';
    const built = buildCanonicalString({
      timestamp: '1720000000000',
      nonce: 'abc123',
      missionId: 'm-1',
      method: 'POST',
      path: '/api/missions/m-1/actions',
      body,
    });
    const lines = built.split('\n');
    expect(lines).toEqual([
      'SUCCRA-V1',
      '1720000000000',
      'abc123',
      'm-1',
      'POST',
      '/api/missions/m-1/actions',
      hashBody(body),
    ]);
  });

  it('hashes the raw body bytes (whitespace-sensitive)', () => {
    expect(hashBody('{"a":1}')).not.toEqual(hashBody('{"a": 1}'));
    expect(hashBody('')).toEqual(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('differs across nonce, mission, method, and path', () => {
    const base = {
      timestamp: '1720000000000',
      nonce: 'n',
      missionId: 'm',
      method: 'POST',
      path: '/p',
      body: '{}',
    };
    const variants = [
      buildCanonicalString({ ...base, nonce: 'other' }),
      buildCanonicalString({ ...base, missionId: 'other' }),
      buildCanonicalString({ ...base, method: 'GET' }),
      buildCanonicalString({ ...base, path: '/q' }),
    ];
    for (const variant of variants) {
      expect(variant).not.toEqual(buildCanonicalString(base));
    }
  });
});
