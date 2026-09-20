// Succra gateway — FR-04 violation streak evaluation (pure).
//
// Amended streak semantics (PROJECT_SPEC.md §5 FR-04):
//   (a) any CONFIRMED action resets the consecutive counter to zero;
//   (b) any violation older than violation_window_seconds drops out;
//   streak = number of policy-blocked actions within the window since
//   the most recent CONFIRMED action (or since activation, implied:
//   no rows predate activation).
//
// Counting rules (§6): only rows that are authenticated, signed by the
// current agent, and rejected by a mission policy rule count. In
// storage terms that is exactly:
//   decision = BLOCKED AND decision_reason_code = POLICY_BLOCKED.
// Anything else the gateway stores — AGENT_NOT_CURRENT,
// MISSION_NOT_ACTIVE, REQUEST_EXPIRED, STALE_AGENT_NONCE, MINT_MISMATCH —
// is agent liveness, chain state, or wrong-signer traffic, not a policy
// violation. Chain rejections, idempotency duplicates, and tamper
// attempts never write such rows, so they can never count.
export const COUNTED_REASON_CODE = 'POLICY_BLOCKED';

export interface StreakInput {
  /** Policy-blocked rows newer than the window start (already filtered). */
  blockedSinceReset: number;
  /** Consecutive-violation trigger for this mission. */
  threshold: number;
}

export interface StreakResult {
  /** blockedSinceReset + 1 (the row being recorded). */
  streakAfter: number;
  /** True only on the crossing edge: fires quarantine exactly once. */
  crossed: boolean;
}

/** Pure edge-trigger: fires only when this violation reaches threshold. */
export function evaluateStreak(input: StreakInput): StreakResult {
  const streakAfter = input.blockedSinceReset + 1;
  return {
    streakAfter,
    crossed: input.blockedSinceReset < input.threshold && streakAfter >= input.threshold,
  };
}

/**
 * Window start for the streak query: violations at or before this
 * timestamp do not count. The reset marker (last CONFIRMED time) wins
 * over the rolling window; without a CONFIRMED action the window alone
 * bounds the streak.
 */
export function streakWindowStartMs(args: {
  nowMs: number;
  windowSeconds: bigint;
  lastConfirmedAtMs: number | null;
}): number {
  const windowStart = args.nowMs - Number(args.windowSeconds) * 1000;
  if (args.lastConfirmedAtMs === null) {
    return windowStart;
  }
  return Math.max(args.lastConfirmedAtMs, windowStart);
}
