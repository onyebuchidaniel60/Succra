// POST /api/missions/:id/checkpoints — persist a verified checkpoint
// (runtime internal credential). Thin transport shell.
import { NextResponse } from 'next/server';
import { createKitChainGateway } from '@/lib/gateway/chain';
import { handleCheckpoints } from '@/lib/gateway/handlers';
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
  const result = await handleCheckpoints({
    store: new SupabaseGatewayStore(admin()),
    chain: createKitChainGateway(),
    guardianCredentialHeader: request.headers.get('x-succra-guardian-credential'),
    expectedGuardianCredential: process.env.SUCCRA_GUARDIAN_CREDENTIAL ?? null,
    missionId: id,
    rawBody,
    nowMs: Date.now(),
  });
  return NextResponse.json(result.json, { status: result.status });
}
