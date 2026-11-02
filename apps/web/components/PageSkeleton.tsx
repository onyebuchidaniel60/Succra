// Succra design system — layout-preserving loading skeleton.
export default function PageSkeleton({
  title = 'Loading…',
  cards = 2,
}: {
  title?: string;
  cards?: number;
}): React.JSX.Element {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 sm:py-14" aria-busy="true" aria-live="polite">
      <span className="sr-only">{title}</span>
      <div className="h-4 w-28 animate-pulse rounded bg-zinc-800" />
      <div className="mt-4 h-9 w-2/3 max-w-md animate-pulse rounded bg-zinc-800" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: cards }).map((_, index) => (
          <div
            key={index}
            className="h-44 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60"
          />
        ))}
      </div>
      <div className="mt-8 h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
    </div>
  );
}
