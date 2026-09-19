// POST /api/agents/:id/heartbeat — agent liveness (agent signature).
import { NextResponse } from 'next/server';
import { handleHeartbeat } from '@/lib/gateway/handlers';
import { SupabaseGatewayStore } from '@/lib/gateway/supabase-store';
import { admin } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    rawBody = '';
  }
  const result = await handleHeartbeat({
    store: new SupabaseGatewayStore(admin()),
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    rawBody,
    agentPathId: id,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
