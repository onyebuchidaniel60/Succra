// `/missions/new` — server entry point for the mission creation wizard.
//
// Session-gated: the owner wallet is resolved from the authenticated
// profile and passed to the client wizard so it can reject a mismatched
// connected wallet before signing.
import { redirect } from 'next/navigation';
import NewMissionWizard from '@/components/NewMissionWizard';
import WalletConnect from '@/components/WalletConnect';
import { normalizeWalletAddress } from '@/lib/auth/message';
import { defaultWizardDraft } from '@/lib/missions/wizard';
import { server } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function NewMissionPage(): Promise<React.JSX.Element> {
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/');
  const { data: profile } = await supabase
    .from('profiles')
    .select('wallet_address')
    .eq('id', auth.user.id)
    .maybeSingle();
  const walletAddress = normalizeWalletAddress(String(profile?.wallet_address ?? ''));
  if (!walletAddress) redirect('/');

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 sm:py-14">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">New mission</p>
          <h1 className="mt-1 text-2xl font-bold">Define bounded authority</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            The mission deploys one SuccraMission contract. The owner wallet signs the deployment;
            funds remain in the owner’s wallet.
          </p>
        </div>
      </div>
      <div className="mt-6">
        <WalletConnect authenticated />
      </div>
      <div className="mt-6">
        <NewMissionWizard ownerWallet={walletAddress} initialDraft={defaultWizardDraft()} />
      </div>
    </main>
  );
}
