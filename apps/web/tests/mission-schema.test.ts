// Unit tests: mission creation schema (FR-01 policy rules, owner strip).
import { describe, expect, it } from 'vitest';
import { MISSION_CREATE_SCHEMA } from '../lib/missions';

const TOKEN = '0x1111111111111111111111111111111111111111';
const MERCHANT = '0x2222222222222222222222222222222222222222';
const PRIMARY = '0x3333333333333333333333333333333333333333';
const SUCCESSOR = '0x4444444444444444444444444444444444444444';

function validBody(): Record<string, unknown> {
  return {
    name: 'Treasury run',
    objective: 'Pay vendors weekly',
    paymentTokenAddress: TOKEN,
    budgetAtomic: '50000000',
    maxPaymentAtomic: '5000000',
    recoveryMaxPaymentAtomic: '1000000',
    merchantAllowlist: [MERCHANT],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    primaryAgentAddress: PRIMARY,
    successors: [{ address: SUCCESSOR, priority: 1 }],
    violationThreshold: 3,
    violationWindowSeconds: 900,
  };
}

describe('MISSION_CREATE_SCHEMA', () => {
  it('accepts a valid mission body', () => {
    expect(MISSION_CREATE_SCHEMA.safeParse(validBody()).success).toEqual(true);
  });

  it('strips a smuggled owner_id instead of accepting it', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), owner_id: 'attacker' });
    expect(parsed.success).toEqual(true);
    if (parsed.success) {
      expect('owner_id' in parsed.data).toEqual(false);
    }
  });

  it('normalizes addresses to lowercase', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({
      ...validBody(),
      paymentTokenAddress: TOKEN.toUpperCase().replace('0X', '0x'),
    });
    expect(parsed.success).toEqual(true);
    if (parsed.success) expect(parsed.data.paymentTokenAddress).toEqual(TOKEN);
  });

  it('rejects maxPayment above budget (FR-01)', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), maxPaymentAtomic: '50000001' }).success
    ).toEqual(false);
  });

  it('rejects recoveryMax above primary max (FR-01)', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({
        ...validBody(),
        recoveryMaxPaymentAtomic: '5000001',
      }).success
    ).toEqual(false);
  });

  it('rejects an empty or duplicate merchant allowlist', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), merchantAllowlist: [] }).success
    ).toEqual(false);
    expect(
      MISSION_CREATE_SCHEMA.safeParse({
        ...validBody(),
        merchantAllowlist: [MERCHANT, MERCHANT],
      }).success
    ).toEqual(false);
  });

  it('rejects a primary agent that is also a successor', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({
        ...validBody(),
        successors: [{ address: PRIMARY, priority: 1 }],
      }).success
    ).toEqual(false);
  });

  it('rejects duplicate successors and more than eight successors', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({
        ...validBody(),
        successors: [
          { address: SUCCESSOR, priority: 1 },
          { address: SUCCESSOR, priority: 2 },
        ],
      }).success
    ).toEqual(false);

    const nine = Array.from({ length: 9 }, (_, index) => ({
      address: `0x${String(index + 1).padStart(40, '0')}`,
      priority: index + 1,
    }));
    expect(MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), successors: nine }).success).toEqual(
      false
    );
  });

  it('rejects out-of-bounds violation settings', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), violationThreshold: 0 }).success
    ).toEqual(false);
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), violationThreshold: 11 }).success
    ).toEqual(false);
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), violationWindowSeconds: 59 }).success
    ).toEqual(false);
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), violationWindowSeconds: 86_401 }).success
    ).toEqual(false);
  });

  it('rejects past expiry', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({
        ...validBody(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }).success
    ).toEqual(false);
  });

  it('rejects malformed addresses and amounts', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), paymentTokenAddress: 'not-an-address' })
        .success
    ).toEqual(false);
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), budgetAtomic: '10.5' }).success
    ).toEqual(false);
    expect(MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), budgetAtomic: '0' }).success).toEqual(
      false
    );
  });
});
