// Succra shared — execute_action instruction codec (pure, kit-free).
//
// Mirrors programs/succra/src/lib.rs `ExecuteAction` exactly:
// - discriminator: first 8 bytes of SHA-256("global:execute_action").
// - args (borsh): action_type u8 (TransferSol = 0, TransferSpl = 1),
//   recipient Pubkey (32), amount u64 LE, nonce u64 LE. Total 57 bytes.
// - accounts in struct order — ALWAYS all eight (the Anchor client
//   substitutes the program id for None optionals, and server-side
//   deserialization is positional, so omitting accounts would mis-map
//   the trailing system/token programs):
//   agent (signer, readonly), mission (writable), recipient_account
//   (writable), vault (writable), spl_vault (writable on SPL, else the
//   program id readonly), recipient_token_account (likewise),
//   system_program, token_program.
//
// Kit-free by design: the SDK and gateway verify instruction bytes with
// decodeExecuteAction, and only the gateway (apps/web, where @solana/kit
// resolves) compiles messages. Byte-equality against the Anchor client
// is proven by the validator-gated comparison test (local only).
import { createHash } from 'node:crypto';

export type ActionTypeName = 'TRANSFER_SOL' | 'TRANSFER_SPL';

export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqY3sqWHfRaidRTpgzwP';

export const EXECUTE_ACTION_DATA_LEN = 8 + 1 + 32 + 8 + 8;

export type AccountRoleName = 'readonly-signer' | 'writable-signer' | 'readonly' | 'writable';

export interface PlannedAccount {
  address: string;
  role: AccountRoleName;
}

export interface PlannedInstruction {
  programAddress: string;
  accounts: PlannedAccount[];
  data: Uint8Array;
}

function actionTypeIndex(actionType: ActionTypeName): number {
  return actionType === 'TRANSFER_SOL' ? 0 : 1;
}

function actionTypeFromIndex(index: number): ActionTypeName {
  if (index === 0) return 'TRANSFER_SOL';
  if (index === 1) return 'TRANSFER_SPL';
  throw new Error('Unknown action type index.');
}

/** First 8 bytes of SHA-256("global:execute_action") (Anchor convention). */
export function executeActionDiscriminator(): Uint8Array {
  return new Uint8Array(
    createHash('sha256').update('global:execute_action', 'utf8').digest().subarray(0, 8)
  );
}

export interface ExecuteActionArgs {
  actionType: ActionTypeName;
  /** 32-byte recipient pubkey. */
  recipient: Uint8Array;
  amount: bigint;
  nonce: bigint;
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

/** Borsh-encode execute_action instruction data (57 bytes). */
export function encodeExecuteAction(args: ExecuteActionArgs): Uint8Array {
  if (args.recipient.length !== 32) {
    throw new Error('Recipient must be 32 bytes.');
  }
  const out = new Uint8Array(EXECUTE_ACTION_DATA_LEN);
  out.set(executeActionDiscriminator(), 0);
  out[8] = actionTypeIndex(args.actionType);
  out.set(args.recipient, 9);
  writeU64LE(out, 41, args.amount);
  writeU64LE(out, 49, args.nonce);
  return out;
}

/** Decode + validate execute_action instruction data. Throws on mismatch. */
export function decodeExecuteAction(data: Uint8Array): ExecuteActionArgs {
  if (data.length !== EXECUTE_ACTION_DATA_LEN) {
    throw new Error('Execute instruction has an invalid length.');
  }
  const expected = executeActionDiscriminator();
  for (let i = 0; i < 8; i += 1) {
    if (data[i] !== expected[i]) {
      throw new Error('Execute instruction has an invalid discriminator.');
    }
  }
  const actionType = actionTypeFromIndex(data[8] ?? 255);
  return {
    actionType,
    recipient: data.subarray(9, 41),
    amount: readU64LE(data, 41),
    nonce: readU64LE(data, 49),
  };
}

export interface ExecuteAccounts {
  agent: string;
  mission: string;
  recipient: string;
  vault: string;
  /** SPL path only; the program id is substituted on the SOL path. */
  splVault?: string;
  /** SPL path only; the program id is substituted on the SOL path. */
  recipientTokenAccount?: string;
}

/**
 * Plan the execute_action instruction (program, ordered account metas,
 * data). The gateway maps this to a kit Instruction; the SDK compares it
 * against the decompiled pre-flight message for verify-before-sign.
 */
export function planExecuteInstruction(
  programId: string,
  accounts: ExecuteAccounts,
  args: ExecuteActionArgs
): PlannedInstruction {
  const onSplPath = args.actionType === 'TRANSFER_SPL';
  if (onSplPath && (!accounts.splVault || !accounts.recipientTokenAccount)) {
    throw new Error('SPL execution requires splVault and recipientTokenAccount.');
  }
  const metas: PlannedAccount[] = [
    { address: accounts.agent, role: 'readonly-signer' },
    { address: accounts.mission, role: 'writable' },
    { address: accounts.recipient, role: 'writable' },
    { address: accounts.vault, role: 'writable' },
    // Proven by probe (anchor client output): None optionals become the
    // program id, readonly.
    {
      address: onSplPath ? (accounts.splVault as string) : programId,
      role: onSplPath ? 'writable' : 'readonly',
    },
    {
      address: onSplPath ? (accounts.recipientTokenAccount as string) : programId,
      role: onSplPath ? 'writable' : 'readonly',
    },
  ];
  metas.push(
    { address: SYSTEM_PROGRAM_ID, role: 'readonly' },
    { address: TOKEN_PROGRAM_ID, role: 'readonly' }
  );
  return {
    programAddress: programId,
    accounts: metas,
    data: encodeExecuteAction(args),
  };
}
