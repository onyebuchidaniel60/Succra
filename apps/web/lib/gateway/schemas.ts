// Succra gateway — zod schemas for Phase 4 agent endpoints.
//
// Every external input is validated. Schemas strip unknown keys (zod
// default): client-provided owner_id/agent_id/mission_id in bodies are
// discarded — authorization derives from the session or the verified
// agent signature, never from body fields (AGENTS.md security rules).
import { z } from 'zod';
import { ATOMIC_AMOUNT_REGEX } from '../missions';
import { isSolanaAddress } from '../solana-address';

const solanaAddress = z
  .string()
  .refine((value) => isSolanaAddress(value), { message: 'Must be a valid Solana address.' });

const atomicAmount = (field: string) =>
  z
    .string()
    .regex(ATOMIC_AMOUNT_REGEX, { message: `${field} must be a decimal integer string.` })
    .refine((value) => value.length <= 20, { message: `${field} exceeds u64 range.` })
    .refine((value) => BigInt(value) > 0n, { message: `${field} must be greater than zero.` });

/** agentNonce accepts the §10 number form (small values) or a digit string (full u64). */
const agentNonce = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d{1,20}$/, { message: 'agentNonce must be a u64 integer.' }),
]);

/** Normalize the accepted agentNonce forms to a canonical digit string. */
export function normalizeAgentNonce(value: number | string): string {
  return typeof value === 'number' ? String(Math.trunc(value)) : value.replace(/^0+(?=\d)/, '');
}

export const ATTACH_AGENT_SCHEMA = z.object({
  publicKey: solanaAddress,
  name: z.string().min(1).max(120),
  role: z.enum(['PRIMARY', 'SUCCESSOR']).default('PRIMARY'),
});

export type AttachAgentInput = z.infer<typeof ATTACH_AGENT_SCHEMA>;

export const EMPTY_BODY_SCHEMA = z.object({}).strict();

export const CHALLENGE_VERIFY_SCHEMA = z.object({
  challenge: z.string().regex(/^[0-9a-f]{64}$/, { message: 'challenge must be 64 hex chars.' }),
  signature: z.string().min(16).max(256),
});

export type ChallengeVerifyInput = z.infer<typeof CHALLENGE_VERIFY_SCHEMA>;

const ACTION_TYPES = ['TRANSFER_SOL', 'TRANSFER_SPL'] as const;

export const PREFLIGHT_SCHEMA = z.object({
  idempotencyKey: z.string().min(8).max(128),
  agentNonce,
  actionType: z.enum(ACTION_TYPES),
  payload: z.object({
    recipient: solanaAddress,
    amountAtomic: atomicAmount('payload.amountAtomic'),
  }),
  expiresAt: z.string().datetime({ message: 'expiresAt must be an ISO-8601 datetime.' }),
});

export type PreflightInput = z.infer<typeof PREFLIGHT_SCHEMA>;

export const SUBMIT_SCHEMA = z.object({
  signedTransaction: z.string().min(16).max(4096),
});

export type SubmitInput = z.infer<typeof SUBMIT_SCHEMA>;

export const UUID_SCHEMA = z.string().uuid();
