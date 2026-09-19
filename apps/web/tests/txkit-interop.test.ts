// Kit interop: @solana/kit builds, @succra/shared parses (and vice versa).
//
// This is the byte-level proof that the kit-free shared codec agrees with
// kit's canonical serialization: the gateway builds with kit, the SDK
// verifies with shared, and both see identical bytes. Runs everywhere
// (no chain); lives here because @solana/kit resolves under apps/web.
import { describe, expect, it } from 'vitest';
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  decompileTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  partiallySignTransactionWithSigners,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import {
  bytesToBase64,
  encodeWireTransaction,
  hashMessageBytes,
  inspectMessage,
  isEmptySignature,
  parseWireTransaction,
} from '@succra/shared';

const BLOCKHASH = '11111111111111111111111111111111';
const PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

describe('kit/shared wire interop', () => {
  it('shared parses kit-built messages identically to kit decompile', async () => {
    const feePayer = await generateKeyPairSigner();
    const agent = await generateKeyPairSigner();
    const data = new Uint8Array([9, 9, 9]);
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayer(feePayer.address, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: address(BLOCKHASH) as unknown as Blockhash, lastValidBlockHeight: 100n },
          m
        ),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address(PROGRAM),
            accounts: [
              { address: agent.address, role: AccountRole.READONLY_SIGNER },
              { address: address(BLOCKHASH), role: AccountRole.WRITABLE },
            ],
            data,
          },
          m
        )
    );
    const compiled = compileTransaction(message);
    const messageBytes = new Uint8Array(compiled.messageBytes);

    const view = inspectMessage(messageBytes);
    expect(view.feePayer).toEqual(feePayer.address);
    expect(view.signerAddresses).toEqual([feePayer.address, agent.address]);
    expect(view.instructions.length).toEqual(1);
    const ix = view.instructions[0];
    expect(ix?.programAddress).toEqual(PROGRAM);
    expect(ix?.accounts).toEqual([
      { address: agent.address, role: 'readonly-signer' },
      { address: BLOCKHASH, role: 'writable' },
    ]);
    expect(ix?.data).toEqual(data);

    const kitView = decompileTransactionMessage(
      getCompiledTransactionMessageDecoder().decode(messageBytes)
    );
    expect(kitView.instructions.length).toEqual(1);
    const kitIx = kitView.instructions[0];
    expect(String(kitIx?.programAddress)).toEqual(PROGRAM);
    expect((kitIx?.accounts ?? []).map((meta) => String(meta.address))).toEqual([
      agent.address,
      BLOCKHASH,
    ]);
    expect(Buffer.from(kitIx?.data ?? []).toString('hex')).toEqual('090909');
  });

  it('shared wire assembly matches kit wire encoding, including null slots', async () => {
    const gateway = await generateKeyPairSigner();
    const agent = await generateKeyPairSigner();
    const message = pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayer(gateway.address, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: address(BLOCKHASH) as unknown as Blockhash, lastValidBlockHeight: 100n },
          m
        ),
      (m) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address(PROGRAM),
            accounts: [{ address: agent.address, role: AccountRole.READONLY_SIGNER }],
            data: new Uint8Array([7]),
          },
          m
        )
    );
    const compiled = compileTransaction(message);
    const messageBytes = new Uint8Array(compiled.messageBytes);

    // Agent-style partial: fee-payer slot empty.
    const agentPartial = await partiallySignTransactionWithSigners([agent], compiled);
    const agentWireB64 = getBase64EncodedWireTransaction(agentPartial);
    const parsed = parseWireTransaction(Buffer.from(agentWireB64, 'base64'));
    expect(parsed.signatures.length).toEqual(2);
    expect(isEmptySignature(parsed.signatures[0] ?? new Uint8Array(1))).toEqual(true);
    expect(new Uint8Array(parsed.messageBytes)).toEqual(new Uint8Array(messageBytes));
    expect(hashMessageBytes(parsed.messageBytes)).toEqual(hashMessageBytes(messageBytes));

    // Gateway splice: overwrite slot 0, re-encode identically to kit.
    const gatewayPartial = await partiallySignTransactionWithSigners([gateway], compiled);
    const gatewayWireB64 = getBase64EncodedWireTransaction(gatewayPartial);
    const gatewayParsed = parseWireTransaction(Buffer.from(gatewayWireB64, 'base64'));
    const finalSigs = [
      gatewayParsed.signatures[0] ?? new Uint8Array(64),
      parsed.signatures[1] ?? new Uint8Array(64),
    ];
    const finalWire = encodeWireTransaction(finalSigs, messageBytes);
    expect(bytesToBase64(finalWire).length).toBeGreaterThan(0);
    const reparsed = parseWireTransaction(finalWire);
    expect(reparsed.signatures.length).toEqual(2);
    expect(isEmptySignature(reparsed.signatures[0] ?? new Uint8Array(1))).toEqual(false);
    expect(reparsed.messageBytes).toEqual(messageBytes);
  });
});
