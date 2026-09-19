// Succra gateway — production GatewayStore over a service-role client.
//
// Every method is a thin query wrapper; all authorization happens in the
// flow functions before these are called. Unique-violation mapping
// (23505) is explicit: idempotency vs agent-nonce conflicts resolve by
// re-reading, never by parsing constraint names.
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActionRequestRow,
  AgentRow,
  ChallengeRow,
  GatewayStore,
  InsertActionOutcome,
  MissionAgentRow,
  MissionRow,
  NewActionRequest,
  NewAgent,
  NewAssignment,
  OnchainTxRow,
  OnchainTxStatus,
  PolicyRow,
} from './store';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

export class SupabaseGatewayStore implements GatewayStore {
  constructor(private readonly db: SupabaseClient) {}

  async getAgentById(agentId: string): Promise<AgentRow | null> {
    const { data, error } = await this.db
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .maybeSingle();
    if (error) throw error;
    return (data as AgentRow | null) ?? null;
  }

  async getAgentByPublicKey(publicKey: string): Promise<AgentRow | null> {
    const { data, error } = await this.db
      .from('agents')
      .select('*')
      .eq('public_key', publicKey)
      .maybeSingle();
    if (error) throw error;
    return (data as AgentRow | null) ?? null;
  }

  async insertAgent(row: NewAgent): Promise<AgentRow> {
    const { data, error } = await this.db.from('agents').insert(row).select('*').single();
    if (error) throw error;
    return data as AgentRow;
  }

  async updateAgentStatus(agentId: string, status: string): Promise<AgentRow | null> {
    const { data, error } = await this.db
      .from('agents')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', agentId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return (data as AgentRow | null) ?? null;
  }

