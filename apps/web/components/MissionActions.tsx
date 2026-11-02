'use client';

// Owner/guardian mission actions used by the mission detail rail.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import InlineError from '@/components/InlineError';

export interface MissionActionsProps {
  missionId: string;
  status: string;
  hasPendingSuccession: boolean;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === 'string') return payload.error.message;
  } catch {
    // Fall through to the generic message.
  }
  return 'The action could not be completed.';
}

export default function MissionActions({
  missionId,
  status,
  hasPendingSuccession,
}: MissionActionsProps): React.JSX.Element {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState<'quarantine' | 'succession' | null>(null);
  const [error, setError] = useState('');

  async function quarantine(): Promise<void> {
    if (working) return;
    setWorking('quarantine');
    setError('');
    try {
      const response = await fetch(`/api/missions/${missionId}/quarantine`, { method: 'POST' });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Quarantine failed. Retry.');
    } finally {
      setWorking(null);
    }
  }

  async function succession(): Promise<void> {
    if (working) return;
    setWorking('succession');
    setError('');
    try {
      const response = await fetch(`/api/missions/${missionId}/succession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        setError(await errorMessage(response));
        return;
      }
      router.refresh();
    } catch {
      setError('Succession failed. Retry.');
    } finally {
      setWorking(null);
    }
  }

  return (
    <section
      className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5"
      aria-label="Mission actions"
    >
      <h2 className="text-sm font-semibold text-zinc-200">Actions</h2>
      <p className="mt-1 text-xs text-zinc-400">
        Owner controls only. Quarantine freezes authority; it never moves funds.
      </p>

      <div className="mt-4 space-y-2">
        {status === 'ACTIVE' ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="w-full rounded-md border border-red-800 px-3 py-2 text-sm font-medium text-red-300 transition-colors duration-150 hover:bg-red-950/40"
          >
            Quarantine mission
          </button>
        ) : null}

        <ConfirmDialog
          open={confirming}
          title="Quarantine this mission?"
          description="The current agent loses payment authority immediately. Funds remain in the owner’s wallet."
          confirmLabel="Confirm quarantine"
          busy={working === 'quarantine'}
          onConfirm={() => void quarantine()}
          onCancel={() => setConfirming(false)}
        />

        {status === 'QUARANTINED' ? (
          <button
            type="button"
            onClick={() => void succession()}
            disabled={working !== null}
            className="w-full rounded-md border border-amber-700 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-950/40 disabled:opacity-50"
          >
            {working === 'succession' ? 'Triggering…' : 'Trigger succession'}
          </button>
        ) : null}

        {status === 'RECOVERING' ? (
          <p className="rounded-md border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">
            {hasPendingSuccession
              ? 'Pending successor acknowledgement. The successor must sign the recovery ACK.'
              : 'Waiting for the runtime to activate a successor.'}
          </p>
        ) : null}

        {status === 'ACTIVE_RECOVERY' ? (
          <p className="rounded-md border border-emerald-800 bg-emerald-950/30 p-3 text-xs text-emerald-200">
            Mission is under recovery authority. The successor cannot expand policy.
          </p>
        ) : null}

        {!['ACTIVE', 'QUARANTINED', 'RECOVERING', 'ACTIVE_RECOVERY'].includes(status) ? (
          <p className="text-xs text-zinc-400">No owner actions are available in this status.</p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      ) : null}
    </section>
  );
}
