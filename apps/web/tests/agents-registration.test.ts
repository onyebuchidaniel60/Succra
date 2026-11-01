import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { registerAgent } from '../lib/gateway/agents';
import { seedAgentWorld, type AgentWorld } from './helpers/agent-fixture';

function account(index: number) {
  return privateKeyToAccount(`0x${(index + 1).toString(16).padStart(2, '0').repeat(32)}`);
}

describe('agent registration', () => {
  let world: AgentWorld;

  beforeEach(async () => {
    world = await seedAgentWorld();
  }, 30_000);

  afterEach(async () => {
    await world.db.close();
  });

  async function register(
    input: Partial<Parameters<typeof registerAgent>[0]['input']> & {
      address: string;
      name: string;
      role: 'PRIMARY' | 'SUCCESSOR';
    }
  ) {
    return registerAgent({
      store: world.store,
      ownerId: world.ownerId,
      missionId: world.missionId,
      input,
    });
  }

  it('registers a valid PRIMARY agent as PENDING', async () => {
    const result = await register({
      address: account(0).address,
      name: 'Alpha',
      role: 'PRIMARY',
    });
    expect(result.status).toEqual(201);
    expect(result.json).toMatchObject({
      address: account(0).address.toLowerCase(),
      status: 'PENDING',
      role: 'PRIMARY',
    });
    const assignment = await world.store.getAssignment(
      world.missionId,
      (result.json as { agentId: string }).agentId
    );
    expect(assignment?.role).toEqual('PRIMARY');
    expect(assignment?.status).toEqual('PENDING');
  });

  it('registers a valid SUCCESSOR with priority and capabilities', async () => {
    const result = await register({
      address: account(1).address,
      name: 'Beta',
      role: 'SUCCESSOR',
      priority: 2,
      requiredCapabilities: ['data-feed'],
    });
    expect(result.status).toEqual(201);
    const agentId = (result.json as { agentId: string }).agentId;
    const assignment = await world.store.getAssignment(world.missionId, agentId);
    expect(assignment?.role).toEqual('SUCCESSOR');
    expect(assignment?.priority).toEqual(2);
    expect(assignment?.required_capabilities).toEqual(['data-feed']);
  });

  it('rejects a second PRIMARY', async () => {
    await register({ address: account(0).address, name: 'Alpha', role: 'PRIMARY' });
    const result = await register({
      address: account(1).address,
      name: 'Beta',
      role: 'PRIMARY',
    });
    expect(result.status).toEqual(409);
    expect(result.json).toMatchObject({ error: { code: 'PRIMARY_ALREADY_ASSIGNED' } });
  });

  it('rejects a ninth successor', async () => {
    for (let index = 0; index < 8; index += 1) {
      const result = await register({
        address: account(index).address,
        name: `S${index}`,
        role: 'SUCCESSOR',
        priority: index,
      });
      expect(result.status).toEqual(201);
    }
    const ninth = await register({
      address: account(8).address,
      name: 'S8',
      role: 'SUCCESSOR',
      priority: 8,
    });
    expect(ninth.status).toEqual(409);
    expect(ninth.json).toMatchObject({ error: { code: 'SUCCESSOR_LIMIT_EXCEEDED' } });
  });

  it('treats re-attaching the same agent and role as idempotent', async () => {
    const first = await register({
      address: account(0).address,
      name: 'Alpha',
      role: 'PRIMARY',
    });
    const second = await register({
      address: account(0).address,
      name: 'Alpha v2',
      role: 'PRIMARY',
    });
    expect(first.status).toEqual(201);
    expect(second.status).toEqual(200);
    expect((second.json as { agentId: string }).agentId).toEqual(
      (first.json as { agentId: string }).agentId
    );
    const assignments = await world.store.listAssignmentsForAgent(
      (first.json as { agentId: string }).agentId
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.status).toEqual('PENDING');
  });

  it('rejects an invalid EVM address', async () => {
    const result = await register({
      address: 'not-an-address',
      name: 'Alpha',
      role: 'PRIMARY',
    });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'INVALID_BODY' } });
  });
});
