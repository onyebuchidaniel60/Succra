// Succra web — EVM agent registration, challenge/verify, heartbeat, status.
//
// Owner-initiated challenge flow (ARCHITECTURE.md §10): the owner requests the
// challenge and submits the agent's signature; the agent signs out-of-band.
// Multi-tenant agent self-registration is post-MVP.
import { randomBytes } from 'node:crypto';
import { isAddress, verifyTypedData } from 'viem';
import { buildAgentChallengeTypedData, AGENT_CHALLENGE_PURPOSE } from '@succra/shared';

export type AgentStatus =
  'PENDING' | 'REGISTERED' | 'ACTIVE_PRIMARY' | 'ACTIVE_SUCCESSOR' | 'QUARANTINED' | 'REVOKED';

export interface AgentRecord {
  id: string;
  owner_id: string;
  name: string;
  address: string;
  public_key: string;
  endpoint_url: string | null;
  capabilities: string[];
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MissionAgentRecord {
  id: string;
  mission_id: string;
  agent_id: string;
  role: 'PRIMARY' | 'SUCCESSOR';
  priority: number | null;
  required_capabilities: string[];
  status: string;
  activated_at: string | null;
  revoked_at: string | null;
}

export interface AgentChallengeRecord {
  id: string;
  agent_id: string;
  challenge: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface AgentStore {
  getMission(id: string): Promise<{ id: string; owner_id: string } | null>;
  getAgentById(id: string): Promise<AgentRecord | null>;
  getAgentByAddress(address: string): Promise<AgentRecord | null>;
  insertAgent(row: {
    owner_id: string;
    name: string;
    address: string;
    public_key: string;
    endpoint_url: string | null;
    capabilities: string[];
    status: AgentStatus;
  }): Promise<AgentRecord>;
  updateAgent(
    id: string,
    patch: Partial<{
      name: string;
      endpoint_url: string | null;
      capabilities: string[];
      status: AgentStatus;
    }>
  ): Promise<AgentRecord | null>;
  getAssignment(missionId: string, agentId: string): Promise<MissionAgentRecord | null>;
  countAssignments(missionId: string, role: 'PRIMARY' | 'SUCCESSOR'): Promise<number>;
  insertAssignment(row: {
    mission_id: string;
    agent_id: string;
    role: 'PRIMARY' | 'SUCCESSOR';
    priority: number | null;
    required_capabilities: string[];
    status: AgentStatus;
  }): Promise<MissionAgentRecord>;
  updateAssignmentStatus(
    missionId: string,
    agentId: string,
    status: AgentStatus
  ): Promise<MissionAgentRecord | null>;
  updateAssignmentsStatusForAgent(agentId: string, status: AgentStatus): Promise<void>;
  hasRegisteredAssignment(agentId: string): Promise<boolean>;
  listAssignmentsForAgent(agentId: string): Promise<MissionAgentRecord[]>;
  insertChallenge(row: {
    agent_id: string;
    challenge: string;
    expires_at: string;
  }): Promise<AgentChallengeRecord>;
  findChallenge(agentId: string, challenge: string): Promise<AgentChallengeRecord | null>;
  consumeChallenge(
    agentId: string,
    challenge: string,
    consumedAt: string
  ): Promise<AgentChallengeRecord | null>;
  deleteExpiredChallenges(before: string): Promise<void>;
  updateHeartbeat(agentId: string, at: string): Promise<AgentRecord | null>;
}

export interface AgentHandlerResult {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}

export interface RegisterAgentInput {
  address: string;
  name: string;
  role: 'PRIMARY' | 'SUCCESSOR';
  priority?: number;
  requiredCapabilities?: string[];
  endpointUrl?: string;
}

const HEARTBEAT_MIN_INTERVAL_MS = 30_000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_CLEANUP_MS = 60 * 60 * 1000;
const MAX_SUCCESSORS = 8;

function error(status: number, code: string, message: string): AgentHandlerResult {
  return { status, json: { error: { code, message } } };
}

function normalizeAddress(value: string): `0x${string}` | null {
  if (!isAddress(value)) return null;
  return value.toLowerCase() as `0x${string}`;
}

function validateRegistration(input: RegisterAgentInput): AgentHandlerResult | null {
  if (!normalizeAddress(input.address)) {
    return error(400, 'INVALID_BODY', 'address must be a valid EVM address.');
  }
  if (input.name.trim().length === 0) {
    return error(400, 'INVALID_BODY', 'name is required.');
  }
  if (input.role !== 'PRIMARY' && input.role !== 'SUCCESSOR') {
    return error(400, 'INVALID_BODY', 'role must be PRIMARY or SUCCESSOR.');
  }
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 0)) {
    return error(400, 'INVALID_BODY', 'priority must be a non-negative integer.');
  }
  return null;
}

