// HSP client foundation test (Phase 0 scaffold; no HSP logic yet).
import { describe, expect, it } from 'vitest';
import { HSP_CLIENT_PHASE } from '../src/index.js';

describe('hsp-client foundation (Phase 3)', () => {
  it('exposes the Phase 3 marker', () => {
    expect(HSP_CLIENT_PHASE).toBe('phase-3');
  });
});
