// Succra web — Phase 6 checkpoint persistence.
import type { SupabaseClient } from '@supabase/supabase-js';

export type CheckpointStatusName = 'CANDIDATE' | 'VERIFIED' | 'SUPERSEDED';

export interface MissionCheckpointRow {
  id: string;
  mission_id: string;
  sequence: number;
  status: CheckpointStatusName;
  checkpoint_hash: string;
  confirmed_payment_ids: unknown;
  confirmed_transaction_hashes: unknown;
  hsp_mandate_ids: unknown;
  confirmed_spent_atomic: string;
  policy_version: number;
  policy_hash: string;
  committed_tx_hash: string | null;
  created_at: string;
}

export interface NewMissionCheckpoint {
  mission_id: string;
  sequence: number;
  status: CheckpointStatusName;
  checkpoint_hash: string;
  confirmed_payment_ids: string[];
  confirmed_transaction_hashes: string[];
  hsp_mandate_ids: string[];
  confirmed_spent_atomic: string;
  policy_version: number;
  policy_hash: string;
  committed_tx_hash: string | null;
}

export interface CheckpointMissionRow {
  id: string;
  contract_address: string | null;
  pda_address: string;
  policy_version: number;
  policy_hash: string;
}

export interface ConfirmedPaymentRow {
  hsp_payment_mandate_id: string;
  settlement_tx_hash: string | null;
}

export async function getCheckpointMission(
  db: SupabaseClient,
  missionId: string
): Promise<CheckpointMissionRow | null> {
  const { data, error } = await db
    .from('missions')
    .select('id, contract_address, pda_address, policy_version, policy_hash')
    .eq('id', missionId)
    .maybeSingle();
  if (error) throw error;
  return (data as CheckpointMissionRow | null) ?? null;
}

export async function listConfirmedPayments(
  db: SupabaseClient,
  missionId: string
): Promise<ConfirmedPaymentRow[]> {
  const { data, error } = await db
    .from('hsp_payments')
    .select('hsp_payment_mandate_id, settlement_tx_hash')
    .eq('mission_id', missionId)
    .eq('status', 'CONFIRMED')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ConfirmedPaymentRow[] | null) ?? [];
}

export async function insertMissionCheckpoint(
  db: SupabaseClient,
  row: NewMissionCheckpoint
): Promise<MissionCheckpointRow> {
  const { data, error } = await db.from('mission_checkpoints').insert(row).select('*').single();
  if (error) throw error;
  return data as MissionCheckpointRow;
}

export async function getLatestVerifiedCheckpoint(
  db: SupabaseClient,
  missionId: string
): Promise<MissionCheckpointRow | null> {
  const { data, error } = await db
    .from('mission_checkpoints')
    .select('*')
    .eq('mission_id', missionId)
    .eq('status', 'VERIFIED')
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as MissionCheckpointRow | null) ?? null;
}

export async function getCheckpointBySequence(
  db: SupabaseClient,
  missionId: string,
  sequence: number
): Promise<MissionCheckpointRow | null> {
  const { data, error } = await db
    .from('mission_checkpoints')
    .select('*')
    .eq('mission_id', missionId)
    .eq('sequence', sequence)
    .maybeSingle();
  if (error) throw error;
  return (data as MissionCheckpointRow | null) ?? null;
}
