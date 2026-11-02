// GET /api/missions/:id — owner-scoped mission detail and live authority.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { getSessionWallet } from '@/lib/auth/session';
import { jsonSafe } from '@/lib/json-safe';
import { getMissionDetail } from '@/lib/missions/detail';
import { server } from '@/lib/supabase';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  const session = await getSessionWallet();
  if (!session) return unauthorized();

  try {
    const detail = await getMissionDetail(await server(), id, session.userId);
    if (!detail) return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
    return NextResponse.json(jsonSafe(detail));
  } catch {
    return apiError(500, 'MISSION_DETAIL_FAILED', 'Could not load mission detail.');
  }
}
