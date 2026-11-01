// GET /api/agents/:id/status — owner session OR agent EIP-712 auth.
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { z } from 'zod';
import { apiError } from '@/lib/api-error';
import { verifyAgentRequest, type AgentAuthReason } from '@/lib/gateway/agent-auth';
import { agentStatusView } from '@/lib/gateway/agents';
import { createSupabaseAgentStore } from '@/lib/gateway/store-agents';
import { consumeAgentNonce } from '@/lib/gateway/store-preflight';
import { admin, server } from '@/lib/supabase';

function authError(reason: AgentAuthReason): NextResponse {
  switch (reason) {
    case 'UNAUTHENTICATED':
      return apiError(401, 'UNAUTHENTICATED', 'Authentication is required.');
    case 'STALE_REQUEST':
      return apiError(401, 'STALE_REQUEST', 'The request timestamp is outside the allowed window.');
    case 'REPLAY_DETECTED':
      return apiError(409, 'REPLAY_DETECTED', 'This agent request nonce has already been used.');
    case 'INVALID_SIGNATURE':
      return apiError(401, 'INVALID_SIGNATURE', 'The agent signature is invalid.');
    case 'AGENT_NOT_CURRENT':
      return apiError(403, 'AGENT_NOT_CURRENT', 'The agent is not authorized for this request.');
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  const db = admin();
  const store = createSupabaseAgentStore(db);
  const agent = await store.getAgentById(id);
  if (!agent) return apiError(404, 'AGENT_NOT_FOUND', 'Agent not found.');

  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    if (agent.owner_id !== auth.user.id) {
      return apiError(404, 'AGENT_NOT_FOUND', 'Agent not found.');
    }
    const result = await agentStatusView({ store, agent });
    return NextResponse.json(result.json, { status: result.status });
  }

  if (!isAddress(agent.address)) {
    return apiError(500, 'AGENT_INVALID_ADDRESS', 'Agent address is invalid.');
  }
  await request.text().catch(() => undefined);
  const verified = await verifyAgentRequest({
    headers: request.headers,
    method: request.method,
    path: new URL(request.url).pathname,
    body: {},
    missionId: agent.id,
    missionAddress: agent.address as `0x${string}`,
    chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
    agent: { id: agent.id, address: agent.address },
    store: {
      consumeAgentNonce: (agentId, nonce, expiresAt) =>
        consumeAgentNonce(db, agentId, nonce, expiresAt),
      isAgentAssigned: async () => true,
    },
    requestId: 'agent-status',
    authorization: 'agent-only',
    nowMs: Date.now(),
  });
  if (!verified.ok) return authError(verified.reason);

  const result = await agentStatusView({ store, agent });
  return NextResponse.json(result.json, { status: result.status });
}
