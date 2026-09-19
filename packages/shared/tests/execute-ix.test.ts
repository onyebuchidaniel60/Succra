// execute_action codec tests (run everywhere, no chain, kit-free).
import { describe, expect, it } from 'vitest';
import {
  decodeExecuteAction,
  encodeExecuteAction,
  EXECUTE_ACTION_DATA_LEN,
  executeActionDiscriminator,
  planExecuteInstruction,
} from '../src/execute-ix.js';

const AGENT = '11111111111111111111111111111111';
const MISSION = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const RECIPIENT = 'ATokenGPvbdGVxr1b2hvZbsiqY3sqWHfRaidRTpgzwP';
const PROGRAM = 'SysvarC1ock11111111111111111111111111111111';

describe('execute_action codec', () => {
  it('discriminator is stable and 8 bytes', () => {
    const first = executeActionDiscriminator();
    expect(first.length).toEqual(8);
    expect(executeActionDiscriminator()).toEqual(first);
  });

  it('encodes to exactly 57 bytes with the documented layout', () => {
    const recipient = new Uint8Array(32).fill(9);
    const encoded = encodeExecuteAction({
      actionType: 'TRANSFER_SOL',
      recipient,
      amount: 1_000_000n,
      nonce: 14n,
    });
    expect(encoded.length).toEqual(EXECUTE_ACTION_DATA_LEN);
    expect(encoded.subarray(0, 8)).toEqual(executeActionDiscriminator());
    expect(encoded[8]).toEqual(0);
    expect(encoded.subarray(9, 41)).toEqual(recipient);
    const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.length);
    expect(view.getBigUint64(41, true)).toEqual(1_000_000n);
    expect(view.getBigUint64(49, true)).toEqual(14n);
  });

  it('round-trips SOL and SPL args', () => {
    for (const actionType of ['TRANSFER_SOL', 'TRANSFER_SPL'] as const) {
      const args = {
        actionType,
        recipient: new Uint8Array(32).fill(3),
        amount: 42n,
        nonce: 7n,
      };
      expect(decodeExecuteAction(encodeExecuteAction(args))).toEqual(args);
    }
  });

  it('rejects tampered data', () => {
    const good = encodeExecuteAction({
      actionType: 'TRANSFER_SOL',
      recipient: new Uint8Array(32).fill(3),
      amount: 42n,
      nonce: 7n,
    });
    const badDiscriminator = new Uint8Array(good);
    badDiscriminator[0] = (badDiscriminator[0] ?? 0) ^ 0xff;
    expect(() => decodeExecuteAction(badDiscriminator)).toThrow();
    const badType = new Uint8Array(good);
    badType[8] = 2;
    expect(() => decodeExecuteAction(badType)).toThrow();
    expect(() => decodeExecuteAction(good.subarray(0, 56))).toThrow();
    const badAmount = new Uint8Array(good);
    badAmount[41] = (badAmount[41] ?? 0) ^ 0x01;
    expect(decodeExecuteAction(badAmount).amount).not.toEqual(42n);
  });

  it('plans the SOL instruction with program-id placeholders for None optionals', () => {
    const ix = planExecuteInstruction(
      PROGRAM,
      { agent: AGENT, mission: MISSION, recipient: RECIPIENT, vault: MISSION },
      { actionType: 'TRANSFER_SOL', recipient: new Uint8Array(32).fill(1), amount: 5n, nonce: 1n }
    );
    expect(ix.programAddress).toEqual(PROGRAM);
    expect(ix.accounts.length).toEqual(8);
    expect(ix.accounts[0]).toEqual({ address: AGENT, role: 'readonly-signer' });
    expect(ix.accounts[1]).toEqual({ address: MISSION, role: 'writable' });
    expect(ix.accounts[2]).toEqual({ address: RECIPIENT, role: 'writable' });
    expect(ix.accounts[3]).toEqual({ address: MISSION, role: 'writable' });
    // None optionals become the program id, readonly (anchor client parity).
    expect(ix.accounts[4]).toEqual({ address: PROGRAM, role: 'readonly' });
    expect(ix.accounts[5]).toEqual({ address: PROGRAM, role: 'readonly' });
  });

  it('requires SPL accounts on the SPL path and appends them in order', () => {
    const base = { agent: AGENT, mission: MISSION, recipient: RECIPIENT, vault: MISSION };
    const args = {
      actionType: 'TRANSFER_SPL' as const,
      recipient: new Uint8Array(32).fill(1),
      amount: 5n,
      nonce: 1n,
    };
    expect(() => planExecuteInstruction(PROGRAM, base, args)).toThrow();
    const ix = planExecuteInstruction(
      PROGRAM,
      { ...base, splVault: AGENT, recipientTokenAccount: RECIPIENT },
      args
    );
    expect(ix.accounts.length).toEqual(8);
    expect(ix.accounts[4]).toEqual({ address: AGENT, role: 'writable' });
    expect(ix.accounts[5]).toEqual({ address: RECIPIENT, role: 'writable' });
  });
});
