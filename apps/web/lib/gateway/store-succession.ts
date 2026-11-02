// Succra web — Phase 6 succession persistence.
import type { SupabaseClient } from '@supabase/supabase-js';

export type SuccessionStatusName = 'PENDING_ACK' | 'ACKNOWLEDGED' | 'FAILED';
export type SuccessionTriggerType = 'quarantine' | 'owner_manual' | 'liveness';

export interface SuccessionMissionRow {
  id: string;
  owner_id: string;
  contract_address: string | null;
  pda_address: string;
  status: string;
  current_agent_id: string | null;
  current_agent_address: string | null;
  policy_version: number;
}

export interface SuccessorCandidateRow {
  mission_agent_id: string;
  agent_id: string;
  address: string;
  priority: number | null;
  status: string;
  capabilities: unknown;
  required_capabilities: unknown;
}

export interface SuccessionEventRow {
  id: string;
  mission_id: string;
  from_agent_id: string | null;
  from_agent_address: string;
  to_agent_id: string;
  to_agent_address: string;
  trigger_type: SuccessionTriggerType;
  checkpoint_hash: string | null;
  checkpoint_sequence: number | null;
  recovery_max_payment_atomic: string;
  status: SuccessionStatusName;
  activation_tx_hash: string | null;
  acknowledgement_tx_hash: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface NewSuccessionEvent {
  mission_id: string;
  from_agent_id: string | null;
  from_agent_address: string;
  to_agent_id: string;
  to_agent_address: string;
  trigger_type: SuccessionTriggerType;
  checkpoint_hash: string | null;
  checkpoint_sequence: number | null;
  recovery_max_payment_atomic: string;
  status: SuccessionStatusName;
  activation_tx_hash: string | null;
}

export async function getSuccessionMission(
  db: SupabaseClient,
  missionId: string
): Promise<SuccessionMissionRow | null> {
  const { data, error } = await db
    .from('missions')
    .select(
      'id, owner_id, contract_address, pda_address, status, current_agent_id, current_agent_address, policy_version'
    )
    .eq('id', missionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SuccessionMissionRow | null) ?? null;
}

export async function listSuccessorCandidates(
  db: SupabaseClient,
  missionId: string
): Promise<SuccessorCandidateRow[]> {
  const { data: assignments, error: assignmentError } = await db
    .from('mission_agents')
    .select('id, agent_id, priority, status, required_capabilities')
    .eq('mission_id', missionId)
    .eq('role', 'SUCCESSOR')
    .in('status', ['REGISTERED', 'ACTIVE_SUCCESSOR']);
  if (assignmentError) throw assignmentError;
  const rows = (assignments as Array<Record<string, unknown>> | null) ?? [];
  if (rows.length === 0) return [];

  const agentIds = rows.map((row) => String(row['agent_id']));
  const { data: agents, error: agentError } = await db
    .from('agents')
    .select('id, address, capabilities')
    .in('id', agentIds);
  if (agentError) throw agentError;
  const agentsById = new Map(
    ((agents as Array<Record<string, unknown>> | null) ?? []).map((agent) => [
      String(agent['id']),
      agent,
    ])
  );

  return rows.flatMap((row) => {
    const agent = agentsById.get(String(row['agent_id']));
    if (!agent) return [];
    return [
      {
        mission_agent_id: String(row['id']),
        agent_id: String(row['agent_id']),
        address: String(agent['address']),
        priority: row['priority'] === null ? null : Number(row['priority']),
        status: String(row['status']),
        capabilities: agent['capabilities'] ?? [],
        required_capabilities: row['required_capabilities'] ?? [],
      },
    ];
  });
}

export async function getPendingSuccession(
  db: SupabaseClient,
  missionId: string
): Promise<SuccessionEventRow | null> {
  const { data, error } = await db
    .from('succession_events')
    .select('*')
    .eq('mission_id', missionId)
    .eq('status', 'PENDING_ACK')
    .maybeSingle();
  if (error) throw error;
  return (data as SuccessionEventRow | null) ?? null;
}

export async function insertSuccessionEvent(
  db: SupabaseClient,
  row: NewSuccessionEvent
): Promise<SuccessionEventRow> {
  const { data, error } = await db.from('succession_events').insert(row).select('*').single();
  if (error) throw error;
  return data as SuccessionEventRow;
}

export async function updateSuccessionActivated(
  db: SupabaseClient,
  successionId: string,
  patch: {
    activation_tx_hash: string;
    checkpoint_hash: string | null;
    checkpoint_sequence: number | null;
  }
): Promise<SuccessionEventRow | null> {
  const { data, error } = await db
    .from('succession_events')
    .update(patch)
    .eq('id', successionId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as SuccessionEventRow | null) ?? null;
}

export async function getSuccessionById(
  db: SupabaseClient,
  missionId: string,
  successionId: string
): Promise<SuccessionEventRow | null> {
  const { data, error } = await db
    .from('succession_events')
    .select('*')
    .eq('id', successionId)
    .eq('mission_id', missionId)
    .maybeSingle();
  if (error) throw error;
  return (data as SuccessionEventRow | null) ?? null;
}

/**
 * ACK-time eligibility: a successor whose assignment or agent record was
 * revoked/quarantined after activation must not be able to acknowledge.
 */
export async function getMissionAgentStatus(
  db: SupabaseClient,
  missionId: string,
  agentId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('mission_agents')
    .select('status')
    .eq('mission_id', missionId)
    .eq('agent_id', agentId)
    .maybeSingle();
  if (error) throw error;
  return (data as { status?: string } | null)?.status ?? null;
}

export async function listSuccessions(
  db: SupabaseClient,
  missionId: string
): Promise<SuccessionEventRow[]> {
  const { data, error } = await db
    .from('succession_events')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as SuccessionEventRow[] | null) ?? [];
}

export async function markSuccessionAcknowledged(
  db: SupabaseClient,
  successionId: string,
  acknowledgementTxHash: string,
  acknowledgedAt: string
): Promise<SuccessionEventRow | null> {
  const { data, error } = await db
    .from('succession_events')
    .update({
      status: 'ACKNOWLEDGED',
      acknowledgement_tx_hash: acknowledgementTxHash,
      acknowledged_at: acknowledgedAt,
    })
    .eq('id', successionId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as SuccessionEventRow | null) ?? null;
}

export async function updateMissionAgentStatus(
  db: SupabaseClient,
  missionId: string,
  agentId: string,
  status: string
): Promise<void> {
  const { error } = await db
    .from('mission_agents')
    .update({ status })
    .eq('mission_id', missionId)
    .eq('agent_id', agentId);
  if (error) throw error;
}

export async function updateMissionStatus(
  db: SupabaseClient,
  missionId: string,
  status: string
): Promise<void> {
  const { error } = await db
    .from('missions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', missionId);
  if (error) throw error;
}

export async function updateMissionCurrentAgent(
  db: SupabaseClient,
  missionId: string,
  agentId: string,
  address: string
): Promise<void> {
  const { error } = await db
    .from('missions')
    .update({
      current_agent_id: agentId,
      current_agent_address: address,
      updated_at: new Date().toISOString(),
    })
    .eq('id', missionId);
  if (error) throw error;
}
