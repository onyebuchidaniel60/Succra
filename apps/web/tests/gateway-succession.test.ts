// Gateway succession tests (PGlite + fake chain, no validator).
// Proves: FR-05 selection (lower priority wins, list-position
// tie-break, AVAILABLE + capability + membership + not-primary
// filters); activation mirrors authority + writes audit rows;
// no eligible successor halts; acknowledgement completes the handoff;
// ack replay and wrong-agent ack are rejected; duplicate succession
// returns the current state.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAcknowledgeSuccession, handleSuccession } from '../lib/gateway/handlers.js';
import { selectSuccessor } from '../lib/gateway/succession.js';
import type { AgentRow, MissionAgentRow } from '../lib/gateway/store.js';
import type { FeePayer } from '../lib/gateway/chain.js';
import { sign as naclSign } from 'tweetnacl';
import { bytesToBase58 } from '@succra/shared';
import {
  makeFakeChain,
  makeTestAgent,
  seedWorld,
  signTestRequest,
  type FixtureWorld,
  type TestAgentKey,
} from './helpers/gateway-fixture.js';

const PROGRAM_ID = 'SysvarC1ock11111111111111111111111111111111';
const CREDENTIAL = 'test-guardian-credential';

function makeGuardian(): FeePayer {
  const pair = naclSign.keyPair();
  const address = bytesToBase58(pair.publicKey);
  return {
    address,
    signBytes: (message: Uint8Array): Uint8Array => naclSign.detached(message, pair.secretKey),
  };
}

