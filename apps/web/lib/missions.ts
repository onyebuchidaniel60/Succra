// Succra web — mission creation schemas, canonical policy document, and
// hash helpers.
//
// Every external input is validated with zod. Schemas strip unknown keys
// by default (`.strip()` is zod's default): in particular, an `owner_id`
// smuggled in a request body is discarded — the owner always comes from
// the verified session (AGENTS.md security rules).
//
// Policy hashes cover the canonical policy JSON committed on-chain via
// MissionFactory.createMission. The database stores the same document and
// hash; the contract remains authoritative.
import { keccak256, stringToHex, isAddress } from 'viem';
import { z } from 'zod';

/** Decimal integer string (for NUMERIC(78,0) columns — never a float). */
export const ATOMIC_AMOUNT_REGEX = /^\d+$/;

export const MAX_SUCCESSORS = 8;
export const DEFAULT_VIOLATION_THRESHOLD = 3;
export const DEFAULT_VIOLATION_WINDOW_SECONDS = 900;
export const MIN_VIOLATION_WINDOW_SECONDS = 60;
export const MAX_VIOLATION_WINDOW_SECONDS = 86_400;
export const MAX_VIOLATION_THRESHOLD = 10;

const evmAddress = z.string().transform((value, context) => {
  if (!isAddress(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a valid EVM address.' });
    return z.NEVER;
  }
  return value.toLowerCase() as `0x${string}`;
});

const atomicAmount = (field: string) =>
  z
    .string()
    .regex(ATOMIC_AMOUNT_REGEX, { message: `${field} must be a decimal integer string.` })
    .refine((value) => value.length <= 78, { message: `${field} exceeds 78 digits.` })
    .refine((value) => !ATOMIC_AMOUNT_REGEX.test(value) || BigInt(value) <= 2n ** 256n - 1n, {
      message: `${field} exceeds uint256.`,
    });

const positiveAtomicAmount = (field: string) =>
  atomicAmount(field).refine((value) => !ATOMIC_AMOUNT_REGEX.test(value) || BigInt(value) > 0n, {
    message: `${field} must be greater than zero.`,
  });

export const MISSION_CREATE_SCHEMA = z
  .object({
    name: z.string().trim().min(1).max(120),
    objective: z.string().trim().min(1).max(2000),
    paymentTokenAddress: evmAddress,
    budgetAtomic: positiveAtomicAmount('budgetAtomic'),
    maxPaymentAtomic: positiveAtomicAmount('maxPaymentAtomic'),
    recoveryMaxPaymentAtomic: positiveAtomicAmount('recoveryMaxPaymentAtomic'),
    merchantAllowlist: z.array(evmAddress).min(1, 'At least one merchant is required.'),
    expiresAt: z.string().datetime({ message: 'expiresAt must be an ISO-8601 datetime.' }),
    primaryAgentAddress: evmAddress,
    primaryAgentName: z.string().trim().min(1).max(120).optional(),
    successors: z
      .array(
        z.object({
          address: evmAddress,
          priority: z.number().int().min(0).max(65_535),
        })
      )
      .max(MAX_SUCCESSORS),
    violationThreshold: z
      .number()
      .int()
      .min(1)
      .max(MAX_VIOLATION_THRESHOLD)
      .default(DEFAULT_VIOLATION_THRESHOLD),
    violationWindowSeconds: z
      .number()
      .int()
      .min(MIN_VIOLATION_WINDOW_SECONDS)
      .max(MAX_VIOLATION_WINDOW_SECONDS)
      .default(DEFAULT_VIOLATION_WINDOW_SECONDS),
  })
  .superRefine((value, context) => {
    // FR-01 creation rules (PROJECT_SPEC.md §5). Guards keep BigInt total:
    // a refinement must report an issue, never throw.
    const numeric = [
      value.budgetAtomic,
      value.maxPaymentAtomic,
      value.recoveryMaxPaymentAtomic,
    ].every((amount) => ATOMIC_AMOUNT_REGEX.test(amount));
    if (numeric && BigInt(value.maxPaymentAtomic) > BigInt(value.budgetAtomic)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxPaymentAtomic'],
        message: 'maxPaymentAtomic must be at most budgetAtomic.',
      });
    }
    if (numeric && BigInt(value.recoveryMaxPaymentAtomic) > BigInt(value.maxPaymentAtomic)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recoveryMaxPaymentAtomic'],
        message: 'recoveryMaxPaymentAtomic must be at most maxPaymentAtomic.',
      });
    }
    if (new Date(value.expiresAt).getTime() <= Date.now()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'expiresAt must be in the future.',
      });
    }

    const merchants = value.merchantAllowlist.map((address) => address.toLowerCase());
    if (new Set(merchants).size !== merchants.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['merchantAllowlist'],
        message: 'merchantAllowlist must not contain duplicates.',
      });
    }

    const primary = value.primaryAgentAddress.toLowerCase();
    const successorAddresses = value.successors.map((successor) => successor.address.toLowerCase());
    if (successorAddresses.includes(primary)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['successors'],
        message: 'The primary agent cannot also be a successor.',
      });
    }
    if (new Set(successorAddresses).size !== successorAddresses.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['successors'],
        message: 'Successor addresses must be unique.',
      });
    }
  });

