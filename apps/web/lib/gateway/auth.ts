// Succra gateway — agent request authentication (ARCHITECTURE.md §12).
//
// Every agent-authenticated endpoint runs this gate before any business
// logic, in this order:
//   1. headers present + well-formed (400 INVALID_BODY class);
//   2. agent registered (401 AGENT_UNKNOWN);
//   3. timestamp within ±60s (401 STALE_TIMESTAMP);
//   4. Ed25519 signature over the §12 canonical string (401 INVALID_SIGNATURE);
//   5. request nonce unseen + single-use consumed (401 NONCE_REUSED);
//   6. mission assignment for mission-scoped routes (403 AGENT_NOT_ASSIGNED).
// Signature is verified BEFORE nonce state is touched (no state burn on
// unauthenticated requests). The canonical missionId is re-derived here:
// the path mission UUID for mission routes, the agent UUID for
// agent-scoped routes (heartbeat, status) — the SDK builds it the same
// way, so both sides agree byte-for-byte.
import { NextResponse } from 'next/server';
import { buildCanonicalString, verifyCanonicalSignature } from '@succra/shared';
import { apiError, type ApiErrorBody } from '../api-error';
import type { AgentRow, GatewayStore, MissionAgentRow, MissionRow } from './store';

export const AGENT_TIMESTAMP_WINDOW_MS = 60_000;
const NONCE_TTL_MS = 10 * 60 * 1000;

export interface AgentHeaders {
  agentId: string;
  timestamp: string;
  nonce: string;
  signature: string;
}

export function readAgentHeaders(headers: Headers): AgentHeaders | null {
  const agentId = headers.get('x-succra-agent-id');
  const timestamp = headers.get('x-succra-timestamp');
  const nonce = headers.get('x-succra-nonce');
  const signature = headers.get('x-succra-signature');
  if (!agentId || !timestamp || !nonce || !signature) {
    return null;
  }
  return { agentId, timestamp, nonce, signature };
}

export interface AuthenticatedAgent {
  agent: AgentRow;
  mission: MissionRow | null;
  assignment: MissionAgentRow | null;
}

type AuthResult = { ok: AuthenticatedAgent } | { error: NextResponse<ApiErrorBody> };

function fail(status: number, code: string, message: string): AuthResult {
  return { error: apiError(status, code, message) };
}

/**
 * Authenticate an agent-signed request. `rawBody` is the exact received
 * body text ('' for GETs); `missionId` is the path mission UUID for
 * mission-scoped routes, null for agent-scoped routes.
 */
export async function authenticateAgentRequest(args: {
  store: GatewayStore;
  headers: Headers;
  method: string;
  path: string;
  rawBody: string;
  missionId: string | null;
  nowMs: number;
}): Promise<AuthResult> {
  const parsed = readAgentHeaders(args.headers);
  if (!parsed) {
    return fail(400, 'INVALID_BODY', 'Missing agent authentication headers.');
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(parsed.agentId)) {
    return fail(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  if (!/^\d{1,16}$/.test(parsed.timestamp)) {
    return fail(400, 'INVALID_BODY', 'Timestamp must be milliseconds since epoch.');
  }
  if (parsed.nonce.length < 8 || parsed.nonce.length > 128) {
    return fail(400, 'INVALID_BODY', 'Nonce has an invalid length.');
  }
  const agent = await args.store.getAgentById(parsed.agentId);
  if (!agent) {
    return fail(401, 'AGENT_UNKNOWN', 'Agent is not registered.');
  }
  const timestampMs = Number(parsed.timestamp);
  if (
    !Number.isSafeInteger(timestampMs) ||
    Math.abs(args.nowMs - timestampMs) > AGENT_TIMESTAMP_WINDOW_MS
  ) {
    return fail(401, 'STALE_TIMESTAMP', 'Request timestamp is outside the acceptance window.');
  }
  const missionId = args.missionId ?? agent.id;
  const canonical = buildCanonicalString({
    timestamp: parsed.timestamp,
    nonce: parsed.nonce,
    missionId,
    method: args.method.toUpperCase(),
    path: args.path,
    body: args.rawBody,
  });
  const valid = verifyCanonicalSignature({
    publicKeyBase58: agent.public_key,
    canonical,
    signatureBase64: parsed.signature,
  });
  if (!valid) {
    return fail(401, 'INVALID_SIGNATURE', 'Agent signature rejected.');
  }
  const inserted = await args.store.insertRequestNonce(
    agent.id,
    parsed.nonce,
    new Date(args.nowMs + NONCE_TTL_MS).toISOString()
  );
  if (inserted === 'duplicate') {
    return fail(401, 'NONCE_REUSED', 'Request nonce was already used.');
  }
  const consumed = await args.store.consumeRequestNonce(
    agent.id,
    parsed.nonce,
    new Date(args.nowMs).toISOString()
  );
  if (!consumed) {
    return fail(401, 'NONCE_REUSED', 'Request nonce was already used.');
  }
  await args.store.sweepRequestNonces(new Date(args.nowMs).toISOString()).catch(() => undefined);

  if (args.missionId === null) {
    return { ok: { agent, mission: null, assignment: null } };
  }
  const mission = await args.store.getMissionById(args.missionId);
  if (!mission) {
    return fail(404, 'MISSION_NOT_FOUND', 'Mission does not exist.');
  }
  const assignment = await args.store.getAssignment(mission.id, agent.id);
  if (!assignment) {
    return fail(403, 'AGENT_NOT_ASSIGNED', 'Agent is not assigned to this mission.');
  }
  return { ok: { agent, mission, assignment } };
}
