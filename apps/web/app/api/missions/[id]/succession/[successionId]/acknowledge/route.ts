// POST /api/missions/:id/succession/:successionId/acknowledge — successor
// acknowledges the handoff (successor agent signature). Thin transport
// shell: headers + params in, handler result out.
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { createKitChainGateway, loadGuardian, programId } from '@/lib/gateway/chain';
import { handleAcknowledgeSuccession } from '@/lib/gateway/handlers';
import { SupabaseGatewayStore } from '@/lib/gateway/supabase-store';
import { admin } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; successionId: string }> }
): Promise<NextResponse> {
  const { id, successionId } = await context.params;
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    rawBody = '';
  }
  let guardian;
  let chainProgramId: string;
  try {
    guardian = loadGuardian();
    chainProgramId = programId();
  } catch {
    return apiError(500, 'GATEWAY_CONFIG', 'Gateway chain configuration is missing.');
  }
  const result = await handleAcknowledgeSuccession({
    store: new SupabaseGatewayStore(admin()),
    chain: createKitChainGateway(),
    guardian,
    programId: chainProgramId,
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    rawBody,
    missionId: id,
    successionId,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
