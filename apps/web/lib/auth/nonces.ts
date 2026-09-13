// Succra web — login nonces, stored in Postgres (public.auth_nonces).
//
// Why a table and not memory: Vercel/serverless runs many instances, so an
// in-memory Map fails nondeterministically in production. The table is
// server-only infrastructure (RLS enabled with NO policies; only the
// service-role key touches it), never read by browsers or user sessions.
//
// Security properties (enforced here, independent of callers):
// - one nonce maps to exactly one wallet address (bound at issuance,
//   re-checked atomically at consumption);
// - single-use: consumption is one atomic UPDATE … WHERE consumed_at IS
//   NULL AND expires_at > now() RETURNING * — safe across instances; the
//   consumed row is then removed so replays deterministically find nothing;
// - expiry: TTL from issuance (SUCCRA_NONCE_TTL_SECONDS, default 600s);
// - stale rows are swept opportunistically on write (no cron in Phase 3);
//   sweep failures never fail issuance/verification.
//
// Structure: `NonceTable` is the domain seam. `SupabaseNonceTable` holds
// the exact SQL run in production; tests substitute FakeNonceTable
// (same single-threaded atomicity for the gate). The live CI suite runs
// this logic against real Supabase over HTTP.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoredNonceRow {
  nonce: string;
  wallet_address: string;
  message: string;
  expires_at: string;
  consumed_at: string | null;
}

export interface NewNonceRow {
  wallet_address: string;
  nonce: string;
  message: string;
  expires_at: string;
}

export interface NonceTable {
  insert(row: NewNonceRow): Promise<void>;
  /** Atomic single-use gate. Returns the row, or null when invalid/expired/used. */
  consumeAtomically(input: {
    nonce: string;
    walletAddress: string;
    nowIso: string;
  }): Promise<StoredNonceRow | null>;
  findByNonce(nonce: string): Promise<StoredNonceRow | null>;
  removeNonce(nonce: string): Promise<void>;
  deleteExpired(nowIso: string): Promise<void>;
}

export interface IssuedNonce {
  nonce: string;
  walletAddress: string;
  message: string;
  expiresAtMs: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function nonceTtlMs(): number {
  const raw = process.env.SUCCRA_NONCE_TTL_SECONDS;
  if (raw !== undefined) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.floor(seconds * 1000);
    }
  }
  return DEFAULT_TTL_MS;
}

function randomNonce(): string {
  // 256-bit entropy, base64url-encoded (no padding).
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export function nonceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

/** Production transport: the exact SQL against public.auth_nonces. */
export class SupabaseNonceTable implements NonceTable {
  constructor(private readonly db: SupabaseClient) {}

  async insert(row: NewNonceRow): Promise<void> {
    const { error } = await this.db.from('auth_nonces').insert(row);
    if (error) {
      throw nonceError('NONCE_ISSUE_FAILED', 'Could not issue a login nonce.');
    }
  }

  async consumeAtomically(input: {
    nonce: string;
    walletAddress: string;
    nowIso: string;
  }): Promise<StoredNonceRow | null> {
    const { data, error } = await this.db
      .from('auth_nonces')
      .update({ consumed_at: input.nowIso })
      .eq('nonce', input.nonce)
      .eq('wallet_address', input.walletAddress)
      .is('consumed_at', null)
      .gt('expires_at', input.nowIso)
      .select();
    if (error) {
      throw nonceError('NONCE_CONSUME_FAILED', 'Could not consume the login nonce.');
    }
    const rows = (data ?? []) as StoredNonceRow[];
    return rows[0] ?? null;
  }

  async findByNonce(nonce: string): Promise<StoredNonceRow | null> {
    const { data, error } = await this.db
      .from('auth_nonces')
      .select('nonce,wallet_address,message,expires_at,consumed_at')
      .eq('nonce', nonce)
      .maybeSingle();
    if (error) {
      throw nonceError('NONCE_LOOKUP_FAILED', 'Could not look up the login nonce.');
    }
    return (data as StoredNonceRow | null) ?? null;
  }

  async removeNonce(nonce: string): Promise<void> {
    const { error } = await this.db.from('auth_nonces').delete().eq('nonce', nonce);
    if (error) {
      throw nonceError('NONCE_REMOVE_FAILED', 'Could not remove the login nonce.');
    }
  }

  async deleteExpired(nowIso: string): Promise<void> {
    const { error } = await this.db.from('auth_nonces').delete().lt('expires_at', nowIso);
    if (error) {
      throw nonceError('NONCE_SWEEP_FAILED', 'Could not sweep expired login nonces.');
    }
  }
}

export async function issueNonce(
  tables: NonceTable,
  walletAddress: string,
  buildMessage: (args: { nonce: string; expiresAtMs: number }) => string,
  nowMs: number,
  ttlMs?: number
): Promise<IssuedNonce> {
  const ttl = ttlMs ?? nonceTtlMs();
  const nonce = randomNonce();
  const expiresAtMs = nowMs + ttl;
  const message = buildMessage({ nonce, expiresAtMs });
  await tables.insert({
    wallet_address: walletAddress,
    nonce,
    message,
    expires_at: new Date(expiresAtMs).toISOString(),
  });
  // Opportunistic cleanup; must never fail issuance.
  await tables.deleteExpired(new Date(nowMs).toISOString()).catch(() => undefined);
  return { nonce, walletAddress, message, expiresAtMs };
}

/**
 * Validate + atomically consume a nonce. Returns the stored record.
 * Throws an Error with `code` NONCE_UNKNOWN / NONCE_REUSED / NONCE_EXPIRED /
 * NONCE_WALLET_MISMATCH. The UPDATE gate is atomic (multi-instance safe);
 * the follow-up lookup only classifies the failure for reporting.
 */
export async function consumeNonce(
  tables: NonceTable,
  nonce: string,
  walletAddress: string,
  nowMs: number
): Promise<IssuedNonce> {
  const nowIso = new Date(nowMs).toISOString();
  const row = await tables.consumeAtomically({ nonce, walletAddress, nowIso });
  if (row) {
    // Single-use complete: remove the row so replays find nothing. The
    // atomic UPDATE above already serialized concurrent consumers; removal
    // is idempotent cleanup (best-effort).
    await tables.removeNonce(nonce).catch(() => undefined);
    return {
      nonce: row.nonce,
      walletAddress: row.wallet_address,
      message: row.message,
      expiresAtMs: Date.parse(row.expires_at),
    };
  }
  const existing = await tables.findByNonce(nonce);
  if (!existing) {
    throw nonceError('NONCE_UNKNOWN', 'Login nonce not found. Request a new one.');
  }
  if (existing.consumed_at !== null) {
    throw nonceError('NONCE_REUSED', 'Login nonce was already used. Request a new one.');
  }
  if (Date.parse(existing.expires_at) <= nowMs) {
    throw nonceError('NONCE_EXPIRED', 'Login nonce expired. Request a new one.');
  }
  throw nonceError('NONCE_WALLET_MISMATCH', 'Login nonce was issued for a different wallet.');
}
