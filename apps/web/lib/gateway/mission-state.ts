// Succra gateway — on-chain Mission account decoding.
//
// Byte layout mirrors programs/succra/src/state.rs exactly:
// discriminator(8), owner(32), mission_id u64, vault_bump u8, mint(32),
// budget u64, remaining u64, max_action u64, recovery_max u64,
// allowed_action_types vec<u8-enum>, allowed_recipients vec<Pubkey>,
// expires_at i64, violation_threshold u8, violation_window u64,
// status u8 (Draft = 0, Active = 1, Cancelled = 2, Quarantined = 3,
// Recovering = 4, ActiveRecovery = 5),
// current_agent(32), agent_nonce u64, successors vec<Pubkey>,
// state_version u64.
// Anchor allocates the FULL Mission::LEN on init, so live accounts carry
// zero padding past the serialized struct: the decoder verifies the
// account discriminator (like Anchor does) and requires trailing bytes,
// if any, to be all zeros. Decoding is validated against
// anchor-decoded accounts by the validator-gated comparison test.
// Unknown status discriminants fail closed (FR-03 amendment): never
// default to Active.
import { createHash } from 'node:crypto';
import { bytesToBase58 } from '@succra/shared';

export type OnchainMissionStatus =
  | 'Draft'
  | 'Active'
  | 'Cancelled'
  | 'Quarantined'
  | 'Recovering'
  | 'ActiveRecovery';

export interface OnchainMissionState {
  address: string;
  owner: string;
  missionId: bigint;
  mint: string;
  budget: bigint;
  remainingBudget: bigint;
  maxAction: bigint;
  /** Successor per-action ceiling (FR-06; enforced on-chain in Phase 6). */
  recoveryMaxAction: bigint;
  allowedActionTypes: string[];
  allowedRecipients: string[];
  expiresAtSec: bigint;
  /** Per-mission consecutive-violation trigger (authoritative for Phase 5 streaks). */
  violationThreshold: number;
  /** Rolling window in seconds for the violation streak (authoritative). */
  violationWindowSeconds: bigint;
  status: OnchainMissionStatus;
  currentAgent: string;
  agentNonce: bigint;
  /** Pre-approved successor allowlist, on-chain order (FR-05 tie-break). */
  successors: string[];
  /** Monotonic state version (0 at creation, +1 per status transition). */
  stateVersion: bigint;
}

class MissionReader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  remaining(): number {
    return this.bytes.length - this.offset;
  }

  take(count: number): Uint8Array {
    if (this.remaining() < count) {
      throw new Error('Mission account is truncated.');
    }
    const slice = this.bytes.subarray(this.offset, this.offset + count);
    this.offset += count;
    return slice;
  }

  u8(): number {
    return this.take(1)[0] ?? 255;
  }

  u32(): number {
    const bytes = this.take(4);
    return (
      (bytes[0] ?? 0) + ((bytes[1] ?? 0) << 8) + ((bytes[2] ?? 0) << 16) + ((bytes[3] ?? 0) << 24)
    );
  }

  u64(): bigint {
    const bytes = this.take(8);
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    return view.getBigUint64(0, true);
  }

  i64(): bigint {
    const bytes = this.take(8);
    const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
    return view.getBigInt64(0, true);
  }

  pubkey(): string {
    return bytesToBase58(this.take(32));
  }
}

const ACTION_TYPE_NAMES = ['TRANSFER_SOL', 'TRANSFER_SPL'] as const;

/** Anchor account discriminator: first 8 bytes of SHA-256("account:Mission"). */
export function missionDiscriminator(): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update('account:Mission', 'utf8').digest().subarray(0, 8)
  );
}

/** Decode a Mission account. Throws on any malformed input. */
export function decodeMissionAccount(address: string, data: Uint8Array): OnchainMissionState {
  const reader = new MissionReader(data);
  const discriminator = reader.take(8);
  const expected = missionDiscriminator();
  for (let i = 0; i < 8; i += 1) {
    if (discriminator[i] !== expected[i]) {
      throw new Error('Mission account has an invalid discriminator.');
    }
  }
  const owner = reader.pubkey();
  const missionId = reader.u64();
  reader.take(1); // vault_bump
  const mint = reader.pubkey();
  const budget = reader.u64();
  const remainingBudget = reader.u64();
  const maxAction = reader.u64();
  const recoveryMaxAction = reader.u64();
  const typeCount = reader.u32();
  if (typeCount > 8) {
    throw new Error('Mission account has too many action types.');
  }
  const allowedActionTypes: string[] = [];
  for (let i = 0; i < typeCount; i += 1) {
    const index = reader.u8();
    const name = ACTION_TYPE_NAMES[index];
    if (!name) {
      throw new Error('Mission account has an unknown action type.');
    }
    allowedActionTypes.push(name);
  }
  const recipientCount = reader.u32();
  if (recipientCount > 16) {
    throw new Error('Mission account has too many recipients.');
  }
  const allowedRecipients: string[] = [];
  for (let i = 0; i < recipientCount; i += 1) {
    allowedRecipients.push(reader.pubkey());
  }
  const expiresAtSec = reader.i64();
  const violationThreshold = reader.u8();
  const violationWindowSeconds = reader.u64();
  const statusIndex = reader.u8();
  let status: OnchainMissionStatus;
  if (statusIndex === 0) {
    status = 'Draft';
  } else if (statusIndex === 1) {
    status = 'Active';
  } else if (statusIndex === 2) {
    status = 'Cancelled';
  } else if (statusIndex === 3) {
    status = 'Quarantined';
  } else if (statusIndex === 4) {
    status = 'Recovering';
  } else if (statusIndex === 5) {
    status = 'ActiveRecovery';
  } else {
    throw new Error('Mission account has an unknown status.');
  }
  const currentAgent = reader.pubkey();
  const agentNonce = reader.u64();
  const successorCount = reader.u32();
  if (successorCount > 8) {
    throw new Error('Mission account has too many successors.');
  }
  const successors: string[] = [];
  for (let i = 0; i < successorCount; i += 1) {
    successors.push(reader.pubkey());
  }
  const stateVersion = reader.u64();
  // Anchor zero-fills the full LEN allocation past the serialized
  // struct; only all-zero padding is accepted here.
  for (const byte of reader.take(reader.remaining())) {
    if (byte !== 0) {
      throw new Error('Mission account has non-zero trailing bytes.');
    }
  }
  return {
    address,
    owner,
    missionId,
    mint,
    budget,
    remainingBudget,
    maxAction,
    recoveryMaxAction,
    allowedActionTypes,
    allowedRecipients,
    expiresAtSec,
    violationThreshold,
    violationWindowSeconds,
    status,
    currentAgent,
    agentNonce,
    successors,
    stateVersion,
  };
}
