// POST /api/agents/:id/challenge — issue an EIP-712 registration challenge.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { issueAgentChallenge } from '@/lib/gateway/agents';
import { createSupabaseAgentStore } from '@/lib/gateway/store-agents';
import { jsonSafe, jsonSafeTypedData } from '@/lib/json-safe';
import { admin, server } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return unauthorized();

  // Drain any body so the request is well-formed; the challenge endpoint
  // does not require one.
  await request.text().catch(() => undefined);

  const result = await issueAgentChallenge({
    store: createSupabaseAgentStore(admin()),
    ownerId: auth.user.id,
    agentId: id,
    chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
  });
  const payload = result.json as { typedData?: unknown } & Record<string, unknown>;
  return NextResponse.json(
    jsonSafe({
      ...payload,
      ...(payload.typedData ? { typedData: jsonSafeTypedData(payload.typedData) } : {}),
    }),
    { status: result.status }
  );
}

export function GET(): NextResponse {
  return apiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to issue a challenge.');
}
