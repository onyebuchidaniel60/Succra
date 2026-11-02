// Succra web — mission creation persistence seam.
//
// Production uses the server-only Supabase client. Tests use a PGlite-backed
// adapter over the real migrations. Keeping the seam explicit makes the
// finalize compare-and-set and agent attachment testable without a network.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MissionDraftRow {
  id: string;
  owner_id: string;
  owner_address: string;
  name: string;
  objective: string;
  status: string;
  contract_address: string;
  factory_address: string;
  payment_token_address: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  current_agent_id: string | null;
  current_agent_address: string;
  policy_version: number;
  policy_hash: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface MissionPolicyRow {
  mission_id: string;
  version: number;
  policy_json: unknown;
  policy_hash: string;
}

export interface NewMissionDraftRow {
  id: string;
  owner_id: string;
  name: string;
  objective: string;
  pda_address: string;
  vault_address: string;
  mint_address: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  status: 'DRAFT';
  current_agent_id: null;
  current_agent_public_key: string;
  contract_address: string;
  factory_address: string;
  owner_address: string;
  payment_token_address: string;
  current_agent_address: string;
  policy_version: 1;
  policy_hash: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface NewMissionPolicyRow {
  mission_id: string;
  version: 1;
  max_action_atomic: string;
  recovery_max_action_atomic: string;
  allowed_action_types: string[];
  allowed_recipients: readonly string[];
  violation_threshold: number;
  violation_window_seconds: number;
  policy_json: unknown;
  policy_hash: string;
}

export interface AgentSummary {
  id: string;
  owner_id: string;
  status: string;
}

export interface ActiveMissionPatch {
  status: 'ACTIVE';
  contract_address: string;
  pda_address: string;
  factory_address: string;
  owner_address: string;
  payment_token_address: string;
  current_agent_address: string;
  current_agent_id: string;
  current_agent_public_key: string;
  policy_hash: string;
  updated_at: string;
}

export interface MissionSummary {
  status: string;
  contract_address: string;
  policy_hash: string;
}

export interface MissionAuditRow {
  mission_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  event_hash: string;
  payload_public: Record<string, unknown>;
  onchain_tx_hash: string;
  created_at: string;
}

export interface MissionAuditRecord {
  id: string;
  payload_public: unknown;
}

export interface MissionCreationStore {
  insertDraft(row: NewMissionDraftRow): Promise<void>;
  insertPolicy(row: NewMissionPolicyRow): Promise<void>;
  deleteDraft(missionId: string, ownerId: string): Promise<void>;
  getDraft(missionId: string, ownerId: string): Promise<MissionDraftRow | null>;
  getPolicy(missionId: string, version: number): Promise<MissionPolicyRow | null>;
  activateMission(missionId: string, ownerId: string, patch: ActiveMissionPatch): Promise<boolean>;
  getMissionSummary(missionId: string, ownerId: string): Promise<MissionSummary | null>;
  getAgentByAddress(address: string): Promise<AgentSummary | null>;
  insertAgent(row: {
    owner_id: string;
    name: string;
    address: string;
    public_key: string;
    endpoint_url: null;
    capabilities: string[];
    status: 'PENDING';
  }): Promise<AgentSummary>;
  getAssignment(missionId: string, agentId: string): Promise<{ id: string } | null>;
  insertAssignment(row: {
    mission_id: string;
    agent_id: string;
    role: 'PRIMARY' | 'SUCCESSOR';
    priority: number | null;
    required_capabilities: string[];
    status: 'REGISTERED' | 'PENDING';
  }): Promise<void>;
  insertAudit(row: MissionAuditRow): Promise<void>;
  getMissionCreatedAudit(missionId: string): Promise<MissionAuditRecord | null>;
  updateAuditPayload(id: string, payload: Record<string, unknown>): Promise<void>;
}

const DRAFT_COLUMNS =
  'id,owner_id,owner_address,name,objective,status,contract_address,factory_address,' +
  'payment_token_address,budget_atomic,remaining_budget_atomic,current_agent_id,' +
  'current_agent_address,policy_version,policy_hash,expires_at,created_at,updated_at';

export function createSupabaseMissionCreationStore(db: SupabaseClient): MissionCreationStore {
  return {
    async insertDraft(row) {
      const { error } = await db.from('missions').insert(row);
      if (error) throw new Error('MISSION_DRAFT_INSERT_FAILED');
    },

    async insertPolicy(row) {
      const { error } = await db.from('mission_policies').insert(row);
      if (error) throw new Error('MISSION_POLICY_INSERT_FAILED');
    },

    async deleteDraft(missionId, ownerId) {
      await db.from('missions').delete().eq('id', missionId).eq('owner_id', ownerId);
    },

    async getDraft(missionId, ownerId) {
      const { data, error } = await db
        .from('missions')
        .select(DRAFT_COLUMNS)
        .eq('id', missionId)
        .eq('owner_id', ownerId)
        .maybeSingle();
      if (error) throw new Error('MISSION_READ_FAILED');
      return (data as unknown as MissionDraftRow | null) ?? null;
    },

    async getPolicy(missionId, version) {
      const { data, error } = await db
        .from('mission_policies')
        .select('mission_id,version,policy_json,policy_hash')
        .eq('mission_id', missionId)
        .eq('version', version)
        .maybeSingle();
      if (error) throw new Error('MISSION_POLICY_READ_FAILED');
      return (data as unknown as MissionPolicyRow | null) ?? null;
    },

    async activateMission(missionId, ownerId, patch) {
      const { data, error } = await db
        .from('missions')
        .update(patch)
        .eq('id', missionId)
        .eq('owner_id', ownerId)
        .eq('status', 'DRAFT')
        .select('id,status,contract_address')
        .maybeSingle();
      if (error) throw new Error('MISSION_ACTIVATE_FAILED');
      return data !== null;
    },

    async getMissionSummary(missionId, ownerId) {
      const { data, error } = await db
        .from('missions')
        .select('status,contract_address,policy_hash')
        .eq('id', missionId)
        .eq('owner_id', ownerId)
        .maybeSingle();
      if (error) throw new Error('MISSION_READ_FAILED');
      return (data as unknown as MissionSummary | null) ?? null;
    },

    async getAgentByAddress(address) {
      const { data, error } = await db
        .from('agents')
        .select('id,owner_id,status')
        .eq('address', address)
        .maybeSingle();
      if (error) throw new Error('AGENT_READ_FAILED');
      return (data as unknown as AgentSummary | null) ?? null;
    },

    async insertAgent(row) {
      const { data, error } = await db
        .from('agents')
        .insert(row)
        .select('id,owner_id,status')
        .single();
      if (error || !data) throw new Error('AGENT_INSERT_FAILED');
      return data as unknown as AgentSummary;
    },

    async getAssignment(missionId, agentId) {
      const { data, error } = await db
        .from('mission_agents')
        .select('id')
        .eq('mission_id', missionId)
        .eq('agent_id', agentId)
        .maybeSingle();
      if (error) throw new Error('ASSIGNMENT_READ_FAILED');
      return (data as unknown as { id: string } | null) ?? null;
    },

    async insertAssignment(row) {
      const { error } = await db.from('mission_agents').insert(row);
      if (error) throw new Error('ASSIGNMENT_INSERT_FAILED');
    },

    async insertAudit(row) {
      const { error } = await db.from('audit_events').insert(row);
      if (error) throw new Error('AUDIT_INSERT_FAILED');
    },

    async getMissionCreatedAudit(missionId) {
      const { data, error } = await db
        .from('audit_events')
        .select('id,payload_public')
        .eq('mission_id', missionId)
        .eq('event_type', 'mission.created')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error('AUDIT_READ_FAILED');
      return (data as unknown as MissionAuditRecord | null) ?? null;
    },

    async updateAuditPayload(id, payload) {
      const { error } = await db
        .from('audit_events')
        .update({ payload_public: payload })
        .eq('id', id);
      if (error) throw new Error('AUDIT_UPDATE_FAILED');
    },
  };
}
