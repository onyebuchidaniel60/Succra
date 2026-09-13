// Succra web — login message format (PROJECT_SPEC.md §4 Flow A, step 3).
//
// Human-readable, and binds wallet + nonce + expiry + application URI so a
// signature cannot be replayed against another app or another wallet.
// The exact bytes of this message are what the wallet signs and what
// `POST /api/auth/verify` re-verifies; any format change invalidates
// outstanding nonces (they are keyed to the stored message, not rebuilt).
export interface LoginMessageInput {
  walletAddress: string;
  nonce: string;
  /** Absolute expiry as an ISO-8601 string (mirrors the nonce record). */
  expiresAt: string;
  /** Application URI the signature is bound to (anti-phishing). */
  appUri: string;
}

export function buildLoginMessage(input: LoginMessageInput): string {
  return [
    'Succra sign-in',
    '',
    `Wallet: ${input.walletAddress}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt}`,
    `URI: ${input.appUri}`,
  ].join('\n');
}

export function appUri(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}