function agentRow(id: string, publicKey: string, capabilities: unknown): AgentRow {
  return {
    id,
    owner_id: 'owner',
    name: 'agent',
    public_key: publicKey,
    endpoint_url: null,
    capabilities,
    status: 'ACTIVE_PRIMARY',
    last_heartbeat_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function assignmentRow(
  id: string,
  agentId: string,
  overrides: Partial<MissionAgentRow> = {}
): MissionAgentRow {
  return {
    id,
    mission_id: 'mission',
    agent_id: agentId,
    role: 'SUCCESSOR',
    priority: null,
    required_capabilities: null,
    status: 'AVAILABLE',
    activated_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('selectSuccessor (pure FR-05 selection)', () => {
  const primary = 'PRIMARY11111111111111111111111111111111';
  const betaKey = 'BETA1111111111111111111111111111111111';
  const gammaKey = 'GAMMA11111111111111111111111111111111';

  function world(
    assignments: MissionAgentRow[],
    agents: AgentRow[],
    onchain: string[]
  ): { assignments: MissionAgentRow[]; agentsById: Map<string, AgentRow>; onchain: string[] } {
    return {
      assignments,
      agentsById: new Map(agents.map((agent) => [agent.id, agent])),
      onchain,
    };
  }

  it('lower priority integer wins', () => {
    const beta = agentRow('beta', betaKey, []);
    const gamma = agentRow('gamma', gammaKey, []);
    const w = world(
      [assignmentRow('a1', 'beta', { priority: 1 }), assignmentRow('a2', 'gamma', { priority: 0 })],
      [beta, gamma],
      [betaKey, gammaKey]
    );
    const winner = selectSuccessor({
      onchainSuccessors: w.onchain,
      quarantinedAgentPublicKey: primary,
      assignments: w.assignments,
      agentsById: w.agentsById,
    });
    expect(winner?.agent.id).toEqual('gamma');
  });

  it('ties break by earlier on-chain list position', () => {
    const beta = agentRow('beta', betaKey, []);
    const gamma = agentRow('gamma', gammaKey, []);
    const w = world(
      [assignmentRow('a1', 'beta', { priority: 1 }), assignmentRow('a2', 'gamma', { priority: 1 })],
      [beta, gamma],
      [gammaKey, betaKey]
    );
    const winner = selectSuccessor({
      onchainSuccessors: w.onchain,
      quarantinedAgentPublicKey: primary,
      assignments: w.assignments,
      agentsById: w.agentsById,
    });
    expect(winner?.agent.id).toEqual('gamma');
  });

  it('skips ineligible candidates', () => {
    const beta = agentRow('beta', betaKey, []);
    const gamma = agentRow('gamma', gammaKey, ['kyc']);
    const outsider = agentRow('outsider', 'OUTSIDER111111111111111111111111111111', []);
    const cases: { name: string; assignments: MissionAgentRow[]; agents: AgentRow[] }[] = [
      {
        name: 'not AVAILABLE',
        assignments: [assignmentRow('a1', 'beta', { status: 'PENDING' })],
        agents: [beta],
      },
      {
        name: 'missing required capability',
        assignments: [assignmentRow('a1', 'beta', { required_capabilities: ['kyc'] })],
        agents: [beta],
      },
      {
        name: 'not on the on-chain list',
        assignments: [assignmentRow('a1', 'outsider')],
        agents: [outsider],
      },
      {
        name: 'is the quarantined primary',
        assignments: [assignmentRow('a1', 'beta')],
        agents: [agentRow('beta', primary, [])],
      },
      {
        name: 'wrong role',
        assignments: [assignmentRow('a1', 'beta', { role: 'PRIMARY' })],
        agents: [beta],
      },
    ];
    for (const { assignments, agents } of cases) {
      const w = world(assignments, agents, [betaKey, gammaKey]);
      expect(
        selectSuccessor({
          onchainSuccessors: w.onchain,
          quarantinedAgentPublicKey: primary,
          assignments: w.assignments,
          agentsById: w.agentsById,
        })
      ).toBeNull();
    }
    // Sanity: gamma passes the capability filter when declared.
    const capable = world(
      [assignmentRow('a1', 'gamma', { required_capabilities: ['kyc'] })],
      [gamma],
      [gammaKey]
    );
    expect(
      selectSuccessor({
        onchainSuccessors: capable.onchain,
        quarantinedAgentPublicKey: primary,
        assignments: capable.assignments,
        agentsById: capable.agentsById,
      })?.agent.id
    ).toEqual('gamma');
  });

  it('null priority sorts last and empty requirements pass trivially', () => {
    const beta = agentRow('beta', betaKey, []);
    const gamma = agentRow('gamma', gammaKey, []);
    const w = world(
      [
        assignmentRow('a1', 'beta', { priority: null }),
        assignmentRow('a2', 'gamma', { priority: 5 }),
      ],
      [beta, gamma],
      [betaKey, gammaKey]
    );
    const winner = selectSuccessor({
      onchainSuccessors: w.onchain,
      quarantinedAgentPublicKey: primary,
      assignments: w.assignments,
      agentsById: w.agentsById,
    });
    expect(winner?.agent.id).toEqual('gamma');
  });
});

describe('succession flow (PGlite + fake chain)', () => {
  let world: FixtureWorld;
  let guardian: FeePayer;
  let betaKeys: TestAgentKey;
  let gammaKeys: TestAgentKey;
  let betaId: string;
  let gammaId: string;

  beforeAll(async () => {
    world = await seedWorld({});
    guardian = makeGuardian();
    betaKeys = makeTestAgent();
    gammaKeys = makeTestAgent();
    const beta = await world.store.insertAgent({
      owner_id: world.ownerId,
      name: 'beta',
      public_key: betaKeys.base58,
      status: 'REGISTERED',
      capabilities: ['payments'],
    });
    betaId = beta.id;
    const gamma = await world.store.insertAgent({
      owner_id: world.ownerId,
      name: 'gamma',
      public_key: gammaKeys.base58,
      status: 'REGISTERED',
      capabilities: ['payments'],
    });
    gammaId = gamma.id;
    await world.store.insertAssignment({
      mission_id: world.missionId,
      agent_id: betaId,
      role: 'SUCCESSOR',
      priority: 1,
      status: 'AVAILABLE',
    });
    await world.store.insertAssignment({
      mission_id: world.missionId,
      agent_id: gammaId,
      role: 'SUCCESSOR',
      priority: 0,
      status: 'AVAILABLE',
    });
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  function successionChain(
    status: 'Quarantined' | 'Recovering',
    stateVersion: bigint,
    currentAgent?: string
  ) {
    return makeFakeChain(world, {
      status,
      currentAgent:
        currentAgent ?? (status === 'Quarantined' ? world.agent.base58 : gammaKeys.base58),
      successors: [betaKeys.base58, gammaKeys.base58],
      stateVersion,
    });
  }

  async function auditTypes(): Promise<string[]> {
    const rows = await world.db.query(
      'SELECT event_type FROM audit_events WHERE mission_id = $1 ORDER BY created_at ASC',
      [world.missionId] as unknown[]
    );
    return rows.rows.map((row) => String((row as Record<string, unknown>)['event_type']));
  }

  it('requires the guardian credential', async () => {
    const result = await handleSuccession({
      store: world.store,
      chain: successionChain('Quarantined', 2n),
      guardian,
      programId: PROGRAM_ID,
      guardianCredentialHeader: null,
      expectedGuardianCredential: CREDENTIAL,
      missionId: world.missionId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(result.status).toEqual(401);
  });

  it('activates the highest-priority eligible successor', async () => {
    const result = await handleSuccession({
      store: world.store,
      chain: successionChain('Quarantined', 2n),
      guardian,
      programId: PROGRAM_ID,
      guardianCredentialHeader: CREDENTIAL,
      expectedGuardianCredential: CREDENTIAL,
      missionId: world.missionId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(result.status).toEqual(200);
    const json = result.json as Record<string, unknown>;
    // Gamma has priority 0 over beta's 1: gamma wins.
    expect(json['status']).toEqual('RECOVERING');
    expect(json['toAgentId']).toEqual(gammaId);
    const successionId = String(json['successionId']);

    const succession = await world.store.getSuccessionById(successionId);
    expect(succession?.status).toEqual('AUTHORIZED');
    expect(succession?.to_agent_id).toEqual(gammaId);
    expect(succession?.onchain_signature).toBeTruthy();
    expect(succession?.recovery_limit_atomic).toEqual('1000000');

    const mission = await world.store.getMissionById(world.missionId);
    expect(mission?.status).toEqual('RECOVERING');
    expect(mission?.current_agent_id).toEqual(gammaId);
    expect(mission?.current_agent_public_key).toEqual(gammaKeys.base58);

    const betaAssignment = await world.store.getAssignment(world.missionId, betaId);
    expect(betaAssignment?.status).toEqual('AVAILABLE');
    const gammaAssignment = await world.store.getAssignment(world.missionId, gammaId);
    expect(gammaAssignment?.status).toEqual('ACTIVE_SUCCESSOR');
    expect(gammaAssignment?.activated_at).toBeTruthy();

    const types = await auditTypes();
    for (const expected of [
      'succession.triggered',
      'succession.candidate_selected',
      'succession.activate.submitted',
      'succession.activate.confirmed',
    ]) {
      expect(types).toContain(expected);
    }
  });

  it('returns the current state on duplicate succession', async () => {
    const result = await handleSuccession({
      store: world.store,
      chain: successionChain('Recovering', 3n),
      guardian,
      programId: PROGRAM_ID,
      guardianCredentialHeader: CREDENTIAL,
      expectedGuardianCredential: CREDENTIAL,
      missionId: world.missionId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(result.status).toEqual(200);
    expect((result.json as Record<string, unknown>)['status']).toEqual('Recovering');
  });

  it('acknowledges the handoff as the successor', async () => {
    const latest = await world.store.latestSuccessionForMission(world.missionId);
    const successionId = latest?.id ?? '';
    const path = `/api/missions/${world.missionId}/succession/${successionId}/acknowledge`;
    const { headers, rawBody } = signTestRequest({
      agent: gammaKeys,
      agentId: gammaId,
      missionId: world.missionId,
      method: 'POST',
      path,
      body: {},
    });
    const result = await handleAcknowledgeSuccession({
      store: world.store,
      chain: successionChain('Recovering', 3n),
      guardian,
      programId: PROGRAM_ID,
      headers,
      method: 'POST',
      path,
      rawBody,
      missionId: world.missionId,
      successionId,
      nowMs: Date.now(),
    });
    expect(result.status).toEqual(200);
    const json = result.json as Record<string, unknown>;
    expect(json['status']).toEqual('ACTIVE_RECOVERY');

    const succession = await world.store.getSuccessionById(successionId);
    expect(succession?.status).toEqual('COMPLETE');
    const mission = await world.store.getMissionById(world.missionId);
    expect(mission?.status).toEqual('ACTIVE_RECOVERY');
    const types = await auditTypes();
    expect(types).toContain('succession.acknowledge.submitted');
    expect(types).toContain('succession.acknowledge.confirmed');
  });

  it('rejects ack replay and wrong-agent ack', async () => {
    const latest = await world.store.latestSuccessionForMission(world.missionId);
    const successionId = latest?.id ?? '';
    const path = `/api/missions/${world.missionId}/succession/${successionId}/acknowledge`;
    // Replay by the successor: already complete.
    const replay = signTestRequest({
      agent: gammaKeys,
      agentId: gammaId,
      missionId: world.missionId,
      method: 'POST',
      path,
      body: {},
    });
    const replayed = await handleAcknowledgeSuccession({
      store: world.store,
      chain: successionChain('Recovering', 3n),
      guardian,
      programId: PROGRAM_ID,
      headers: replay.headers,
      method: 'POST',
      path,
      rawBody: replay.rawBody,
      missionId: world.missionId,
      successionId,
      nowMs: Date.now(),
    });
    expect(replayed.status).toEqual(200);
    expect((replayed.json as Record<string, unknown>)['status']).toEqual('COMPLETE');
    // Wrong agent (the quarantined primary): forbidden.
    const intruder = signTestRequest({
      agent: world.agent,
      agentId: world.agentId,
      missionId: world.missionId,
      method: 'POST',
      path,
      body: {},
    });
    const rejected = await handleAcknowledgeSuccession({
      store: world.store,
      chain: successionChain('Recovering', 3n),
      guardian,
      programId: PROGRAM_ID,
      headers: intruder.headers,
      method: 'POST',
      path,
      rawBody: intruder.rawBody,
      missionId: world.missionId,
      successionId,
      nowMs: Date.now(),
    });
    expect(rejected.status).toEqual(403);
  });
});

describe('succession halt (no eligible successor)', () => {
  let world: FixtureWorld;
  let guardian: FeePayer;

  beforeAll(async () => {
    // DB mirror already reflects the quarantine (compare-and-set source).
    world = await seedWorld({ missionStatus: 'QUARANTINED' });
    guardian = makeGuardian();
    const beta = await world.store.insertAgent({
      owner_id: world.ownerId,
      name: 'beta',
      public_key: makeTestAgent().base58,
      status: 'REGISTERED',
      capabilities: [],
    });
    // PENDING: attached but never verified — not AVAILABLE.
    await world.store.insertAssignment({
      mission_id: world.missionId,
      agent_id: beta.id,
      role: 'SUCCESSOR',
      priority: 0,
      status: 'PENDING',
    });
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('halts when nothing is eligible', async () => {
    const chain = makeFakeChain(world, { status: 'Quarantined', stateVersion: 2n });
    const result = await handleSuccession({
      store: world.store,
      chain,
      guardian,
      programId: PROGRAM_ID,
      guardianCredentialHeader: CREDENTIAL,
      expectedGuardianCredential: CREDENTIAL,
      missionId: world.missionId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(result.status).toEqual(200);
    expect((result.json as Record<string, unknown>)['status']).toEqual('HALTED');
    const mission = await world.store.getMissionById(world.missionId);
    expect(mission?.status).toEqual('HALTED');
    const latest = await world.store.latestSuccessionForMission(world.missionId);
    expect(latest).toBeNull();
    const rows = await world.db.query(
      `SELECT event_type FROM audit_events WHERE mission_id = $1 AND event_type = 'succession.triggered'`,
      [world.missionId] as unknown[]
    );
    expect(rows.rows.length).toEqual(1);
  });
});
