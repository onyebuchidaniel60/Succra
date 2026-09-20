// Succra gateway — succession flow (Phase 6, FR-05/FR-06 as amended).
//
// State machine (PROJECT_SPEC.md §6):
//   QUARANTINED ──guardian activate_successor──▶ RECOVERING
//   RECOVERING ──successor ack + guardian acknowledge_recovery──▶ ACTIVE_RECOVERY
// Two on-chain instructions, not one. The chain is authoritative:
// stale versions and double activations fail on-chain (StaleStateVersion
// / InvalidMissionStatus) even if two runtimes race; the DB mirror is
// best-effort compare-and-set style, never the arbiter (§11).
// The guardian signs exactly these two instructions and pays its own
// fees — it never signs as an agent and never touches vault PDAs, so
// it cannot spend (AGENTS.md invariants). No DB transaction is held
// open across chain I/O.
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { bytesToBase58, bytesToBase64, encodeWireTransaction } from '@succra/shared';
import { planAcknowledgeRecoveryInstruction, planActivateSuccessorInstruction } from '@succra/shared';
import type { ChainGateway, FeePayer } from './chain';
import type { OnchainMissionState } from './mission-state';
import { toKitRole } from './preflight';
import { writeAuditEvent, type QuarantineActor } from './audit';
import type { AgentRow, GatewayStore, MissionAgentRow, MissionRow } from './store';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

export interface SuccessionDeps {
  store: GatewayStore;
  chain: ChainGateway;
  guardian: FeePayer;
  programId: string;
  /** Test-only polling override (production uses the constants above). */
  poll?: { intervalMs: number; timeoutMs: number };
}

export interface SuccessionCandidate {
  assignment: MissionAgentRow;
  agent: AgentRow;
  /** Lower wins; NULL priority sorts last (explicit Phase 6 reading). */
  priority: number;
  /** Position in the on-chain successor list (tie-break). */
  listIndex: number;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === 'string')) return null;
  return value as string[];
}

/**
 * FR-05 deterministic successor selection (pure over loaded rows).
 * Filters: SUCCESSOR role, registered key, not the quarantined primary,
 * AVAILABLE assignment status, on-chain list membership, capability
 * superset (no requirements pass trivially). Orders: lower priority
 * integer wins; ties break by earlier on-chain list position.
 */
export function selectSuccessor(args: {
  onchainSuccessors: string[];
  quarantinedAgentPublicKey: string;
  assignments: MissionAgentRow[];
  agentsById: Map<string, AgentRow>;
}): SuccessionCandidate | null {
  const ranked: SuccessionCandidate[] = [];
  for (const assignment of args.assignments) {
    if (assignment.role !== 'SUCCESSOR') continue;
    const agent = args.agentsById.get(assignment.agent_id);
    if (!agent) continue;
    if (agent.public_key === args.quarantinedAgentPublicKey) continue;
    if (!agent.public_key) continue;
    if (assignment.status !== 'AVAILABLE') continue;
    const listIndex = args.onchainSuccessors.indexOf(agent.public_key);
    if (listIndex < 0) continue;
    const required = asStringArray(assignment.required_capabilities) ?? [];
    const declared = asStringArray(agent.capabilities) ?? [];
    if (!required.every((capability) => declared.includes(capability))) continue;
    ranked.push({
      assignment,
      agent,
      priority: assignment.priority ?? Number.POSITIVE_INFINITY,
      listIndex,
    });
  }
  ranked.sort((a, b) => a.priority - b.priority || a.listIndex - b.listIndex);
  return ranked[0] ?? null;
}

export type SuccessionOutcome =
  | { kind: 'activated'; successionId: string; signature: string; slot: number; toAgentId: string }
  | { kind: 'halted'; reason: string }
  | { kind: 'already'; status: string; signature: string | null }
  | { kind: 'failed'; signature: string | null; code: string; message: string }
  | { kind: 'error'; status: number; code: string; message: string };

