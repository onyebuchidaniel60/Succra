// Succra gateway — HTTP handler functions (framework-free).
//
// Each handle* function takes plain inputs (params, raw body, headers)
// and returns { status, json }. Next.js route files only parse the
// transport, build production deps, and serialize the result — so every
// behavior below is unit-testable with a PGlite store and a fake chain,
// and the live Alpha adapter calls these same functions (no drift).
import { authenticateAgentRequest, readAgentHeaders, type AuthenticatedAgent } from './auth';
import { timingSafeEqual } from 'node:crypto';
import type { ChainGateway, FeePayer } from './chain';
import { HEARTBEAT_MIN_INTERVAL_MS, recordHeartbeat } from './heartbeat';
import { preflightAction, type PreflightBody } from './preflight';
import {
  ATTACH_AGENT_SCHEMA,
  CHALLENGE_VERIFY_SCHEMA,
  EMPTY_BODY_SCHEMA,
  normalizeAgentNonce,
  PREFLIGHT_SCHEMA,
  SUBMIT_SCHEMA,
  UUID_SCHEMA,
} from './schemas';
import { attachAgent, isRegistrationError, issueChallenge, verifyChallenge } from './registration';
import { agentStatusView } from './status';
import { quarantineMission } from './quarantine';
import { submitAction } from './submit';
import type { GatewayStore } from './store';

export interface HandlerResult {
  status: number;
  json: unknown;
}

function error(status: number, code: string, message: string): HandlerResult {
  return { status, json: { error: { code, message, requestId: 'handler' } } };
}

function parseJson(rawBody: string): { ok: unknown } | { error: HandlerResult } {
  try {
    return { ok: JSON.parse(rawBody) as unknown };
  } catch {
    return { error: error(400, 'INVALID_BODY', 'Request body must be JSON.') };
  }
}

