// Succra web — shared post-settlement hook.
//
// Every settlement confirmation path (submit handler, webhook, poller) must
// commit the next checkpoint. If the mission was quarantined in the same
// window, the optional succession trigger is fired too.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MissionOnChainState } from './contract-reader';
import { readMissionState } from './contract-reader';
import { admin } from '@/lib/supabase';
import { getCheckpointMission } from './store-checkpoints';
import { writeCheckpoint, type CheckpointWriteResult } from './checkpoint-writer';
import { triggerSuccessionForMission } from './succession-runner';

export interface PostSettlementDeps {
  getMission(missionId: string): Promise<{
    id: string;
    contract_address: string | null;
    pda_address: string;
  } | null>;
  readState(address: `0x${string}`): Promise<MissionOnChainState>;
  writeCheckpoint(missionId: string, expectedVersion: bigint): Promise<CheckpointWriteResult>;
  triggerSuccession?(missionId: string): Promise<void>;
}

export function createPostSettlementDeps(db: SupabaseClient = admin()): PostSettlementDeps {
  return {
    getMission: (missionId) => getCheckpointMission(db, missionId),
    readState: (address) => readMissionState(address),
    writeCheckpoint: (missionId, expectedVersion) => writeCheckpoint(missionId, expectedVersion),
    triggerSuccession: async (missionId) => {
      await triggerSuccessionForMission(missionId, { triggerType: 'quarantine' });
    },
  };
}

export async function postSettlementHook(
  missionId: string,
  expectedVersion?: bigint,
  deps: PostSettlementDeps = createPostSettlementDeps()
): Promise<CheckpointWriteResult> {
  const mission = await deps.getMission(missionId);
  if (!mission) throw new Error('Mission not found for post-settlement hook.');
  const address = (mission.contract_address ?? mission.pda_address) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Mission contract address is invalid.');
  }
  const state = await deps.readState(address);
  let checkpoint: CheckpointWriteResult | null = null;
  let checkpointError: unknown;
  if (state.status !== 'QUARANTINED') {
    try {
      checkpoint = await deps.writeCheckpoint(missionId, expectedVersion ?? state.stateVersion);
    } catch (error) {
      checkpointError = error;
    }
  }
  if (state.status === 'QUARANTINED' && deps.triggerSuccession) {
    await deps.triggerSuccession(missionId);
  }
  if (checkpointError) throw checkpointError;
  if (!checkpoint) {
    throw new Error('Mission is quarantined; checkpoint deferred to recovery.');
  }
  return checkpoint;
}
