// Succra shared — quarantine instruction codec (pure, kit-free).
//
// Mirrors programs/succra/src/lib.rs `Quarantine` exactly:
// - discriminator: first 8 bytes of SHA-256("global:quarantine").
// - args: none (8 bytes total).
// - accounts in struct order: guardian (signer, readonly at the
//   instruction level — fee-payer writability is a message-level
//   property the gateway's kit builder assigns), mission (writable).
//
// Kit-free by design, like execute-ix.ts: only the gateway compiles
// messages. Byte-equality against the Anchor client is proven by the
// mocha program suite (gateway-planned vs anchor-built comparison).
import { createHash } from 'node:crypto';
import type { PlannedAccount, PlannedInstruction } from './execute-ix.js';

export const QUARANTINE_DATA_LEN = 8;

/** First 8 bytes of SHA-256("global:quarantine") (Anchor convention). */
export function quarantineDiscriminator(): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update('global:quarantine', 'utf8').digest().subarray(0, 8)
  );
}

/** Encode the quarantine instruction data (discriminator only). */
export function encodeQuarantineAction(): Uint8Array {
  return quarantineDiscriminator();
}

/** Validate quarantine instruction data. Throws on mismatch. */
export function decodeQuarantineAction(data: Uint8Array): void {
  if (data.length !== QUARANTINE_DATA_LEN) {
    throw new Error('Quarantine instruction has an invalid length.');
  }
  const expected = quarantineDiscriminator();
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== expected[i]) {
      throw new Error('Quarantine instruction has an invalid discriminator.');
    }
  }
}

export interface QuarantineAccounts {
  guardian: string;
  mission: string;
}

/**
 * Plan the quarantine instruction (program, ordered account metas, data).
 * The gateway maps this to a kit Instruction with the guardian as both
 * fee payer and authority signer; the mission is the only written account,
 * so the guardian can never move funds through this instruction.
 */
export function planQuarantineInstruction(
  programId: string,
  accounts: QuarantineAccounts
): PlannedInstruction {
  const metas: PlannedAccount[] = [
    { address: accounts.guardian, role: 'readonly-signer' },
    { address: accounts.mission, role: 'writable' },
  ];
  return {
    programAddress: programId,
    accounts: metas,
    data: encodeQuarantineAction(),
  };
}
