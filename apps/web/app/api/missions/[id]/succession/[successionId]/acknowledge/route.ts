// POST /api/missions/:id/succession/:successionId/acknowledge
//
// The successor authenticates with a standard SuccraRequest EIP-712 signature
// over this path/body, and separately signs the recovery ACK digest. The
// guardian submits the ACK transaction so the successor needs no gas.
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { verifyAgentRequest, type AgentAuthReason } from '@/lib/gateway/agent-auth';
import { readMissionState } from '@/lib/gateway/contract-reader';
import { sendAcknowledgeRecovery } from '@/lib/gateway/contract-writer';
import { acknowledgeRecovery } from '@/lib/gateway/succession-ack';
import { insertAuditEvent } from '@/lib/gateway/store-quarantine';
import { getAgentByAddress } from '@/lib/gateway/store-preflight';
import {
  getMissionAgentStatus,
  getSuccessionById,
  getSuccessionMission,
  markSuccessionAcknowledged,
  updateMissionAgentStatus,
  updateMissionCurrentAgent,
  updateMissionStatus,
} from '@/lib/gateway/store-succession';
import { admin } from '@/lib/supabase';
import { consumeAgentNonce, isAgentAssigned } from '@/lib/gateway/store-preflight';

const bodySchema = z.object({
  expectedVersion: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/),
});

function authError(reason: AgentAuthReason): NextResponse {
  switch (reason) {
    case 'UNAUTHENTICATED':
      return apiError(401, 'UNAUTHENTICATED', 'Agent authentication is required.');
    case 'STALE_REQUEST':
      return apiError(401, 'STALE_REQUEST', 'The request timestamp is outside the allowed window.');
    case 'REPLAY_DETECTED':
      return apiError(409, 'REPLAY_DETECTED', 'This agent request nonce has already been used.');
    case 'INVALID_SIGNATURE':
      return apiError(401, 'INVALID_SIGNATURE', 'The agent signature is invalid.');
    case 'AGENT_NOT_CURRENT':
      return apiError(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; successionId: string }> }
): Promise<NextResponse> {
  const { id, successionId } = await context.params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(successionId).success
  ) {
    return apiError(400, 'INVALID_BODY', 'Mission and succession ids must be UUIDs.');
  }
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body could not be read.');
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Expected { expectedVersion, signature }.');
  }

  const db = admin();
  try {
    const mission = await getSuccessionMission(db, id);
    if (!mission) return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
    const succession = await getSuccessionById(db, id, successionId);
    if (!succession) return apiError(404, 'SUCCESSION_NOT_FOUND', 'Succession not found.');
    if (succession.status !== 'PENDING_ACK') {
      return apiError(
        409,
        'SUCCESSION_NOT_PENDING',
        'This succession is not awaiting acknowledgement.'
      );
    }

    const addressValue = mission.contract_address ?? mission.pda_address;
    if (!isAddress(addressValue)) {
      return apiError(500, 'MISSION_CONTRACT_INVALID', 'Mission contract address is invalid.');
    }
    const missionAddress = addressValue as `0x${string}`;

    const headerAgent = request.headers.get('x-succra-agent-address');
    if (!headerAgent) {
      return apiError(401, 'UNAUTHENTICATED', 'Agent authentication is required.');
    }
    const agent = await getAgentByAddress(db, headerAgent);
    if (!agent) {
      return apiError(403, 'AGENT_NOT_CURRENT', 'The successor agent is not registered.');
    }
    if (agent.id !== succession.to_agent_id) {
      return apiError(403, 'SUCCESSION_FORBIDDEN', 'This succession belongs to another agent.');
    }

    const auth = await verifyAgentRequest({
      headers: request.headers,
      method: request.method,
      path: new URL(request.url).pathname,
      body: parsedBody as Record<string, unknown>,
      missionId: id,
      missionAddress,
      chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
      currentAgent: succession.to_agent_address,
      agent: { id: agent.id, address: agent.public_key },
      store: {
        consumeAgentNonce: (agentId, nonce, expiresAt) =>
          consumeAgentNonce(db, agentId, nonce, expiresAt),
        isAgentAssigned: (missionId, agentId) => isAgentAssigned(db, missionId, agentId),
      },
      requestId: successionId,
      nowMs: Date.now(),
    });
    if (!auth.ok) return authError(auth.reason);

    const expectedVersion =
      typeof parsed.data.expectedVersion === 'number'
        ? BigInt(parsed.data.expectedVersion)
        : BigInt(parsed.data.expectedVersion);
    const result = await acknowledgeRecovery({
      deps: {
        getMission: (missionId) => getSuccessionMission(db, missionId),
        getSuccession: (missionId, idValue) => getSuccessionById(db, missionId, idValue),
        getSuccessorEligibility: async ({ missionId, agentId }) => ({
          agentStatus: agent.status,
          assignmentStatus: await getMissionAgentStatus(db, missionId, agentId),
        }),
        readState: (address) => readMissionState(address),
        submitAck: (args) => sendAcknowledgeRecovery(args),
        insertAuditEvent: async (row) => {
          await insertAuditEvent(db, row);
        },
        markAcknowledged: (idValue, txHash, at) =>
          markSuccessionAcknowledged(db, idValue, txHash, at),
        updateAgentStatus: (missionId, agentId, status) =>
          updateMissionAgentStatus(db, missionId, agentId, status),
        updateMissionStatus: (missionId, status) => updateMissionStatus(db, missionId, status),
        updateMissionCurrentAgent: (missionId, agentId, address) =>
          updateMissionCurrentAgent(db, missionId, agentId, address),
      },
      missionId: id,
      successionId,
      expectedVersion,
      signature: parsed.data.signature as `0x${string}`,
      agentId: agent.id,
      agentAddress: agent.public_key,
    });
    return NextResponse.json(result.json, { status: result.status });
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'The acknowledgement could not be completed.');
  }
}
