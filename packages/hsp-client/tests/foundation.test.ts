// HSP client foundation test (Phase 0 scaffold; no HSP logic yet).
import { describe, expect, it } from 'vitest';
import { HSP_CLIENT_PHASE } from '../src/index.js';

describe('hsp-client foundation (Phase 2)', () => {
  it('exposes the Phase 2 marker and nothing else', () => {
    expect(HSP_CLIENT_PHASE).toBe('phase-2');
  });
});