export async function registerAgent(args: {
  store: AgentStore;
  ownerId: string;
  missionId: string;
  input: RegisterAgentInput;
  nowMs?: number;
}): Promise<AgentHandlerResult> {
  void args.nowMs;
  const invalid = validateRegistration(args.input);
  if (invalid) return invalid;

  const address = normalizeAddress(args.input.address);
  if (!address) return error(400, 'INVALID_BODY', 'address must be a valid EVM address.');
  const { store } = args;

  const mission = await store.getMission(args.missionId);
  if (!mission || mission.owner_id !== args.ownerId) {
    return error(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  }

  const existing = await store.getAgentByAddress(address);
  if (existing && existing.owner_id !== args.ownerId) {
    return error(
      409,
      'ADDRESS_ALREADY_OWNED_BY_ANOTHER_OWNER',
      'This address is registered to another owner.'
    );
  }

  const priorAssignment = existing ? await store.getAssignment(mission.id, existing.id) : null;
  if (priorAssignment && existing) {
    if (priorAssignment.role !== args.input.role) {
      return error(
        409,
        'AGENT_ALREADY_ASSIGNED',
        'This agent is already assigned to the mission with a different role.'
      );
    }
    const updated = await store.updateAgent(existing.id, {
      name: args.input.name,
      ...(args.input.requiredCapabilities !== undefined
        ? { capabilities: args.input.requiredCapabilities }
        : {}),
      ...(args.input.endpointUrl !== undefined ? { endpoint_url: args.input.endpointUrl } : {}),
    });
    return {
      status: 200,
      json: {
        agentId: existing.id,
        missionAgentId: priorAssignment.id,
        address,
        status: updated?.status ?? existing.status,
        role: priorAssignment.role,
        nextStep: 'Register agent via challenge/verify',
      },
    };
  }

  if (args.input.role === 'PRIMARY') {
    if ((await store.countAssignments(mission.id, 'PRIMARY')) > 0) {
      return error(409, 'PRIMARY_ALREADY_ASSIGNED', 'This mission already has a PRIMARY agent.');
    }
  } else if ((await store.countAssignments(mission.id, 'SUCCESSOR')) >= MAX_SUCCESSORS) {
    return error(409, 'SUCCESSOR_LIMIT_EXCEEDED', 'A mission may have at most 8 successors.');
  }

  const capabilities = args.input.requiredCapabilities ?? [];
  const agent =
    existing ??
    (await store.insertAgent({
      owner_id: args.ownerId,
      name: args.input.name,
      address,
      public_key: address,
      endpoint_url: args.input.endpointUrl ?? null,
      capabilities,
      status: 'PENDING',
    }));

  const updatedAgent =
    existing && (args.input.name !== existing.name || args.input.requiredCapabilities !== undefined)
      ? await store.updateAgent(existing.id, {
          name: args.input.name,
          ...(args.input.requiredCapabilities !== undefined
            ? { capabilities: args.input.requiredCapabilities }
            : {}),
          ...(args.input.endpointUrl !== undefined ? { endpoint_url: args.input.endpointUrl } : {}),
        })
      : agent;

  const verifiedStatuses = new Set(['REGISTERED', 'ACTIVE_PRIMARY', 'ACTIVE_SUCCESSOR']);
  const assignmentStatus: AgentStatus =
    updatedAgent && verifiedStatuses.has(updatedAgent.status) ? 'REGISTERED' : 'PENDING';
  const assignment = await store.insertAssignment({
    mission_id: mission.id,
    agent_id: agent.id,
    role: args.input.role,
    priority: args.input.role === 'SUCCESSOR' ? (args.input.priority ?? null) : null,
    required_capabilities: capabilities,
    status: assignmentStatus,
  });

  return {
    status: 201,
    json: {
      agentId: agent.id,
      missionAgentId: assignment.id,
      address,
      status: updatedAgent?.status ?? agent.status,
      role: assignment.role,
      nextStep: 'Register agent via challenge/verify',
    },
  };
}

export async function issueAgentChallenge(args: {
  store: AgentStore;
  ownerId: string;
  agentId: string;
  chainId: number;
  nowMs?: number;
}): Promise<AgentHandlerResult> {
  const nowMs = args.nowMs ?? Date.now();
  const agent = await args.store.getAgentById(args.agentId);
  if (!agent) return error(404, 'AGENT_NOT_FOUND', 'Agent not found.');
  if (agent.owner_id !== args.ownerId) {
    return error(403, 'AGENT_FORBIDDEN', 'Agent belongs to another owner.');
  }
  if (agent.status !== 'PENDING') {
    return error(409, 'AGENT_ALREADY_VERIFIED', 'Agent is already verified.');
  }
  const address = normalizeAddress(agent.address);
  if (!address) {
    return error(500, 'AGENT_INVALID_ADDRESS', 'Agent address is not a valid EVM address.');
  }

  await args.store.deleteExpiredChallenges(new Date(nowMs - CHALLENGE_CLEANUP_MS).toISOString());

  const challenge = randomBytes(32).toString('hex');
  const expiresAtMs = nowMs + CHALLENGE_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const typedData = buildAgentChallengeTypedData({
    agentAddress: address,
    challenge,
    expiresAt: BigInt(Math.floor(expiresAtMs / 1000)),
    chainId: args.chainId,
  });
  await args.store.insertChallenge({
    agent_id: agent.id,
    challenge,
    expires_at: expiresAt,
  });

  return {
    status: 200,
    json: { challenge, typedData, expiresAt },
  };
}

export async function verifyAgentChallenge(args: {
  store: AgentStore;
  ownerId: string;
  agentId: string;
  challenge: string;
  signature: string;
  chainId: number;
  nowMs?: number;
}): Promise<AgentHandlerResult> {
  const nowMs = args.nowMs ?? Date.now();
  const agent = await args.store.getAgentById(args.agentId);
  if (!agent) return error(404, 'AGENT_NOT_FOUND', 'Agent not found.');
  if (agent.owner_id !== args.ownerId) {
    return error(403, 'AGENT_FORBIDDEN', 'Agent belongs to another owner.');
  }
  // ARCHITECTURE.md §10 uses "VERIFIED" as the verification outcome word;
  // the persistent status is REGISTERED per PROJECT_SPEC's agent assignment
  // state machine. There is no durable VERIFIED state.
  if (agent.status === 'REGISTERED') {
    return {
      status: 200,
      json: { agentId: agent.id, address: agent.address, status: 'REGISTERED' },
    };
  }
  if (agent.status !== 'PENDING') {
    return error(409, 'AGENT_ALREADY_VERIFIED', 'Agent is not pending verification.');
  }
  const address = normalizeAddress(agent.address);
  if (!address) {
    return error(500, 'AGENT_INVALID_ADDRESS', 'Agent address is not a valid EVM address.');
  }
  if (!/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(args.signature)) {
    return error(400, 'INVALID_SIGNATURE', 'signature must be a 65-byte EIP-712 signature.');
  }

  const challenge = args.challenge.startsWith('0x')
    ? args.challenge.slice(2).toLowerCase()
    : args.challenge.toLowerCase();
  const row = await args.store.findChallenge(agent.id, challenge);
  if (!row) return error(400, 'CHALLENGE_UNKNOWN', 'Challenge is unknown.');
  if (row.consumed_at !== null) {
    return error(400, 'CHALLENGE_ALREADY_CONSUMED', 'Challenge was already consumed.');
  }
  if (Date.parse(row.expires_at) <= nowMs) {
    return error(400, 'CHALLENGE_EXPIRED', 'Challenge has expired.');
  }

  const consumed = await args.store.consumeChallenge(
    agent.id,
    challenge,
    new Date(nowMs).toISOString()
  );
  if (!consumed) {
    return error(400, 'CHALLENGE_ALREADY_CONSUMED', 'Challenge was already consumed.');
  }

  const typedData = buildAgentChallengeTypedData({
    agentAddress: address,
    challenge: row.challenge,
    expiresAt: BigInt(Math.floor(Date.parse(row.expires_at) / 1000)),
    chainId: args.chainId,
  });
  let valid = false;
  try {
    valid = await verifyTypedData({
      address,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    return error(400, 'INVALID_SIGNATURE', 'Challenge signature rejected.');
  }

  const updated = await args.store.updateAgent(agent.id, { status: 'REGISTERED' });
  if (!updated) return error(500, 'REGISTRATION_FAILED', 'Could not update the agent.');
  await args.store.updateAssignmentsStatusForAgent(agent.id, 'REGISTERED');

  return {
    status: 200,
    json: { agentId: agent.id, address, status: 'REGISTERED' },
  };
}

export async function recordAgentHeartbeat(args: {
  store: AgentStore;
  agent: AgentRecord;
  nowMs?: number;
}): Promise<AgentHandlerResult> {
  const nowMs = args.nowMs ?? Date.now();
  if (args.agent.last_heartbeat_at) {
    const elapsed = nowMs - Date.parse(args.agent.last_heartbeat_at);
    if (Number.isFinite(elapsed) && elapsed < HEARTBEAT_MIN_INTERVAL_MS) {
      const retryAfter = Math.ceil((HEARTBEAT_MIN_INTERVAL_MS - elapsed) / 1000);
      return {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
        json: {
          error: {
            code: 'HEARTBEAT_TOO_SOON',
            message: `Heartbeat too soon. Minimum interval is ${
              HEARTBEAT_MIN_INTERVAL_MS / 1000
            }s.`,
          },
        },
      };
    }
  }

  let updated = await args.store.updateHeartbeat(args.agent.id, new Date(nowMs).toISOString());
  if (!updated) return error(500, 'HEARTBEAT_FAILED', 'Could not record the heartbeat.');

  if (updated.status === 'PENDING' && (await args.store.hasRegisteredAssignment(updated.id))) {
    const registered = await args.store.updateAgent(updated.id, { status: 'REGISTERED' });
    if (registered) updated = registered;
  }

  return {
    status: 200,
    json: {
      agentId: updated.id,
      lastHeartbeatAt: updated.last_heartbeat_at,
      status: updated.status,
    },
  };
}

export async function agentStatusView(args: {
  store: AgentStore;
  agent: AgentRecord;
}): Promise<AgentHandlerResult> {
  const assignments = await args.store.listAssignmentsForAgent(args.agent.id);
  return {
    status: 200,
    json: {
      agentId: args.agent.id,
      address: args.agent.address,
      status: args.agent.status,
      lastHeartbeatAt: args.agent.last_heartbeat_at,
      missions: assignments.map((assignment) => ({
        missionId: assignment.mission_id,
        role: assignment.role,
        status: assignment.status,
      })),
    },
  };
}

export const AGENT_STATUS_VALUES: AgentStatus[] = [
  'PENDING',
  'REGISTERED',
  'ACTIVE_PRIMARY',
  'ACTIVE_SUCCESSOR',
  'QUARANTINED',
  'REVOKED',
];

export { AGENT_CHALLENGE_PURPOSE, HEARTBEAT_MIN_INTERVAL_MS, CHALLENGE_TTL_MS };
