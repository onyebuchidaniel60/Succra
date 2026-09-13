// Unit tests: mission draft schema (validation, FR-01 rules, owner strip).
import { describe, expect, it } from 'vitest';
import { MISSION_CREATE_SCHEMA } from '../lib/missions';

const SYSTEM_PROGRAM = '11111111111111111111111111111111';
// Format-valid fixture address (token program id — used only for shape,
// not as a real agent).
const AGENT = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function validBody(): Record<string, unknown> {
  return {
    name: 'Treasury run',
    objective: 'Pay vendors weekly',
    mintAddress: SYSTEM_PROGRAM,
    budgetAtomic: '50000000',
    maxActionAtomic: '5000000',
    recoveryMaxActionAtomic: '1000000',
    allowedActionTypes: ['TRANSFER_SOL'],
    allowedRecipients: [AGENT],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    currentAgentPublicKey: AGENT,
  };
}

describe('MISSION_CREATE_SCHEMA', () => {
  it('accepts a valid draft body', () => {
    expect(MISSION_CREATE_SCHEMA.safeParse(validBody()).success).toEqual(true);
  });

  it('strips a smuggled owner_id instead of accepting it', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), owner_id: 'attacker' });
    expect(parsed.success).toEqual(true);
    if (parsed.success) {
      expect('owner_id' in parsed.data).toEqual(false);
    }
  });

  it('rejects maxAction above budget (FR-01)', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), maxActionAtomic: '50000001' });
    expect(parsed.success).toEqual(false);
  });

  it('rejects recoveryMax above primary max (FR-01)', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({
      ...validBody(),
      recoveryMaxActionAtomic: '5000001',
    });
    expect(parsed.success).toEqual(false);
  });

  it('rejects empty action types (FR-01)', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), allowedActionTypes: [] });
    expect(parsed.success).toEqual(false);
  });

  it('rejects unknown action types', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({
      ...validBody(),
      allowedActionTypes: ['SWAP'],
    });
    expect(parsed.success).toEqual(false);
  });

  it('rejects past expiry (FR-01)', () => {
    const parsed = MISSION_CREATE_SCHEMA.safeParse({
      ...validBody(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(parsed.success).toEqual(false);
  });

  it('rejects malformed addresses and amounts', () => {
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), mintAddress: 'not-an-address' }).success
    ).toEqual(false);
    expect(
      MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), budgetAtomic: '10.5' }).success
    ).toEqual(false);
    expect(MISSION_CREATE_SCHEMA.safeParse({ ...validBody(), budgetAtomic: '0' }).success).toEqual(
      false
    );
  });
});
