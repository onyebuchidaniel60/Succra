// POST /api/missions/:id/actions/:requestId/submit — HSP settlement submit.
//
// Synchronous per ARCHITECTURE.md §10: authorizePayment confirms, then HSP is
// submitted, then the endpoint waits for settlement (bounded) and mirrors the
// authoritative result. 202 is returned only on timeout; the DB row remains
// authoritative and the webhook/poller finishes it.
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { verifyAgentRequest, type AgentAuthReason } from '@/lib/gateway/agent-auth';
import { postSettlementHook } from '@/lib/gateway/post-settlement';
import { submitApprovedAction } from '@/lib/gateway/submit-handler';
import {
  createSubmitChain,
  createSubmitHsp,
  createSubmitPersistence,
} from '@/lib/gateway/submit-production';
import {
  consumeAgentNonce,
  getActionRequestByRequestId,
  getAgentByAddress,
  getMissionById,
  isAgentAssigned,
} from '@/lib/gateway/store-preflight';
import { admin } from '@/lib/supabase';

const bodySchema = z.object({
  mandateHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  // 65-byte r||s||v or 64-byte EIP-2098 compact signatures.
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
  context: { params: Promise<{ id: string; requestId: string }> }
): Promise<NextResponse> {
  const { id, requestId } = await context.params;
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(requestId).success) {
    return apiError(400, 'INVALID_BODY', 'Mission and request ids must be UUIDs.');
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
    return apiError(400, 'INVALID_BODY', 'Expected { mandateHash, signature }.');
  }

  const db = admin();
  try {
    const mission = await getMissionById(db, id);
    if (!mission) return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');

    const missionAddressValue = mission.contract_address ?? mission.pda_address;
    if (!isAddress(missionAddressValue)) {
      return apiError(500, 'MISSION_CONTRACT_INVALID', 'Mission contract address is invalid.');
    }
    const missionAddress = missionAddressValue as `0x${string}`;

    const headerAgent = request.headers.get('x-succra-agent-address');
    if (!headerAgent) {
      return apiError(401, 'UNAUTHENTICATED', 'Agent authentication is required.');
    }
    const agent = await getAgentByAddress(db, headerAgent);
    if (!agent) {
      return apiError(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
    }

    const auth = await verifyAgentRequest({
      headers: request.headers,
      method: request.method,
      path: new URL(request.url).pathname,
      body: parsedBody as Record<string, unknown>,
      missionId: id,
      missionAddress,
      chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
      currentAgent: mission.current_agent_address ?? mission.current_agent_public_key,
      agent: { id: agent.id, address: agent.public_key },
      store: {
        consumeAgentNonce: (agentId, nonce, expiresAt) =>
          consumeAgentNonce(db, agentId, nonce, expiresAt),
        isAgentAssigned: (missionId, agentId) => isAgentAssigned(db, missionId, agentId),
      },
      requestId,
      nowMs: Date.now(),
    });
    if (!auth.ok) return authError(auth.reason);

    const action = await getActionRequestByRequestId(db, id, requestId);
    if (!action) return apiError(404, 'ACTION_NOT_FOUND', 'Action request not found.');
    if (action.agent_id !== agent.id) {
      return apiError(403, 'AGENT_NOT_ASSIGNED', 'This action request belongs to another agent.');
    }

    const result = await submitApprovedAction({
      action,
      mission,
      agent,
      missionAddress,
      chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
      mandateHash: parsed.data.mandateHash,
      signature: parsed.data.signature,
      chain: createSubmitChain(),
      hsp: createSubmitHsp(),
      persistence: createSubmitPersistence(db),
      postSettlement: (missionId, expectedVersion) =>
        postSettlementHook(missionId, expectedVersion).then(() => undefined),
    });
    return NextResponse.json(result.json, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Missing ')) {
      return apiError(500, 'SUBMIT_CONFIG', 'Settlement configuration is incomplete.');
    }
    return apiError(500, 'INTERNAL_ERROR', 'The submit request could not be completed.');
  }
}
