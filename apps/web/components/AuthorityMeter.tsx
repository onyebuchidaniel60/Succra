// Succra design system — budget vs per-payment authority meter.
import { formatAtomicUnknown, formatTokenAmount } from '@/lib/format';

export default function AuthorityMeter({
  spentAtomic,
  budgetAtomic,
  perPaymentAtomic,
  decimals,
  symbol,
}: {
  spentAtomic: bigint | string;
  budgetAtomic: bigint | string;
  perPaymentAtomic: bigint | string | null;
  decimals: number | null;
  symbol?: string | null;
}): React.JSX.Element {
  let spent = 0n;
  let budget = 0n;
  let perPayment = 0n;
  try {
    spent = BigInt(spentAtomic);
    budget = BigInt(budgetAtomic);
    perPayment = perPaymentAtomic === null ? 0n : BigInt(perPaymentAtomic);
  } catch {
    // Keep zeroed values; the labels still show raw values.
  }
  const ratio = budget > 0n ? Number((spent * 10_000n) / budget) / 100 : 0;
  const bounded = Math.max(0, Math.min(100, ratio));
  const fmt = (value: bigint): string =>
    decimals === null ? formatAtomicUnknown(value) : formatTokenAmount(value, decimals, 2);
  const unit = symbol ? ` ${symbol}` : '';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-zinc-400">Spent</span>
        <span className="font-mono text-zinc-300">
          {fmt(spent)}
          {unit} / {fmt(budget)}
          {unit}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Budget consumed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(bounded)}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-150"
          style={{ width: `${bounded}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
        <span className="text-zinc-400">Per-payment ceiling</span>
        <span className="font-mono text-zinc-300">
          {perPaymentAtomic === null ? '—' : `${fmt(perPayment)}${unit}`}
        </span>
      </div>
    </div>
  );
}
