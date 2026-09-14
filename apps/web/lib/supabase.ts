// Succra web — Supabase clients.
//
// Key rules (ARCHITECTURE.md §12/§13, AGENTS.md):
// - Browser code uses the publishable key only (`browser()`).
// - Server route handlers use the user's JWT (`server()`); every query is
//   additionally scoped to the authenticated owner in code — RLS is the
//   backstop, not the only line of defense.
// - The service-role key (`admin()`) is server-only, used solely for the
//   auth bridge (find-or-create user, mint session) and test cleanup. It
//   must never reach the browser (no NEXT_PUBLIC_ prefix, never imported
//   by client components).
import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

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

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
  return key;
}

/** Browser-side client (publishable key). Safe for client components. */
export function browser(): SupabaseClient {
  return createBrowserClient(publicUrl(), publishableKey());
}

/**
 * Server-side client bound to the request cookies (user JWT). Use in Route
 * Handlers, Server Components, and middleware. Call `getUser()` — never
 * trust `getSession()` — to authenticate.
 */
export async function server(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(publicUrl(), publishableKey(), {
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
}

/**
 * Service-role client (bypasses RLS). Server-only. Restricted to: auth
 * bridge user lookup/creation, profile bootstrap, session minting, and
 * test cleanup. Never derive authorization from its results — always
 * re-derive the owner from the verified session.
 */
export function admin(): SupabaseClient {
  return createClient(publicUrl(), serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
