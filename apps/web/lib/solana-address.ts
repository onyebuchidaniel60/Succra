// Succra web — Solana address helpers.
//
// Stack rule (ARCHITECTURE.md §9): `@solana/kit` is the wallet/address
// library for new code. `address()` throws on malformed input, which makes
// it a validator as well as a parser. Signature verification itself uses
// tweetnacl (Ed25519 primitive) in `lib/auth/signature.ts`.
import { address } from '@solana/kit';

/** Returns true when `value` parses as a Solana address (base58, 32 bytes). */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    return false;
  }
  try {
    address(value);
    return true;
  } catch {
    return false;
  }
}
