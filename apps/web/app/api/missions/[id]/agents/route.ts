// POST /api/missions/:id/agents — attach an agent (owner session).
// Thin transport shell: session + params in, handler result out.
import { NextResponse } from 'next/server';
import { unauthorized } from '@/lib/api-error';
import { handleAttachAgent } from '@/lib/gateway/handlers';
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
  const result = await handleAttachAgent({
    store: new SupabaseGatewayStore(admin()),
    ownerId: auth.user.id,
    missionId: id,
    rawBody,
  });
  return NextResponse.json(result.json, { status: result.status });
}
