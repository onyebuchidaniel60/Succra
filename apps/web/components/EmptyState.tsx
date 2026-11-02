// Succra design system — standard empty state.
import type { ReactNode } from 'react';

export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/50 p-8 text-center">
      <h2 className="text-base font-semibold text-zinc-200">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </section>
  );
}
