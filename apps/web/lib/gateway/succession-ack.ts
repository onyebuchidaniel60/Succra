// Succra web — Phase 6 acknowledgement core.
//
// The successor signs the ACK digest; the guardian submits the transaction so
// the successor never needs gas. The route first verifies the signature
// against the pending succession's successor address.
import { recoverAddress } from 'viem';
import { computeRecoveryAckDigest } from '@succra/shared';
import type { MissionOnChainState } from './contract-reader';
import type { SuccessionEventRow } from './store-succession';
import { auditEventHash, type NewAuditEventRow } from './store-quarantine';

export interface AckMissionRow {
  id: string;
  contract_address: string | null;
  pda_address: string;
}

export interface AckDeps {
  getMission(missionId: string): Promise<AckMissionRow | null>;
  getSuccession(missionId: string, successionId: string): Promise<SuccessionEventRow | null>;
  readState(address: `0x${string}`): Promise<MissionOnChainState>;
  submitAck(args: {
    missionAddress: `0x${string}`;
    expectedVersion: bigint;
    signature: `0x${string}`;
  }): Promise<{ txHash: string }>;
  insertAuditEvent(row: NewAuditEventRow): Promise<unknown>;
  markAcknowledged(successionId: string, txHash: string, acknowledgedAt: string): Promise<unknown>;
  updateAgentStatus(missionId: string, agentId: string, status: string): Promise<void>;
  updateMissionStatus(missionId: string, status: string): Promise<void>;
  updateMissionCurrentAgent(missionId: string, agentId: string, address: string): Promise<void>;
  now?: () => number;
}

export interface AckResult {
  status: number;
  json: unknown;
}

function failure(status: number, code: string, message: string): AckResult {
  return { status, json: { error: { code, message } } };
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as { errorName?: unknown }).errorName;
  return typeof value === 'string' ? value : undefined;
}

export async function acknowledgeRecovery(args: {
  deps: AckDeps;
  missionId: string;
  successionId: string;
  expectedVersion: bigint;
  signature: `0x${string}`;
  agentId: string;
  agentAddress: string;
}): Promise<AckResult> {
  const { deps, missionId, successionId } = args;
  const mission = await deps.getMission(missionId);
  if (!mission) return failure(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  const succession = await deps.getSuccession(missionId, successionId);
  if (!succession) return failure(404, 'SUCCESSION_NOT_FOUND', 'Succession not found.');
  if (succession.status !== 'PENDING_ACK') {
    return failure(
      409,
      'SUCCESSION_NOT_PENDING',
      'This succession is not awaiting acknowledgement.'
    );
  }
  if (
    succession.to_agent_id !== args.agentId ||
    succession.to_agent_address.toLowerCase() !== args.agentAddress.toLowerCase()
  ) {
    return failure(403, 'SUCCESSION_FORBIDDEN', 'This succession belongs to another agent.');
  }

  const addressValue = mission.contract_address ?? mission.pda_address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addressValue)) {
    return failure(500, 'MISSION_CONTRACT_INVALID', 'Mission contract address is invalid.');
  }
  const missionAddress = addressValue as `0x${string}`;

  let state: MissionOnChainState;
  try {
    state = await deps.readState(missionAddress);
  } catch {
    return failure(503, 'MISSION_STATE_UNAVAILABLE', 'Mission state is temporarily unavailable.');
  }
  if (state.status !== 'RECOVERING') {
    return failure(409, 'NOT_RECOVERING', 'The mission is not in RECOVERING state.');
  }
  if (state.currentAgent.toLowerCase() !== succession.to_agent_address.toLowerCase()) {
    return failure(409, 'SUCCESSION_STALE', 'The on-chain successor no longer matches.');
  }
  if (state.stateVersion !== args.expectedVersion) {
    return failure(409, 'VERSION_CONFLICT', 'The mission state changed; re-read and retry.');
  }

  const digest = computeRecoveryAckDigest({
    missionAddress,
    expectedVersion: args.expectedVersion,
  });
  let recovered: string;
  try {
    recovered = await recoverAddress({ hash: digest, signature: args.signature });
  } catch {
    return failure(400, 'INVALID_ACK_SIGNATURE', 'The acknowledgement signature is invalid.');
  }
  if (recovered.toLowerCase() !== succession.to_agent_address.toLowerCase()) {
    return failure(400, 'INVALID_ACK_SIGNATURE', 'The acknowledgement signature is invalid.');
  }

  const nowIso = new Date((deps.now ?? Date.now)()).toISOString();
  const submittedPayload = {
    successionId,
    successor: succession.to_agent_address,
    expectedVersion: args.expectedVersion.toString(),
    checkpointSequence: succession.checkpoint_sequence,
  };
  await deps.insertAuditEvent({
    mission_id: missionId,
    event_type: 'succession.acknowledge.submitted',
    actor_type: 'agent',
    actor_id: args.agentId,
    event_hash: auditEventHash([
      missionId,
      'succession.acknowledge.submitted',
      successionId,
      args.expectedVersion,
    ]),
    payload_public: submittedPayload,
    onchain_tx_hash: null,
  });

  let txHash: string;
  try {
    const submitted = await deps.submitAck({
      missionAddress,
      expectedVersion: args.expectedVersion,
      signature: args.signature,
    });
    txHash = submitted.txHash;
  } catch (error) {
    const name = errorName(error);
    if (name === 'InvalidVersion') {
      return failure(409, 'VERSION_CONFLICT', 'The mission state changed; re-read and retry.');
    }
    if (name === 'NotInRecovering' || name === 'InvalidStatus') {
      return failure(409, 'NOT_RECOVERING', 'The mission is not in RECOVERING state.');
    }
    if (name === 'InvalidAcknowledgement') {
      return failure(400, 'INVALID_ACK_SIGNATURE', 'The acknowledgement signature was rejected.');
    }
    return failure(502, 'ACKNOWLEDGE_FAILED', 'The acknowledgement transaction failed.');
  }

  await deps.markAcknowledged(successionId, txHash, nowIso);
  if (succession.from_agent_id && succession.from_agent_id !== succession.to_agent_id) {
    await deps.updateAgentStatus(missionId, succession.from_agent_id, 'REVOKED');
  }
  await deps.updateAgentStatus(missionId, succession.to_agent_id, 'ACTIVE_PRIMARY');
  await deps.updateMissionStatus(missionId, 'ACTIVE_RECOVERY');
  await deps.updateMissionCurrentAgent(
    missionId,
    succession.to_agent_id,
    succession.to_agent_address
  );
  await deps.insertAuditEvent({
    mission_id: missionId,
    event_type: 'succession.acknowledge.confirmed',
    actor_type: 'agent',
    actor_id: args.agentId,
    event_hash: auditEventHash([
      missionId,
      'succession.acknowledge.confirmed',
      successionId,
      txHash,
    ]),
    payload_public: { ...submittedPayload, txHash },
    onchain_tx_hash: txHash,
  });

  return {
    status: 200,
    json: {
      successionId,
      status: 'ACKNOWLEDGED',
      txHash,
    },
  };
}
