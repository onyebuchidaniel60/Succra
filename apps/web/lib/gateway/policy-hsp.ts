import { requestIdToBytes32 } from '@succra/shared';

export type HspMissionStatus =
  | 'ACTIVE'
  | 'ACTIVE_RECOVERY'
  | 'DRAFT'
  | 'DEGRADED'
  | 'QUARANTINED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'HALTED';

export interface HspPolicyInput {
  missionOnChain: {
    currentAgent: string;
    status: HspMissionStatus | string;
    agentNonce: bigint;
    confirmedSpentAtomic: bigint;
    paymentToken: string;
    budgetAtomic: bigint;
    maxPaymentAtomic: bigint;
    recoveryMaxPaymentAtomic: bigint;
    expiresAt: bigint;
    allowedMerchants: Set<string>;
  };
  missionMirror: {
    remainingBudgetAtomic: bigint;
  };
  request: {
    requestId: string;
    idempotencyKey: string;
    agentNonce: bigint;
    actionType: string;
    payload: {
      merchant: string;
      token: string;
      amountAtomic: bigint;
      expiresAt: bigint;
      paymentReference?: string;
    };
    submittedAt: bigint;
  };
  seenRequestIds: Set<string>;
  seenIdempotencyKeys: Set<string>;
}

export type HspPolicyReasonCode =
  | 'MISSION_NOT_ACTIVE'
  | 'INVALID_ACTION_TYPE'
  | 'STALE_NONCE'
  | 'MISSION_EXPIRED'
  | 'REQUEST_EXPIRED'
  | 'DUPLICATE_REQUEST'
  | 'MERCHANT_NOT_ALLOWED'
  | 'TOKEN_NOT_ALLOWED'
  | 'AMOUNT_EXCEEDS_MAX'
  | 'BUDGET_EXHAUSTED';

export interface HspMandatePayload {
  requestId: string;
  onchainRequestId: string;
  idempotencyKey: string;
  agentNonce: bigint;
  merchant: string;
  token: string;
  amountAtomic: bigint;
  expiresAt: bigint;
  paymentReference?: string;
}

export type HspPolicyDecision =
  | { decision: 'ALLOW'; mandatePayload: HspMandatePayload }
  | { decision: 'BLOCK'; reasonCode: HspPolicyReasonCode };

const ACTIVE_STATUSES = new Set(['ACTIVE', 'ACTIVE_RECOVERY']);

/**
 * Deterministic off-chain mirror of the Phase 1 SuccraMission policy.
 * It does not call HSP and does not move funds.
 *
 * The running-budget branch is exercised in policy-hsp.test.ts with a
 * non-zero confirmedSpentAtomic (Phase 3).
 */
export function evaluateHspPaymentPolicy(input: HspPolicyInput): HspPolicyDecision {
  const { missionOnChain, missionMirror, request } = input;
  const now = request.submittedAt;
  const onchainRequestId = requestIdToBytes32(request.requestId);

  if (!ACTIVE_STATUSES.has(missionOnChain.status)) {
    return { decision: 'BLOCK', reasonCode: 'MISSION_NOT_ACTIVE' };
  }
  if (request.actionType !== 'HSP_PAYMENT') {
    return { decision: 'BLOCK', reasonCode: 'INVALID_ACTION_TYPE' };
  }
  if (request.agentNonce <= missionOnChain.agentNonce) {
    return { decision: 'BLOCK', reasonCode: 'STALE_NONCE' };
  }
  if (now >= missionOnChain.expiresAt) {
    return { decision: 'BLOCK', reasonCode: 'MISSION_EXPIRED' };
  }
  if (now >= request.payload.expiresAt) {
    return { decision: 'BLOCK', reasonCode: 'REQUEST_EXPIRED' };
  }
  if (input.seenRequestIds.has(onchainRequestId)) {
    return { decision: 'BLOCK', reasonCode: 'DUPLICATE_REQUEST' };
  }
  if (input.seenIdempotencyKeys.has(request.idempotencyKey)) {
    return { decision: 'BLOCK', reasonCode: 'DUPLICATE_REQUEST' };
  }
  if (!missionOnChain.allowedMerchants.has(request.payload.merchant.toLowerCase())) {
    return { decision: 'BLOCK', reasonCode: 'MERCHANT_NOT_ALLOWED' };
  }
  if (request.payload.token.toLowerCase() !== missionOnChain.paymentToken.toLowerCase()) {
    return { decision: 'BLOCK', reasonCode: 'TOKEN_NOT_ALLOWED' };
  }

  const ceiling =
    missionOnChain.status === 'ACTIVE'
      ? missionOnChain.maxPaymentAtomic
      : missionOnChain.recoveryMaxPaymentAtomic;
  if (request.payload.amountAtomic > ceiling) {
    return { decision: 'BLOCK', reasonCode: 'AMOUNT_EXCEEDS_MAX' };
  }
  if (
    missionOnChain.confirmedSpentAtomic + request.payload.amountAtomic >
    missionOnChain.budgetAtomic
  ) {
    return { decision: 'BLOCK', reasonCode: 'BUDGET_EXHAUSTED' };
  }
  if (missionMirror.remainingBudgetAtomic < request.payload.amountAtomic) {
    return { decision: 'BLOCK', reasonCode: 'BUDGET_EXHAUSTED' };
  }

  const mandatePayload: HspMandatePayload = {
    requestId: request.requestId,
    onchainRequestId,
    idempotencyKey: request.idempotencyKey,
    agentNonce: request.agentNonce,
    merchant: request.payload.merchant,
    token: request.payload.token,
    amountAtomic: request.payload.amountAtomic,
    expiresAt: request.payload.expiresAt,
  };
  if (request.payload.paymentReference !== undefined) {
    mandatePayload.paymentReference = request.payload.paymentReference;
  }
  return { decision: 'ALLOW', mandatePayload };
}

export const HSP_POLICY_REASON_MESSAGES: Record<HspPolicyReasonCode, string> = {
  MISSION_NOT_ACTIVE: 'Mission is not currently executable.',
  INVALID_ACTION_TYPE: 'Only HSP_PAYMENT is supported.',
  STALE_NONCE: 'The requested agent nonce is not greater than the on-chain nonce.',
  MISSION_EXPIRED: 'The mission has expired.',
  REQUEST_EXPIRED: 'The payment request has expired.',
  DUPLICATE_REQUEST: 'This request has already been seen.',
  MERCHANT_NOT_ALLOWED: 'The merchant is not in the mission allowlist.',
  TOKEN_NOT_ALLOWED: 'The payment token does not match the mission token.',
  AMOUNT_EXCEEDS_MAX: 'The amount exceeds the current per-payment ceiling.',
  BUDGET_EXHAUSTED: 'The amount exceeds the remaining mission budget envelope.',
};
