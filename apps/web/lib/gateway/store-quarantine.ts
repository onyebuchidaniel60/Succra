// Succra web — Phase 5 violation/quarantine persistence.
//
// All functions use the server-only service-role client. On-chain state is
// authoritative; these writes are mirrors and audit records, never the source
// of truth for mission authority or funds.
import { keccak256, stringToHex } from 'viem';
import type { SupabaseClient } from '@supabase/supabase-js';

/** PROJECT_SPEC.md §6 countable policy violations. */
export const COUNTABLE_VIOLATION_REASON_CODES = [
  'INVALID_ACTION_TYPE',
  'MERCHANT_NOT_ALLOWED',
  'TOKEN_NOT_ALLOWED',
  'AMOUNT_EXCEEDS_MAX',
  'BUDGET_EXHAUSTED',
] as const;

export type CountableViolationReasonCode = (typeof COUNTABLE_VIOLATION_REASON_CODES)[number];

export function isCountableViolationReasonCode(
  value: string | null | undefined
): value is CountableViolationReasonCode {
  return (
    value !== null &&
    value !== undefined &&
    (COUNTABLE_VIOLATION_REASON_CODES as readonly string[]).includes(value)
  );
}

export const VIOLATION_MAX_ATTEMPTS = 3;

export type AuditActorType = 'owner' | 'guardian' | 'runtime' | 'agent' | 'system';

export interface NewAuditEventRow {
  mission_id: string;
  event_type: string;
  actor_type: AuditActorType;
  actor_id: string | null;
  event_hash: string;
  payload_public: Record<string, unknown>;
  onchain_tx_hash?: string | null;
  created_at?: string;
}

export interface AuditEventRow extends NewAuditEventRow {
  id: string;
  created_at: string;
}

export interface UnprocessedBlockedRequestRow {
  id: string;
  mission_id: string;
  agent_id: string;
  request_id: string;
  onchain_request_id: string;
  decision: string;
  decision_reason_code: string;
  created_at: string;
  violation_attempts: number;
  violation_poisoned: boolean;
}

export interface QuarantineMissionRow {
  id: string;
  owner_id: string;
  contract_address: string | null;
  pda_address: string;
  status: string;
  current_agent_id: string | null;
}

/**
 * Deterministic audit hash. The exact field order is part of the Phase 5
 * convention and must stay stable for verification.
 */
export function auditEventHash(parts: readonly (string | number | bigint | null)[]): string {
  return keccak256(
    stringToHex(parts.map((part) => (part === null ? '' : String(part).toLowerCase())).join(':'))
  );
}

export async function getUnprocessedBlockedRequests(
  db: SupabaseClient,
  limit = 25
): Promise<UnprocessedBlockedRequestRow[]> {
  const { data, error } = await db
    .from('action_requests')
    .select('*')
    .eq('decision', 'BLOCK')
    .in('decision_reason_code', [...COUNTABLE_VIOLATION_REASON_CODES])
    .is('violation_recorded_at', null)
    .eq('violation_poisoned', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data as UnprocessedBlockedRequestRow[] | null) ?? [];
}

export async function markViolationRecorded(
  db: SupabaseClient,
  actionRequestId: string,
  txHash: string,
  recordedAt = new Date().toISOString()
): Promise<void> {
  const { error } = await db
    .from('action_requests')
    .update({
      violation_recorded_at: recordedAt,
      violation_recorded_tx_hash: txHash,
    })
    .eq('id', actionRequestId);
  if (error) throw error;
}

export async function markViolationAttemptFailed(
  db: SupabaseClient,
  actionRequestId: string,
  attempts: number
): Promise<void> {
  const { error } = await db
    .from('action_requests')
    .update({
      violation_attempts: attempts,
      violation_poisoned: attempts >= VIOLATION_MAX_ATTEMPTS,
    })
    .eq('id', actionRequestId);
  if (error) throw error;
}

export async function insertAuditEvent(
  db: SupabaseClient,
  row: NewAuditEventRow
): Promise<AuditEventRow> {
  const { data, error } = await db
    .from('audit_events')
    .insert({
      ...row,
      onchain_tx_hash: row.onchain_tx_hash ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AuditEventRow;
}

export async function getRecentAuditEvents(
  db: SupabaseClient,
  missionId: string,
  limit = 50
): Promise<AuditEventRow[]> {
  const { data, error } = await db
    .from('audit_events')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AuditEventRow[] | null) ?? [];
}

export async function getQuarantineMission(
  db: SupabaseClient,
  missionId: string
): Promise<QuarantineMissionRow | null> {
  const { data, error } = await db
    .from('missions')
    .select('id, owner_id, contract_address, pda_address, status, current_agent_id')
    .eq('id', missionId)
    .maybeSingle();
  if (error) throw error;
  return (data as QuarantineMissionRow | null) ?? null;
}

/** On-chain first, then this DB mirror. Idempotent by design. */
export async function updateMissionStatusToQuarantined(
  db: SupabaseClient,
  missionId: string,
  updatedAt = new Date().toISOString()
): Promise<void> {
  const { error } = await db
    .from('missions')
    .update({ status: 'QUARANTINED', updated_at: updatedAt })
    .eq('id', missionId);
  if (error) throw error;
}

/** Mirrors the quarantined primary assignment; never touches successor rows. */
export async function updateCurrentAgentStatusToQuarantined(
  db: SupabaseClient,
  missionId: string
): Promise<void> {
  const mission = await getQuarantineMission(db, missionId);
  if (!mission) return;

  let query = db
    .from('mission_agents')
    .update({ status: 'QUARANTINED' })
    .eq('mission_id', missionId);
  if (mission.current_agent_id) {
    query = query.eq('agent_id', mission.current_agent_id);
  } else {
    query = query.eq('role', 'PRIMARY');
  }
  const { error } = await query;
  if (error) throw error;
}
