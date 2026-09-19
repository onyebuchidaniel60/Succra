// SDK verify-before-sign tests (no chain, kit-free).
//
// Messages are assembled by a test-only builder below (plain legacy
// layout). Kit-built interop for the same verify path is covered by
// apps/web/tests/txkit-interop.test.ts and the live Alpha test.
import { describe, expect, it } from 'vitest';
import { sign } from 'tweetnacl';
import {
  addressToBytes,
  bytesToBase58,
  bytesToBase64,
  encodeExecuteAction,
  inspectMessage,
  messageFromBase64,
  parseWireTransaction,
  TOKEN_PROGRAM_ID,
} from '@succra/shared';
import { SdkRefusal } from '../src/errors.js';
import { createAgentKeypair } from '../src/keys.js';
import { verifyAndSignPreflight, type ExpectedAction } from '../src/verify.js';

/** Test-only legacy message assembler: header + keys + blockhash + ixes. */
function assembleMessage(args: {
  keys: Uint8Array[];
  instructions: Array<{ program: number; accounts: number[]; data: Uint8Array }>;
}): Uint8Array {
  // Header [2,1,3]: fee payer + agent sign; program/sys/token readonly.
  // Matches kit's compiled output (accounts deduplicated).
  const out: number[] = [2, 1, 3, args.keys.length];
  for (const key of args.keys) out.push(...key);
  out.push(...new Uint8Array(32).fill(5));
  out.push(args.instructions.length);
  for (const ix of args.instructions) {
    out.push(ix.program);
    out.push(ix.accounts.length, ...ix.accounts);
    out.push(ix.data.length, ...ix.data);
  }
  return new Uint8Array(out);
}

interface Vector {
  messageB64: string;
  expected: ExpectedAction;
  agentSecret: Uint8Array;
  agentBase58: string;
}

/** Correct vector: deduplicated keys, execute ix with the program twice. */
function buildVector(): Vector {
  const feePayer = new Uint8Array(32).fill(10);
  const agent = createAgentKeypair();
  const mission = new Uint8Array(32).fill(20);
  const recipient = new Uint8Array(32).fill(30);
  const vault = new Uint8Array(32).fill(40);
  const sys = new Uint8Array(32).fill(0);
  const token = addressToBytes(TOKEN_PROGRAM_ID);
  const program = new Uint8Array(32).fill(60);
  const data = encodeExecuteAction({
    actionType: 'TRANSFER_SOL',
    recipient,
    amount: 1000n,
    nonce: 3n,
  });
  const messageBytes = assembleMessage({
    keys: [feePayer, agent.publicKey, mission, recipient, vault, program, sys, token],
    instructions: [{ program: 5, accounts: [1, 2, 3, 4, 5, 5, 6, 7], data }],
  });
  return {
    messageB64: bytesToBase64(messageBytes),
    expected: {
      programId: bytesToBase58(program),
      agent: bytesToBase58(agent.publicKey),
      mission: bytesToBase58(mission),
      vault: bytesToBase58(vault),
      recipient: bytesToBase58(recipient),
      actionType: 'TRANSFER_SOL',
      amountAtomic: '1000',
      agentNonce: '3',
    },
    agentSecret: agent.secretKey,
    agentBase58: bytesToBase58(agent.publicKey),
  };
}

/** Rebuild the vector message with mutated instruction data. */
function rebuildWithData(vector: Vector, data: Uint8Array): string {
  const msg = messageFromBase64(vector.messageB64);
  const parsed = inspectMessage(msg);
  void parsed;
  const keys = [
    new Uint8Array(32).fill(10),
    addressToBytes(vector.expected.agent),
    addressToBytes(vector.expected.mission),
    addressToBytes(vector.expected.recipient),
    addressToBytes(vector.expected.vault),
    new Uint8Array(32).fill(0),
    addressToBytes(TOKEN_PROGRAM_ID),
    addressToBytes(vector.expected.programId),
  ];
  return bytesToBase64(
    assembleMessage({ keys, instructions: [{ program: 7, accounts: [1, 2, 3, 4, 5, 6], data }] })
  );
}

