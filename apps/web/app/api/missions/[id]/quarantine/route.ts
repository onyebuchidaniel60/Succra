// POST /api/missions/:id/quarantine — owner session or guardian credential.
//
// Both modes submit the same guardian-authorized SuccraMission.quarantine
// call. The chain is authoritative; the database mirror is written only after
// the transaction confirms. Already-quarantined missions return 200
// idempotently without a second transaction.
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, unauthorized } from '@/lib/api-error';
import { readMissionState } from '@/lib/gateway/contract-reader';
import { sendQuarantine } from '@/lib/gateway/contract-writer';
import { requestQuarantine } from '@/lib/gateway/quarantine-evm';
import {
  getQuarantineMission,
  insertAuditEvent as insertAuditEventRow,
  updateCurrentAgentStatusToQuarantined,
  updateMissionStatusToQuarantined,
} from '@/lib/gateway/store-quarantine';
import { admin, server } from '@/lib/supabase';

function guardianCredentialMatches(request: Request): boolean {
  const header = request.headers.get('authorization');
  const expected = process.env.HASHKEY_GUARDIAN_CREDENTIAL;
  if (!header?.startsWith('Bearer ') || !expected) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (presented.length === 0) return false;
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return (
    presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes)
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }

  const db = admin();
  let actor: { type: 'owner' | 'guardian'; id: string | null };

  if (guardianCredentialMatches(request)) {
    actor = { type: 'guardian', id: null };
  } else {
    const supabase = await server();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const mission = await getQuarantineMission(db, id);
    if (!mission || mission.owner_id !== auth.user.id) {
      return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
    }
    actor = { type: 'owner', id: auth.user.id };
  }

  try {
    const result = await requestQuarantine({
      deps: {
        getMission: (missionId) => getQuarantineMission(db, missionId),
        readState: (address) => readMissionState(address),
        submitQuarantine: (args) => sendQuarantine(args),
        insertAuditEvent: async (row) => {
          await insertAuditEventRow(db, row);
        },
        updateMissionStatus: (missionId) => updateMissionStatusToQuarantined(db, missionId),
        updateAgentStatus: (missionId) => updateCurrentAgentStatusToQuarantined(db, missionId),
      },
      missionId: id,
      actor,
    });
    return NextResponse.json(result.json, { status: result.status });
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'The quarantine request could not be completed.');
  }
}
