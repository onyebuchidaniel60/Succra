// Succra web — JSON error envelope (ARCHITECTURE.md §10).
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

/** Every error response uses the §10 envelope. Never includes secrets. */
export function apiError(
  status: number,
  code: string,
  message: string
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, requestId: randomUUID() } }, { status });
}

/** 401 for missing/invalid sessions (dashboard uses redirect instead). */
export function unauthorized(message = 'Authentication required.'): NextResponse<ApiErrorBody> {
  return apiError(401, 'UNAUTHORIZED', message);
}
