// Succra design system — status badge with text + icon (never colour-only).
import { statusTone } from '@/lib/format';

export default function StatusBadge({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}): React.JSX.Element {
  const tone = statusTone(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${tone.className} ${className}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone.dotClassName}`} />
      <span className="sr-only">Status: </span>
      {tone.label}
    </span>
  );
}
