// Succra SDK — §10 error envelope parsing.
//
// Every gateway error uses { error: { code, message, requestId } }.
// Success shapes are endpoint-specific (see client.ts); only errors are
// normalized here.
export interface GatewayErrorBody {
  error: { code: string; message: string; requestId: string };
}

/** Thrown for gateway error responses (HTTP 4xx/5xx with §10 envelope). */
export class SdkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;

  constructor(args: { status: number; code: string; message: string; requestId: string }) {
    super(args.message);
    this.name = 'SdkError';
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
  }
}

/** Thrown when the SDK itself refuses an action (never sent). */
export class SdkRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SdkRefusal';
  }
}

/** Parse an error payload into an SdkError. Never throws. */
export function parseGatewayError(status: number, payload: unknown): SdkError {
  const fallback = new SdkError({
    status,
    code: 'UNKNOWN_ERROR',
    message: 'Gateway returned an unrecognized error.',
    requestId: 'unknown',
  });
  if (typeof payload !== 'object' || payload === null) {
    return fallback;
  }
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return fallback;
  }
  const record = error as Record<string, unknown>;
  if (typeof record['code'] !== 'string' || typeof record['message'] !== 'string') {
    return fallback;
  }
  return new SdkError({
    status,
    code: record['code'],
    message: record['message'],
    requestId: typeof record['requestId'] === 'string' ? record['requestId'] : 'unknown',
  });
}
