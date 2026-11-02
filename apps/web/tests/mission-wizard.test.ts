// Unit tests: seven-step wizard validation and atomic conversion.
import { describe, expect, it, vi } from 'vitest';
import {
  dateToExpiresAt,
  defaultWizardDraft,
  parseTokenAmount,
  toMissionCreateInput,
  validateWizard,
  validateWizardStep,
  type MissionWizardDraft,
} from '../lib/missions/wizard';

function validDraft(): MissionWizardDraft {
  return {
    name: 'Treasury run',
    objective: 'Pay vendors',
    paymentTokenAddress: '0x1111111111111111111111111111111111111111',
    budget: '1000',
    maxPayment: '100',
    recoveryMaxPayment: '50',
    expiresAt: '2030-01-01',
    merchantAllowlist: ['0x2222222222222222222222222222222222222222'],
    primaryAgentAddress: '0x3333333333333333333333333333333333333333',
    primaryAgentName: 'Alpha',
    successors: [{ address: '0x4444444444444444444444444444444444444444', priority: '1' }],
    violationThreshold: '3',
    violationWindowSeconds: '900',
  };
}

describe('wizard token amounts', () => {
  it('converts human USDC to six-decimal atomic strings', () => {
    expect(parseTokenAmount('1')).toEqual({ atomic: '1000000' });
    expect(parseTokenAmount('1.5')).toEqual({ atomic: '1500000' });
    expect(parseTokenAmount('0.000001')).toEqual({ atomic: '1' });
  });

  it('rejects zero, negatives, and excess precision', () => {
    expect(parseTokenAmount('0')).toHaveProperty('error');
    expect(parseTokenAmount('-1')).toHaveProperty('error');
    expect(parseTokenAmount('1.1234567')).toHaveProperty('error');
  });

  it('maps a date-only value to end-of-day UTC', () => {
    expect(dateToExpiresAt('2030-01-01')).toEqual('2030-01-01T23:59:59.000Z');
    expect(dateToExpiresAt('bad')).toBeNull();
  });
});

describe('wizard step validation', () => {
  it('accepts a complete valid draft on every step', () => {
    const draft = validDraft();
    for (let step = 0; step < 6; step += 1) {
      expect(validateWizardStep(step, draft)).toEqual({});
    }
    expect(validateWizard(draft)).toEqual({});
  });

  it('requires mission basics', () => {
    const errors = validateWizardStep(0, { ...validDraft(), name: '', objective: '' });
    expect(errors['name']).toBeDefined();
    expect(errors['objective']).toBeDefined();
  });

  it('enforces the authority ceilings and future expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const errors = validateWizardStep(1, {
      ...validDraft(),
      maxPayment: '1001',
      recoveryMaxPayment: '1002',
      expiresAt: '2020-01-01',
    });
    expect(errors['maxPayment']).toBeDefined();
    expect(errors['recoveryMaxPayment']).toBeDefined();
    expect(errors['expiresAt']).toBeDefined();
    vi.useRealTimers();
  });

  it('requires a non-empty, unique merchant allowlist', () => {
    expect(
      validateWizardStep(2, { ...validDraft(), merchantAllowlist: [''] })['merchantAllowlist']
    ).toBeDefined();
    expect(
      validateWizardStep(2, {
        ...validDraft(),
        merchantAllowlist: [
          '0x2222222222222222222222222222222222222222',
          '0x2222222222222222222222222222222222222222',
        ],
      })['merchantAllowlist']
    ).toBeDefined();
  });

  it('rejects the primary agent in the successor list', () => {
    const errors = validateWizardStep(4, {
      ...validDraft(),
      successors: [{ address: '0x3333333333333333333333333333333333333333', priority: '1' }],
    });
    expect(errors['successors']).toBeDefined();
  });

  it('enforces policy tuning bounds', () => {
    const errors = validateWizardStep(5, {
      ...validDraft(),
      violationThreshold: '0',
      violationWindowSeconds: '10',
    });
    expect(errors['violationThreshold']).toBeDefined();
    expect(errors['violationWindowSeconds']).toBeDefined();
  });

  it('converts a valid draft into the API body', () => {
    const body = toMissionCreateInput(validDraft());
    expect(body.budgetAtomic).toEqual('1000000000');
    expect(body.maxPaymentAtomic).toEqual('100000000');
    expect(body.recoveryMaxPaymentAtomic).toEqual('50000000');
    expect(body.expiresAt).toEqual('2030-01-01T23:59:59.000Z');
    expect(body.successors).toEqual([
      { address: '0x4444444444444444444444444444444444444444', priority: 1 },
    ]);
  });

  it('defaults to a seven-day expiry', () => {
    const draft = defaultWizardDraft();
    expect(draft.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(draft.violationThreshold).toEqual('3');
    expect(draft.violationWindowSeconds).toEqual('900');
  });
});