export type AcknowledgeOutcome =
  | { kind: 'acknowledged'; successionId: string; signature: string; slot: number }
  | { kind: 'already'; status: string; signature: string | null }
  | { kind: 'failed'; signature: string | null; code: string; message: string }
  | { kind: 'error'; status: number; code: string; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TerminalPoll =
  | { ok: true; signature: string; slot: number }
  | { ok: false; code: 'CHAIN_REJECTION' | 'CONFIRMATION_TIMEOUT'; message: string };

/** Poll a submitted guardian signature to its terminal state (no open DB tx). */
async function pollGuardianSignature(
  chain: ChainGateway,
  signature: string,
  poll?: { intervalMs: number; timeoutMs: number }
): Promise<TerminalPoll> {
  const interval = poll?.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (poll?.timeoutMs ?? POLL_TIMEOUT_MS);
  for (;;) {
    const status = await chain.getSignatureStatus(signature).catch(() => null);
    if (status && status.err != null) {
      return { ok: false, code: 'CHAIN_REJECTION', message: 'Transaction rejected by the cluster.' };
    }
    if (status && status.err == null) {
      return { ok: true, signature, slot: status.slot };
    }
    if (Date.now() >= deadline) {
      return {
        ok: false,
        code: 'CONFIRMATION_TIMEOUT',
        message: 'Confirmation timed out; retry to resume polling.',
      };
    }
    await sleep(interval);
  }
}

interface PlannedSend {
  messageBytes: Uint8Array;
  guardianSig: Uint8Array;
  wireB64: string;
  expectedSignature: string;
}

function planGuardianMessage(
  deps: SuccessionDeps,
  planned: { programAddress: string; accounts: Array<{ address: string; role: string }>; data: Uint8Array },
  blockhash: string,
  lastValidBlockHeight: bigint
): PlannedSend {
  const instruction: Instruction = {
    programAddress: address(planned.programAddress),
    accounts: planned.accounts.map((meta) => ({
      address: address(meta.address),
      role: toKitRole(meta.role as 'readonly-signer' | 'writable'),
    })),
    data: planned.data,
  };
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(address(deps.guardian.address), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: address(blockhash) as unknown as Blockhash, lastValidBlockHeight },
        m
      ),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );
  const messageBytes = new Uint8Array(compileTransaction(message).messageBytes);
  const guardianSig = deps.guardian.signBytes(messageBytes);
  const wireB64 = bytesToBase64(encodeWireTransaction([guardianSig], messageBytes));
  return { messageBytes, guardianSig, wireB64, expectedSignature: bytesToBase58(guardianSig) };
}

async function sendGuardianTransaction(
  chain: ChainGateway,
  send: PlannedSend,
  poll?: { intervalMs: number; timeoutMs: number }
): Promise<TerminalPoll & { signature: string }> {
  let signature: string;
  try {
    signature = await chain.sendRawTransaction(send.wireB64);
  } catch {
    const landed = await chain.getSignatureStatus(send.expectedSignature).catch(() => null);
    if (landed) {
      const terminal = await pollGuardianSignature(chain, send.expectedSignature, poll);
      return { ...terminal, signature: send.expectedSignature };
    }
    return {
      ok: false,
      code: 'CHAIN_REJECTION',
      message: 'Transaction was rejected before confirmation.',
      signature: send.expectedSignature,
    };
  }
  if (signature !== send.expectedSignature) {
    return {
      ok: false,
      code: 'CHAIN_REJECTION',
      message: 'RPC returned an unexpected signature.',
      signature: send.expectedSignature,
    };
  }
  const terminal = await pollGuardianSignature(chain, signature, poll);
  return { ...terminal, signature };
}

/**
 * Run succession for a QUARANTINED mission: select the highest-priority
 * eligible successor (FR-05), submit guardian-signed activate_successor,
 * mirror into succession_events + mission authority, write audit rows.
 * No eligible successor → HALTED mirror + audit (no succession row:
 * to_agent_id has no candidate).
 */
