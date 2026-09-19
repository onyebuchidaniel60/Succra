// GET /api/agents/:id/status — agent status (owner session OR agent signature).
import { NextResponse } from 'next/server';
import { handleGetStatus } from '@/lib/gateway/handlers';
import { SupabaseGatewayStore } from '@/lib/gateway/supabase-store';
import { admin, server } from '@/lib/supabase';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  const result = await handleGetStatus({
    store: new SupabaseGatewayStore(admin()),
    sessionOwnerId: auth.user?.id ?? null,
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    agentPathId: id,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
