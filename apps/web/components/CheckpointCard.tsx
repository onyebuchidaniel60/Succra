// Succra design system — verified checkpoint card with proof link.
import { explorerTxUrl } from '@/lib/audit/format';
import { shortenAddress } from '@/lib/format';

export interface CheckpointCardData {
  sequence: number;
  checkpoint_hash: string;
  committed_tx_hash?: string | null;
  created_at: string;
}

export default function CheckpointCard({
  checkpoint,
  title = 'Latest checkpoint',
}: {
  checkpoint: CheckpointCardData | null;
  title?: string;
}): React.JSX.Element {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
      <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      {checkpoint ? (
        <dl className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-400">Sequence</dt>
            <dd className="font-mono text-zinc-300">#{checkpoint.sequence}</dd>
          </div>
          <div>
            <dt className="text-zinc-400">Hash</dt>
            <dd
              className="mt-1 break-all font-mono text-zinc-300"
              title={checkpoint.checkpoint_hash}
            >
              {shortenAddress(checkpoint.checkpoint_hash, 6)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-400">Committed</dt>
            <dd className="mt-1 text-zinc-300">
              {new Date(checkpoint.created_at).toLocaleString()}
            </dd>
          </div>
          {checkpoint.committed_tx_hash ? (
            <div>
              <dt className="text-zinc-400">Proof</dt>
              <dd className="mt-1">
                <a
                  href={explorerTxUrl(checkpoint.committed_tx_hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-400 underline underline-offset-2"
                >
                  View on Blockscout ↗
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No verified checkpoint yet.</p>
      )}
    </section>
  );
}
