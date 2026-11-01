import type { SupabaseClient } from '@supabase/supabase-js';

export type HspPaymentStatusName =
  'PREFLIGHTED' | 'SIGNED' | 'AUTHORIZED' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

export interface HspPaymentRow {
  id: string;
  mission_id: string;
  action_request_id: string;
  hsp_payment_mandate_id: string;
  mandate_hash: string;
  amount_atomic: string;
  token_address: string;
  merchant_address: string;
  status: HspPaymentStatusName;
  authorization_tx_hash: string | null;
  settlement_tx_hash: string | null;
  block_number: number | null;
  raw_error: unknown;
  submitted_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface NewHspPayment {
  mission_id: string;
  action_request_id: string;
  hsp_payment_mandate_id: string;
  mandate_hash: string;
  amount_atomic: string;
  token_address: string;
  merchant_address: string;
  status: HspPaymentStatusName;
  authorization_tx_hash: string | null;
  settlement_tx_hash?: string | null;
  block_number?: number | null;
  raw_error?: unknown;
  submitted_at?: string | null;
  settled_at?: string | null;
}

export interface NewHspWebhookEvent {
  hsp_payment_mandate_id: string;
  event_id: string;
  event_hash: string;
  payload: unknown;
  signature_verified: boolean;
  processed_at?: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

export async function getHspPaymentByActionRequestId(
  db: SupabaseClient,
  actionRequestId: string
): Promise<HspPaymentRow | null> {
  const { data, error } = await db
    .from('hsp_payments')
    .select('*')
    .eq('action_request_id', actionRequestId)
    .maybeSingle();
  if (error) throw error;
  return (data as HspPaymentRow | null) ?? null;
}

export async function getHspPaymentByMandateId(
  db: SupabaseClient,
  hspPaymentMandateId: string
): Promise<HspPaymentRow | null> {
  const { data, error } = await db
    .from('hsp_payments')
    .select('*')
    .eq('hsp_payment_mandate_id', hspPaymentMandateId)
    .maybeSingle();
  if (error) throw error;
  return (data as HspPaymentRow | null) ?? null;
}

export async function insertHspPayment(
  db: SupabaseClient,
  row: NewHspPayment
): Promise<HspPaymentRow> {
  const { data, error } = await db.from('hsp_payments').insert(row).select('*').single();
  if (error) throw error;
  return data as HspPaymentRow;
}

export async function updateHspPayment(
  db: SupabaseClient,
  id: string,
  patch: Partial<NewHspPayment>
): Promise<HspPaymentRow | null> {
  const { data, error } = await db
    .from('hsp_payments')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as HspPaymentRow | null) ?? null;
}

export async function transitionHspPayment(
  db: SupabaseClient,
  id: string,
  fromStatus: HspPaymentStatusName,
  patch: Partial<NewHspPayment>
): Promise<HspPaymentRow | null> {
  const { data, error } = await db
    .from('hsp_payments')
    .update(patch)
    .eq('id', id)
    .eq('status', fromStatus)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return (data as HspPaymentRow | null) ?? null;
}

/** Atomically mirrors confirmed spend; HSP/HashKey remain authoritative. */
export async function mirrorConfirmedSpend(
  db: SupabaseClient,
  missionId: string,
  amountAtomic: string
): Promise<string | null> {
  const { data, error } = await db.rpc('mirror_confirmed_spend', {
    p_mission_id: missionId,
    p_amount: amountAtomic,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : data === null ? null : String(data);
}

export async function insertHspWebhookEvent(
  db: SupabaseClient,
  row: NewHspWebhookEvent
): Promise<{ outcome: 'INSERTED'; id: string } | { outcome: 'DUPLICATE' }> {
  const { data, error } = await db.from('hsp_webhook_events').insert(row).select('id').single();
  if (error) {
    if (isUniqueViolation(error)) return { outcome: 'DUPLICATE' };
    throw error;
  }
  return { outcome: 'INSERTED', id: (data as { id: string }).id };
}

export async function markHspWebhookProcessed(
  db: SupabaseClient,
  id: string,
  processedAt: string
): Promise<void> {
  const { error } = await db
    .from('hsp_webhook_events')
    .update({ processed_at: processedAt })
    .eq('id', id);
  if (error) throw error;
}

export async function listSubmittedHspPayments(
  db: SupabaseClient,
  olderThanIso: string
): Promise<HspPaymentRow[]> {
  const { data, error } = await db
    .from('hsp_payments')
    .select('*')
    .eq('status', 'SUBMITTED')
    .lt('submitted_at', olderThanIso)
    .order('submitted_at', { ascending: true });
  if (error) throw error;
  return (data as HspPaymentRow[] | null) ?? [];
}

export async function getMissionContractAddress(
  db: SupabaseClient,
  missionId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('missions')
    .select('contract_address, pda_address')
    .eq('id', missionId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { contract_address?: string | null; pda_address?: string | null } | null;
  return row?.contract_address ?? row?.pda_address ?? null;
}

export async function getActionRequestOnchainRequestId(
  db: SupabaseClient,
  actionRequestId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('action_requests')
    .select('onchain_request_id')
    .eq('id', actionRequestId)
    .maybeSingle();
  if (error) throw error;
  return (data as { onchain_request_id?: string | null } | null)?.onchain_request_id ?? null;
}
