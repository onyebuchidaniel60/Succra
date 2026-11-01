// POST /api/missions/:id/agents — attach an EVM agent to a mission (owner).
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { registerAgent } from '@/lib/gateway/agents';
import { createSupabaseAgentStore } from '@/lib/gateway/store-agents';
import { admin, server } from '@/lib/supabase';

const bodySchema = z.object({
  address: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(['PRIMARY', 'SUCCESSOR']),
  priority: z.number().int().nonnegative().optional(),
  requiredCapabilities: z.array(z.string()).optional(),
  endpointUrl: z.string().url().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return unauthorized();

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await request.text());
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Request body does not match the agent schema.');
  }

  const result = await registerAgent({
    store: createSupabaseAgentStore(admin()),
    ownerId: auth.user.id,
    missionId: id,
    input: {
      address: parsed.data.address,
      name: parsed.data.name,
      role: parsed.data.role,
      ...(parsed.data.priority !== undefined ? { priority: parsed.data.priority } : {}),
      ...(parsed.data.requiredCapabilities !== undefined
        ? { requiredCapabilities: parsed.data.requiredCapabilities }
        : {}),
      ...(parsed.data.endpointUrl !== undefined ? { endpointUrl: parsed.data.endpointUrl } : {}),
    },
  });
  return NextResponse.json(result.json, { status: result.status });
}

export function DELETE(): NextResponse {
  return apiError(405, 'METHOD_NOT_ALLOWED', 'Agent removal is not supported in MVP.');
}
