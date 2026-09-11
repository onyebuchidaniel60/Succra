import { describe, expect, it } from 'vitest';
import { SUCCRA_SDK_PHASE } from '../src/index.js';

describe('sdk foundation (Phase 0)', () => {
  it('exposes the Phase 0 marker and nothing else', () => {
    expect(SUCCRA_SDK_PHASE).toBe('phase-0');
  });
});
