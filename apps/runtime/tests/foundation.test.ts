import { describe, expect, it } from 'vitest';
import { SUCCRA_RUNTIME_PHASE } from '../src/index.js';

describe('runtime foundation (Phase 0)', () => {
  it('exposes the Phase 0 marker and nothing else', () => {
    expect(SUCCRA_RUNTIME_PHASE).toBe('phase-0');
  });
});