describe('verify-before-sign', () => {
  it('accepts an exact match and returns an agent-signed wire transaction', () => {
    const vector = buildVector();
    const agentBytes = addressToBytes(vector.agentBase58);
    const { signedTransaction } = verifyAndSignPreflight({
      unsignedTransaction: vector.messageB64,
      expected: vector.expected,
      agentSecretKey: vector.agentSecret,
    });
    const parsed = parseWireTransaction(messageFromBase64(signedTransaction));
    expect(parsed.signatures.length).toEqual(2);
    expect(parsed.messageBytes).toEqual(messageFromBase64(vector.messageB64));
    expect(
      sign.detached.verify(
        parsed.messageBytes,
        parsed.signatures[1] ?? new Uint8Array(0),
        agentBytes
      )
    ).toEqual(true);
  });

  it('refuses tampered amount, recipient, type, and nonce', () => {
    const vector = buildVector();
    const original = inspectMessage(messageFromBase64(vector.messageB64)).instructions[0]?.data;
    if (!original) throw new Error('vector has no instruction');
    const mutate = (index: number, xor: number): string => {
      const copy = new Uint8Array(original);
      copy[index] = (copy[index] ?? 0) ^ xor;
      return rebuildWithData(vector, copy);
    };
    // amount byte, recipient byte, action-type byte, nonce byte.
    for (const bad of [mutate(41, 0x01), mutate(9, 0x01), mutate(8, 0x01), mutate(49, 0x01)]) {
      expect(() =>
        verifyAndSignPreflight({
          unsignedTransaction: bad,
          expected: vector.expected,
          agentSecretKey: vector.agentSecret,
        })
      ).toThrow(SdkRefusal);
    }
  });

  it('refuses program, mission, and signer mismatches plus malformed input', () => {
    const vector = buildVector();
    const otherProgram = bytesToBase58(new Uint8Array(32).fill(61));
    const otherMission = bytesToBase58(new Uint8Array(32).fill(21));
    expect(() =>
      verifyAndSignPreflight({
        unsignedTransaction: vector.messageB64,
        expected: { ...vector.expected, programId: otherProgram },
        agentSecretKey: vector.agentSecret,
      })
    ).toThrow(SdkRefusal);
    expect(() =>
      verifyAndSignPreflight({
        unsignedTransaction: vector.messageB64,
        expected: { ...vector.expected, mission: otherMission },
        agentSecretKey: vector.agentSecret,
      })
    ).toThrow(SdkRefusal);
    expect(() =>
      verifyAndSignPreflight({
        unsignedTransaction: vector.messageB64,
        expected: vector.expected,
        agentSecretKey: new Uint8Array(32),
      })
    ).toThrow(SdkRefusal);
    expect(() =>
      verifyAndSignPreflight({
        unsignedTransaction: '!!!',
        expected: vector.expected,
        agentSecretKey: vector.agentSecret,
      })
    ).toThrow(SdkRefusal);
  });

  it('refuses multi-instruction messages', () => {
    const vector = buildVector();
    const msg = messageFromBase64(vector.messageB64);
    const parsed = inspectMessage(msg);
    const data = parsed.instructions[0]?.data ?? new Uint8Array(0);
    const keys = [
      new Uint8Array(32).fill(10),
      addressToBytes(vector.expected.agent),
      addressToBytes(vector.expected.mission),
      addressToBytes(vector.expected.recipient),
      addressToBytes(vector.expected.vault),
      new Uint8Array(32).fill(0),
      addressToBytes(TOKEN_PROGRAM_ID),
      addressToBytes(vector.expected.programId),
    ];
    const multi = bytesToBase64(
      assembleMessage({
        keys,
        instructions: [
          { program: 7, accounts: [1, 2, 3, 4, 5, 6], data },
          { program: 7, accounts: [1], data: new Uint8Array([0]) },
        ],
      })
    );
    expect(() =>
      verifyAndSignPreflight({
        unsignedTransaction: multi,
        expected: vector.expected,
        agentSecretKey: vector.agentSecret,
      })
    ).toThrow(SdkRefusal);
  });
});