  async updateAgentHeartbeat(agentId: string, atIso: string): Promise<AgentRow | null> {
    const { data, error } = await this.db
      .from('agents')
      .update({ last_heartbeat_at: atIso, updated_at: atIso })
      .eq('id', agentId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return (data as AgentRow | null) ?? null;
  }

  async getMissionById(missionId: string): Promise<MissionRow | null> {
    const { data, error } = await this.db
      .from('missions')
      .select('*')
      .eq('id', missionId)
      .maybeSingle();
    if (error) throw error;
    return (data as MissionRow | null) ?? null;
  }

  async updateMissionRemaining(missionId: string, remainingAtomic: string): Promise<void> {
    const { error } = await this.db
      .from('missions')
      .update({ remaining_budget_atomic: remainingAtomic, updated_at: new Date().toISOString() })
      .eq('id', missionId);
    if (error) throw error;
  }

  async getLatestPolicy(missionId: string): Promise<PolicyRow | null> {
    const { data, error } = await this.db
      .from('mission_policies')
      .select('*')
      .eq('mission_id', missionId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as PolicyRow | null) ?? null;
  }

  async getAssignment(missionId: string, agentId: string): Promise<MissionAgentRow | null> {
    const { data, error } = await this.db
      .from('mission_agents')
      .select('*')
      .eq('mission_id', missionId)
      .eq('agent_id', agentId)
      .maybeSingle();
    if (error) throw error;
    return (data as MissionAgentRow | null) ?? null;
  }

  async listAssignmentsForAgent(agentId: string): Promise<MissionAgentRow[]> {
    const { data, error } = await this.db
      .from('mission_agents')
      .select('*')
      .eq('agent_id', agentId);
    if (error) throw error;
    return (data ?? []) as MissionAgentRow[];
  }

  async insertAssignment(row: NewAssignment): Promise<MissionAgentRow> {
    const { data, error } = await this.db.from('mission_agents').insert(row).select('*').single();
    if (error) throw error;
    return data as MissionAgentRow;
  }

  async getActionById(requestId: string): Promise<ActionRequestRow | null> {
    const { data, error } = await this.db
      .from('action_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw error;
    return (data as ActionRequestRow | null) ?? null;
  }

  async getActionByIdempotency(missionId: string, key: string): Promise<ActionRequestRow | null> {
    const { data, error } = await this.db
      .from('action_requests')
      .select('*')
      .eq('mission_id', missionId)
      .eq('idempotency_key', key)
      .maybeSingle();
    if (error) throw error;
    return (data as ActionRequestRow | null) ?? null;
  }

  async insertAction(row: NewActionRequest): Promise<InsertActionOutcome> {
    const { data, error } = await this.db.from('action_requests').insert(row).select('*').single();
    if (!error) {
      return { inserted: data as ActionRequestRow };
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // Lost a race (or replayed): the idempotency row wins over the nonce
    // slot because duplicates must return the ORIGINAL decision.
    const existing = await this.getActionByIdempotency(row.mission_id, row.idempotency_key);
    return { conflict: existing ? 'idempotency' : 'agent-nonce' };
  }

  async markActionSubmitted(requestId: string, atIso: string): Promise<void> {
    const { error } = await this.db
      .from('action_requests')
      .update({ submitted_at: atIso })
      .eq('id', requestId);
    if (error) throw error;
  }

  async getOnchainTxByRequest(requestId: string): Promise<OnchainTxRow | null> {
    const { data, error } = await this.db
      .from('onchain_transactions')
      .select('*')
      .eq('action_request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return (data as OnchainTxRow | null) ?? null;
  }

  async insertOnchainTx(row: {
    mission_id: string;
    action_request_id: string;
    signature: string;
    status: OnchainTxStatus;
  }): Promise<{ inserted: OnchainTxRow } | { conflict: 'signature' }> {
    const { data, error } = await this.db
      .from('onchain_transactions')
      .insert(row)
      .select('*')
      .single();
    if (!error) {
      return { inserted: data as OnchainTxRow };
    }
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return { conflict: 'signature' };
  }

  async updateOnchainTxConfirmed(signature: string, slot: number, atIso: string): Promise<void> {
    const { error } = await this.db
      .from('onchain_transactions')
      .update({ status: 'CONFIRMED', slot, confirmed_at: atIso })
      .eq('signature', signature);
    if (error) throw error;
  }

  async updateOnchainTxFailed(signature: string, rawError: unknown): Promise<void> {
    const { error } = await this.db
      .from('onchain_transactions')
      .update({ status: 'FAILED', raw_error: rawError as Record<string, unknown> })
      .eq('signature', signature);
    if (error) throw error;
  }

  async insertRequestNonce(
    agentId: string,
    nonce: string,
    expiresAtIso: string
  ): Promise<'ok' | 'duplicate'> {
    const { error } = await this.db
      .from('agent_request_nonces')
      .insert({ agent_id: agentId, nonce, expires_at: expiresAtIso });
    if (!error) {
      return 'ok';
    }
    if (isUniqueViolation(error)) {
      return 'duplicate';
    }
    throw error;
  }

  async consumeRequestNonce(agentId: string, nonce: string, nowIso: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('agent_request_nonces')
      .update({ consumed_at: nowIso })
      .eq('agent_id', agentId)
      .eq('nonce', nonce)
      .is('consumed_at', null)
      .select('id');
    if (error) throw error;
    return ((data ?? []) as unknown[]).length > 0;
  }

  async sweepRequestNonces(nowIso: string): Promise<void> {
    const { error } = await this.db.from('agent_request_nonces').delete().lt('expires_at', nowIso);
    if (error) throw error;
  }

  async insertChallenge(agentId: string, challenge: string, expiresAtIso: string): Promise<void> {
    const { error } = await this.db
      .from('agent_challenges')
      .insert({ agent_id: agentId, challenge, expires_at: expiresAtIso });
    if (error) throw error;
  }

  async findChallenge(agentId: string, challenge: string): Promise<ChallengeRow | null> {
    const { data, error } = await this.db
      .from('agent_challenges')
      .select('*')
      .eq('agent_id', agentId)
      .eq('challenge', challenge)
      .maybeSingle();
    if (error) throw error;
    return (data as ChallengeRow | null) ?? null;
  }

  async consumeChallenge(agentId: string, challenge: string, nowIso: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('agent_challenges')
      .update({ consumed_at: nowIso })
      .eq('agent_id', agentId)
      .eq('challenge', challenge)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .select('id');
    if (error) throw error;
    return ((data ?? []) as unknown[]).length > 0;
  }
}