async function agentAuth(args: {
  store: GatewayStore;
  headers: Headers;
  method: string;
  path: string;
  rawBody: string;
  missionId: string | null;
  nowMs: number;
}): Promise<AuthenticatedAgent | HandlerResult> {
  const result = await authenticateAgentRequest(args);
  if ('error' in result) {
    const status = result.error.status;
    const body = (await result.error.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    return { status, json: body };
  }
  return result.ok;
}

export async function handleAttachAgent(args: {
  store: GatewayStore;
  ownerId: string | null;
  missionId: string;
  rawBody: string;
}): Promise<HandlerResult> {
  if (!args.ownerId) {
    return error(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  if (!UUID_SCHEMA.safeParse(args.missionId).success) {
    return error(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  const parsedBody = parseJson(args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  const parsed = ATTACH_AGENT_SCHEMA.safeParse(parsedBody.ok);
  if (!parsed.success) {
    return error(400, 'INVALID_BODY', 'Expected { publicKey, name, role? }.');
  }
  try {
    const result = await attachAgent({
      store: args.store,
      ownerId: args.ownerId,
      missionId: args.missionId,
      publicKey: parsed.data.publicKey,
      name: parsed.data.name,
      role: parsed.data.role,
    });
    return {
      status: result.created ? 201 : 200,
      json: { agentId: result.agent.id, status: result.agent.status },
    };
  } catch (err) {
    if (isRegistrationError(err)) {
      return error(err.status, err.code, err.message);
    }
    throw err;
  }
}

export async function handleIssueChallenge(args: {
  store: GatewayStore;
  ownerId: string | null;
  agentId: string;
  rawBody: string;
  nowMs: number;
}): Promise<HandlerResult> {
  if (!args.ownerId) {
    return error(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  if (!UUID_SCHEMA.safeParse(args.agentId).success) {
    return error(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  const parsedBody = parseJson(args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  if (!EMPTY_BODY_SCHEMA.safeParse(parsedBody.ok).success) {
    return error(400, 'INVALID_BODY', 'Request body must be empty.');
  }
  try {
    const result = await issueChallenge({
      store: args.store,
      ownerId: args.ownerId,
      agentId: args.agentId,
      nowMs: args.nowMs,
    });
    return { status: 200, json: result };
  } catch (err) {
    if (isRegistrationError(err)) {
      return error(err.status, err.code, err.message);
    }
    throw err;
  }
}

export async function handleVerifyChallenge(args: {
  store: GatewayStore;
  ownerId: string | null;
  agentId: string;
  rawBody: string;
  nowMs: number;
}): Promise<HandlerResult> {
  if (!args.ownerId) {
    return error(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  if (!UUID_SCHEMA.safeParse(args.agentId).success) {
    return error(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  const parsedBody = parseJson(args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  const parsed = CHALLENGE_VERIFY_SCHEMA.safeParse(parsedBody.ok);
  if (!parsed.success) {
    return error(400, 'INVALID_BODY', 'Expected { challenge, signature }.');
  }
  try {
    const agent = await verifyChallenge({
      store: args.store,
      ownerId: args.ownerId,
      agentId: args.agentId,
      challenge: parsed.data.challenge,
      signatureBase64: parsed.data.signature,
      nowMs: args.nowMs,
    });
    return { status: 200, json: { agentId: agent.id, status: 'VERIFIED' } };
  } catch (err) {
    if (isRegistrationError(err)) {
      return error(err.status, err.code, err.message);
    }
    throw err;
  }
}

export async function handleHeartbeat(args: {
  store: GatewayStore;
  headers: Headers;
  method: string;
  path: string;
  rawBody: string;
  agentPathId: string;
  nowMs: number;
}): Promise<HandlerResult> {
  if (!UUID_SCHEMA.safeParse(args.agentPathId).success) {
    return error(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  const parsedBody = parseJson(args.rawBody === '' ? '{}' : args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  if (!EMPTY_BODY_SCHEMA.safeParse(parsedBody.ok).success) {
    return error(400, 'INVALID_BODY', 'Request body must be empty.');
  }
  const auth = await agentAuth({
    store: args.store,
    headers: args.headers,
    method: args.method,
    path: args.path,
    rawBody: args.rawBody,
    missionId: null,
    nowMs: args.nowMs,
  });
  if ('status' in auth) return auth;
  if (auth.agent.id !== args.agentPathId) {
    return error(403, 'AGENT_FORBIDDEN', 'Header agent does not match the path agent.');
  }
  const outcome = await recordHeartbeat({
    store: args.store,
    agent: auth.agent,
    nowMs: args.nowMs,
  });
  if (outcome.kind === 'rate-limited') {
    return error(
      429,
      'HEARTBEAT_TOO_SOON',
      `Heartbeat too soon. Minimum interval is ${HEARTBEAT_MIN_INTERVAL_MS / 1000}s.`
    );
  }
  return {
    status: 200,
    json: { agentId: outcome.agent.id, lastHeartbeatAt: outcome.agent.last_heartbeat_at },
  };
}

export async function handlePreflight(args: {
  store: GatewayStore;
  chain: ChainGateway;
  feePayerAddress: string;
  programId: string;
  guardian?: FeePayer;
  headers: Headers;
  method: string;
  path: string;
  rawBody: string;
  missionId: string;
  nowMs: number;
}): Promise<HandlerResult> {
  if (!UUID_SCHEMA.safeParse(args.missionId).success) {
    return error(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  const parsedBody = parseJson(args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  const parsed = PREFLIGHT_SCHEMA.safeParse(parsedBody.ok);
  if (!parsed.success) {
    return error(400, 'INVALID_BODY', 'Action request failed validation.');
  }
  const auth = await agentAuth({
    store: args.store,
    headers: args.headers,
    method: args.method,
    path: args.path,
    rawBody: args.rawBody,
    missionId: args.missionId,
    nowMs: args.nowMs,
  });
  if ('status' in auth) return auth;
  if (!auth.mission) {
    return error(500, 'PREFLIGHT_FAILED', 'Mission scope was lost during authentication.');
  }
  const body: PreflightBody = {
    idempotencyKey: parsed.data.idempotencyKey,
    agentNonce: normalizeAgentNonce(parsed.data.agentNonce),
    actionType: parsed.data.actionType,
    recipient: parsed.data.payload.recipient,
    amountAtomic: parsed.data.payload.amountAtomic,
    expiresAt: parsed.data.expiresAt,
  };
  try {
    const outcome = await preflightAction({
      deps: {
        store: args.store,
        chain: args.chain,
        feePayerAddress: args.feePayerAddress,
        programId: args.programId,
        ...(args.guardian !== undefined ? { guardian: args.guardian } : {}),
      },
      mission: auth.mission,
      agent: auth.agent,
      assignmentRole: auth.assignment?.role ?? null,
      body,
      requestSignature: args.headers.get('x-succra-signature') ?? '',
      rawBody: args.rawBody,
      nowMs: args.nowMs,
    });
    if (outcome.kind === 'allow') {
      return {
        status: 200,
        json: {
          decision: 'ALLOW',
          requestId: outcome.requestId,
          unsignedTransaction: outcome.unsignedTransaction,
          expiresAt: outcome.expiresAt,
        },
      };
    }
    return {
      status: 200,
      json: {
        decision: 'BLOCK',
        requestId: outcome.requestId,
        reasonCode: outcome.reasonCode,
        reason: outcome.reason,
      },
    };
  } catch {
    return error(500, 'PREFLIGHT_FAILED', 'Pre-flight evaluation failed.');
  }
}

export async function handleSubmit(args: {
  store: GatewayStore;
  chain: ChainGateway;
  feePayer: FeePayer;
  headers: Headers;
  method: string;
  path: string;
  rawBody: string;
  missionId: string;
  requestId: string;
  nowMs: number;
  poll?: { intervalMs: number; timeoutMs: number };
}): Promise<HandlerResult> {
  if (
    !UUID_SCHEMA.safeParse(args.missionId).success ||
    !UUID_SCHEMA.safeParse(args.requestId).success
  ) {
    return error(400, 'INVALID_BODY', 'Mission and request ids must be UUIDs.');
  }
  const parsedBody = parseJson(args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  const parsed = SUBMIT_SCHEMA.safeParse(parsedBody.ok);
  if (!parsed.success) {
    return error(400, 'INVALID_BODY', 'Expected { signedTransaction }.');
  }
  const auth = await agentAuth({
    store: args.store,
    headers: args.headers,
    method: args.method,
    path: args.path,
    rawBody: args.rawBody,
    missionId: args.missionId,
    nowMs: args.nowMs,
  });
  if ('status' in auth) return auth;
  if (!auth.mission) {
    return error(500, 'SUBMIT_FAILED', 'Mission scope was lost during authentication.');
  }
  try {
    const outcome = await submitAction({
      deps: {
        store: args.store,
        chain: args.chain,
        feePayer: args.feePayer,
        ...(args.poll !== undefined ? { poll: args.poll } : {}),
      },
      mission: auth.mission,
      agent: auth.agent,
      requestId: args.requestId,
      signedTxB64: parsed.data.signedTransaction,
      nowMs: args.nowMs,
    });
    if (outcome.kind === 'confirmed') {
      return {
        status: 200,
        json: {
          decision: 'ALLOW',
          requestId: outcome.requestId,
          signature: outcome.signature,
          slot: outcome.slot,
          status: 'CONFIRMED',
        },
      };
    }
    if (outcome.kind === 'failed') {
      return {
        status: 200,
        json: {
          decision: 'ALLOW',
          requestId: outcome.requestId,
          signature: outcome.signature,
          status: 'FAILED',
          error: { code: outcome.code, message: outcome.message },
        },
      };
    }
    return error(outcome.status, outcome.code, outcome.message);
  } catch {
    return error(500, 'SUBMIT_FAILED', 'Action submission failed.');
  }
}

/**
 * Quarantine a mission (POST /api/missions/:id/quarantine).
 * Auth: owner session (mission must belong to the owner) OR a valid
 * runtime guardian credential. The credential check is constant-time;
 * the expected value comes from server-only env via the route.
 */
export async function handleQuarantine(args: {
  store: GatewayStore;
  chain: ChainGateway;
  guardian: FeePayer;
  programId: string;
  ownerId: string | null;
  guardianCredentialHeader: string | null;
  expectedGuardianCredential: string | null;
  missionId: string;
  rawBody: string;
  nowMs: number;
}): Promise<HandlerResult> {
  if (!UUID_SCHEMA.safeParse(args.missionId).success) {
    return error(400, 'INVALID_BODY', 'Mission id must be a UUID.');
  }
  const parsedBody = parseJson(args.rawBody === '' ? '{}' : args.rawBody);
  if ('error' in parsedBody) return parsedBody.error;
  if (!EMPTY_BODY_SCHEMA.safeParse(parsedBody.ok).success) {
    return error(400, 'INVALID_BODY', 'Request body must be empty.');
  }
  const mission = await args.store.getMissionById(args.missionId);
  if (!mission) {
    return error(404, 'MISSION_NOT_FOUND', 'Mission does not exist.');
  }
  let actor: { type: 'owner'; id: string } | { type: 'guardian'; id: null };
  if (args.ownerId) {
    if (mission.owner_id !== args.ownerId) {
      return error(403, 'MISSION_FORBIDDEN', 'Mission belongs to another owner.');
    }
    actor = { type: 'owner', id: args.ownerId };
  } else if (
    args.guardianCredentialHeader &&
    args.expectedGuardianCredential &&
    args.guardianCredentialHeader.length === args.expectedGuardianCredential.length &&
    timingSafeEqual(
      Buffer.from(args.guardianCredentialHeader, 'utf8'),
      Buffer.from(args.expectedGuardianCredential, 'utf8')
    )
  ) {
    actor = { type: 'guardian', id: null };
  } else {
    return error(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  try {
    const outcome = await quarantineMission({
      deps: {
        store: args.store,
        chain: args.chain,
        guardian: args.guardian,
        programId: args.programId,
      },
      mission,
      agent: null,
      actor,
      nowMs: args.nowMs,
    });
    if (outcome.kind === 'confirmed') {
      return {
        status: 200,
        json: {
          missionId: mission.id,
          status: 'QUARANTINED',
          signature: outcome.signature,
          slot: outcome.slot,
        },
      };
    }
    if (outcome.kind === 'already') {
      return {
        status: 200,
        json: {
          missionId: mission.id,
          status: 'ALREADY_QUARANTINED',
          signature: outcome.signature,
        },
      };
    }
    if (outcome.kind === 'failed') {
      return {
        status: 200,
        json: {
          missionId: mission.id,
          status: 'FAILED',
          signature: outcome.signature,
          error: { code: outcome.code, message: outcome.message },
        },
      };
    }
    return error(outcome.status, outcome.code, outcome.message);
  } catch {
    return error(500, 'QUARANTINE_FAILED', 'Quarantine failed.');
  }
}

export async function handleGetStatus(args: {
  store: GatewayStore;
  sessionOwnerId: string | null;
  headers: Headers;
  method: string;
  path: string;
  agentPathId: string;
  nowMs: number;
}): Promise<HandlerResult> {
  if (!UUID_SCHEMA.safeParse(args.agentPathId).success) {
    return error(400, 'INVALID_BODY', 'Agent id must be a UUID.');
  }
  if (args.sessionOwnerId) {
    const agent = await args.store.getAgentById(args.agentPathId);
    if (!agent) {
      return error(404, 'AGENT_NOT_FOUND', 'Agent does not exist.');
    }
    if (agent.owner_id !== args.sessionOwnerId) {
      return error(403, 'AGENT_FORBIDDEN', 'Agent belongs to another owner.');
    }
    return { status: 200, json: await agentStatusView({ store: args.store, agent }) };
  }
  if (!readAgentHeaders(args.headers)) {
    return error(401, 'UNAUTHORIZED', 'Authentication required.');
  }
  const auth = await agentAuth({
    store: args.store,
    headers: args.headers,
    method: args.method,
    path: args.path,
    rawBody: '',
    missionId: null,
    nowMs: args.nowMs,
  });
  if ('status' in auth) return auth;
  if (auth.agent.id !== args.agentPathId) {
    return error(403, 'AGENT_FORBIDDEN', 'Header agent does not match the path agent.');
  }
  return { status: 200, json: await agentStatusView({ store: args.store, agent: auth.agent }) };
}
