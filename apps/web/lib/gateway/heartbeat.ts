// Succra gateway — heartbeat (POST /api/agents/:id/heartbeat).
//
// Records last_heartbeat_at with a fixed 30s minimum interval (named
// constant per amended §10, not an env var). Faster heartbeats are
// rejected with 429 HEARTBEAT_TOO_SOON. Heartbeat never triggers
// quarantine and never touches violation counters (Phase 5).
import type { AgentRow, GatewayStore } from './store';

/** Minimum interval between accepted heartbeats (amended §10: 30s). */
export const HEARTBEAT_MIN_INTERVAL_MS = 30_000;

export type HeartbeatOutcome =
  { kind: 'recorded'; agent: AgentRow } | { kind: 'rate-limited'; retryAfterMs: number };

export async function recordHeartbeat(args: {
  store: GatewayStore;
  agent: AgentRow;
  nowMs: number;
}): Promise<HeartbeatOutcome> {
  const { store, agent, nowMs } = args;
  if (agent.last_heartbeat_at) {
    const elapsed = nowMs - Date.parse(agent.last_heartbeat_at);
    if (Number.isFinite(elapsed) && elapsed < HEARTBEAT_MIN_INTERVAL_MS) {
      return { kind: 'rate-limited', retryAfterMs: HEARTBEAT_MIN_INTERVAL_MS - elapsed };
    }
  }
  const updated = await store.updateAgentHeartbeat(agent.id, new Date(nowMs).toISOString());
  if (!updated) {
    throw new Error('Heartbeat update missed its agent row.');
  }
  return { kind: 'recorded', agent: updated };
}