export async function runSuccession(args: {
  deps: SuccessionDeps;
  mission: MissionRow;
  actor: QuarantineActor;
  nowMs: number;
}): Promise<SuccessionOutcome> {
  const { deps, mission, actor, nowMs } = args;
  const { store, chain, guardian } = deps;
  const atIso = new Date(nowMs).toISOString();

  const onchain: OnchainMissionState | null = await chain.getMissionState(mission.pda_address);
  if (!onchain) {
    return {
      kind: 'error',
      status: 409,
      code: 'SUCCESSION_NOT_ALLOWED',
      message: 'Mission has no on-chain state to succeed.',
    };
  }
  if (onchain.status !== 'Quarantined') {
    const latest = await store.latestSuccessionForMission(mission.id);
    return { kind: 'already', status: onchain.status, signature: latest?.onchain_signature ?? null };
  }

  const assignments = await store.listMissionAssignments(mission.id);
  const agentsById = new Map<string, AgentRow>();
  for (const assignment of assignments) {
    if (assignment.role !== 'SUCCESSOR') continue;
    const agent = await store.getAgentById(assignment.agent_id);
    if (agent) agentsById.set(agent.id, agent);
  }
  const candidate = selectSuccessor({
    onchainSuccessors: onchain.successors,
    quarantinedAgentPublicKey: onchain.currentAgent,
    assignments,
    agentsById,
  });

  if (!candidate) {
    await store.markMissionHalted(mission.id, atIso);
    await writeAuditEvent({
      store,
      missionId: mission.id,
      eventType: 'succession.triggered',
      actor,
      signature: null,
      payload: { outcome: 'halted', reason: 'No eligible successor.' },
      nowMs,
    });
    return { kind: 'halted', reason: 'No eligible successor.' };
  }

  const boundary = await store.latestVerifiedCheckpoint(mission.id);
  const fromAgent = await store.getAgentByPublicKey(onchain.currentAgent);
  const succession = await store.insertSuccessionEvent({
    mission_id: mission.id,
    from_agent_id: fromAgent?.id ?? null,
    to_agent_id: candidate.agent.id,
    trigger_type: 'quarantine',
    checkpoint_id: boundary?.id ?? null,
    recovery_limit_atomic: onchain.recoveryMaxAction.toString(),
    status: 'TRIGGERED',
    onchain_signature: null,
  });
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'succession.triggered',
    actor,
    signature: null,
    payload: {
      succession_id: succession.id,
      to_agent_id: candidate.agent.id,
      to_agent_public_key: candidate.agent.public_key,
      priority: candidate.priority,
      list_index: candidate.listIndex,
      checkpoint_id: boundary?.id ?? null,
    },
    nowMs,
  });
  await store.updateSuccessionStatus(succession.id, { status: 'CANDIDATE_SELECTED' });
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'succession.candidate_selected',
    actor,
    signature: null,
    payload: { succession_id: succession.id, to_agent_id: candidate.agent.id },
    nowMs,
  });

  const { blockhash, lastValidBlockHeight } = await chain.getLatestBlockhash();
  const planned = planActivateSuccessorInstruction(deps.programId, {
    guardian: guardian.address,
    mission: onchain.address,
  }, {
    successorBase58: candidate.agent.public_key,
    expectedVersion: onchain.stateVersion,
  });
  const send = planGuardianMessage(deps, planned, blockhash, lastValidBlockHeight);
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'succession.activate.submitted',
    actor,
    signature: send.expectedSignature,
    payload: {
      succession_id: succession.id,
      to_agent_id: candidate.agent.id,
      expected_version: onchain.stateVersion.toString(),
    },
    nowMs,
  });
  const terminal = await sendGuardianTransaction(chain, send, deps.poll);
  if (!terminal.ok) {
    return { kind: 'failed', signature: terminal.signature, code: terminal.code, message: terminal.message };
  }

  await store.updateSuccessionStatus(succession.id, {
    status: 'AUTHORIZED',
    onchain_signature: terminal.signature,
  });
  await store.updateMissionAuthority(mission.id, {
    status: 'RECOVERING',
    current_agent_id: candidate.agent.id,
    current_agent_public_key: candidate.agent.public_key,
    atIso,
  });
  const fromAssignment = fromAgent
    ? assignments.find((row) => row.agent_id === fromAgent.id) ?? null
    : null;
  if (fromAssignment) {
    await store.updateAssignment(fromAssignment.id, { status: 'REVOKED', revoked_at: atIso });
  }
  if (fromAgent) {
    await store.updateAgentStatus(fromAgent.id, 'REVOKED');
  }
  await store.updateAssignment(candidate.assignment.id, {
    status: 'ACTIVE_SUCCESSOR',
    activated_at: atIso,
  });
  await store.updateAgentStatus(candidate.agent.id, 'ACTIVE_SUCCESSOR');
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'succession.activate.confirmed',
    actor,
    signature: terminal.signature,
    payload: { succession_id: succession.id, slot: terminal.slot },
    nowMs,
  });
  return {
    kind: 'activated',
    successionId: succession.id,
    signature: terminal.signature,
    slot: terminal.slot,
    toAgentId: candidate.agent.id,
  };
}

