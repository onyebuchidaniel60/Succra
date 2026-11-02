// Succra web — Phase 6 canonical checkpoint writer.
//
// Sequence is the on-chain checkpointCount: 0, 1, 2, ... The initial
// sequence=0 commit happens at mission activation via the runtime initializer.
// Every CONFIRMED settlement is followed by the next checkpoint. The contract
// stores only the hash; the full deterministic snapshot lives in
// mission_checkpoints.
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeCheckpointHash } from '@succra/shared';
import type { MissionOnChainState } from './contract-reader';
import { readMissionState } from './contract-reader';
import { sendCommitCheckpoint } from './contract-writer';
import { admin } from '@/lib/supabase';
import { auditEventHash, insertAuditEvent } from './store-quarantine';
import {
  getCheckpointMission,
  insertMissionCheckpoint,
  listConfirmedPayments,
  type NewMissionCheckpoint,
} from './store-checkpoints';

export interface CheckpointWriterDeps {
  getMission(missionId: string): Promise<{
    id: string;
    contract_address: string | null;
    pda_address: string;
    policy_version: number;
    policy_hash: string;
  } | null>;
  readState(address: `0x${string}`): Promise<MissionOnChainState>;
  listConfirmedPayments(
    missionId: string
  ): Promise<Array<{ hsp_payment_mandate_id: string; settlement_tx_hash: string | null }>>;
  commitCheckpoint(args: {
    missionAddress: `0x${string}`;
    sequence: bigint;
    checkpointHash: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<{ txHash: string }>;
  insertCheckpoint(row: NewMissionCheckpoint): Promise<unknown>;
  insertAuditEvent(row: Parameters<typeof insertAuditEvent>[1]): Promise<unknown>;
  now?: () => number;
}

export interface CheckpointWriteResult {
  sequence: number;
  checkpointHash: `0x${string}`;
  txHash: string;
}

export function createCheckpointWriterDeps(db: SupabaseClient = admin()): CheckpointWriterDeps {
  return {
    getMission: (missionId) => getCheckpointMission(db, missionId),
    readState: (address) => readMissionState(address),
    listConfirmedPayments: (missionId) => listConfirmedPayments(db, missionId),
    commitCheckpoint: (args) => sendCommitCheckpoint(args),
    insertCheckpoint: (row) => insertMissionCheckpoint(db, row),
    insertAuditEvent: (row) => insertAuditEvent(db, row),
  };
}

/**
 * Commits one checkpoint at the next on-chain sequence and mirrors the
 * verified snapshot. `expectedVersion` must be the stateVersion read after
 * the settlement that triggered this checkpoint.
 */
export async function writeCheckpoint(
  missionId: string,
  expectedVersion: bigint,
  deps: CheckpointWriterDeps = createCheckpointWriterDeps()
): Promise<CheckpointWriteResult> {
  const mission = await deps.getMission(missionId);
  if (!mission) throw new Error('Mission not found for checkpoint.');
  const missionAddressValue = mission.contract_address ?? mission.pda_address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(missionAddressValue)) {
    throw new Error('Mission contract address is invalid.');
  }
  const missionAddress = missionAddressValue as `0x${string}`;
  const state = await deps.readState(missionAddress);
  const sequence = Number(state.checkpointCount);

  const confirmed = await deps.listConfirmedPayments(missionId);
  const confirmedPaymentIds = confirmed.map((payment) => payment.hsp_payment_mandate_id).sort();
  const confirmedTxHashes = confirmed
    .map((payment) => payment.settlement_tx_hash)
    .filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)
    .map((hash) => hash.toLowerCase())
    .sort();
  const createdAt = BigInt(Math.floor((deps.now ?? Date.now)() / 1000));

  const checkpointHash = computeCheckpointHash({
    missionId,
    sequence,
    confirmedPaymentIds,
    confirmedTxHashes,
    confirmedSpentAtomic: state.confirmedSpentAtomic,
    maxPaymentAtomic: state.maxPaymentAtomic,
    recoveryMaxPaymentAtomic: state.recoveryMaxPaymentAtomic,
    policyVersion: mission.policy_version,
    policyHash: state.policyHash,
    createdAt,
  });

  const committed = await deps.commitCheckpoint({
    missionAddress,
    sequence: BigInt(sequence),
    checkpointHash,
    expectedVersion,
  });

  await deps.insertCheckpoint({
    mission_id: missionId,
    sequence,
    status: 'VERIFIED',
    checkpoint_hash: checkpointHash,
    confirmed_payment_ids: confirmedPaymentIds,
    confirmed_transaction_hashes: confirmedTxHashes,
    hsp_mandate_ids: confirmedPaymentIds,
    confirmed_spent_atomic: state.confirmedSpentAtomic.toString(),
    policy_version: mission.policy_version,
    policy_hash: state.policyHash,
    committed_tx_hash: committed.txHash,
  });

  await deps.insertAuditEvent({
    mission_id: missionId,
    event_type: 'checkpoint.verified',
    actor_type: 'runtime',
    actor_id: null,
    event_hash: auditEventHash([missionId, 'checkpoint.verified', sequence, checkpointHash]),
    payload_public: {
      sequence,
      checkpointHash,
      txHash: committed.txHash,
      confirmedPaymentIds,
      confirmedTxHashes,
      hspMandateIds: confirmedPaymentIds,
      confirmedSpentAtomic: state.confirmedSpentAtomic.toString(),
      policyVersion: mission.policy_version,
      policyHash: state.policyHash,
    },
    onchain_tx_hash: committed.txHash,
  });

  return { sequence, checkpointHash, txHash: committed.txHash };
}
