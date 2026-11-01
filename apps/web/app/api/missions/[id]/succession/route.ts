// POST /api/missions/:id/succession — manual succession trigger.
// GET  /api/missions/:id/succession — owner-scoped succession history.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { guardianCredentialMatches } from '@/lib/gateway/guardian-auth';
import { getSuccessionMission, listSuccessions } from '@/lib/gateway/store-succession';
import { triggerSuccessionForMission } from '@/lib/gateway/succession-runner';
import { admin, server } from '@/lib/supabase';

const bodySchema = z.object({
  successorAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  let body: unknown = {};
  try {
    const raw = await request.text();
    body = raw.length > 0 ? JSON.parse(raw) : {};
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'successorAddress must be an EVM address.');
  }

  const db = admin();
  const guardianMode = guardianCredentialMatches(request);
  if (!guardianMode) {
    const supabase = await server();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const mission = await getSuccessionMission(db, id);
    if (!mission || mission.owner_id !== auth.user.id) {
      return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
    }
  }

  try {
    const result = await triggerSuccessionForMission(id, {
      triggerType: 'owner_manual',
      ...(parsed.data.successorAddress !== undefined
        ? { preferredSuccessorAddress: parsed.data.successorAddress }
        : {}),
    });
    if (result.outcome === 'ACTIVATED' || result.outcome === 'ALREADY_ACTIVATED') {
      return NextResponse.json({
        successionId: result.successionId ?? null,
        activatedAddress: result.toAgentAddress ?? null,
        status: 'PENDING_ACK',
      });
    }
    if (result.outcome === 'ACTIVATION_FAILED') {
      return apiError(502, 'SUCCESSION_ACTIVATION_FAILED', 'Successor activation failed.');
    }
    return apiError(409, 'NO_ELIGIBLE_SUCCESSOR', 'No eligible successor is available.');
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'The succession request could not be completed.');
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return unauthorized();

  const db = admin();
  const mission = await getSuccessionMission(db, id);
  if (!mission || mission.owner_id !== auth.user.id) {
    return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  }
  const succession = await listSuccessions(db, id);
  const latest = succession[0] ?? null;
  return NextResponse.json({
    mission: {
      id: mission.id,
      status: mission.status,
      currentAgentId: mission.current_agent_id,
      currentAgentAddress: mission.current_agent_address,
    },
    succession,
    currentAgent: mission.current_agent_address,
    previousAgent: latest?.from_agent_address ?? null,
  });
}
