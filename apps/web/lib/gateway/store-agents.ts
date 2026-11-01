import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentChallengeRecord,
  AgentRecord,
  AgentStatus,
  AgentStore,
  MissionAgentRecord,
} from './agents';

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row['id']),
    owner_id: String(row['owner_id']),
    name: String(row['name']),
    address: String(row['address']),
    public_key: String(row['public_key']),
    endpoint_url: row['endpoint_url'] === null ? null : String(row['endpoint_url']),
    capabilities: stringArray(row['capabilities']),
    status: String(row['status']),
    last_heartbeat_at: row['last_heartbeat_at']
      ? new Date(row['last_heartbeat_at'] as string).toISOString()
      : null,
    created_at: new Date(row['created_at'] as string).toISOString(),
    updated_at: new Date(row['updated_at'] as string).toISOString(),
  };
}

function asAssignment(row: Record<string, unknown>): MissionAgentRecord {
  return {
    id: String(row['id']),
    mission_id: String(row['mission_id']),
    agent_id: String(row['agent_id']),
    role: String(row['role']) as 'PRIMARY' | 'SUCCESSOR',
    priority: row['priority'] === null ? null : Number(row['priority']),
    required_capabilities: stringArray(row['required_capabilities']),
    status: String(row['status']),
    activated_at: row['activated_at']
      ? new Date(row['activated_at'] as string).toISOString()
      : null,
    revoked_at: row['revoked_at'] ? new Date(row['revoked_at'] as string).toISOString() : null,
  };
}

function asChallenge(row: Record<string, unknown>): AgentChallengeRecord {
  return {
    id: String(row['id']),
    agent_id: String(row['agent_id']),
    challenge: String(row['challenge']),
    expires_at: new Date(row['expires_at'] as string).toISOString(),
    consumed_at: row['consumed_at'] ? new Date(row['consumed_at'] as string).toISOString() : null,
    created_at: new Date(row['created_at'] as string).toISOString(),
  };
}

export function createSupabaseAgentStore(db: SupabaseClient): AgentStore {
  return {
    async getMission(id) {
      const { data, error } = await db
        .from('missions')
        .select('id, owner_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as { id: string; owner_id: string } | null) ?? null;
    },

    async getAgentById(id) {
      const { data, error } = await db.from('agents').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? asAgent(data as Record<string, unknown>) : null;
    },

    async getAgentByAddress(address) {
      const { data, error } = await db
        .from('agents')
        .select('*')
        .eq('address', address)
        .maybeSingle();
      if (error) throw error;
      return data ? asAgent(data as Record<string, unknown>) : null;
    },

    async insertAgent(row) {
      const { data, error } = await db.from('agents').insert(row).select('*').single();
      if (error) throw error;
      return asAgent(data as Record<string, unknown>);
    },

    async updateAgent(id, patch) {
      const update = { ...patch, updated_at: new Date().toISOString() };
      const { data, error } = await db
        .from('agents')
        .update(update)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? asAgent(data as Record<string, unknown>) : null;
    },

    async getAssignment(missionId, agentId) {
      const { data, error } = await db
        .from('mission_agents')
        .select('*')
        .eq('mission_id', missionId)
        .eq('agent_id', agentId)
        .maybeSingle();
      if (error) throw error;
      return data ? asAssignment(data as Record<string, unknown>) : null;
    },

    async countAssignments(missionId, role) {
      const { count, error } = await db
        .from('mission_agents')
        .select('id', { count: 'exact', head: true })
        .eq('mission_id', missionId)
        .eq('role', role);
      if (error) throw error;
      return count ?? 0;
    },

    async insertAssignment(row) {
      const { data, error } = await db.from('mission_agents').insert(row).select('*').single();
      if (error) throw error;
      return asAssignment(data as Record<string, unknown>);
    },

    async updateAssignmentStatus(missionId, agentId, status) {
      const { data, error } = await db
        .from('mission_agents')
        .update({ status })
        .eq('mission_id', missionId)
        .eq('agent_id', agentId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? asAssignment(data as Record<string, unknown>) : null;
    },

    async updateAssignmentsStatusForAgent(agentId, status) {
      const { error } = await db
        .from('mission_agents')
        .update({ status })
        .eq('agent_id', agentId)
        .eq('status', 'PENDING');
      if (error) throw error;
    },

    async hasRegisteredAssignment(agentId) {
      const { data, error } = await db
        .from('mission_agents')
        .select('id')
        .eq('agent_id', agentId)
        .eq('status', 'REGISTERED')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async listAssignmentsForAgent(agentId) {
      const { data, error } = await db.from('mission_agents').select('*').eq('agent_id', agentId);
      if (error) throw error;
      return ((data as Record<string, unknown>[] | null) ?? []).map(asAssignment);
    },

    async insertChallenge(row) {
      const { data, error } = await db.from('agent_challenges').insert(row).select('*').single();
      if (error) throw error;
      return asChallenge(data as Record<string, unknown>);
    },

    async findChallenge(agentId, challenge) {
      const { data, error } = await db
        .from('agent_challenges')
        .select('*')
        .eq('agent_id', agentId)
        .eq('challenge', challenge)
        .maybeSingle();
      if (error) throw error;
      return data ? asChallenge(data as Record<string, unknown>) : null;
    },

    async consumeChallenge(agentId, challenge, consumedAt) {
      const { data, error } = await db
        .from('agent_challenges')
        .update({ consumed_at: consumedAt })
        .eq('agent_id', agentId)
        .eq('challenge', challenge)
        .is('consumed_at', null)
        .gt('expires_at', consumedAt)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? asChallenge(data as Record<string, unknown>) : null;
    },

    async deleteExpiredChallenges(before) {
      const { error } = await db.from('agent_challenges').delete().lt('expires_at', before);
      if (error) throw error;
    },

    async updateHeartbeat(agentId, at) {
      const { data, error } = await db
        .from('agents')
        .update({ last_heartbeat_at: at, updated_at: at })
        .eq('id', agentId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data ? asAgent(data as Record<string, unknown>) : null;
    },
  };
}

export function isAgentStatus(value: string): value is AgentStatus {
  return [
    'PENDING',
    'REGISTERED',
    'ACTIVE_PRIMARY',
    'ACTIVE_SUCCESSOR',
    'QUARANTINED',
    'REVOKED',
  ].includes(value);
}
