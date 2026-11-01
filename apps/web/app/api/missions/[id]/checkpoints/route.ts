// POST /api/missions/:id/checkpoints — guardian-only manual checkpoint.
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { writeCheckpoint } from '@/lib/gateway/checkpoint-writer';
import { readMissionState } from '@/lib/gateway/contract-reader';
import { guardianCredentialMatches } from '@/lib/gateway/guardian-auth';
import { getCheckpointMission } from '@/lib/gateway/store-checkpoints';
import { admin } from '@/lib/supabase';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  if (!guardianCredentialMatches(request)) {
    return apiError(401, 'UNAUTHORIZED', 'Guardian credential is required.');
  }

  const db = admin();
  const mission = await getCheckpointMission(db, id);
  if (!mission) return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  const addressValue = mission.contract_address ?? mission.pda_address;
  if (!isAddress(addressValue)) {
    return apiError(500, 'MISSION_CONTRACT_INVALID', 'Mission contract address is invalid.');
  }

  try {
    const state = await readMissionState(addressValue as `0x${string}`);
    const result = await writeCheckpoint(id, state.stateVersion);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('InvalidVersion') || message.includes('InvalidStatus')) {
      return apiError(409, 'CHECKPOINT_CONFLICT', 'The mission state changed; re-read and retry.');
    }
    return apiError(500, 'CHECKPOINT_FAILED', 'The checkpoint could not be committed.');
  }
}
