import type { SupabaseClient } from '@supabase/supabase-js';

export interface PreflightMissionRow {
  id: string;
  owner_id: string;
  name: string;
  objective: string;
  pda_address: string;
  vault_address: string;
  mint_address: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  status: string;
  current_agent_id: string | null;
  current_agent_public_key: string;
  policy_version: number;
  policy_hash: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface PreflightAgentRow {
  id: string;
  owner_id: string;
  name: string;
  public_key: string;
  endpoint_url: string | null;
  capabilities: unknown;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreflightMissionAgentRow {
  id: string;
  mission_id: string;
  agent_id: string;
  role: string | null;
  priority: number | null;
  required_capabilities: unknown;
  status: string | null;
  activated_at: string | null;
  revoked_at: string | null;
}

export interface NewPreflightActionRequest {
  mission_id: string;
  agent_id: string;
  idempotency_key: string;
  request_id: string;
  onchain_request_id: string;
  agent_nonce: number;
  action_type: string;
  payload: unknown;
  request_hash: string;
  signature: string | null;
  decision: 'ALLOW' | 'BLOCK';
  decision_reason_code: string | null;
  mandate_hash: string | null;
  mandate_payload: unknown;
  typed_data: unknown;
  expires_at: string;
}

export interface PreflightActionRequestRow extends NewPreflightActionRequest {
  id: string;
  created_at: string;
  submitted_at: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

export async function getMissionById(
  db: SupabaseClient,
  missionId: string
): Promise<PreflightMissionRow | null> {
  const { data, error } = await db.from('missions').select('*').eq('id', missionId).maybeSingle();
  if (error) throw error;
  return (data as PreflightMissionRow | null) ?? null;
}

export async function getAgentByAddress(
  db: SupabaseClient,
  address: string
): Promise<PreflightAgentRow | null> {
  const { data, error } = await db
    .from('agents')
    .select('*')
    .ilike('public_key', address)
    .maybeSingle();
  if (error) throw error;
  return (data as PreflightAgentRow | null) ?? null;
}

export async function getMissionAgents(
  db: SupabaseClient,
  missionId: string
): Promise<PreflightMissionAgentRow[]> {
  const { data, error } = await db.from('mission_agents').select('*').eq('mission_id', missionId);
  if (error) throw error;
  return (data as PreflightMissionAgentRow[] | null) ?? [];
}

export async function isAgentAssigned(
  db: SupabaseClient,
  missionId: string,
  agentId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('mission_agents')
    .select('id')
    .eq('mission_id', missionId)
    .eq('agent_id', agentId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function listActionRequestKeys(
  db: SupabaseClient,
  missionId: string
): Promise<{ requestIds: Set<string>; idempotencyKeys: Set<string> }> {
  const { data, error } = await db
    .from('action_requests')
    .select('onchain_request_id, idempotency_key')
    .eq('mission_id', missionId);
  if (error) throw error;

  const requestIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const row of data ?? []) {
    const onchainRequestId = (row as { onchain_request_id?: string | null }).onchain_request_id;
    const idempotencyKey = (row as { idempotency_key?: string | null }).idempotency_key;
    if (onchainRequestId) requestIds.add(onchainRequestId);
    if (idempotencyKey) idempotencyKeys.add(idempotencyKey);
  }
  return { requestIds, idempotencyKeys };
}

export async function getActionRequestByMissionAndIdempotencyKey(
  db: SupabaseClient,
  missionId: string,
  idempotencyKey: string
): Promise<PreflightActionRequestRow | null> {
  const { data, error } = await db
    .from('action_requests')
    .select('*')
    .eq('mission_id', missionId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return (data as PreflightActionRequestRow | null) ?? null;
}

export async function insertActionRequest(
  db: SupabaseClient,
  row: NewPreflightActionRequest
): Promise<string> {
  const { data, error } = await db.from('action_requests').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function consumeAgentNonce(
  db: SupabaseClient,
  agentId: string,
  nonce: string,
  expiresAt: string
): Promise<'CONSUMED' | 'REPLAY_DETECTED'> {
  const { error } = await db.from('agent_request_nonces').insert({
    agent_id: agentId,
    nonce,
    expires_at: expiresAt,
  });
  if (error) {
    if (isUniqueViolation(error)) return 'REPLAY_DETECTED';
    throw error;
  }
  return 'CONSUMED';
}

export async function getOwnerWalletAddress(
  db: SupabaseClient,
  ownerId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('profiles')
    .select('wallet_address')
    .eq('id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return (data as { wallet_address?: string } | null)?.wallet_address ?? null;
}
