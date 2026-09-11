import { describe, expect, it } from 'vitest';
import { SUCCRA_PROGRAM_CLIENT_PHASE } from '../src/index.js';

describe('program-client foundation (Phase 0)', () => {
  it('exposes the Phase 0 marker and nothing else', () => {
    expect(SUCCRA_PROGRAM_CLIENT_PHASE).toBe('phase-0');
  });
});
