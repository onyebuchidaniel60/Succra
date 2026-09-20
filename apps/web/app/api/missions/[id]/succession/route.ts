// POST /api/missions/:id/succession — run succession (guardian credential).
// Thin transport shell: credential + params in, handler result out.
import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { createKitChainGateway, loadGuardian, programId } from '@/lib/gateway/chain';
import { handleSuccession } from '@/lib/gateway/handlers';
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
  let guardian;
  let chainProgramId: string;
  try {
    guardian = loadGuardian();
    chainProgramId = programId();
  } catch {
    return apiError(500, 'GATEWAY_CONFIG', 'Gateway chain configuration is missing.');
  }
  const result = await handleSuccession({
    store: new SupabaseGatewayStore(admin()),
    chain: createKitChainGateway(),
    guardian,
    programId: chainProgramId,
    guardianCredentialHeader: request.headers.get('x-succra-guardian-credential'),
    expectedGuardianCredential: process.env.SUCCRA_GUARDIAN_CREDENTIAL ?? null,
    missionId: id,
    rawBody,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
