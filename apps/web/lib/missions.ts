// Succra web — request schemas + mission DRAFT helpers.
//
// Every external input is validated with zod. Schemas strip unknown keys
// by default (`.strip()` is zod's default): in particular, an `owner_id`
// smuggled in a request body is discarded — the owner always comes from
// the verified session (AGENTS.md security rules).
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isSolanaAddress } from './solana-address';

const solanaAddress = z
  .string()
  .refine((value) => isSolanaAddress(value), { message: 'Must be a valid Solana address.' });

/** Decimal integer string (for NUMERIC(78,0) columns — never a float). */
export const ATOMIC_AMOUNT_REGEX = /^\d+$/;
const atomicAmount = (field: string) =>
  z
    .string()
    .regex(ATOMIC_AMOUNT_REGEX, { message: `${field} must be a decimal integer string.` })
    .refine((value) => value.length <= 78, { message: `${field} exceeds 78 digits.` });

const positiveAtomicAmount = (field: string) =>
  atomicAmount(field).refine((value) => ATOMIC_AMOUNT_REGEX.test(value) && BigInt(value) > 0n, {
    message: `${field} must be greater than zero.`,
  });

export const NONCE_REQUEST_SCHEMA = z.object({
  walletAddress: solanaAddress,
});

export const VERIFY_REQUEST_SCHEMA = z.object({
  walletAddress: solanaAddress,
  nonce: z.string().min(16).max(128),
  signature: z.string().min(16).max(128),
});

const ACTION_TYPES = ['TRANSFER_SOL', 'TRANSFER_SPL'] as const;

export const MISSION_CREATE_SCHEMA = z
  .object({
    name: z.string().min(1).max(120),
    objective: z.string().min(1).max(2000),
    mintAddress: solanaAddress,
    budgetAtomic: positiveAtomicAmount('budgetAtomic'),
    maxActionAtomic: positiveAtomicAmount('maxActionAtomic'),
    recoveryMaxActionAtomic: positiveAtomicAmount('recoveryMaxActionAtomic'),
    allowedActionTypes: z.array(z.enum(ACTION_TYPES)).min(1),
    allowedRecipients: z.array(solanaAddress).default([]),
    expiresAt: z.string().datetime({ message: 'expiresAt must be an ISO-8601 datetime.' }),
    currentAgentPublicKey: solanaAddress,
  })
  .superRefine((value, context) => {
    // FR-01 creation rules (PROJECT_SPEC.md §5). Guards keep BigInt total:
    // a refinement must report an issue, never throw.
    const numeric = [
      value.budgetAtomic,
      value.maxActionAtomic,
      value.recoveryMaxActionAtomic,
    ].every((amount) => ATOMIC_AMOUNT_REGEX.test(amount));
    if (numeric && BigInt(value.maxActionAtomic) > BigInt(value.budgetAtomic)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxActionAtomic'],
        message: 'maxActionAtomic must be at most budgetAtomic.',
      });
    }
    if (numeric && BigInt(value.recoveryMaxActionAtomic) > BigInt(value.maxActionAtomic)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recoveryMaxActionAtomic'],
        message: 'recoveryMaxActionAtomic must be at most maxActionAtomic.',
      });
    }
    if (new Date(value.expiresAt).getTime() <= Date.now()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'expiresAt must be in the future.',
      });
    }
  });

export type MissionCreateInput = z.infer<typeof MISSION_CREATE_SCHEMA>;

export interface PolicyDocument {
  version: 1;
  max_action_atomic: string;
  recovery_max_action_atomic: string;
  allowed_action_types: readonly string[];
  allowed_recipients: readonly string[];
  violation_threshold: 3;
  violation_window_seconds: 900;
}

/** Canonical policy document stored in mission_policies.policy_json. */
export function buildPolicyDocument(input: MissionCreateInput): PolicyDocument {
  return {
    version: 1,
    max_action_atomic: input.maxActionAtomic,
    recovery_max_action_atomic: input.recoveryMaxActionAtomic,
    allowed_action_types: [...input.allowedActionTypes],
    allowed_recipients: [...input.allowedRecipients],
    violation_threshold: 3,
    violation_window_seconds: 900,
  };
}

/** sha256 hex of the canonical policy JSON (missions.policy_hash). */
export function hashPolicyDocument(policy: PolicyDocument): string {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}

/**
 * Placeholder PDA/vault addresses for DRAFT rows. Phase 3 never touches
 * Solana, but pda_address/vault_address are UNIQUE NOT NULL per §7, so
 * each draft gets unique, obviously-not-on-chain placeholders. Real PDAs
 * arrive with on-chain creation in a later phase.
 */
export function placeholderAddress(kind: 'pda' | 'vault'): string {
  return `pending:${kind}:${randomUUID()}`;
}
