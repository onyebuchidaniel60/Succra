'use client';

// Accessible copy control for addresses and hashes.
import { useState } from 'react';

export default function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          })
          .catch(() => undefined);
      }}
      className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors duration-150 hover:border-zinc-500 focus-visible:border-emerald-500"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
