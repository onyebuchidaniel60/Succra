// Succra gateway — FR-03 pre-flight policy evaluation (pure).
//
// All nine PROJECT_SPEC.md §5 FR-03 checks, no I/O: same inputs always
// give the same decision. The program re-enforces every check on-chain;
// this courtesy evaluation saves gas and gives fast BLOCK answers. It
// must never override the program: on-chain rejection stays
// authoritative (submit records FAILED).
// NATIVE_MINT is the zero address, which base58-encodes identically to
// the system program id; SOL missions use it, SPL missions use a real mint.
export const NATIVE_MINT_ADDRESS = '11111111111111111111111111111111';

export type BlockReasonCode =
  | 'MISSION_NOT_ACTIVE'
  | 'MISSION_QUARANTINED'
  | 'AGENT_NOT_CURRENT'
  | 'POLICY_BLOCKED'
  | 'REQUEST_EXPIRED'
  | 'STALE_AGENT_NONCE'
  | 'MINT_MISMATCH';

export interface PolicySnapshot {
  maxActionAtomic: bigint | null;
  allowedActionTypes: string[] | null;
  allowedRecipients: string[] | null;
}

export interface ChainPolicyState {
  status: string;
  currentAgent: string;
  remainingBudgetAtomic: bigint;
  agentNonce: bigint;
  expiresAtSec: bigint;
  mintAddress: string;
}

export interface PolicyIntent {
  agentPublicKey: string;
  agentNonce: bigint;
  actionType: 'TRANSFER_SOL' | 'TRANSFER_SPL';
  recipient: string;
  amountAtomic: bigint;
  expiresAtMs: number;
}

export type PolicyDecision =
  { decision: 'ALLOW' } | { decision: 'BLOCK'; reasonCode: BlockReasonCode; reason: string };

/** Human-readable reason per code (BLOCK responses are not stored, so the text is static). */
export function reasonMessage(code: BlockReasonCode): string {
  switch (code) {
    case 'MISSION_NOT_ACTIVE':
      return 'Mission is not active on-chain.';
    case 'MISSION_QUARANTINED':
      return 'Mission is quarantined; no actions may execute.';
    case 'AGENT_NOT_CURRENT':
      return 'Agent is not the current mission agent.';
    case 'POLICY_BLOCKED':
      return 'Action violates mission policy.';
    case 'REQUEST_EXPIRED':
      return 'Action request has expired.';
    case 'STALE_AGENT_NONCE':
      return 'Agent nonce is not greater than the on-chain counter.';
    case 'MINT_MISMATCH':
      return 'Action type does not match the mission mint kind.';
  }
}

export function evaluatePolicy(args: {
  policy: PolicySnapshot;
  chain: ChainPolicyState;
  intent: PolicyIntent;
  nowMs: number;
}): PolicyDecision {
  const { policy, chain, intent, nowMs } = args;
  const block = (reasonCode: BlockReasonCode, detail: string): PolicyDecision => ({
    decision: 'BLOCK',
    reasonCode,
    reason: `${reasonMessage(reasonCode)} ${detail}`.trim(),
  });
  // FR-03 #1: mission is active (no recovery states exist on-chain in Phase 4).
  // A quarantined mission reports its own code so callers can distinguish
  // a frozen mission from a never-activated one.
  if (chain.status === 'Quarantined') {
    return block('MISSION_QUARANTINED', 'On-chain status is Quarantined.');
  }
  if (chain.status !== 'Active') {
    return block('MISSION_NOT_ACTIVE', `On-chain status is ${chain.status}.`);
  }
  // FR-03 #2: agent is the current agent.
  if (intent.agentPublicKey !== chain.currentAgent) {
    return block('AGENT_NOT_CURRENT', 'Signer does not match the on-chain current agent.');
  }
  // FR-03 #3: action type allowed (missing policy row fails closed).
  if (!policy.allowedActionTypes || !policy.allowedActionTypes.includes(intent.actionType)) {
    return block('POLICY_BLOCKED', `Action type ${intent.actionType} is not allowed.`);
  }
  // FR-03 #4: recipient allowlisted (null or empty fails closed).
  if (!policy.allowedRecipients || !policy.allowedRecipients.includes(intent.recipient)) {
    return block('POLICY_BLOCKED', 'Recipient is not allowlisted.');
  }
  // FR-03 #5: amount within per-action max.
  if (policy.maxActionAtomic === null || intent.amountAtomic > policy.maxActionAtomic) {
    return block('POLICY_BLOCKED', 'Amount exceeds the per-action maximum.');
  }
  // FR-03 #6: amount within remaining budget.
  if (intent.amountAtomic > chain.remainingBudgetAtomic) {
    return block('POLICY_BLOCKED', 'Amount exceeds the remaining budget.');
  }
  // FR-03 #7: request not expired.
  if (!(intent.expiresAtMs > nowMs)) {
    return block('REQUEST_EXPIRED', 'The request expiresAt is not in the future.');
  }
  // FR-03 #8: agent nonce strictly greater than the on-chain counter.
  if (!(intent.agentNonce > chain.agentNonce)) {
    return block('STALE_AGENT_NONCE', 'Agent nonce must exceed the on-chain counter.');
  }
  // FR-03 #9: mint kind matches the action type.
  const isNative = chain.mintAddress === NATIVE_MINT_ADDRESS;
  if (intent.actionType === 'TRANSFER_SOL' ? !isNative : isNative) {
    return block('MINT_MISMATCH', 'Action type does not match the mission mint kind.');
  }
  return { decision: 'ALLOW' };
}