/**
 * Acknowledge a succession: the successor's off-chain authenticated ack
 * is already verified by the caller; the runtime submits guardian-signed
 * acknowledge_recovery and mirrors RECOVERING → ACTIVE_RECOVERY.
 */
export async function acknowledgeSuccession(args: {
  deps: SuccessionDeps;
  mission: MissionRow;
  successionId: string;
  agent: AgentRow;
  actor: QuarantineActor;
  nowMs: number;
}): Promise<AcknowledgeOutcome> {
  const { deps, mission, successionId, agent, actor, nowMs } = args;
  const { store, chain, guardian } = deps;
  const atIso = new Date(nowMs).toISOString();

  const succession = await store.getSuccessionById(successionId);
  if (!succession || succession.mission_id !== mission.id) {
    return { kind: 'error', status: 404, code: 'SUCCESSION_NOT_FOUND', message: 'Succession not found.' };
  }
  if (succession.to_agent_id !== agent.id) {
    return { kind: 'error', status: 403, code: 'SUCCESSION_FORBIDDEN', message: 'Not the successor.' };
  }
  if (succession.status === 'ACKNOWLEDGED' || succession.status === 'COMPLETE') {
    return { kind: 'already', status: succession.status, signature: succession.onchain_signature };
  }
  if (succession.status !== 'AUTHORIZED') {
    return {
      kind: 'error',
      status: 409,
      code: 'SUCCESSION_NOT_ACTIVE',
      message: `Succession is ${succession.status}, not AUTHORIZED.`,
    };
  }

  const onchain = await chain.getMissionState(mission.pda_address);
  if (!onchain || onchain.status !== 'Recovering') {
    return {
      kind: 'error',
      status: 409,
      code: 'SUCCESSION_NOT_ALLOWED',
      message: `Mission is ${onchain?.status ?? 'missing'}, not Recovering.`,
    };
  }

  const { blockhash, lastValidBlockHeight } = await chain.getLatestBlockhash();
  const planned = planAcknowledgeRecoveryInstruction(deps.programId, {
    guardian: guardian.address,
    mission: onchain.address,
  }, { expectedVersion: onchain.stateVersion });
  const send = planGuardianMessage(deps, planned, blockhash, lastValidBlockHeight);
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'succession.acknowledge.submitted',
    actor,
    signature: send.expectedSignature,
    payload: {
      succession_id: succession.id,
      expected_version: onchain.stateVersion.toString(),
    },
    nowMs,
  });
  const terminal = await sendGuardianTransaction(chain, send, deps.poll);
  if (!terminal.ok) {
    return { kind: 'failed', signature: terminal.signature, code: terminal.code, message: terminal.message };
  }

  await store.updateSuccessionStatus(succession.id, {
    status: 'ACKNOWLEDGED',
    onchain_signature: terminal.signature,
  });
  await store.updateMissionAuthority(mission.id, {
    status: 'ACTIVE_RECOVERY',
    current_agent_id: agent.id,
    current_agent_public_key: agent.public_key,
    atIso,
  });
  await store.updateSuccessionStatus(succession.id, { status: 'COMPLETE' });
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'succession.acknowledge.confirmed',
    actor,
    signature: terminal.signature,
    payload: { succession_id: succession.id, slot: terminal.slot },
    nowMs,
  });
  return { kind: 'acknowledged', successionId: succession.id, signature: terminal.signature, slot: terminal.slot };
}
