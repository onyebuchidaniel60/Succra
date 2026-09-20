// Shared succession codec tests (pure, no chain).
import { describe, expect, it } from 'vitest';
import {
  ACKNOWLEDGE_RECOVERY_DATA_LEN,
  ACTIVATE_SUCCESSOR_DATA_LEN,
  acknowledgeRecoveryDiscriminator,
  activateSuccessorDiscriminator,
  bytesToBase58,
  decodeAcknowledgeRecovery,
  decodeActivateSuccessor,
  encodeAcknowledgeRecovery,
  encodeActivateSuccessor,
  planAcknowledgeRecoveryInstruction,
  planActivateSuccessorInstruction,
} from '../src/index.js';

const PROGRAM = bytesToBase58(new Uint8Array(32).fill(9));
const GUARDIAN = bytesToBase58(new Uint8Array(32).fill(10));
const MISSION = bytesToBase58(new Uint8Array(32).fill(11));
const SUCCESSOR = bytesToBase58(new Uint8Array(32).fill(12));

function successorBytes(): Uint8Array {
  const out = new Uint8Array(32).fill(12);
  return out;
}

describe('activate_successor instruction codec', () => {
  it('encodes discriminator + successor + version (48 bytes)', () => {
    const data = encodeActivateSuccessor({ successor: successorBytes(), expectedVersion: 2n });
    expect(data.length).toEqual(ACTIVATE_SUCCESSOR_DATA_LEN);
    expect([...data.subarray(0, 8)]).toEqual([...activateSuccessorDiscriminator()]);
    expect([...data.subarray(8, 40)]).toEqual([...successorBytes()]);
    const view = new DataView(data.buffer, data.byteOffset + 40, 8);
    expect(view.getBigUint64(0, true)).toEqual(2n);
  });

  it('round-trips decode and rejects tampered bytes', () => {
    const decoded = decodeActivateSuccessor(
      encodeActivateSuccessor({ successor: successorBytes(), expectedVersion: 7n })
    );
    expect([...decoded.successor]).toEqual([...successorBytes()]);
    expect(decoded.expectedVersion).toEqual(7n);
    const bad = new Uint8Array(
      encodeActivateSuccessor({ successor: successorBytes(), expectedVersion: 7n })
    );
    bad[0] = (bad[0] ?? 0) ^ 0xff;
    expect(() => decodeActivateSuccessor(bad)).toThrow();
    expect(() => decodeActivateSuccessor(new Uint8Array(47))).toThrow();
  });

  it('plans guardian-signer + writable mission in struct order', () => {
    const planned = planActivateSuccessorInstruction(
      PROGRAM,
      { guardian: GUARDIAN, mission: MISSION },
      { successorBase58: SUCCESSOR, expectedVersion: 2n }
    );
    expect(planned.programAddress).toEqual(PROGRAM);
    expect(planned.accounts).toEqual([
      { address: GUARDIAN, role: 'readonly-signer' },
      { address: MISSION, role: 'writable' },
    ]);
    // Only two accounts: no vault, token, or system accounts can move
    // funds through this instruction by construction.
    expect(planned.accounts.length).toEqual(2);
  });
});

describe('acknowledge_recovery instruction codec', () => {
  it('encodes discriminator + version (16 bytes)', () => {
    const data = encodeAcknowledgeRecovery(3n);
    expect(data.length).toEqual(ACKNOWLEDGE_RECOVERY_DATA_LEN);
    expect([...data.subarray(0, 8)]).toEqual([...acknowledgeRecoveryDiscriminator()]);
    const view = new DataView(data.buffer, data.byteOffset + 8, 8);
    expect(view.getBigUint64(0, true)).toEqual(3n);
  });

  it('round-trips decode and rejects tampered bytes', () => {
    expect(decodeAcknowledgeRecovery(encodeAcknowledgeRecovery(5n)).expectedVersion).toEqual(5n);
    const bad = new Uint8Array(encodeAcknowledgeRecovery(5n));
    bad[0] = (bad[0] ?? 0) ^ 0xff;
    expect(() => decodeAcknowledgeRecovery(bad)).toThrow();
    expect(() => decodeAcknowledgeRecovery(new Uint8Array(15))).toThrow();
  });

  it('plans guardian-signer + writable mission in struct order', () => {
    const planned = planAcknowledgeRecoveryInstruction(
      PROGRAM,
      { guardian: GUARDIAN, mission: MISSION },
      { expectedVersion: 3n }
    );
    expect(planned.programAddress).toEqual(PROGRAM);
    expect(planned.accounts).toEqual([
      { address: GUARDIAN, role: 'readonly-signer' },
      { address: MISSION, role: 'writable' },
    ]);
    expect(planned.accounts.length).toEqual(2);
  });
});
