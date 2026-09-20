// Succra shared — succession instruction codecs (pure, kit-free).
//
// Mirrors programs/succra/src/lib.rs `ActivateSuccessor` and
// `AcknowledgeRecovery` exactly:
// - activate_successor data: discriminator (8) + successor Pubkey (32)
//   + expected_version u64 LE (8) = 48 bytes total.
// - acknowledge_recovery data: discriminator (8) + expected_version
//   u64 LE (8) = 16 bytes total.
// - accounts in struct order: guardian (signer), mission (writable).
//   Neither instruction touches vault accounts: succession moves
//   authority, never funds, by construction.
//
// Kit-free by design, like execute-ix.ts: only the gateway compiles
// messages. Byte-equality against the Anchor client is proven by the
// mocha program suite (gateway-planned vs anchor-built comparison).
import { createHash } from 'node:crypto';
import { base58ToBytes32 } from './base.js';
import type { PlannedAccount, PlannedInstruction } from './execute-ix.js';

export const ACTIVATE_SUCCESSOR_DATA_LEN = 8 + 32 + 8;
export const ACKNOWLEDGE_RECOVERY_DATA_LEN = 8 + 8;

/** First 8 bytes of SHA-256("global:activate_successor") (Anchor convention). */
export function activateSuccessorDiscriminator(): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update('global:activate_successor', 'utf8').digest().subarray(0, 8)
  );
}

/** First 8 bytes of SHA-256("global:acknowledge_recovery") (Anchor convention). */
export function acknowledgeRecoveryDiscriminator(): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update('global:acknowledge_recovery', 'utf8').digest().subarray(0, 8)
  );
}

function writeU64LE(out: Uint8Array, offset: number, value: bigint): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error('u64 out of range.');
  }
  const view = new DataView(out.buffer, out.byteOffset + offset, 8);
  view.setBigUint64(0, value, true);
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
}

export interface ActivateSuccessorArgs {
  /** 32-byte successor pubkey. */
  successor: Uint8Array;
  expectedVersion: bigint;
}

/** Borsh-encode activate_successor instruction data (48 bytes). */
export function encodeActivateSuccessor(args: ActivateSuccessorArgs): Uint8Array {
  if (args.successor.length !== 32) {
    throw new Error('Successor must be 32 bytes.');
  }
  const out = new Uint8Array(ACTIVATE_SUCCESSOR_DATA_LEN);
  out.set(activateSuccessorDiscriminator(), 0);
  out.set(args.successor, 8);
  writeU64LE(out, 40, args.expectedVersion);
  return out;
}

/** Decode + validate activate_successor instruction data. Throws on mismatch. */
export function decodeActivateSuccessor(data: Uint8Array): ActivateSuccessorArgs {
  if (data.length !== ACTIVATE_SUCCESSOR_DATA_LEN) {
    throw new Error('Activate-successor instruction has an invalid length.');
  }
  const expected = activateSuccessorDiscriminator();
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== expected[i]) {
      throw new Error('Activate-successor instruction has an invalid discriminator.');
    }
  }
  return {
    successor: data.subarray(8, 40),
    expectedVersion: readU64LE(data, 40),
  };
}

/** Borsh-encode acknowledge_recovery instruction data (16 bytes). */
export function encodeAcknowledgeRecovery(expectedVersion: bigint): Uint8Array {
  const out = new Uint8Array(ACKNOWLEDGE_RECOVERY_DATA_LEN);
  out.set(acknowledgeRecoveryDiscriminator(), 0);
  writeU64LE(out, 8, expectedVersion);
  return out;
}

/** Decode + validate acknowledge_recovery instruction data. Throws on mismatch. */
export function decodeAcknowledgeRecovery(data: Uint8Array): { expectedVersion: bigint } {
  if (data.length !== ACKNOWLEDGE_RECOVERY_DATA_LEN) {
    throw new Error('Acknowledge-recovery instruction has an invalid length.');
  }
  const expected = acknowledgeRecoveryDiscriminator();
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== expected[i]) {
      throw new Error('Acknowledge-recovery instruction has an invalid discriminator.');
    }
  }
  return { expectedVersion: readU64LE(data, 8) };
}

export interface SuccessionAccounts {
  guardian: string;
  mission: string;
}

function successionMetas(accounts: SuccessionAccounts): PlannedAccount[] {
  return [
    { address: accounts.guardian, role: 'readonly-signer' },
    { address: accounts.mission, role: 'writable' },
  ];
}

/**
 * Plan the activate_successor instruction (program, ordered account
 * metas, data). The gateway maps this to a kit Instruction with the
 * guardian as both fee payer and authority signer; the mission is the
 * only written account, so the guardian can never move funds through
 * this instruction.
 */
export function planActivateSuccessorInstruction(
  programId: string,
  accounts: SuccessionAccounts,
  args: { successorBase58: string; expectedVersion: bigint }
): PlannedInstruction {
  return {
    programAddress: programId,
    accounts: successionMetas(accounts),
    data: encodeActivateSuccessor({
      successor: base58ToBytes32(args.successorBase58),
      expectedVersion: args.expectedVersion,
    }),
  };
}

/**
 * Plan the acknowledge_recovery instruction. Same account shape as
 * activation; data carries only the expected state version.
 */
export function planAcknowledgeRecoveryInstruction(
  programId: string,
  accounts: SuccessionAccounts,
  args: { expectedVersion: bigint }
): PlannedInstruction {
  return {
    programAddress: programId,
    accounts: successionMetas(accounts),
    data: encodeAcknowledgeRecovery(args.expectedVersion),
  };
}
