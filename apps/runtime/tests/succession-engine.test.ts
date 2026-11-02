import { describe, expect, it, vi } from 'vitest';
import {
  runSuccessionEngine,
  type SuccessionEngineDeps,
  type SuccessorCandidate,
} from '../src/succession/succession-engine.js';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const MISSION_ADDRESS = `0x${'11'.repeat(20)}` as `0x${string}`;
const PRIMARY = `0x${'aa'.repeat(20)}`;
const BETA = `0x${'bb'.repeat(20)}`;
const GAMMA = `0x${'cc'.repeat(20)}`;
const DELTA = `0x${'dd'.repeat(20)}`;

function candidate(
  address: string,
  agentId: string,
  priority: number | null,
  overrides: Partial<SuccessorCandidate> = {}
): SuccessorCandidate {
  return {
    missionAgentId: `ma-${agentId}`,
    agentId,
    address,
    priority,
    status: 'REGISTERED',
    capabilities: [],
    requiredCapabilities: [],
    ...overrides,
  };
}

function harness(
  options: {
    status?: string;
    currentAgent?: string;
    candidates?: SuccessorCandidate[];
    successors?: Array<{ agent: string; priority: number; active: boolean }>;
    checkpoint?: { sequence: number; checkpoint_hash: string } | null;
    pending?: {
      id: string;
      to_agent_address: string;
      activation_tx_hash: string | null;
      checkpoint_hash: string | null;
      checkpoint_sequence: number | null;
    } | null;
  } = {}
) {
  const audits: Array<Record<string, unknown>> = [];
  const activations: string[] = [];
  const failed: string[] = [];
  const status = options.status ?? 'QUARANTINED';
  const currentAgent = options.currentAgent ?? PRIMARY;
  const successors = options.successors ?? [
    { agent: BETA, priority: 2, active: true },
    { agent: GAMMA, priority: 1, active: true },
  ];
  const pending = options.pending ?? null;

  const deps: SuccessionEngineDeps = {
    getMission: vi.fn(async () => ({
      id: MISSION_ID,
      contract_address: MISSION_ADDRESS,
      pda_address: MISSION_ADDRESS,
      current_agent_id: 'primary-agent',
      current_agent_address: PRIMARY,
    })),
    readState: vi.fn(async () => ({
      status,
      stateVersion: 4n,
      currentAgent,
      recoveryMaxPaymentAtomic: 100n,
      successors,
    })),
    listCandidates: vi.fn(async () => options.candidates ?? []),
    getLatestVerifiedCheckpoint: vi.fn(async () =>
      options.checkpoint === undefined
        ? { sequence: 0, checkpoint_hash: `0x${'01'.repeat(32)}` }
        : options.checkpoint
    ),
    getPendingSuccession: vi.fn(async () => pending),
    failPendingSuccession: vi.fn(async (id: string) => {
      failed.push(id);
    }),
    insertSuccessionEvent: vi.fn(async (row) => {
      const created = {
        id: 'succession-1',
        to_agent_address: row.to_agent_address,
        activation_tx_hash: row.activation_tx_hash,
        checkpoint_hash: row.checkpoint_hash,
        checkpoint_sequence: row.checkpoint_sequence,
      };
      return created;
    }),
    insertAuditEvent: vi.fn(async (row) => {
      audits.push(row as unknown as Record<string, unknown>);
    }),
    activateSuccessor: vi.fn(async ({ successor }) => {
      activations.push(successor);
      return { txHash: `0x${'ee'.repeat(32)}` };
    }),
  };

  return { deps, audits, activations, failed };
}

describe('Phase 6 succession engine', () => {
  it('picks the eligible successor by lower on-chain priority', async () => {
    const h = harness({
      candidates: [candidate(BETA, 'beta-agent', 2), candidate(GAMMA, 'gamma-agent', 1)],
    });
    const result = await runSuccessionEngine(h.deps, MISSION_ID);
    expect(result).toMatchObject({
      outcome: 'ACTIVATED',
      successionId: 'succession-1',
      toAgentAddress: GAMMA,
    });
    expect(h.activations).toEqual([GAMMA]);
  });

  it('skips candidates that fail capabilities or are inactive on-chain', async () => {
    const h = harness({
      candidates: [
        candidate(BETA, 'beta-agent', 1, {
          capabilities: ['pay'],
          requiredCapabilities: ['pay', 'audit'],
        }),
        candidate(GAMMA, 'gamma-agent', 2, { capabilities: ['pay', 'audit'] }),
        candidate(DELTA, 'delta-agent', 0),
      ],
      successors: [
        { agent: BETA, priority: 1, active: true },
        { agent: GAMMA, priority: 2, active: true },
        { agent: DELTA, priority: 0, active: false },
      ],
    });
    await runSuccessionEngine(h.deps, MISSION_ID);
    expect(h.activations).toEqual([GAMMA]);
  });

  it('handles no eligible successor without inventing an event name', async () => {
    const h = harness({ candidates: [], successors: [] });
    const result = await runSuccessionEngine(h.deps, MISSION_ID);
    expect(result.outcome).toEqual('NO_ELIGIBLE');
    expect(h.activations).toEqual([]);
    expect(h.audits.map((event) => event['event_type'])).toEqual(['succession.triggered']);
    expect(h.audits[0]?.['payload_public']).toMatchObject({
      outcome: 'no_eligible_successor',
      eligible_candidates: [],
    });
  });

  it('is idempotent when the current on-chain successor is already pending', async () => {
    const h = harness({
      status: 'RECOVERING',
      currentAgent: BETA,
      pending: {
        id: 'pending-1',
        to_agent_address: BETA,
        activation_tx_hash: `0x${'ee'.repeat(32)}`,
        checkpoint_hash: `0x${'01'.repeat(32)}`,
        checkpoint_sequence: 0,
      },
    });
    const result = await runSuccessionEngine(h.deps, MISSION_ID);
    expect(result.outcome).toEqual('ALREADY_ACTIVATED');
    expect(h.activations).toEqual([]);
    expect(h.failed).toEqual([]);
  });

  it('retries from RECOVERING with a different successor and fails the old pending row', async () => {
    const h = harness({
      status: 'RECOVERING',
      currentAgent: BETA,
      pending: {
        id: 'pending-1',
        to_agent_address: BETA,
        activation_tx_hash: `0x${'ee'.repeat(32)}`,
        checkpoint_hash: `0x${'01'.repeat(32)}`,
        checkpoint_sequence: 0,
      },
      candidates: [candidate(BETA, 'beta-agent', 1), candidate(GAMMA, 'gamma-agent', 2)],
    });
    const result = await runSuccessionEngine(h.deps, MISSION_ID, {
      preferredSuccessorAddress: GAMMA,
    });
    expect(result.outcome).toEqual('ACTIVATED');
    expect(h.failed).toEqual(['pending-1']);
    expect(h.activations).toEqual([GAMMA]);
  });

  it('does not activate without a verified checkpoint', async () => {
    const h = harness({ checkpoint: null, candidates: [candidate(BETA, 'beta-agent', 1)] });
    const result = await runSuccessionEngine(h.deps, MISSION_ID);
    expect(result.outcome).toEqual('NO_CHECKPOINT');
    expect(h.activations).toEqual([]);
    expect(h.audits[0]?.['payload_public']).toMatchObject({
      outcome: 'no_verified_checkpoint',
    });
  });
});
