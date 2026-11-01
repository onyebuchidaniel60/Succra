// POST /api/agents/:id/verify — verify an agent's EIP-712 challenge signature.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { verifyAgentChallenge } from '@/lib/gateway/agents';
import { createSupabaseAgentStore } from '@/lib/gateway/store-agents';
import { admin, server } from '@/lib/supabase';

const bodySchema = z.object({
  challenge: z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/),
});

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

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(await request.text());
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Expected { challenge, signature }.');
  }

  const result = await verifyAgentChallenge({
    store: createSupabaseAgentStore(admin()),
    ownerId: auth.user.id,
    agentId: id,
    challenge: parsed.data.challenge,
    signature: parsed.data.signature,
    chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
  });
  return NextResponse.json(result.json, { status: result.status });
}

export function GET(): NextResponse {
  return apiError(405, 'METHOD_NOT_ALLOWED', 'Use POST to verify a challenge.');
}
