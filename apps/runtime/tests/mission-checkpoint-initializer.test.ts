import { describe, expect, it, vi } from 'vitest';
import {
  runMissionCheckpointInitializer,
  type MissionCheckpointInitializerDeps,
} from '../src/monitor/mission-checkpoint-initializer.js';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const MISSION_ADDRESS = `0x${'11'.repeat(20)}` as `0x${string}`;

function harness(checkpointCount = 0n, status = 'ACTIVE') {
  const checkpoints: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const deps: MissionCheckpointInitializerDeps = {
    listActiveMissions: vi.fn(async () => [
      {
        id: MISSION_ID,
        contract_address: MISSION_ADDRESS,
        pda_address: MISSION_ADDRESS,
        policy_version: 1,
      },
    ]),
    readState: vi.fn(async () => ({
      status,
      stateVersion: 0n,
      checkpointCount,
      confirmedSpentAtomic: 0n,
      maxPaymentAtomic: 400n,
      recoveryMaxPaymentAtomic: 100n,
      policyHash: `0x${'22'.repeat(32)}`,
    })),
    commitCheckpoint: vi.fn(async () => ({ txHash: `0x${'33'.repeat(32)}` })),
    insertCheckpoint: vi.fn(async (row) => {
      checkpoints.push(row as unknown as Record<string, unknown>);
    }),
    insertAuditEvent: vi.fn(async (row) => {
      audits.push(row as unknown as Record<string, unknown>);
    }),
  };
  return { deps, checkpoints, audits };
}

describe('Phase 6 initial checkpoint watcher', () => {
  it('commits sequence 0 for an active mission with checkpointCount 0', async () => {
    const h = harness();
    const result = await runMissionCheckpointInitializer(h.deps);
    expect(result).toEqual({ checked: 1, initialized: 1 });
    expect(h.deps.commitCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 0n, expectedVersion: 0n })
    );
    expect(h.checkpoints[0]).toMatchObject({
      mission_id: MISSION_ID,
      sequence: 0,
      status: 'VERIFIED',
      confirmed_payment_ids: [],
      confirmed_transaction_hashes: [],
      hsp_mandate_ids: [],
      confirmed_spent_atomic: '0',
    });
    expect(h.audits[0]).toMatchObject({ event_type: 'checkpoint.verified' });
  });

  it('skips missions that already have a checkpoint', async () => {
    const h = harness(1n);
    const result = await runMissionCheckpointInitializer(h.deps);
    expect(result).toEqual({ checked: 1, initialized: 0 });
    expect(h.deps.commitCheckpoint).not.toHaveBeenCalled();
  });

  it('skips non-executable missions', async () => {
    const h = harness(0n, 'QUARANTINED');
    const result = await runMissionCheckpointInitializer(h.deps);
    expect(result).toEqual({ checked: 1, initialized: 0 });
    expect(h.deps.commitCheckpoint).not.toHaveBeenCalled();
  });
});
