// Succra gateway — agent registration flows (ARCHITECTURE.md §10).
//
// attach (owner session): find-or-create the agents row by public key,
// attach it to the mission. Phase 4 accepts PRIMARY and SUCCESSOR roles;
// only PRIMARY assignments may submit actions (enforced in pre-flight).
// challenge/verify (owner session): issue a single-use 32-byte challenge
// and verify the agent's signature over the raw challenge bytes, then
// mark the agent ACTIVE_PRIMARY (REGISTERED/ACTIVE_PRIMARY are the only
// Phase 4 statuses; the verify RESPONSE reports "VERIFIED" per the
// amended envelope — that word describes the verification outcome).
import { randomBytes } from 'node:crypto';
import { sign as naclSign } from 'tweetnacl';
import { base58ToBytes32, base64ToBytes, bytesToHex, hexToBytes } from '@succra/shared';
import type { AgentRow, GatewayStore, MissionAgentRow } from './store';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface AttachResult {
  agent: AgentRow;
  assignment: MissionAgentRow;
  created: boolean;
}

/** Attach an agent public key to a mission (owner already authorized). */
export async function attachAgent(args: {
  store: GatewayStore;
  ownerId: string;
  missionId: string;
  publicKey: string;
  name: string;
  role: 'PRIMARY' | 'SUCCESSOR';
  /** Succession order; null means unordered (Phase 6 selection sorts last). */
  priority?: number | null;
  /** Required capability tags for this assignment (Phase 6 eligibility). */
  requiredCapabilities?: string[] | null;
  /** Declared agent capability tags (Phase 6 eligibility). */
  capabilities?: string[] | null;
}): Promise<AttachResult> {
  const { store } = args;
  const mission = await store.getMissionById(args.missionId);
  if (!mission) {
    throw registrationError(404, 'MISSION_NOT_FOUND', 'Mission does not exist.');
  }
  if (mission.owner_id !== args.ownerId) {
    throw registrationError(403, 'MISSION_FORBIDDEN', 'Mission belongs to another owner.');
  }
  const existing = await store.getAgentByPublicKey(args.publicKey);
  if (existing && existing.owner_id !== args.ownerId) {
    throw registrationError(
      409,
      'AGENT_OWNED_ELSEWHERE',
      'Agent key is registered to another owner.'
    );
  }
  const agent =
    existing ??
    (await store.insertAgent({
      owner_id: args.ownerId,
      name: args.name,
      public_key: args.publicKey,
      status: 'REGISTERED',
      capabilities: args.capabilities ?? [],
    }));
  if (existing && args.capabilities !== undefined && args.capabilities !== null) {
    await store.updateAgentCapabilities(existing.id, args.capabilities);
  }
  const prior = await store.getAssignment(mission.id, agent.id);
  if (prior) {
    return { agent, assignment: prior, created: false };
  }
  // AVAILABLE (FR-05) requires attachment AND passed key verification:
  // verified agents attach straight to AVAILABLE, unverified agents
  // attach as PENDING and flip on successful challenge verification.
  const verified = agent.status !== 'REGISTERED';
  const assignment = await store.insertAssignment({
    mission_id: mission.id,
    agent_id: agent.id,
    role: args.role,
    priority: args.priority ?? null,
    required_capabilities: args.requiredCapabilities ?? null,
    status: verified ? 'AVAILABLE' : 'PENDING',
  });
  return { agent, assignment, created: true };
}

export interface ChallengeResult {
  challenge: string;
  expiresAt: string;
}

/** Issue a registration challenge (owner already authorized). */
export async function issueChallenge(args: {
  store: GatewayStore;
  ownerId: string;
  agentId: string;
  nowMs: number;
}): Promise<ChallengeResult> {
  const agent = await args.store.getAgentById(args.agentId);
  if (!agent) {
    throw registrationError(404, 'AGENT_NOT_FOUND', 'Agent does not exist.');
  }
  if (agent.owner_id !== args.ownerId) {
    throw registrationError(403, 'AGENT_FORBIDDEN', 'Agent belongs to another owner.');
  }
  const challenge = bytesToHex(randomBytes(32));
  const expiresAt = new Date(args.nowMs + CHALLENGE_TTL_MS).toISOString();
  await args.store.insertChallenge(agent.id, challenge, expiresAt);
  return { challenge, expiresAt };
}

/** Verify a signed challenge and mark the agent ACTIVE_PRIMARY. */
export async function verifyChallenge(args: {
  store: GatewayStore;
  ownerId: string;
  agentId: string;
  challenge: string;
  signatureBase64: string;
  nowMs: number;
}): Promise<AgentRow> {
  const agent = await args.store.getAgentById(args.agentId);
  if (!agent) {
    throw registrationError(404, 'AGENT_NOT_FOUND', 'Agent does not exist.');
  }
  if (agent.owner_id !== args.ownerId) {
    throw registrationError(403, 'AGENT_FORBIDDEN', 'Agent belongs to another owner.');
  }
  // Read-first classification (no state changes yet): unknown, used,
  // or expired. Signature failures burn nothing, matching the request
  // nonce gate (authenticate first, consume second).
  const row = await args.store.findChallenge(agent.id, args.challenge);
  if (!row || row.consumed_at !== null) {
    throw registrationError(401, 'CHALLENGE_UNKNOWN', 'Challenge is unknown or already used.');
  }
  if (Date.parse(row.expires_at) <= args.nowMs) {
    throw registrationError(401, 'CHALLENGE_EXPIRED', 'Challenge has expired.');
  }
  let valid = false;
  try {
    const publicKey = base58ToBytes32(agent.public_key);
    const signature = base64ToBytes(args.signatureBase64);
    const message = hexToBytes(args.challenge);
    valid =
      signature.length === 64 &&
      message.length === 32 &&
      naclSign.detached.verify(message, signature, publicKey);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw registrationError(401, 'INVALID_SIGNATURE', 'Challenge signature rejected.');
  }
  // Atomic single-use gate elects exactly one winner under concurrency.
  const consumed = await args.store.consumeChallenge(
    agent.id,
    args.challenge,
    new Date(args.nowMs).toISOString()
  );
  if (!consumed) {
    throw registrationError(401, 'CHALLENGE_UNKNOWN', 'Challenge is unknown or already used.');
  }
  const updated = await args.store.updateAgentStatus(agent.id, 'ACTIVE_PRIMARY');
  if (!updated) {
    throw registrationError(500, 'REGISTRATION_FAILED', 'Could not activate the agent.');
  }
  // Key possession proven: pending mission assignments become AVAILABLE
  // (FR-05 eligibility input).
  await args.store.markAgentAssignmentsAvailable(agent.id);
  return updated;
}

export interface RegistrationError {
  status: number;
  code: string;
  message: string;
}

export function registrationError(
  status: number,
  code: string,
  message: string
): RegistrationError {
  return { status, code, message };
}

export function isRegistrationError(value: unknown): value is RegistrationError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RegistrationError).status === 'number' &&
    typeof (value as RegistrationError).code === 'string'
  );
}
