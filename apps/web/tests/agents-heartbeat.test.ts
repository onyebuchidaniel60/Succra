import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyAgentRequest } from '../lib/gateway/agent-auth';
import { recordAgentHeartbeat } from '../lib/gateway/agents';
import { seedAgentWorld, type AgentWorld } from './helpers/agent-fixture';
import { agentHeaders, registerAndVerify, registerPending } from './helpers/agent-test-utils';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);

describe('agent heartbeat', () => {
  let world: AgentWorld;

  beforeEach(async () => {
    world = await seedAgentWorld();
  }, 30_000);

  afterEach(async () => {
    await world.db.close();
  });

  it('records a valid heartbeat', async () => {
    const { agent } = await registerAndVerify(world.store, world.ownerId, world.missionId, account);
    const nowMs = 1_700_000_000_000;
    const result = await recordAgentHeartbeat({ store: world.store, agent, nowMs });
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      agentId: agent.id,
      lastHeartbeatAt: new Date(nowMs).toISOString(),
      status: 'REGISTERED',
    });
    expect((await world.store.getAgentById(agent.id))?.last_heartbeat_at).toEqual(
      new Date(nowMs).toISOString()
    );
  });

  it('rejects a heartbeat less than 30 seconds after the last one', async () => {
    const { agent } = await registerAndVerify(world.store, world.ownerId, world.missionId, account);
    await recordAgentHeartbeat({ store: world.store, agent, nowMs: 1_700_000_000_000 });
    const refreshed = await world.store.getAgentById(agent.id);
    if (!refreshed) throw new Error('agent missing');
    const result = await recordAgentHeartbeat({
      store: world.store,
      agent: refreshed,
      nowMs: 1_700_000_010_000,
    });
    expect(result.status).toEqual(429);
    expect(result.headers?.['Retry-After']).toEqual('20');
    expect(result.json).toMatchObject({ error: { code: 'HEARTBEAT_TOO_SOON' } });
  });

  it('rejects a signature from a different agent', async () => {
    const { agent } = await registerAndVerify(world.store, world.ownerId, world.missionId, account);
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = await agentHeaders({
      account: other,
      agent,
      path: `/api/agents/${agent.id}/heartbeat`,
      method: 'POST',
      requestId: 'agent-heartbeat',
      timestamp,
    });
    const result = await verifyAgentRequest({
      headers,
      method: 'POST',
      path: `/api/agents/${agent.id}/heartbeat`,
      body: {},
      missionId: agent.id,
      missionAddress: agent.address as `0x${string}`,
      chainId: 177,
      agent: { id: agent.id, address: agent.address },
      store: {
        consumeAgentNonce: async () => 'CONSUMED',
        isAgentAssigned: async () => true,
      },
      requestId: 'agent-heartbeat',
      authorization: 'agent-only',
      nowMs: timestamp * 1000,
    });
    expect(result).toEqual({ ok: false, reason: 'INVALID_SIGNATURE' });
  });

  it('allows a successor (non-current agent) to authenticate for heartbeat', async () => {
    const { agent } = await registerAndVerify(
      world.store,
      world.ownerId,
      world.missionId,
      account,
      { role: 'SUCCESSOR', priority: 1 }
    );
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = await agentHeaders({
      account,
      agent,
      path: `/api/agents/${agent.id}/heartbeat`,
      method: 'POST',
      requestId: 'agent-heartbeat',
      timestamp,
    });
    const result = await verifyAgentRequest({
      headers,
      method: 'POST',
      path: `/api/agents/${agent.id}/heartbeat`,
      body: {},
      missionId: agent.id,
      missionAddress: agent.address as `0x${string}`,
      chainId: 177,
      currentAgent: other.address,
      agent: { id: agent.id, address: agent.address },
      store: {
        consumeAgentNonce: async () => 'CONSUMED',
        isAgentAssigned: async () => false,
      },
      requestId: 'agent-heartbeat',
      authorization: 'agent-only',
      nowMs: timestamp * 1000,
    });
    expect(result).toEqual({ ok: true });
    const heartbeat = await recordAgentHeartbeat({
      store: world.store,
      agent,
      nowMs: timestamp * 1000,
    });
    expect(heartbeat.status).toEqual(200);
  });

  it('promotes PENDING to REGISTERED on heartbeat when an assignment is verified', async () => {
    const pending = await registerPending(world.store, world.ownerId, world.missionId, account);
    const assignment = await world.store.getAssignment(world.missionId, pending.agentId);
    if (!assignment) throw new Error('assignment missing');
    await world.store.updateAssignmentStatus(world.missionId, pending.agentId, 'REGISTERED');
    const agent = await world.store.getAgentById(pending.agentId);
    if (!agent) throw new Error('agent missing');
    const result = await recordAgentHeartbeat({
      store: world.store,
      agent,
      nowMs: 1_700_000_000_000,
    });
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ status: 'REGISTERED' });
  });
});