export type MissionCreateInput = z.infer<typeof MISSION_CREATE_SCHEMA>;

export interface MissionPolicyDocument {
  version: 1;
  payment_token_address: `0x${string}`;
  budget_atomic: string;
  max_payment_atomic: string;
  recovery_max_payment_atomic: string;
  merchant_allowlist: readonly `0x${string}`[];
  expires_at: string;
  primary_agent_address: `0x${string}`;
  successors: readonly { address: `0x${string}`; priority: number }[];
  violation_threshold: number;
  violation_window_seconds: number;
  cart_mandate_id: string;
  cart_mandate_hash: `0x${string}`;
}

const policyDocumentSchema = z.object({
  version: z.literal(1),
  payment_token_address: evmAddress,
  budget_atomic: positiveAtomicAmount('budget_atomic'),
  max_payment_atomic: positiveAtomicAmount('max_payment_atomic'),
  recovery_max_payment_atomic: positiveAtomicAmount('recovery_max_payment_atomic'),
  merchant_allowlist: z.array(evmAddress).min(1),
  expires_at: z.string().datetime(),
  primary_agent_address: evmAddress,
  successors: z
    .array(z.object({ address: evmAddress, priority: z.number().int().min(0).max(65_535) }))
    .max(MAX_SUCCESSORS),
  violation_threshold: z.number().int().min(1).max(MAX_VIOLATION_THRESHOLD),
  violation_window_seconds: z
    .number()
    .int()
    .min(MIN_VIOLATION_WINDOW_SECONDS)
    .max(MAX_VIOLATION_WINDOW_SECONDS),
  cart_mandate_id: z.string().min(1),
  cart_mandate_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export interface CartMandateResult {
  mandateId: string;
  mandateHash: `0x${string}`;
}

/**
 * Provisional mock Cart Mandate. Phase 9 replaces this with a real HSP
 * Cart Mandate flow; until then the on-chain hash commits a deterministic
 * mock payload so the contract field is never fabricated as a real HSP ID.
 */
export function buildMockCartMandate(input: {
  missionId: string;
  paymentTokenAddress: string;
  budgetAtomic: string;
  merchantAllowlist: readonly string[];
}): CartMandateResult {
  const mandateId = `mock-cart-${input.missionId}`;
  const mandateHash = keccak256(
    stringToHex(
      JSON.stringify({
        mandateId,
        missionId: input.missionId,
        paymentTokenAddress: input.paymentTokenAddress.toLowerCase(),
        budgetAtomic: input.budgetAtomic,
        merchantAllowlist: input.merchantAllowlist.map((address) => address.toLowerCase()),
      })
    )
  );
  return { mandateId, mandateHash };
}

/** Canonical policy document stored in mission_policies.policy_json. */
export function buildPolicyDocument(
  input: MissionCreateInput,
  cartMandate: CartMandateResult
): MissionPolicyDocument {
  return {
    version: 1,
    payment_token_address: input.paymentTokenAddress,
    budget_atomic: input.budgetAtomic,
    max_payment_atomic: input.maxPaymentAtomic,
    recovery_max_payment_atomic: input.recoveryMaxPaymentAtomic,
    merchant_allowlist: input.merchantAllowlist,
    expires_at: input.expiresAt,
    primary_agent_address: input.primaryAgentAddress,
    successors: input.successors.map((successor) => ({
      address: successor.address,
      priority: successor.priority,
    })),
    violation_threshold: input.violationThreshold,
    violation_window_seconds: input.violationWindowSeconds,
    cart_mandate_id: cartMandate.mandateId,
    cart_mandate_hash: cartMandate.mandateHash,
  };
}

/** keccak256 over the canonical policy JSON (bytes32 on-chain policyHash). */
export function hashPolicyDocument(policy: MissionPolicyDocument): `0x${string}` {
  return keccak256(stringToHex(JSON.stringify(policy)));
}

export function parsePolicyDocument(value: unknown): MissionPolicyDocument | null {
  const parsed = policyDocumentSchema.safeParse(value);
  return parsed.success ? (parsed.data as MissionPolicyDocument) : null;
}
