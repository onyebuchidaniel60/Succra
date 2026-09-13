// POST /api/auth/nonce — issue a wallet login nonce (ARCHITECTURE.md §10).
//
// Request:  { "walletAddress": "<base58>" }
// Success:  { "nonce": "...", "message": "...", "expiresAt": "..." }
// Errors:   400 INVALID_BODY (envelope).
//
// The nonce is bound to the wallet address at issuance and stored
// server-side (DB-backed auth_nonces table, single-use, TTL). The exact `message` bytes must
// be signed by the wallet and returned to POST /api/auth/verify.
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { appUri, buildLoginMessage } from '@/lib/auth/message';
import { issueNonce, nonceTtlMs, SupabaseNonceTable } from '@/lib/auth/nonces';
import { NONCE_REQUEST_SCHEMA } from '@/lib/missions';
import { admin } from '@/lib/supabase';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be JSON.');
  }
  const parsed = NONCE_REQUEST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'walletAddress must be a valid Solana address.');
  }

  const nowMs = Date.now();
  const uri = appUri();
  let stored;
  try {
    stored = await issueNonce(
      new SupabaseNonceTable(admin()),
      parsed.data.walletAddress,
      ({ nonce, expiresAtMs }) =>
        buildLoginMessage({
          walletAddress: parsed.data.walletAddress,
          nonce,
          expiresAt: new Date(expiresAtMs).toISOString(),
          appUri: uri,
        }),
      nowMs,
      nonceTtlMs()
    );
  } catch {
    return apiError(500, 'NONCE_ISSUE_FAILED', 'Could not issue a login nonce.');
  }

  return NextResponse.json({
    nonce: stored.nonce,
    message: stored.message,
    expiresAt: new Date(stored.expiresAtMs).toISOString(),
  });
}
