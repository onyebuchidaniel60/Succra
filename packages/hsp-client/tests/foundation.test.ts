// HSP client foundation test (Phase 0 scaffold; no HSP logic yet).
import { describe, expect, it } from 'vitest';
import { HSP_CLIENT_PHASE } from '../src/index.js';

describe('hsp-client foundation (Phase 0)', () => {
  it('exposes the Phase 0 marker and nothing else', () => {
    expect(HSP_CLIENT_PHASE).toBe('phase-0');
  });
});
