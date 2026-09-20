// Succra gateway — verified checkpoints (Phase 6, FR-07 as amended).
//
// A VERIFIED checkpoint is written on every CONFIRMED action, plus an
// initial sequence=0 checkpoint when the mission becomes Active
// (cold-start guard), so a checkpoint always exists. Quarantine marks
// the latest VERIFIED checkpoint as the recovery boundary (recorded in
// the quarantine audit payload; no row mutation needed).
//
// Hashing uses ONLY the canonical Borsh preimage below
// (ARCHITECTURE.md §10 "Canonical checkpoint serialization").
// JSON.stringify-based hashing is forbidden for checkpoint hashes:
// JSON key order is not canonical across implementations.
//
// Preimage type mapping (explicit Phase 6 reading, reviewer-may-amend):
// mission_id is the DB mission UUID string (Borsh string); sequence is
// u64; confirmed_action_ids / confirmed_signatures are Vec<string>;
// budgets and limits are u64; policy_version is u32; policy_hash is a
// string; created_at is i64 unix seconds. NUMERIC(78,0) values always
// fit u64 here because the program stores budgets/limits as u64.
import { sha256Hex } from '@succra/shared';
import type { CheckpointRow, GatewayStore, NewCheckpoint } from './store';

const U64_MAX = 0xffffffffffffffffn;

function checkU64(value: bigint, field: string): void {
  if (value < 0n || value > U64_MAX) {
    throw new Error(`Checkpoint preimage field ${field} out of u64 range.`);
  }
}

class BorshWriter {
  private bytes: number[] = [];

