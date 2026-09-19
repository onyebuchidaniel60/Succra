// POST /api/agents/:id/verify — verify a signed challenge (owner).
import { NextResponse } from 'next/server';
import { unauthorized } from '@/lib/api-error';
import { handleVerifyChallenge } from '@/lib/gateway/handlers';
import { SupabaseGatewayStore } from '@/lib/gateway/supabase-store';
import { admin, server } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return unauthorized();
  }
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    rawBody = '';
  }
  const result = await handleVerifyChallenge({
    store: new SupabaseGatewayStore(admin()),
    ownerId: auth.user.id,
    agentId: id,
    rawBody,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
