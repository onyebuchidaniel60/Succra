// FR-03 pre-flight evaluation tests: all nine checks + ALLOW (pure, no DB/chain).
import { describe, expect, it } from 'vitest';
import {
  evaluatePolicy,
  type ChainPolicyState,
  type PolicyIntent,
  type PolicySnapshot,
} from '../lib/gateway/policy';

const POLICY: PolicySnapshot = {
  maxActionAtomic: 5_000_000n,
  allowedActionTypes: ['TRANSFER_SOL'],
  allowedRecipients: ['R1'],
};

const CHAIN: ChainPolicyState = {
  status: 'Active',
  currentAgent: 'A1',
  remainingBudgetAtomic: 50_000_000n,
  agentNonce: 7n,
  expiresAtSec: 9_999_999_999n,
  mintAddress: '11111111111111111111111111111111',
};

const INTENT: PolicyIntent = {
  agentPublicKey: 'A1',
  agentNonce: 8n,
  actionType: 'TRANSFER_SOL',
  recipient: 'R1',
  amountAtomic: 1_000_000n,
  expiresAtMs: Date.now() + 3600_000,
};

describe('FR-03 policy evaluation', () => {
  it('allows a fully valid action', () => {
    expect(
      evaluatePolicy({ policy: POLICY, chain: CHAIN, intent: INTENT, nowMs: Date.now() })
    ).toEqual({
      decision: 'ALLOW',
    });
  });

  it('blocks #1 non-active missions', () => {
    for (const status of ['Draft', 'Cancelled']) {
      const result = evaluatePolicy({
        policy: POLICY,
        chain: { ...CHAIN, status },
        intent: INTENT,
        nowMs: Date.now(),
      });
      expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'MISSION_NOT_ACTIVE' });
    }
  });

  it('blocks quarantined missions with MISSION_QUARANTINED', () => {
    const result = evaluatePolicy({
      policy: POLICY,
      chain: { ...CHAIN, status: 'Quarantined' },
      intent: INTENT,
      nowMs: Date.now(),
    });
    expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'MISSION_QUARANTINED' });
  });

  it('blocks #2 non-current agents', () => {
    const result = evaluatePolicy({
      policy: POLICY,
      chain: CHAIN,
      intent: { ...INTENT, agentPublicKey: 'OTHER' },
      nowMs: Date.now(),
    });
    expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'AGENT_NOT_CURRENT' });
  });

  it('blocks #3 disallowed action types (and missing policy)', () => {
    const type = evaluatePolicy({
      policy: POLICY,
      chain: CHAIN,
      intent: { ...INTENT, actionType: 'TRANSFER_SPL' },
      nowMs: Date.now(),
    });
    expect(type).toMatchObject({ decision: 'BLOCK', reasonCode: 'POLICY_BLOCKED' });
    const missing = evaluatePolicy({
      policy: { maxActionAtomic: null, allowedActionTypes: null, allowedRecipients: null },
      chain: CHAIN,
      intent: INTENT,
      nowMs: Date.now(),
    });
    expect(missing).toMatchObject({ decision: 'BLOCK', reasonCode: 'POLICY_BLOCKED' });
  });

  it('blocks #4 non-allowlisted recipients (null and empty fail closed)', () => {
    const other = evaluatePolicy({
      policy: POLICY,
      chain: CHAIN,
      intent: { ...INTENT, recipient: 'EVIL' },
      nowMs: Date.now(),
    });
    expect(other).toMatchObject({ decision: 'BLOCK', reasonCode: 'POLICY_BLOCKED' });
    for (const allowedRecipients of [null, [] as string[]] as const) {
      const result = evaluatePolicy({
        policy: { ...POLICY, allowedRecipients },
        chain: CHAIN,
        intent: INTENT,
        nowMs: Date.now(),
      });
      expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'POLICY_BLOCKED' });
    }
  });

  it('blocks #5 amounts above max and #6 amounts above remaining', () => {
    const overMax = evaluatePolicy({
      policy: POLICY,
      chain: CHAIN,
      intent: { ...INTENT, amountAtomic: 5_000_001n },
      nowMs: Date.now(),
    });
    expect(overMax).toMatchObject({ decision: 'BLOCK', reasonCode: 'POLICY_BLOCKED' });
    const overRemaining = evaluatePolicy({
      policy: { ...POLICY, maxActionAtomic: 100_000_000n },
      chain: { ...CHAIN, remainingBudgetAtomic: 999n },
      intent: { ...INTENT, amountAtomic: 1000n },
      nowMs: Date.now(),
    });
    expect(overRemaining).toMatchObject({ decision: 'BLOCK', reasonCode: 'POLICY_BLOCKED' });
  });

  it('blocks #7 expired requests', () => {
    const result = evaluatePolicy({
      policy: POLICY,
      chain: CHAIN,
      intent: { ...INTENT, expiresAtMs: Date.now() - 1000 },
      nowMs: Date.now(),
    });
    expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'REQUEST_EXPIRED' });
  });

  it('blocks #8 stale or reused agent nonces (equal or lower)', () => {
    for (const agentNonce of [7n, 3n, 0n]) {
      const result = evaluatePolicy({
        policy: POLICY,
        chain: CHAIN,
        intent: { ...INTENT, agentNonce },
        nowMs: Date.now(),
      });
      expect(result).toMatchObject({ decision: 'BLOCK', reasonCode: 'STALE_AGENT_NONCE' });
    }
  });

  it('blocks #9 mint-kind mismatches both ways', () => {
    const splOnNative = evaluatePolicy({
      policy: POLICY,
      chain: CHAIN,
      intent: { ...INTENT, actionType: 'TRANSFER_SPL' },
      nowMs: Date.now(),
    });
    expect(splOnNative.decision).toEqual('BLOCK');
    const solOnSpl = evaluatePolicy({
      policy: POLICY,
      chain: { ...CHAIN, mintAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      intent: INTENT,
      nowMs: Date.now(),
    });
    expect(solOnSpl).toMatchObject({ decision: 'BLOCK', reasonCode: 'MINT_MISMATCH' });
    const splOnSpl = evaluatePolicy({
      policy: { ...POLICY, allowedActionTypes: ['TRANSFER_SPL'] },
      chain: { ...CHAIN, mintAddress: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      intent: { ...INTENT, actionType: 'TRANSFER_SPL' },
      nowMs: Date.now(),
    });
    expect(splOnSpl).toEqual({ decision: 'ALLOW' });
  });

  it('exposes static human reasons per code', () => {
    const result = evaluatePolicy({
      policy: POLICY,
      chain: { ...CHAIN, status: 'Draft' },
      intent: INTENT,
      nowMs: Date.now(),
    });
    expect(result.decision).toEqual('BLOCK');
    if (result.decision === 'BLOCK') {
      expect(typeof result.reason).toEqual('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
