import { describe, expect, it } from 'vitest';
import { SUCCRA_WEB_PHASE } from '../src/index.js';

describe('web foundation (Phase 0)', () => {
  it('exposes the Phase 0 marker and nothing else', () => {
    expect(SUCCRA_WEB_PHASE).toBe('phase-0');
  });
});
