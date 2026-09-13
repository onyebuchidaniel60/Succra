// POST /api/auth/verify — verify wallet signature, establish session.
//
// Request:  { walletAddress, nonce, signature } (signature = base64
//             Ed25519 detached signature over the issued message bytes)
// Success:  200 { user: { id, walletAddress } } + Supabase session cookies
// Errors:   400 INVALID_BODY; 401 NONCE_UNKNOWN/NONCE_REUSED/NONCE_EXPIRED/
//           NONCE_WALLET_MISMATCH/INVALID_SIGNATURE; 500 SESSION_FAILED.
//
// Session model (ARCHITECTURE.md §9/§12): the session is a genuine
// Supabase Auth session (Supabase-signed JWT + refresh token), never a
// home-rolled token. The server verifies the Solana signature, resolves
// the wallet to an auth user (creating user + profile on first login),
// then mints the session through Auth's own OTP-verification path and
// stores it in HTTP-only cookies via @supabase/ssr. RLS sees
// auth.uid() = the user id; owners are always derived from that session.
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { apiError } from '@/lib/api-error';
import { verifyWalletSignature } from '@/lib/auth/signature';
import { consumeNonce, SupabaseNonceTable } from '@/lib/auth/nonces';
import { VERIFY_REQUEST_SCHEMA } from '@/lib/missions';
import { admin } from '@/lib/supabase';

function publicUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL.');
  return url;
}

function publishableKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  return key;
}

/** Deterministic, unroutable contact address for a wallet identity. */
function walletEmail(walletAddress: string): string {
  return `${walletAddress}@wallet.succra.invalid`;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be JSON.');
  }
  const parsed = VERIFY_REQUEST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Expected { walletAddress, nonce, signature }.');
  }
  const { walletAddress, nonce, signature } = parsed.data;

  // 1. Single-use, expiry-checked, wallet-bound nonce, consumed atomically
  // in Postgres (multi-instance safe). Consumed here, so a replayed verify
  // can never reach signature checking twice.
  let message: string;
  try {
    message = (
      await consumeNonce(new SupabaseNonceTable(admin()), nonce, walletAddress, Date.now())
    ).message;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'NONCE_UNKNOWN';
    const known = ['NONCE_UNKNOWN', 'NONCE_REUSED', 'NONCE_EXPIRED', 'NONCE_WALLET_MISMATCH'];
    return apiError(
      401,
      known.includes(code) ? code : 'NONCE_UNKNOWN',
      'Login nonce invalid, reused, or expired. Request a new one.'
    );
  }

  // 2. Ed25519 signature over the exact issued message bytes.
  if (!verifyWalletSignature({ walletAddress, message, signatureBase64: signature })) {
    return apiError(401, 'INVALID_SIGNATURE', 'Wallet signature rejected. No session created.');
  }

  // 3. Resolve wallet -> auth user (create on first login), then profile.
  // owner_id for every later write is derived from this session, never
  // from request input.
  const adminClient = admin();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('wallet_address', walletAddress)
    .maybeSingle();
  let userId = profile?.id as string | undefined;
  let email = walletEmail(walletAddress);
  if (userId) {
    const existing = await adminClient.auth.admin.getUserById(userId);
    if (existing.error || !existing.data.user?.email) {
      // Stale profile row whose auth user is gone: drop it, start over.
      await adminClient.from('profiles').delete().eq('id', userId);
      userId = undefined;
    } else {
      email = existing.data.user.email;
    }
  }

  if (!userId) {
    const created = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { wallet_address: walletAddress },
      user_metadata: { wallet_address: walletAddress },
    });
    if (created.error || !created.data.user) {
      return apiError(500, 'SESSION_FAILED', 'Could not establish a session.');
    }
    userId = created.data.user.id;
    const inserted = await adminClient.from('profiles').insert({
      id: userId,
      wallet_address: walletAddress,
    });
    if (inserted.error) {
      return apiError(500, 'SESSION_FAILED', 'Could not establish a session.');
    }
  } else {
    const existing = await adminClient.from('profiles').select('id').eq('id', userId).maybeSingle();
    if (!existing.data) {
      const inserted = await adminClient
        .from('profiles')
        .insert({ id: userId, wallet_address: walletAddress });
      if (inserted.error) {
        return apiError(500, 'SESSION_FAILED', 'Could not establish a session.');
      }
    }
  }

  // 4. Mint a real Supabase session (Auth-signed JWT) and set cookies.
  const link = await adminClient.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link.error ? undefined : link.data.properties?.hashed_token;
  if (!tokenHash) {
    return apiError(500, 'SESSION_FAILED', 'Could not establish a session.');
  }
  const cookieStore = await cookies();
  const sessionClient = createServerClient(publicUrl(), publishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
  const verified = await sessionClient.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (verified.error || !verified.data.session || verified.data.user?.id !== userId) {
    return apiError(500, 'SESSION_FAILED', 'Could not establish a session.');
  }

  return NextResponse.json({ user: { id: userId, walletAddress } });
}
