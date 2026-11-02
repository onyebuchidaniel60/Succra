// Succra design system — compact EVM agent identity with copy control.
import CopyButton from '@/components/CopyButton';
import { shortenAddress } from '@/lib/format';

export default function AgentIdentityChip({
  address,
  label,
  role,
}: {
  address: string;
  label?: string;
  role?: string;
}): React.JSX.Element {
  const valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  return (
    <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/70 px-2.5 py-1 text-xs">
      {role ? <span className="text-zinc-400">{role}</span> : null}
      <span className="font-mono text-zinc-200" title={address}>
        {valid ? shortenAddress(address, 4) : address || '—'}
      </span>
      {label ? <span className="truncate text-zinc-400">{label}</span> : null}
      {valid ? <CopyButton value={address} label={label ?? 'agent address'} /> : null}
    </span>
  );
}
