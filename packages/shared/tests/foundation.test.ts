import { describe, expect, it } from 'vitest';
import { SUCCRA_SHARED_PHASE } from '../src/index.js';

describe('shared foundation (Phase 0)', () => {
  it('exposes the Phase 0 marker and nothing else', () => {
    expect(SUCCRA_SHARED_PHASE).toBe('phase-0');
  });
});
