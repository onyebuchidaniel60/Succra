// Succra design system — human-readable mission policy rules.
import { formatAtomicUnknown, formatTokenAmount } from '@/lib/format';
import type { MissionPolicyDocument } from '@/lib/missions';

export default function PolicyRuleList({
  policy,
  decimals,
  symbol,
}: {
  policy: MissionPolicyDocument | null;
  decimals: number | null;
  symbol?: string | null;
}): React.JSX.Element {
  if (!policy) {
    return <p className="text-sm text-zinc-400">No stored policy document.</p>;
  }
  const fmt = (value: string): string =>
    decimals === null ? formatAtomicUnknown(value) : formatTokenAmount(value, decimals, 2);
  const unit = symbol ? ` ${symbol}` : '';
  return (
    <ul className="space-y-2 text-xs" aria-label="Mission policy rules">
      <li className="flex justify-between gap-3">
        <span className="text-zinc-400">Per-payment ceiling</span>
        <span className="font-mono text-zinc-300">
          {fmt(policy.max_payment_atomic)}
          {unit}
        </span>
      </li>
      <li className="flex justify-between gap-3">
        <span className="text-zinc-400">Recovery ceiling</span>
        <span className="font-mono text-zinc-300">
          {fmt(policy.recovery_max_payment_atomic)}
          {unit}
        </span>
      </li>
      <li className="flex justify-between gap-3">
        <span className="text-zinc-400">Violation threshold</span>
        <span className="text-zinc-300">
          {policy.violation_threshold} within {policy.violation_window_seconds}s
        </span>
      </li>
      <li>
        <span className="text-zinc-400">Allowed merchants</span>
        <ul className="mt-1 space-y-1">
          {policy.merchant_allowlist.map((merchant) => (
            <li key={merchant} className="break-all font-mono text-zinc-300">
              {merchant}
            </li>
          ))}
        </ul>
      </li>
      <li className="flex justify-between gap-3">
        <span className="text-zinc-400">Expires</span>
        <span className="text-zinc-300">{new Date(policy.expires_at).toLocaleString()}</span>
      </li>
    </ul>
  );
}
