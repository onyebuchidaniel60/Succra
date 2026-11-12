// Owner access for the live mainnet console.
//
// The deployer address alone is public, so `?owner=0x...` cannot be treated
// as authorization. The owner must sign a short-lived challenge; the server
// then issues an opaque in-memory bearer token for private demo state.
// Tokens never leave the server and expire automatically. The public demo
// view remains unauthenticated by design (`?demo=true`).
import { randomBytes } from 'node:crypto';
import { verifyMessage, type Address, type Hex } from 'viem';
import { demoOwnerAddress, isDemoOwner } from '@/lib/demo/orchestrator';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

type Challenge = { message: string; expiresAtMs: number };
type Session = { address: string; expiresAtMs: number };

type AuthStore = {
  challenges: Map<string, Challenge>;
  sessions: Map<string, Session>;
};

const globalForAuth = globalThis as unknown as { __succraDemoAuth?: AuthStore };
const store: AuthStore = (globalForAuth.__succraDemoAuth ??= {
  challenges: new Map(),
  sessions: new Map(),
});

export class DemoAuthError extends Error {
  constructor(
    public readonly code:
      | 'NOT_OWNER'
      | 'CHALLENGE_EXPIRED'
      | 'INVALID_SIGNATURE'
      | 'NOT_AUTHORIZED'
  ) {
    super(code);
    this.name = 'DemoAuthError';
  }
}

function prune(): void {
  const now = Date.now();
  for (const [key, value] of store.challenges) {
    if (value.expiresAtMs <= now) store.challenges.delete(key);
  }
  for (const [key, value] of store.sessions) {
    if (value.expiresAtMs <= now) store.sessions.delete(key);
  }
}

export function createOwnerChallenge(address: string): {
  message: string;
  expiresAt: string;
} {
  prune();
  if (!isDemoOwner(address)) throw new DemoAuthError('NOT_OWNER');
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const expiresAtMs = Date.now() + CHALLENGE_TTL_MS;
  const message = [
    'Succra owner access',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    '',
    'Signing proves wallet ownership for this browser session.',
    'It does not authorize a transaction or transfer of funds.',
  ].join('\n');
  store.challenges.set(address.toLowerCase(), { message, expiresAtMs });
  return { message, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function verifyOwnerChallenge(
  address: string,
  signature: string
): Promise<{ token: string; expiresAt: string }> {
  prune();
  if (!isDemoOwner(address)) throw new DemoAuthError('NOT_OWNER');
  const challenge = store.challenges.get(address.toLowerCase());
  if (!challenge || challenge.expiresAtMs <= Date.now()) {
    throw new DemoAuthError('CHALLENGE_EXPIRED');
  }
  // A challenge is single-use even when the signature is wrong, so a failed
  // attempt cannot be retried against a stale message.
  store.challenges.delete(address.toLowerCase());

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as Address,
      message: challenge.message,
      signature: signature as Hex,
    });
  } catch {
    valid = false;
  }
  if (!valid) throw new DemoAuthError('INVALID_SIGNATURE');

  const token = randomBytes(32).toString('hex');
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  store.sessions.set(token, {
    address: address.toLowerCase(),
    expiresAtMs,
  });
  return { token, expiresAt: new Date(expiresAtMs).toISOString() };
}

/** True only when the bearer token belongs to the deployer session. */
export function hasOwnerSession(authorization: string | null): boolean {
  prune();
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return false;
  const session = store.sessions.get(token);
  if (!session || session.expiresAtMs <= Date.now()) return false;
  return session.address === demoOwnerAddress().toLowerCase();
}
