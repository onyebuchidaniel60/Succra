// Succra web — display formatting for addresses and atomic token amounts.
// Token amounts are DB mirrors only; the contract/HSP remain authoritative.

export const DEFAULT_TOKEN_DECIMALS = 6;

export function shortenAddress(value: string, visible = 4): string {
  if (value.length <= visible * 2 + 1) return value;
  return `${value.slice(0, visible + 2)}…${value.slice(-visible)}`;
}

/** Format a decimal atomic amount for display (default 6-decimal USDC). */
export function formatAtomic(
  value: string | bigint | null | undefined,
  decimals = DEFAULT_TOKEN_DECIMALS,
  maxFraction = 2
): string {
  if (value === null || value === undefined || value === '') return '—';
  let atomic: bigint;
  try {
    atomic = BigInt(value);
  } catch {
    return String(value);
  }
  const negative = atomic < 0n;
  const absolute = negative ? -atomic : atomic;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  const fractionText =
    fraction === 0n
      ? ''
      : `.${fraction.toString().padStart(decimals, '0').slice(0, maxFraction).replace(/0+$/, '')}`;
  const trimmed = fractionText === '.' ? '' : fractionText;
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${trimmed}`;
}

export function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export interface StatusTone {
  label: string;
  className: string;
  dotClassName: string;
}

export function statusTone(status: string): StatusTone {
  const label = statusLabel(status);
  switch (status) {
    case 'ACTIVE':
      return {
        label,
        className: 'border-emerald-700/60 bg-emerald-950/50 text-emerald-300',
        dotClassName: 'bg-emerald-400',
      };
    case 'ACTIVE_RECOVERY':
    case 'RECOVERING':
      return {
        label,
        className: 'border-amber-700/60 bg-amber-950/50 text-amber-300',
        dotClassName: 'bg-amber-400',
      };
    case 'QUARANTINED':
    case 'HALTED':
      return {
        label,
        className: 'border-red-800/60 bg-red-950/50 text-red-300',
        dotClassName: 'bg-red-400',
      };
    case 'DRAFT':
      return {
        label,
        className: 'border-blue-800/60 bg-blue-950/50 text-blue-300',
        dotClassName: 'bg-blue-400',
      };
    case 'CANCELLED':
    case 'EXPIRED':
    case 'COMPLETED':
      return {
        label,
        className: 'border-zinc-700 bg-zinc-900 text-zinc-400',
        dotClassName: 'bg-zinc-500',
      };
    default:
      return {
        label,
        className: 'border-zinc-700 bg-zinc-900 text-zinc-300',
        dotClassName: 'bg-zinc-400',
      };
  }
}
