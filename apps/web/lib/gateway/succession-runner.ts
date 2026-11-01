// Succra web — production adapter for the runtime succession engine.
//
// The engine is pure/orchestration-only; this adapter supplies the web-side
// Supabase persistence and guardian contract writers.
import { admin } from '@/lib/supabase';
import { readMissionState } from './contract-reader';
import { sendActivateSuccessor } from './contract-writer';
import { insertAuditEvent } from './store-quarantine';
import { getLatestVerifiedCheckpoint } from './store-checkpoints';
import {
  getSuccessionMission,
  getPendingSuccession,
  insertSuccessionEvent,
  listSuccessorCandidates,
  type SuccessionEventRow,
} from './store-succession';
import {
  runSuccessionEngine,
  type SuccessionEngineDeps,
  type SuccessionEngineResult,
  type SuccessionTriggerType,
} from '../../../runtime/src/succession/succession-engine';

function deps(): SuccessionEngineDeps {
  const db = admin();
  return {
    getMission: (missionId) => getSuccessionMission(db, missionId),
    readState: (address) => readMissionState(address),
    listCandidates: async (missionId) =>
      (await listSuccessorCandidates(db, missionId)).map((candidate) => ({
        missionAgentId: candidate.mission_agent_id,
        agentId: candidate.agent_id,
        address: candidate.address,
        priority: candidate.priority,
        status: candidate.status,
        capabilities: Array.isArray(candidate.capabilities)
          ? candidate.capabilities.filter((value): value is string => typeof value === 'string')
          : [],
        requiredCapabilities: Array.isArray(candidate.required_capabilities)
          ? candidate.required_capabilities.filter(
              (value): value is string => typeof value === 'string'
            )
          : [],
      })),
    getLatestVerifiedCheckpoint: async (missionId) => {
      const checkpoint = await getLatestVerifiedCheckpoint(db, missionId);
      return checkpoint
        ? { sequence: checkpoint.sequence, checkpoint_hash: checkpoint.checkpoint_hash }
        : null;
    },
    getPendingSuccession: async (missionId) => getPendingSuccession(db, missionId),
    failPendingSuccession: async (successionId) => {
      await db
        .from('succession_events')
        .update({ status: 'FAILED' })
        .eq('id', successionId)
        .eq('status', 'PENDING_ACK');
    },
    insertSuccessionEvent: (row) => insertSuccessionEvent(db, row),
    insertAuditEvent: async (row) => {
      await insertAuditEvent(db, row);
    },
    activateSuccessor: (args) => sendActivateSuccessor(args),
  };
}

export function triggerSuccessionForMission(
  missionId: string,
  options: {
    triggerType?: SuccessionTriggerType;
    preferredSuccessorAddress?: string;
  } = {}
): Promise<SuccessionEngineResult> {
  return runSuccessionEngine(deps(), missionId, options);
}

export type { SuccessionEventRow };
