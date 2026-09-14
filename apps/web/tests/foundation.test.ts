// Web foundation smoke test: policy document + placeholder helpers.
import { describe, expect, it } from 'vitest';
import { buildPolicyDocument, hashPolicyDocument, placeholderAddress } from '../lib/missions';

describe('web foundation', () => {
  it('builds a version-1 policy document with network defaults', () => {
    const policy = buildPolicyDocument({
      maxActionAtomic: '5000000',
      recoveryMaxActionAtomic: '1000000',
      allowedActionTypes: ['TRANSFER_SOL'],
      allowedRecipients: [],
    } as never);
    expect(policy.version).toEqual(1);
    expect(policy.violation_threshold).toEqual(3);
    expect(policy.violation_window_seconds).toEqual(900);
    expect(hashPolicyDocument(policy)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mints unique, obviously-placeholder PDA/vault addresses', () => {
    const first = placeholderAddress('pda');
    const second = placeholderAddress('pda');
    expect(first.startsWith('pending:pda:')).toEqual(true);
    expect(first).not.toEqual(second);
    expect(placeholderAddress('vault').startsWith('pending:vault:')).toEqual(true);
  });
});
