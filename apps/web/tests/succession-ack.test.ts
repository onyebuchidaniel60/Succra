import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { computeRecoveryAckDigest } from '@succra/shared';
import { acknowledgeRecovery, type AckDeps } from '../lib/gateway/succession-ack';
import type { MissionOnChainState } from '../lib/gateway/contract-reader';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const SUCCESSION_ID = '22222222-2222-4222-8222-222222222222';
const MISSION_ADDRESS = `0x${'11'.repeat(20)}` as const;
const BETA = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const GAMMA = privateKeyToAccount(`0x${'33'.repeat(32)}`);

function onchain(overrides: Partial<MissionOnChainState> = {}): MissionOnChainState {
  return {
    contractAddress: MISSION_ADDRESS,
    currentAgent: BETA.address,
    status: 'RECOVERING',
    agentNonce: 0n,
    stateVersion: 5n,
    violationCount: 0,
    lastViolationAt: 0n,
    confirmedSpentAtomic: 0n,
    lastCheckpointHash: `0x${'01'.repeat(32)}`,
    lastCheckpointSequence: 0n,
    checkpointCount: 1n,
    successors: [],
    paymentToken: `0x${'44'.repeat(20)}`,
    budgetAtomic: 1000n,
    maxPaymentAtomic: 400n,
    recoveryMaxPaymentAtomic: 100n,
    expiresAt: 2_000_000_000n,
    policyHash: `0x${'55'.repeat(32)}`,
    cartMandateHash: `0x${'66'.repeat(32)}`,
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    allowedMerchants: new Set(),
    ...overrides,
  };
}

function deps(overrides: Partial<AckDeps> = {}): AckDeps {
  return {
    getMission: vi.fn(async () => ({
      id: MISSION_ID,
      contract_address: MISSION_ADDRESS,
      pda_address: MISSION_ADDRESS,
    })),
    getSuccession: vi.fn(async () => ({
      id: SUCCESSION_ID,
      mission_id: MISSION_ID,
      from_agent_id: 'alpha-id',
      from_agent_address: `0x${'aa'.repeat(20)}`,
      to_agent_id: 'beta-id',
      to_agent_address: BETA.address,
      trigger_type: 'quarantine' as const,
      checkpoint_hash: `0x${'01'.repeat(32)}`,
      checkpoint_sequence: 0,
      recovery_max_payment_atomic: '100',
      status: 'PENDING_ACK' as const,
      activation_tx_hash: `0x${'02'.repeat(32)}`,
      acknowledgement_tx_hash: null,
      created_at: new Date().toISOString(),
      acknowledged_at: null,
    })),
    getSuccessorEligibility: vi.fn(async () => ({
      agentStatus: 'REGISTERED',
      assignmentStatus: 'REGISTERED',
    })),
    readState: vi.fn(async () => onchain()),
    submitAck: vi.fn(async () => ({ txHash: `0x${'03'.repeat(32)}` })),
    insertAuditEvent: vi.fn(async () => undefined),
    markAcknowledged: vi.fn(async () => undefined),
    updateAgentStatus: vi.fn(async () => undefined),
    updateMissionStatus: vi.fn(async () => undefined),
    updateMissionCurrentAgent: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function signatureFor(version: bigint, signer = BETA) {
  return signer.sign({
    hash: computeRecoveryAckDigest({ missionAddress: MISSION_ADDRESS, expectedVersion: version }),
  });
}

describe('Phase 6 acknowledgement core', () => {
  it('accepts a valid successor signature and mirrors the acknowledged state', async () => {
    const d = deps();
    const result = await acknowledgeRecovery({
      deps: d,
      missionId: MISSION_ID,
      successionId: SUCCESSION_ID,
      expectedVersion: 5n,
      signature: await signatureFor(5n),
      agentId: 'beta-id',
      agentAddress: BETA.address,
    });
    expect(result.status).toEqual(200);
    expect(d.submitAck).toHaveBeenCalledTimes(1);
    expect(d.markAcknowledged).toHaveBeenCalledWith(
      SUCCESSION_ID,
      `0x${'03'.repeat(32)}`,
      expect.any(String)
    );
    expect(d.updateAgentStatus).toHaveBeenCalledWith(MISSION_ID, 'alpha-id', 'REVOKED');
    expect(d.updateAgentStatus).toHaveBeenCalledWith(MISSION_ID, 'beta-id', 'ACTIVE_PRIMARY');
    const eventTypes = (d.insertAuditEvent as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { event_type: string }).event_type
    );
    expect(eventTypes).toEqual([
      'succession.acknowledge.submitted',
      'succession.acknowledge.confirmed',
    ]);
  });

  it('rejects a signature from the wrong key before touching the chain', async () => {
    const d = deps();
    const result = await acknowledgeRecovery({
      deps: d,
      missionId: MISSION_ID,
      successionId: SUCCESSION_ID,
      expectedVersion: 5n,
      signature: await signatureFor(5n, GAMMA),
      agentId: 'beta-id',
      agentAddress: BETA.address,
    });
    expect(result.status).toEqual(400);
    expect(d.submitAck).not.toHaveBeenCalled();
  });

  it('rejects a stale expected version', async () => {
    const d = deps();
    const result = await acknowledgeRecovery({
      deps: d,
      missionId: MISSION_ID,
      successionId: SUCCESSION_ID,
      expectedVersion: 4n,
      signature: await signatureFor(4n),
      agentId: 'beta-id',
      agentAddress: BETA.address,
    });
    expect(result.status).toEqual(409);
    expect(d.submitAck).not.toHaveBeenCalled();
  });

  it('rejects ACK when the successor assignment was quarantined after activation', async () => {
    const d = deps({
      getSuccessorEligibility: vi.fn(async () => ({
        agentStatus: 'QUARANTINED',
        assignmentStatus: 'QUARANTINED',
      })),
    });
    const result = await acknowledgeRecovery({
      deps: d,
      missionId: MISSION_ID,
      successionId: SUCCESSION_ID,
      expectedVersion: 5n,
      signature: await signatureFor(5n),
      agentId: 'beta-id',
      agentAddress: BETA.address,
    });
    expect(result).toMatchObject({
      status: 403,
      json: { error: { code: 'SUCCESSOR_NOT_ELIGIBLE' } },
    });
    expect(d.submitAck).not.toHaveBeenCalled();
  });

  it('rejects ACK when the successor assignment was revoked', async () => {
    const d = deps({
      getSuccessorEligibility: vi.fn(async () => ({
        agentStatus: 'REGISTERED',
        assignmentStatus: 'REVOKED',
      })),
    });
    const result = await acknowledgeRecovery({
      deps: d,
      missionId: MISSION_ID,
      successionId: SUCCESSION_ID,
      expectedVersion: 5n,
      signature: await signatureFor(5n),
      agentId: 'beta-id',
      agentAddress: BETA.address,
    });
    expect(result).toMatchObject({
      status: 403,
      json: { error: { code: 'SUCCESSOR_NOT_ELIGIBLE' } },
    });
    expect(d.submitAck).not.toHaveBeenCalled();
  });
});
