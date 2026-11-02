// POST /api/missions/:id/finalize — verify the owner-signed
// MissionFactory.createMission transaction and activate the mission mirror.
//
// Request: { txHash: "0x..." }.
// Auth: owner session; the owner wallet is derived from the profile, never
// from the body. Idempotent when the mission is already ACTIVE at the same
// contract address.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { getSessionWallet } from '@/lib/auth/session';
import {
  createMissionChain,
  MissionDeploymentError,
  type MissionDeploymentErrorCode,
} from '@/lib/missions/chain';
import { finalizeMission, MissionFinalizeError } from '@/lib/missions/creation';
import { createSupabaseMissionCreationStore } from '@/lib/missions/creation-store';
import { admin } from '@/lib/supabase';

const bodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'txHash must be a 32-byte hex value.'),
});

const DEPLOYMENT_STATUS: Record<MissionDeploymentErrorCode, number> = {
  TX_NOT_FOUND: 404,
  TX_FAILED: 422,
  EVENT_MISSING: 409,
  OWNER_MISMATCH: 409,
  ADDRESS_MISMATCH: 409,
  POLICY_MISMATCH: 409,
  STATE_MISMATCH: 409,
};

function deploymentCode(code: MissionDeploymentErrorCode): string {
  switch (code) {
    case 'TX_NOT_FOUND':
      return 'MISSION_TX_NOT_FOUND';
    case 'TX_FAILED':
      return 'MISSION_TX_FAILED';
    case 'OWNER_MISMATCH':
      return 'MISSION_OWNER_MISMATCH';
    case 'POLICY_MISMATCH':
      return 'MISSION_POLICY_MISMATCH';
    case 'ADDRESS_MISMATCH':
      return 'MISSION_ADDRESS_MISMATCH';
    case 'EVENT_MISSING':
      return 'MISSION_EVENT_MISSING';
    case 'STATE_MISMATCH':
      return 'MISSION_STATE_MISMATCH';
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }

  const session = await getSessionWallet();
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be JSON.');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'txHash must be a 32-byte 0x hex value.');
  }

  let chain;
  try {
    chain = createMissionChain();
  } catch {
    return apiError(503, 'CHAIN_NOT_CONFIGURED', 'HashKey mission factory is not configured.');
  }

  try {
    const result = await finalizeMission({
      store: createSupabaseMissionCreationStore(admin()),
      ownerId: session.userId,
      ownerWallet: session.walletAddress,
      missionId: id,
      txHash: parsed.data.txHash as `0x${string}`,
      chain,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof MissionDeploymentError) {
      return apiError(DEPLOYMENT_STATUS[error.code], deploymentCode(error.code), error.message);
    }
    if (error instanceof MissionFinalizeError) {
      const status =
        error.code === 'MISSION_NOT_FOUND'
          ? 404
          : error.code === 'MISSION_FINALIZE_FAILED'
            ? 500
            : 409;
      return apiError(status, error.code, error.message);
    }
    return apiError(503, 'CHAIN_UNAVAILABLE', 'Could not verify the mission deployment.');
  }
}
