import { describe, expect, it } from 'vitest';
import { requestIdToBytes32 } from '@succra/shared';
import { evaluateHspPaymentPolicy, type HspPolicyInput } from '../lib/gateway/policy-hsp';

const AGENT = `0x${'22'.repeat(20)}`;
const MERCHANT = `0x${'33'.repeat(20)}`;
const TOKEN = `0x${'44'.repeat(20)}`;
const OTHER = `0x${'55'.repeat(20)}`;
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function baseInput(
  overrides: {
    mission?: Partial<HspPolicyInput['missionOnChain']>;
    mirror?: Partial<HspPolicyInput['missionMirror']>;
    request?: Partial<HspPolicyInput['request']>;
    payload?: Partial<HspPolicyInput['request']['payload']>;
    seenRequestIds?: Set<string>;
    seenIdempotencyKeys?: Set<string>;
  } = {}
): HspPolicyInput {
  return {
    missionOnChain: {
      currentAgent: AGENT,
      status: 'ACTIVE',
      agentNonce: 4n,
      confirmedSpentAtomic: 0n,
      paymentToken: TOKEN,
      budgetAtomic: 1000n,
      maxPaymentAtomic: 400n,
      recoveryMaxPaymentAtomic: 100n,
      expiresAt: 2000n,
      allowedMerchants: new Set([MERCHANT]),
      ...overrides.mission,
    },
    missionMirror: { remainingBudgetAtomic: 1000n, ...overrides.mirror },
    request: {
      requestId: REQUEST_ID,
      idempotencyKey: 'idem-1',
      agentNonce: 5n,
      actionType: 'HSP_PAYMENT',
      payload: {
        merchant: MERCHANT,
        token: TOKEN,
        amountAtomic: 100n,
        expiresAt: 1500n,
        ...overrides.payload,
      },
      submittedAt: 1000n,
      ...overrides.request,
    },
    seenRequestIds: overrides.seenRequestIds ?? new Set(),
    seenIdempotencyKeys: overrides.seenIdempotencyKeys ?? new Set(),
  };
}

describe('HSP payment policy evaluator', () => {
  it('allows a valid ACTIVE payment', () => {
    const result = evaluateHspPaymentPolicy(baseInput());
    expect(result.decision).toEqual('ALLOW');
    if (result.decision === 'ALLOW') {
      expect(result.mandatePayload.onchainRequestId).toEqual(requestIdToBytes32(REQUEST_ID));
      expect(result.mandatePayload.amountAtomic).toEqual(100n);
    }
  });

  it('allows ACTIVE_RECOVERY within the recovery ceiling', () => {
    const result = evaluateHspPaymentPolicy(
      baseInput({ mission: { status: 'ACTIVE_RECOVERY' }, payload: { amountAtomic: 100n } })
    );
    expect(result.decision).toEqual('ALLOW');
  });

  it('blocks each policy reason in order', () => {
    expect(evaluateHspPaymentPolicy(baseInput({ mission: { status: 'QUARANTINED' } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'MISSION_NOT_ACTIVE',
    });
    expect(
      evaluateHspPaymentPolicy(baseInput({ request: { actionType: 'TRANSFER_SOL' } }))
    ).toEqual({ decision: 'BLOCK', reasonCode: 'INVALID_ACTION_TYPE' });
    expect(evaluateHspPaymentPolicy(baseInput({ request: { agentNonce: 4n } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'STALE_NONCE',
    });
    expect(evaluateHspPaymentPolicy(baseInput({ mission: { expiresAt: 999n } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'MISSION_EXPIRED',
    });
    expect(evaluateHspPaymentPolicy(baseInput({ payload: { expiresAt: 999n } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'REQUEST_EXPIRED',
    });
    expect(
      evaluateHspPaymentPolicy(
        baseInput({ seenRequestIds: new Set([requestIdToBytes32(REQUEST_ID)]) })
      )
    ).toEqual({ decision: 'BLOCK', reasonCode: 'DUPLICATE_REQUEST' });
    expect(
      evaluateHspPaymentPolicy(baseInput({ seenIdempotencyKeys: new Set(['idem-1']) }))
    ).toEqual({ decision: 'BLOCK', reasonCode: 'DUPLICATE_REQUEST' });
    expect(evaluateHspPaymentPolicy(baseInput({ payload: { merchant: OTHER } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'MERCHANT_NOT_ALLOWED',
    });
    expect(evaluateHspPaymentPolicy(baseInput({ payload: { token: OTHER } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'TOKEN_NOT_ALLOWED',
    });
    expect(evaluateHspPaymentPolicy(baseInput({ payload: { amountAtomic: 401n } }))).toEqual({
      decision: 'BLOCK',
      reasonCode: 'AMOUNT_EXCEEDS_MAX',
    });
    expect(
      evaluateHspPaymentPolicy(
        baseInput({ mission: { status: 'ACTIVE_RECOVERY' }, payload: { amountAtomic: 101n } })
      )
    ).toEqual({ decision: 'BLOCK', reasonCode: 'AMOUNT_EXCEEDS_MAX' });
  });

  it('keeps the degenerate check-11 path valid while confirmedSpentAtomic is zero', () => {
    const result = evaluateHspPaymentPolicy(
      baseInput({
        mission: { maxPaymentAtomic: 1000n },
        payload: { amountAtomic: 1000n },
      })
    );
    expect(result.decision).toEqual('ALLOW');
  });

  it('blocks an amount above the budget in the degenerate zero-spent case', () => {
    const result = evaluateHspPaymentPolicy(
      baseInput({
        mission: { maxPaymentAtomic: 2000n },
        payload: { amountAtomic: 1001n },
      })
    );
    expect(result).toEqual({ decision: 'BLOCK', reasonCode: 'BUDGET_EXHAUSTED' });
  });

  it('blocks on a stale mirror budget even when on-chain checks pass', () => {
    const result = evaluateHspPaymentPolicy(baseInput({ mirror: { remainingBudgetAtomic: 50n } }));
    expect(result).toEqual({ decision: 'BLOCK', reasonCode: 'BUDGET_EXHAUSTED' });
  });

  it('blocks a second payment once confirmed spend exhausts the budget', () => {
    // A 900-atomic settlement is already confirmed. The next 200-atomic
    // payment is individually within maxPaymentAtomic (400) but would push
    // confirmed spend past the 1000-atomic envelope.
    const result = evaluateHspPaymentPolicy(
      baseInput({
        mission: { confirmedSpentAtomic: 900n },
        mirror: { remainingBudgetAtomic: 100n },
        payload: { amountAtomic: 200n },
      })
    );
    expect(result).toEqual({ decision: 'BLOCK', reasonCode: 'BUDGET_EXHAUSTED' });
  });

  it('allows a second payment while confirmed spend leaves room', () => {
    const result = evaluateHspPaymentPolicy(
      baseInput({
        mission: { confirmedSpentAtomic: 500n },
        mirror: { remainingBudgetAtomic: 500n },
        payload: { amountAtomic: 400n },
      })
    );
    expect(result.decision).toEqual('ALLOW');
  });
});
