// POST /api/missions/:id/quarantine — freeze an ACTIVE mission (owner or guardian).
// Thin transport shell: session/credential + params in, handler result out.
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { createKitChainGateway, loadGuardian, programId } from '@/lib/gateway/chain';
import { handleQuarantine } from '@/lib/gateway/handlers';
import { SupabaseGatewayStore } from '@/lib/gateway/supabase-store';
import { admin, server } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
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
  const result = await handleQuarantine({
    store: new SupabaseGatewayStore(admin()),
    chain: createKitChainGateway(),
    guardian,
    programId: chainProgramId,
    ownerId: auth.user?.id ?? null,
    guardianCredentialHeader: request.headers.get('x-succra-guardian-credential'),
    expectedGuardianCredential: process.env.SUCCRA_GUARDIAN_CREDENTIAL ?? null,
    missionId: id,
    rawBody,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
