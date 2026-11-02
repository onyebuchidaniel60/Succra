// Succra web — shared post-settlement hook.
//
// Every settlement confirmation path (submit handler, webhook, poller) must
// commit the next checkpoint. If the mission was quarantined in the same
// window, the optional succession trigger is fired too.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MissionOnChainState } from './contract-reader';
import { readMissionState } from './contract-reader';
import { admin } from '@/lib/supabase';
import {
  getCheckpointMission,
  listConfirmedPaymentDetails,
  listPaymentAuditMandateIds,
  type ConfirmedPaymentDetailRow,
} from './store-checkpoints';
import { writeCheckpoint, type CheckpointWriteResult } from './checkpoint-writer';
import { auditEventHash, insertAuditEvent as insertAuditEventRow } from './store-quarantine';
import type { NewAuditEventRow } from './store-quarantine';
import { triggerSuccessionForMission } from './succession-runner';

export interface PostSettlementDeps {
  getMission(missionId: string): Promise<{
    id: string;
    contract_address: string | null;
    pda_address: string;
  } | null>;
  readState(address: `0x${string}`): Promise<MissionOnChainState>;
  writeCheckpoint(missionId: string, expectedVersion: bigint): Promise<CheckpointWriteResult>;
  triggerSuccession?(missionId: string): Promise<void>;
  listConfirmedPaymentDetails(missionId: string): Promise<ConfirmedPaymentDetailRow[]>;
  listPaymentAuditMandateIds(missionId: string): Promise<Set<string>>;
  insertAuditEvent(row: NewAuditEventRow): Promise<unknown>;
}

export function createPostSettlementDeps(db: SupabaseClient = admin()): PostSettlementDeps {
  return {
    getMission: (missionId) => getCheckpointMission(db, missionId),
    readState: (address) => readMissionState(address),
    writeCheckpoint: (missionId, expectedVersion) => writeCheckpoint(missionId, expectedVersion),
    triggerSuccession: async (missionId) => {
      await triggerSuccessionForMission(missionId, { triggerType: 'quarantine' });
    },
    listConfirmedPaymentDetails: (missionId) => listConfirmedPaymentDetails(db, missionId),
    listPaymentAuditMandateIds: (missionId) => listPaymentAuditMandateIds(db, missionId),
    insertAuditEvent: (row) => insertAuditEventRow(db, row),
  };
}

/**
 * Backfills `payment.confirmed` audit rows for confirmed HSP settlements.
 * Idempotent by HSP mandate ID; a failed insert is retried on the next
 * settlement because the audit list is re-read each time.
 */
export async function recordPaymentAudits(
  missionId: string,
  deps: Pick<
    PostSettlementDeps,
    'listConfirmedPaymentDetails' | 'listPaymentAuditMandateIds' | 'insertAuditEvent'
  >
): Promise<number> {
  const [payments, alreadyAudited] = await Promise.all([
    deps.listConfirmedPaymentDetails(missionId),
    deps.listPaymentAuditMandateIds(missionId),
  ]);
  let inserted = 0;
  for (const payment of payments) {
    if (alreadyAudited.has(payment.hsp_payment_mandate_id)) continue;
    if (!payment.settlement_tx_hash) continue;
    await deps.insertAuditEvent({
      mission_id: missionId,
      event_type: 'payment.confirmed',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: auditEventHash([
        missionId,
        'payment.confirmed',
        payment.hsp_payment_mandate_id,
        payment.settlement_tx_hash,
      ]),
      payload_public: {
        hspPaymentMandateId: payment.hsp_payment_mandate_id,
        settlementTxHash: payment.settlement_tx_hash,
        amountAtomic: String(payment.amount_atomic),
        tokenAddress: payment.token_address,
        merchantAddress: payment.merchant_address,
        blockNumber: payment.block_number === null ? null : String(payment.block_number),
      },
      onchain_tx_hash: payment.settlement_tx_hash,
      ...(payment.settled_at ? { created_at: payment.settled_at } : {}),
    });
    inserted += 1;
  }
  return inserted;
}

export async function postSettlementHook(
  missionId: string,
  expectedVersion?: bigint,
  deps: PostSettlementDeps = createPostSettlementDeps()
): Promise<CheckpointWriteResult> {
  const mission = await deps.getMission(missionId);
  if (!mission) throw new Error('Mission not found for post-settlement hook.');
  const address = (mission.contract_address ?? mission.pda_address) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Mission contract address is invalid.');
  }
  // Settlement is already authoritative. Audit failures are best-effort and
  // are retried on the next confirmed settlement; they must not turn a
  // confirmed payment into an API failure.
  await recordPaymentAudits(missionId, deps).catch(() => 0);
  const state = await deps.readState(address);
  let checkpoint: CheckpointWriteResult | null = null;
  let checkpointError: unknown;
  if (state.status !== 'QUARANTINED') {
    try {
      checkpoint = await deps.writeCheckpoint(missionId, expectedVersion ?? state.stateVersion);
    } catch (error) {
      checkpointError = error;
    }
  }
  if (state.status === 'QUARANTINED' && deps.triggerSuccession) {
    await deps.triggerSuccession(missionId);
  }
  if (checkpointError) throw checkpointError;
  if (!checkpoint) {
    throw new Error('Mission is quarantined; checkpoint deferred to recovery.');
  }
  return checkpoint;
}
