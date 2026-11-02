// Web foundation smoke test: canonical policy document + hash helpers.
import { describe, expect, it } from 'vitest';
import {
  buildMockCartMandate,
  buildPolicyDocument,
  hashPolicyDocument,
  parsePolicyDocument,
  type MissionCreateInput,
} from '../lib/missions';

const input = {
  name: 'Treasury run',
  objective: 'Pay vendors',
  paymentTokenAddress: '0x1111111111111111111111111111111111111111',
  budgetAtomic: '5000000',
  maxPaymentAtomic: '1000000',
  recoveryMaxPaymentAtomic: '500000',
  merchantAllowlist: ['0x2222222222222222222222222222222222222222'],
  expiresAt: '2030-01-01T00:00:00.000Z',
  primaryAgentAddress: '0x3333333333333333333333333333333333333333',
  successors: [{ address: '0x4444444444444444444444444444444444444444', priority: 1 }],
  violationThreshold: 3,
  violationWindowSeconds: 900,
} as unknown as MissionCreateInput;

describe('mission policy helpers', () => {
  it('builds a version-1 policy document and keccak bytes32 hash', () => {
    const cart = buildMockCartMandate({
      missionId: 'mission-1',
      paymentTokenAddress: input.paymentTokenAddress,
      budgetAtomic: input.budgetAtomic,
      merchantAllowlist: input.merchantAllowlist,
    });
    const policy = buildPolicyDocument(input, cart);
    expect(policy.version).toEqual(1);
    expect(policy.cart_mandate_id).toEqual('mock-cart-mission-1');
    expect(hashPolicyDocument(policy)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parsePolicyDocument(policy)).toEqual(policy);
  });

  it('is deterministic for the same mission and policy', () => {
    const first = buildMockCartMandate({
      missionId: 'mission-1',
      paymentTokenAddress: input.paymentTokenAddress,
      budgetAtomic: input.budgetAtomic,
      merchantAllowlist: input.merchantAllowlist,
    });
    const second = buildMockCartMandate({
      missionId: 'mission-1',
      paymentTokenAddress: input.paymentTokenAddress,
      budgetAtomic: input.budgetAtomic,
      merchantAllowlist: input.merchantAllowlist,
    });
    expect(first).toEqual(second);
    expect(buildPolicyDocument(input, first)).toEqual(buildPolicyDocument(input, second));
  });

  it('rejects malformed stored policy documents', () => {
    expect(parsePolicyDocument({ version: 2 })).toBeNull();
    expect(parsePolicyDocument(null)).toBeNull();
  });
});
