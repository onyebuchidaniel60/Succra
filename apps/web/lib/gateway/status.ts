// Succra gateway — agent status view (GET /api/agents/:id/status).
import type { AgentRow, GatewayStore } from './store';

export interface AgentStatusView {
  agentId: string;
  publicKey: string;
  status: string;
  lastHeartbeatAt: string | null;
  missions: Array<{ missionId: string; role: string }>;
}

/** Owner-or-agent authorized status snapshot (amended §10 envelope). */
export async function agentStatusView(args: {
  store: GatewayStore;
  agent: AgentRow;
}): Promise<AgentStatusView> {
  const assignments = await args.store.listAssignmentsForAgent(args.agent.id);
  return {
    agentId: args.agent.id,
    publicKey: args.agent.public_key,
    status: args.agent.status,
    lastHeartbeatAt: args.agent.last_heartbeat_at,
    missions: assignments.map((row) => ({
      missionId: row.mission_id,
      role: row.role ?? 'PRIMARY',
    })),
  };
}
