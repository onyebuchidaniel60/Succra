// POST /api/missions/:id/actions/:requestId/submit — submit (agent signature).
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { createKitChainGateway, loadFeePayer } from '@/lib/gateway/chain';
import { handleSubmit } from '@/lib/gateway/handlers';
import { SupabaseGatewayStore } from '@/lib/gateway/supabase-store';
import { admin } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; requestId: string }> }
): Promise<NextResponse> {
  const { id, requestId } = await context.params;
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    rawBody = '';
  }
  let feePayer;
  try {
    feePayer = loadFeePayer();
  } catch {
    return apiError(500, 'GATEWAY_CONFIG', 'Gateway chain configuration is missing.');
  }
  const result = await handleSubmit({
    store: new SupabaseGatewayStore(admin()),
    chain: createKitChainGateway(),
    feePayer,
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    rawBody,
    missionId: id,
    requestId,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
