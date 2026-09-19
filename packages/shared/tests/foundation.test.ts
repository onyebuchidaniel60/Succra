// Shared surface test: pure contracts are exported.
import { describe, expect, it } from 'vitest';
import { buildCanonicalString, executeActionDiscriminator, inspectMessage } from '../src/index.js';

describe('shared surface (Phase 4)', () => {
  it('exposes the pure contract modules', () => {
    expect(typeof buildCanonicalString).toEqual('function');
    expect(executeActionDiscriminator().length).toEqual(8);
    expect(typeof inspectMessage).toEqual('function');
  });
});
