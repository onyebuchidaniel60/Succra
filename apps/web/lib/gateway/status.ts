// Succra gateway — agent status view (GET /api/agents/:id/status).
import type { AgentRow } from './store';

export interface AgentStatusView {
  agentId: string;
  publicKey: string;
  address: string;
  name: string;
  capabilities: string[];
  status: string;
  lastHeartbeatAt: string | null;
  missions: Array<{ missionId: string; role: string }>;
}

export interface AgentStatusStore {
  listAssignmentsForAgent(
    agentId: string
  ): Promise<Array<{ mission_id: string; role: string | null }>>;
}

/** Owner-or-agent authorized status snapshot (amended §10 envelope). */
export async function agentStatusView(args: {
  store: AgentStatusStore;
  agent: AgentRow;
}): Promise<AgentStatusView> {
  const assignments = await args.store.listAssignmentsForAgent(args.agent.id);
  const rich = args.agent as AgentRow & {
    address?: string | null;
    name?: string | null;
    capabilities?: unknown;
  };
  const capabilities = Array.isArray(rich.capabilities)
    ? rich.capabilities.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    agentId: args.agent.id,
    publicKey: args.agent.public_key,
    address: rich.address ?? args.agent.public_key,
    name: rich.name ?? 'Agent',
    capabilities,
    status: args.agent.status,
    lastHeartbeatAt: args.agent.last_heartbeat_at,
    missions: assignments.map((row) => ({
      missionId: row.mission_id,
      role: row.role ?? 'PRIMARY',
    })),
  };
}
