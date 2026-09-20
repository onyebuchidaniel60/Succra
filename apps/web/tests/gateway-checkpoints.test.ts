// Gateway checkpoint tests (pure Borsh/hash vectors + PGlite writes).
// Proves: the canonical preimage layout is byte-exact (Borsh-compatible),
// hashing is deterministic and field-sensitive, writes are idempotent,
// newer VERIFIED rows supersede older ones, and the activation
// cold-start guard backfills sequence 0 exactly once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkpointHash,
  encodeCheckpointPreimage,
  ensureActivationCheckpoint,
  writeVerifiedCheckpoint,
  type CheckpointPreimage,
} from '../lib/gateway/checkpoints.js';
import { seedWorld, type FixtureWorld } from './helpers/gateway-fixture.js';

function basePreimage(overrides: Partial<CheckpointPreimage> = {}): CheckpointPreimage {
  return {
    missionId: 'm',
    sequence: 1,
    confirmedActionIds: [],
    confirmedSignatures: [],
    remainingBudgetAtomic: 0n,
    maxActionAtCheckpoint: 0n,
    recoveryMaxActionAtCheckpoint: 0n,
    policyVersion: 1,
    policyHash: 'h',
    createdAtSec: 0,
    ...overrides,
  };
}

describe('canonical checkpoint preimage', () => {
  it('matches the hand-computed Borsh layout', () => {
    const bytes = encodeCheckpointPreimage(basePreimage());
    // str("m") | u64(1) | vec[] | vec[] | u64(0) | u64(0) | u64(0)
    // | u32(1) | str("h") | i64(0) — 62 bytes total.
    const expectedHex =
      '010000006d' +
      '0100000000000000' +
      '00000000' +
      '00000000' +
      '00'.repeat(24) +
      '01000000' +
      '0100000068' +
      '00'.repeat(8);
    expect(bytes.length).toEqual(62);
    expect(Buffer.from(bytes).toString('hex')).toEqual(expectedHex);
  });

  it('is deterministic for identical inputs', () => {
    expect(checkpointHash(basePreimage())).toEqual(checkpointHash(basePreimage()));
    expect(checkpointHash(basePreimage())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any field changes', () => {
    const baseline = checkpointHash(basePreimage());
    const variants: Partial<CheckpointPreimage>[] = [
      { missionId: 'n' },
      { sequence: 2 },
      { confirmedActionIds: ['a'] },
      { confirmedSignatures: ['s'] },
      { remainingBudgetAtomic: 1n },
      { maxActionAtCheckpoint: 1n },
      { recoveryMaxActionAtCheckpoint: 1n },
      { policyVersion: 2 },
      { policyHash: 'g' },
      { createdAtSec: 1 },
    ];
    for (const variant of variants) {
      expect(checkpointHash(basePreimage(variant))).not.toEqual(baseline);
    }
  });

  it('fails closed on out-of-range values', () => {
    expect(() => encodeCheckpointPreimage(basePreimage({ sequence: -1 }))).toThrow();
    expect(() => encodeCheckpointPreimage(basePreimage({ remainingBudgetAtomic: -1n }))).toThrow();
    expect(() =>
      encodeCheckpointPreimage(basePreimage({ remainingBudgetAtomic: 2n ** 64n }))
    ).toThrow();
  });
});

describe('checkpoint writes', () => {
  let world: FixtureWorld;

  beforeAll(async () => {
    world = await seedWorld({});
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('writes a VERIFIED checkpoint with NULL commitment', async () => {
    const row = await writeVerifiedCheckpoint(world.store, {
      missionId: world.missionId,
      sequence: 1,
      confirmedActionIds: ['11111111-1111-1111-1111-111111111111'],
      confirmedSignatures: ['sig1'],
      remainingBudgetAtomic: 49_000_000n,
      maxActionAtomic: 5_000_000n,
      recoveryMaxActionAtomic: 1_000_000n,
      policyVersion: 1,
      policyHash: 'hash',
      nowMs: Date.now(),
    });
    expect(row.status).toEqual('VERIFIED');
    expect(row.sequence).toEqual(1);
    expect(row.committed_signature).toBeNull();
    expect(row.checkpoint_hash).toMatch(/^[0-9a-f]{64}$/);
    const snapshot = row.state_snapshot as Record<string, unknown>;
    expect(snapshot['policy_hash']).toEqual('hash');
    expect(snapshot['confirmed_signatures']).toEqual(['sig1']);
  });

  it('is idempotent on (mission_id, sequence)', async () => {
    const first = await writeVerifiedCheckpoint(world.store, {
      missionId: world.missionId,
      sequence: 5,
      confirmedActionIds: [],
      confirmedSignatures: ['sig5'],
      remainingBudgetAtomic: 40_000_000n,
      maxActionAtomic: 5_000_000n,
      recoveryMaxActionAtomic: 1_000_000n,
      policyVersion: 1,
      policyHash: 'hash',
      nowMs: Date.now(),
    });
    const second = await writeVerifiedCheckpoint(world.store, {
      missionId: world.missionId,
      sequence: 5,
      confirmedActionIds: [],
      confirmedSignatures: ['sig5-other'],
      remainingBudgetAtomic: 39_000_000n,
      maxActionAtomic: 5_000_000n,
      recoveryMaxActionAtomic: 1_000_000n,
      policyVersion: 1,
      policyHash: 'hash',
      nowMs: Date.now(),
    });
    expect(second.id).toEqual(first.id);
  });

  it('supersedes older VERIFIED rows when a newer one lands', async () => {
    await writeVerifiedCheckpoint(world.store, {
      missionId: world.missionId,
      sequence: 9,
      confirmedActionIds: [],
      confirmedSignatures: ['sig9'],
      remainingBudgetAtomic: 30_000_000n,
      maxActionAtomic: 5_000_000n,
      recoveryMaxActionAtomic: 1_000_000n,
      policyVersion: 1,
      policyHash: 'hash',
      nowMs: Date.now(),
    });
    const older = await world.store.getCheckpoint(world.missionId, 5);
    expect(older?.status).toEqual('SUPERSEDED');
    const latest = await world.store.latestVerifiedCheckpoint(world.missionId);
    expect(latest?.sequence).toEqual(9);
  });

  it('backfills the sequence=0 activation checkpoint exactly once', async () => {
    const args = {
      missionId: world.missionId,
      remainingBudgetAtomic: 50_000_000n,
      maxActionAtomic: 5_000_000n,
      recoveryMaxActionAtomic: 1_000_000n,
      policyVersion: 1,
      policyHash: 'hash',
      nowMs: Date.now(),
    };
    const first = await ensureActivationCheckpoint(world.store, args);
    const second = await ensureActivationCheckpoint(world.store, args);
    expect(first.sequence).toEqual(0);
    expect(second.id).toEqual(first.id);
    expect(first.status).toEqual('VERIFIED');
  });
});
