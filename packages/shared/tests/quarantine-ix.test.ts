// Shared quarantine codec tests (pure, no chain).
import { describe, expect, it } from 'vitest';
import {
  decodeQuarantineAction,
  encodeQuarantineAction,
  planQuarantineInstruction,
  quarantineDiscriminator,
  QUARANTINE_DATA_LEN,
} from '../src/index.js';
import { bytesToBase58 } from '../src/index.js';

const PROGRAM = bytesToBase58(new Uint8Array(32).fill(9));
const GUARDIAN = bytesToBase58(new Uint8Array(32).fill(10));
const MISSION = bytesToBase58(new Uint8Array(32).fill(11));

describe('quarantine instruction codec', () => {
  it('encodes the 8-byte discriminator only', () => {
    const data = encodeQuarantineAction();
    expect(data.length).toEqual(QUARANTINE_DATA_LEN);
    expect([...data]).toEqual([...quarantineDiscriminator()]);
  });

  it('round-trips decode and rejects tampered bytes', () => {
    expect(() => decodeQuarantineAction(encodeQuarantineAction())).not.toThrow();
    const bad = new Uint8Array(encodeQuarantineAction());
    bad[0] = (bad[0] ?? 0) ^ 0xff;
    expect(() => decodeQuarantineAction(bad)).toThrow();
    expect(() => decodeQuarantineAction(new Uint8Array(7))).toThrow();
  });

  it('plans guardian-signer + writable mission in struct order', () => {
    const planned = planQuarantineInstruction(PROGRAM, { guardian: GUARDIAN, mission: MISSION });
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