  u8(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new Error('Borsh u8 out of range.');
    }
    this.bytes.push(value);
  }

  u32(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('Borsh u32 out of range.');
    }
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    );
  }

  u64(value: bigint): void {
    checkU64(value, 'u64');
    let rest = value;
    for (let i = 0; i < 8; i += 1) {
      this.bytes.push(Number(rest & 0xffn));
      rest >>= 8n;
    }
  }

  i64(value: bigint): void {
    if (value < -0x8000000000000000n || value > 0x7fffffffffffffffn) {
      throw new Error('Borsh i64 out of range.');
    }
    this.u64(value & U64_MAX);
  }

  str(value: string): void {
    const utf8 = new TextEncoder().encode(value);
    this.u32(utf8.length);
    for (const byte of utf8) this.bytes.push(byte);
  }

  vecStr(values: string[]): void {
    this.u32(values.length);
    for (const value of values) this.str(value);
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export interface CheckpointPreimage {
  missionId: string;
  sequence: number;
  confirmedActionIds: string[];
  confirmedSignatures: string[];
  remainingBudgetAtomic: bigint;
  maxActionAtCheckpoint: bigint;
  recoveryMaxActionAtCheckpoint: bigint;
  policyVersion: number;
  policyHash: string;
  /** Unix seconds. */
  createdAtSec: number;
}

/**
 * Borsh-encode the canonical checkpoint preimage. Field order is fixed
 * by the spec amendment; any change breaks cross-implementation
 * verification. Throws on out-of-range values (fail closed).
 */
export function encodeCheckpointPreimage(preimage: CheckpointPreimage): Uint8Array {
  if (!Number.isSafeInteger(preimage.sequence) || preimage.sequence < 0) {
    throw new Error('Checkpoint sequence must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(preimage.createdAtSec)) {
    throw new Error('Checkpoint created_at must be unix seconds.');
  }
  const writer = new BorshWriter();
  writer.str(preimage.missionId);
  writer.u64(BigInt(preimage.sequence));
  writer.vecStr(preimage.confirmedActionIds);
  writer.vecStr(preimage.confirmedSignatures);
  writer.u64(preimage.remainingBudgetAtomic);
  writer.u64(preimage.maxActionAtCheckpoint);
  writer.u64(preimage.recoveryMaxActionAtCheckpoint);
  writer.u32(preimage.policyVersion);
  writer.str(preimage.policyHash);
  writer.i64(BigInt(preimage.createdAtSec));
  return writer.finish();
}

/** SHA-256 over the canonical preimage bytes, hex-encoded. */
export function checkpointHash(preimage: CheckpointPreimage): string {
  return sha256Hex(encodeCheckpointPreimage(preimage));
}

export interface VerifiedCheckpointInput {
  missionId: string;
  /** Action order: the confirmed action's on-chain agent_nonce. */
  sequence: number;
  confirmedActionIds: string[];
  confirmedSignatures: string[];
  remainingBudgetAtomic: bigint;
  maxActionAtomic: bigint;
  recoveryMaxActionAtomic: bigint;
  policyVersion: number;
  policyHash: string;
  nowMs: number;
}

/**
 * Write a VERIFIED checkpoint row and supersede older VERIFIED rows for
 * the mission. Insert is idempotent on (mission_id, sequence): a
 * duplicate returns the existing row. committed_signature stays NULL
 * through Phase 6 (on-chain commitment deferred to Phase 9).
 */
export async function writeVerifiedCheckpoint(
  store: GatewayStore,
  input: VerifiedCheckpointInput
): Promise<CheckpointRow> {
  const createdAtSec = Math.floor(input.nowMs / 1000);
  const hash = checkpointHash({
    missionId: input.missionId,
    sequence: input.sequence,
    confirmedActionIds: input.confirmedActionIds,
    confirmedSignatures: input.confirmedSignatures,
    remainingBudgetAtomic: input.remainingBudgetAtomic,
    maxActionAtCheckpoint: input.maxActionAtomic,
    recoveryMaxActionAtCheckpoint: input.recoveryMaxActionAtomic,
    policyVersion: input.policyVersion,
    policyHash: input.policyHash,
    createdAtSec,
  });
  const row: NewCheckpoint = {
    mission_id: input.missionId,
    sequence: input.sequence,
    status: 'VERIFIED',
    checkpoint_hash: hash,
    confirmed_action_ids: input.confirmedActionIds,
    remaining_budget_atomic: input.remainingBudgetAtomic.toString(),
    state_snapshot: {
      confirmed_signatures: input.confirmedSignatures,
      authority_limits_at_checkpoint: {
        max_action: input.maxActionAtomic.toString(),
        recovery_max_action: input.recoveryMaxActionAtomic.toString(),
      },
      policy_version: input.policyVersion,
      policy_hash: input.policyHash,
    },
    committed_signature: null,
  };
  const inserted = await store.insertCheckpoint(row);
  await store.supersedeOlderCheckpoints(input.missionId, input.sequence);
  return inserted;
}

/**
 * Cold-start guard: ensure the sequence=0 activation checkpoint exists.
 * The gateway has no fund hook (funding is wallet-side), so the first
 * gateway contact after activation backfills it lazily. Idempotent.
 */
export async function ensureActivationCheckpoint(
  store: GatewayStore,
  args: {
    missionId: string;
    remainingBudgetAtomic: bigint;
    maxActionAtomic: bigint;
    recoveryMaxActionAtomic: bigint;
    policyVersion: number;
    policyHash: string;
    nowMs: number;
  }
): Promise<CheckpointRow> {
  const existing = await store.getCheckpoint(args.missionId, 0);
  if (existing) return existing;
  return writeVerifiedCheckpoint(store, {
    missionId: args.missionId,
    sequence: 0,
    confirmedActionIds: [],
    confirmedSignatures: [],
    remainingBudgetAtomic: args.remainingBudgetAtomic,
    maxActionAtomic: args.maxActionAtomic,
    recoveryMaxActionAtomic: args.recoveryMaxActionAtomic,
    policyVersion: args.policyVersion,
    policyHash: args.policyHash,
    nowMs: args.nowMs,
  });
}
