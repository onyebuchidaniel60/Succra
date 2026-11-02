// Succra web — authenticated session helpers.
//
// The Supabase session identifies the user (auth.uid()). The owner wallet
// always comes from the authenticated profile, never from a request body.
// Addresses are stored and returned as 0x-prefixed lowercase hex.
import { unauthorized } from '@/lib/api-error';
import { normalizeWalletAddress } from '@/lib/auth/message';
import { server } from '@/lib/supabase';

export interface SessionWallet {
  userId: string;
  walletAddress: `0x${string}`;
}

/**
 * Resolve the session user and its EVM wallet. Returns null when there is
 * no session or the profile has no valid EVM wallet; callers return 401.
 */
export async function getSessionWallet(): Promise<SessionWallet | null> {
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('wallet_address')
    .eq('id', auth.user.id)
    .maybeSingle();
  const raw = profile?.wallet_address;
  if (typeof raw !== 'string') return null;
  const walletAddress = normalizeWalletAddress(raw);
  if (!walletAddress) return null;
  return { userId: auth.user.id, walletAddress };
}

/** Convenience guard for route handlers. */
export function sessionRequired(): ReturnType<typeof unauthorized> {
  return unauthorized('A wallet-authenticated session is required.');
}
