// Succra web — Phase 5 manual quarantine core.
//
// The chain is authoritative: read AuthorityState, submit quarantine with the
// current stateVersion, then mirror the confirmed result into the database.
// The guardian never spends, changes policy, or adds a successor here.
import { isAddress } from 'viem';
import { auditEventHash, type AuditActorType, type NewAuditEventRow } from './store-quarantine';

export interface QuarantineMissionRecord {
  id: string;
  owner_id: string;
  contract_address: string | null;
  pda_address: string;
  status: string;
  current_agent_id: string | null;
}

export interface QuarantineOnChainState {
  status: string;
  stateVersion: bigint;
  violationCount: number;
}

export interface QuarantineActor {
  type: Extract<AuditActorType, 'owner' | 'guardian'>;
  id: string | null;
}

export interface QuarantineDeps {
  getMission(missionId: string): Promise<QuarantineMissionRecord | null>;
  readState(address: `0x${string}`): Promise<QuarantineOnChainState>;
  submitQuarantine(args: {
    missionAddress: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<{ txHash: string }>;
  insertAuditEvent(row: NewAuditEventRow): Promise<void>;
  updateMissionStatus(missionId: string): Promise<void>;
  updateAgentStatus(missionId: string): Promise<void>;
  nowMs?: number;
}

export interface QuarantineHandlerResult {
  status: number;
  json: unknown;
}

function failure(status: number, code: string, message: string): QuarantineHandlerResult {
  return { status, json: { error: { code, message } } };
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as { errorName?: unknown }).errorName;
  return typeof name === 'string' ? name : undefined;
}

function executable(status: string): boolean {
  return status === 'ACTIVE' || status === 'ACTIVE_RECOVERY';
}

async function mirrorQuarantined(deps: QuarantineDeps, missionId: string): Promise<void> {
  await deps.updateMissionStatus(missionId);
  await deps.updateAgentStatus(missionId);
}

/**
 * Quarantines one mission. Authorization is decided by the route:
 * owner session (Mode A) or guardian credential (Mode B).
 */
export async function requestQuarantine(args: {
  deps: QuarantineDeps;
  missionId: string;
  actor: QuarantineActor;
}): Promise<QuarantineHandlerResult> {
  const { deps, missionId, actor } = args;
  const mission = await deps.getMission(missionId);
  if (!mission) return failure(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  if (actor.type === 'owner' && mission.owner_id !== actor.id) {
    return failure(404, 'MISSION_NOT_FOUND', 'Mission not found.');
  }

  const missionAddressValue = mission.contract_address ?? mission.pda_address;
  if (!isAddress(missionAddressValue)) {
    return failure(500, 'MISSION_CONTRACT_INVALID', 'Mission contract address is invalid.');
  }
  const missionAddress = missionAddressValue as `0x${string}`;

  let onchain: QuarantineOnChainState;
  try {
    onchain = await deps.readState(missionAddress);
  } catch {
    return failure(503, 'MISSION_STATE_UNAVAILABLE', 'Mission state is temporarily unavailable.');
  }

  if (onchain.status === 'QUARANTINED') {
    await mirrorQuarantined(deps, missionId);
    return {
      status: 200,
      json: {
        missionId,
        status: 'QUARANTINED',
        txHash: null,
        quarantinedAt: null,
        idempotent: true,
      },
    };
  }
  if (!executable(onchain.status)) {
    return failure(
      409,
      'QUARANTINE_NOT_ALLOWED',
      `Only ACTIVE or ACTIVE_RECOVERY missions can be quarantined (on-chain status is ${onchain.status}).`
    );
  }

  let txHash: string;
  try {
    const result = await deps.submitQuarantine({
      missionAddress,
      expectedVersion: onchain.stateVersion,
    });
    txHash = result.txHash;
  } catch (error) {
    const name = errorName(error);
    if (name === 'AlreadyQuarantined' || name === 'InvalidStatus') {
      const latest = await deps.readState(missionAddress).catch(() => null);
      if (latest?.status === 'QUARANTINED') {
        await mirrorQuarantined(deps, missionId);
        return {
          status: 200,
          json: {
            missionId,
            status: 'QUARANTINED',
            txHash: null,
            quarantinedAt: null,
            idempotent: true,
          },
        };
      }
      return failure(409, 'QUARANTINE_NOT_ALLOWED', 'The mission is not quarantinable.');
    }
    if (name === 'InvalidVersion') {
      return failure(409, 'VERSION_CONFLICT', 'The mission state changed; retry quarantine.');
    }
    if (name === 'NotGuardian') {
      return failure(500, 'GUARDIAN_CONFIG', 'The configured guardian key is not authorized.');
    }
    return failure(502, 'QUARANTINE_FAILED', 'The quarantine transaction failed.');
  }

  const nowIso = new Date(deps.nowMs ?? Date.now()).toISOString();
  const payload = {
    txHash,
    previousStatus: onchain.status,
    stateVersionBefore: onchain.stateVersion.toString(),
    violationCount: onchain.violationCount,
  };
  await deps.insertAuditEvent({
    mission_id: missionId,
    event_type: 'quarantine.submitted',
    actor_type: actor.type,
    actor_id: actor.id,
    event_hash: auditEventHash([missionId, 'quarantine.submitted', txHash]),
    payload_public: payload,
    onchain_tx_hash: txHash,
  });
  await deps.insertAuditEvent({
    mission_id: missionId,
    event_type: 'quarantine.confirmed',
    actor_type: actor.type,
    actor_id: actor.id,
    event_hash: auditEventHash([missionId, 'quarantine.confirmed', txHash]),
    payload_public: payload,
    onchain_tx_hash: txHash,
  });
  await mirrorQuarantined(deps, missionId);

  return {
    status: 200,
    json: {
      missionId,
      status: 'QUARANTINED',
      txHash,
      quarantinedAt: nowIso,
      idempotent: false,
    },
  };
}
