// Succra web — login request validation (ARCHITECTURE.md §10).
//
// Addresses are normalized to lowercase 0x hex. Unknown keys (including a
// client-supplied owner_id) are stripped by zod's default object behavior.
import { z } from 'zod';
import { normalizeWalletAddress } from './message';

const walletAddress = z.string().transform((value, context) => {
  const normalized = normalizeWalletAddress(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Must be a valid EVM address.' });
    return z.NEVER;
  }
  return normalized;
});

const chainId = z
  .number()
  .int()
  .positive()
  .refine((value) => value === 177 || value === 133, {
    message: 'chainId must be HashKey mainnet (177) or testnet (133).',
  });

export const NONCE_REQUEST_SCHEMA = z.object({
  walletAddress,
  chainId: chainId.optional(),
});

export const VERIFY_REQUEST_SCHEMA = z.object({
  walletAddress,
  nonce: z.string().min(16).max(128),
  signature: z
    .string()
    .regex(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be a 65-byte 0x hex string.' })
    .transform((value) => value as `0x${string}`),
});

export type NonceRequestInput = z.infer<typeof NONCE_REQUEST_SCHEMA>;
export type VerifyRequestInput = z.infer<typeof VERIFY_REQUEST_SCHEMA>;
