'use client';

// Succra design system — inline error with optional retry.
export default function InlineError({
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-200 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md border border-red-800 px-3 py-1.5 font-medium text-red-100 transition-colors duration-150 hover:bg-red-900/50"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
