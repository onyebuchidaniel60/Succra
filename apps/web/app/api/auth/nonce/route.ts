// POST /api/auth/nonce — issue an EIP-712 wallet login nonce.
//
// Request:  { "walletAddress": "0x...", "chainId"?: 177 | 133 }
// Success:  { "nonce": "...", "typedData": { ... }, "expiresAt": "..." }
// Errors:   400 INVALID_BODY (envelope).
//
// The nonce is bound to the wallet address at issuance and stored
// server-side (DB-backed auth_nonces table, single-use, TTL). The exact
// typed data returned here must be signed by the wallet and submitted to
// POST /api/auth/verify. The stored `message` column holds the serialized
// typed data so verification uses byte-identical canonical fields.
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { buildLoginTypedData, type LoginTypedData } from '@/lib/auth/message';
import { NONCE_REQUEST_SCHEMA } from '@/lib/auth/schemas';
import { issueNonce, nonceTtlMs, SupabaseNonceTable } from '@/lib/auth/nonces';
import { admin } from '@/lib/supabase';

function configuredChainId(): number {
  const raw = process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? '177';
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 177;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be JSON.');
  }
  const parsed = NONCE_REQUEST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'walletAddress must be a valid EVM address.');
  }

  const nowMs = Date.now();
  const chainId = parsed.data.chainId ?? configuredChainId();
  let stored;
  let typedData: LoginTypedData | undefined;
  try {
    stored = await issueNonce(
      new SupabaseNonceTable(admin()),
      parsed.data.walletAddress,
      ({ nonce }) => {
        typedData = buildLoginTypedData({
          walletAddress: parsed.data.walletAddress,
          nonce,
          issuedAt: new Date(nowMs).toISOString(),
          chainId,
        });
        return JSON.stringify(typedData);
      },
      nowMs,
      nonceTtlMs()
    );
  } catch {
    return apiError(500, 'NONCE_ISSUE_FAILED', 'Could not issue a login nonce.');
  }
  if (!typedData) {
    return apiError(500, 'NONCE_ISSUE_FAILED', 'Could not issue a login nonce.');
  }

  return NextResponse.json({
    nonce: stored.nonce,
    typedData,
    expiresAt: new Date(stored.expiresAtMs).toISOString(),
  });
}
