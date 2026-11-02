// GET /api/missions/:id/audit — owner-scoped immutable audit timeline.
//
// Phase 7b is owner-only. Public audit mode (a public mission flag) remains
// deferred; no event row is written by this route.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { getSessionWallet } from '@/lib/auth/session';
import type { AuditEvent } from '@/lib/audit/format';
import { admin } from '@/lib/supabase';

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

  const db = admin();
  const { data: mission, error: missionError } = await db
    .from('missions')
    .select('id,name,status,contract_address,current_agent_address,owner_id')
    .eq('id', id)
    .maybeSingle();
  if (missionError) {
    return apiError(500, 'AUDIT_READ_FAILED', 'Could not load the mission audit.');
  }
  if (!mission || mission.owner_id !== session.userId) {
    return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  }

  const { data: events, error: eventsError } = await db
    .from('audit_events')
    .select(
      'id,mission_id,event_type,actor_type,actor_id,payload_public,onchain_tx_hash,created_at'
    )
    .eq('mission_id', id)
    .order('created_at', { ascending: true });
  if (eventsError) {
    return apiError(500, 'AUDIT_READ_FAILED', 'Could not load the mission audit.');
  }

  return NextResponse.json({
    mission: {
      id: mission.id,
      name: mission.name,
      status: mission.status,
      contractAddress: mission.contract_address,
      currentAgentAddress: mission.current_agent_address,
    },
    events: (events as unknown as AuditEvent[] | null) ?? [],
  });
}
