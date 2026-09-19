// Succra SDK — verify-before-sign (REQUIRED security behavior).
//
// Before signing a pre-flighted `unsignedTransaction`, the SDK
// deserializes the message and verifies the single instruction is
// EXACTLY the requested execute_action (program, ordered accounts with
// roles, and decoded args). Any deviation throws SdkRefusal and nothing
// is signed. This protects the agent against a malicious or buggy
// gateway swapping recipient, amount, action type, or mission.
import { sign } from 'tweetnacl';
import {
  addressToBytes,
  bytesToBase58,
  bytesToBase64,
  decodeExecuteAction,
  emptySignature,
  encodeWireTransaction,
  inspectMessage,
  messageFromBase64,
  planExecuteInstruction,
  type ActionTypeName,
} from '@succra/shared';
import { SdkRefusal } from './errors.js';

export interface ExpectedAction {
  programId: string;
  agent: string;
  mission: string;
  vault: string;
  recipient: string;
  actionType: ActionTypeName;
  amountAtomic: string;
  agentNonce: string;
  splVault?: string;
  recipientTokenAccount?: string;
}

function refuse(reason: string): never {
  throw new SdkRefusal(`Refusing to sign pre-flighted transaction: ${reason}`);
}

/**
 * Verify the pre-flighted message matches the requested action, sign it
 * with the agent key, and assemble the submission wire transaction
 * (fee-payer slot holds 64 zero bytes; the gateway fills it at submit).
 */
export function verifyAndSignPreflight(args: {
  unsignedTransaction: string;
  expected: ExpectedAction;
  agentSecretKey: Uint8Array;
}): { signedTransaction: string } {
  const { expected } = args;
  if (args.agentSecretKey.length !== 64) {
    throw new SdkRefusal('Agent secret key must be 64 bytes.');
  }
  let messageBytes: Uint8Array;
  try {
    messageBytes = messageFromBase64(args.unsignedTransaction);
  } catch {
    refuse('unsignedTransaction is not valid base64.');
  }
  let view;
  try {
    view = inspectMessage(messageBytes);
  } catch {
    refuse('unsignedTransaction does not parse as a legacy message.');
  }
  if (view.instructions.length !== 1) {
    refuse(`expected exactly 1 instruction, found ${view.instructions.length}.`);
  }
  const found = view.instructions[0];
  if (!found) {
    refuse('missing instruction.');
  }
  let planned;
  try {
    const accounts: { agent: string; mission: string; recipient: string; vault: string } = {
      agent: expected.agent,
      mission: expected.mission,
      recipient: expected.recipient,
      vault: expected.vault,
    };
    const splAccounts =
      expected.splVault !== undefined && expected.recipientTokenAccount !== undefined
        ? { splVault: expected.splVault, recipientTokenAccount: expected.recipientTokenAccount }
        : {};
    planned = planExecuteInstruction(
      expected.programId,
      { ...accounts, ...splAccounts },
      {
        actionType: expected.actionType,
        recipient: addressToBytes(expected.recipient),
        amount: BigInt(expected.amountAtomic),
        nonce: BigInt(expected.agentNonce),
      }
    );
  } catch {
    refuse('expected action parameters are invalid.');
  }
  if (found.programAddress !== planned.programAddress) {
    refuse('program mismatch.');
  }
  if (found.accounts.length !== planned.accounts.length) {
    refuse('account list length mismatch.');
  }
  for (let i = 0; i < planned.accounts.length; i += 1) {
    const got = found.accounts[i];
    const want = planned.accounts[i];
    if (!got || !want || got.address !== want.address || got.role !== want.role) {
      refuse(`account ${i} mismatch.`);
    }
  }
  let decodedMatches = false;
  try {
    const decoded = decodeExecuteAction(found.data);
    decodedMatches =
      decoded.actionType === expected.actionType &&
      bytesToBase58(decoded.recipient) === expected.recipient &&
      decoded.amount === BigInt(expected.amountAtomic) &&
      decoded.nonce === BigInt(expected.agentNonce);
  } catch {
    decodedMatches = false;
  }
  if (!decodedMatches) {
    refuse('instruction data does not match the requested action.');
  }
  const agentIndex = view.signerAddresses.indexOf(expected.agent);
  if (agentIndex < 0) {
    refuse('agent is not a signer of the transaction.');
  }
  const signature = sign.detached(messageBytes, args.agentSecretKey);
  const signatures: Uint8Array[] = view.signerAddresses.map((signer, index) =>
    index === agentIndex ? signature : emptySignature()
  );
  return { signedTransaction: bytesToBase64(encodeWireTransaction(signatures, messageBytes)) };
}
