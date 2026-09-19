// POST /api/missions/:id/actions — pre-flight (agent signature).
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { createKitChainGateway, loadFeePayer, programId } from '@/lib/gateway/chain';
import { handlePreflight } from '@/lib/gateway/handlers';
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
  let feePayerAddress: string;
  let chainProgramId: string;
  try {
    feePayerAddress = loadFeePayer().address;
    chainProgramId = programId();
  } catch {
    return apiError(500, 'GATEWAY_CONFIG', 'Gateway chain configuration is missing.');
  }
  const result = await handlePreflight({
    store: new SupabaseGatewayStore(admin()),
    chain: createKitChainGateway(),
    feePayerAddress,
    programId: chainProgramId,
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    rawBody,
    missionId: id,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
