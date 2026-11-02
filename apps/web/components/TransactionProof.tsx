// Succra design system — transaction hash plus Blockscout proof.
import CopyButton from '@/components/CopyButton';
import { explorerTxUrl } from '@/lib/audit/format';
import { shortenAddress } from '@/lib/format';

export default function TransactionProof({
  txHash,
  label = 'Transaction',
}: {
  txHash: string;
  label?: string;
}): React.JSX.Element {
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-300" title={txHash}>
        {shortenAddress(txHash, 6)}
      </span>
      <CopyButton value={txHash} label={label} />
      <a
        href={explorerTxUrl(txHash)}
        target="_blank"
        rel="noreferrer"
        className="text-emerald-400 underline underline-offset-2"
      >
        View on Blockscout ↗
      </a>
    </span>
  );
}
