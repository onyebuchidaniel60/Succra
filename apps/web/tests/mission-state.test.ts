// On-chain Mission decoder vectors (no chain).
// Bytes are hand-assembled per programs/succra/src/state.rs; the same
// decoder is cross-checked against anchor-decoded accounts by the
// validator-gated comparison test (local only).
import { describe, expect, it } from 'vitest';
import { bytesToBase58 } from '@succra/shared';
import { decodeMissionAccount, missionDiscriminator } from '../lib/gateway/mission-state.js';

function u64(value: bigint): number[] {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return [...out];
}

function buildMission(overrides: { status?: number; agentFill?: number } = {}): {
  bytes: Uint8Array;
  mission: string;
  agent: string;
} {
  const mission = new Uint8Array(32).fill(21);
  const agent = new Uint8Array(32).fill(22);
  const out: number[] = [
    ...missionDiscriminator(),
    ...new Uint8Array(32).fill(1), // owner
    ...u64(9n), // mission_id
    200, // vault_bump
    ...new Uint8Array(32), // mint = native (zeros)
    ...u64(50_000_000n), // budget
    ...u64(49_000_000n), // remaining
    ...u64(5_000_000n), // max_action
    ...u64(1_000_000n), // recovery_max
    1,
    0,
    0,
    0,
    0, // 1 action type: TransferSol
    1,
    0,
    0,
    0,
    ...new Uint8Array(32).fill(30), // 1 recipient
    ...u64(9_999_999_999n), // expires_at
    3, // violation_threshold
    ...u64(900n), // violation_window
    overrides.status ?? 1, // Active
    ...(overrides.agentFill !== undefined ? new Uint8Array(32).fill(overrides.agentFill) : agent),
    ...u64(7n), // agent_nonce
  ];
  return {
    bytes: new Uint8Array(out),
    mission: bytesToBase58(mission),
    agent: bytesToBase58(agent),
  };
}

describe('mission account decoding', () => {
  it('decodes every field at the documented offsets', () => {
    const { bytes, mission, agent } = buildMission({});
    void mission;
    const state = decodeMissionAccount('MissionAddr', bytes);
    expect(state.address).toEqual('MissionAddr');
    expect(state.missionId).toEqual(9n);
    expect(state.mint).toEqual('11111111111111111111111111111111');
    expect(state.budget).toEqual(50_000_000n);
    expect(state.remainingBudget).toEqual(49_000_000n);
    expect(state.maxAction).toEqual(5_000_000n);
    expect(state.allowedActionTypes).toEqual(['TRANSFER_SOL']);
    expect(state.allowedRecipients).toEqual([bytesToBase58(new Uint8Array(32).fill(30))]);
    expect(state.expiresAtSec).toEqual(9_999_999_999n);
    expect(state.violationThreshold).toEqual(3);
    expect(state.violationWindowSeconds).toEqual(900n);
    expect(state.status).toEqual('Active');
    expect(state.currentAgent).toEqual(agent);
    expect(state.agentNonce).toEqual(7n);
  });

  it('maps all three statuses and rejects unknown ones', () => {
    expect(decodeMissionAccount('m', buildMission({ status: 0 }).bytes).status).toEqual('Draft');
    expect(decodeMissionAccount('m', buildMission({ status: 2 }).bytes).status).toEqual(
      'Cancelled'
    );
    expect(decodeMissionAccount('m', buildMission({ status: 3 }).bytes).status).toEqual(
      'Quarantined'
    );
    expect(() => decodeMissionAccount('m', buildMission({ status: 9 }).bytes)).toThrow();
  });

  it('rejects truncated inputs, bad discriminators, and non-zero padding', () => {
    const { bytes } = buildMission({});
    expect(() => decodeMissionAccount('m', bytes.subarray(0, 100))).toThrow();
    expect(() => decodeMissionAccount('m', new Uint8Array(0))).toThrow();
    const badDisc = new Uint8Array(bytes);
    badDisc[0] = (badDisc[0] ?? 0) ^ 0xff;
    expect(() => decodeMissionAccount('m', badDisc)).toThrow();
    // Anchor zero-fills the LEN allocation: zero padding passes (live
    // accounts are 699 bytes), non-zero padding fails.
    expect(() => decodeMissionAccount('m', new Uint8Array([...bytes, 0, 0]))).not.toThrow();
    const dirty = new Uint8Array([...bytes, 0, 1]);
    expect(() => decodeMissionAccount('m', dirty)).toThrow();
  });
});
