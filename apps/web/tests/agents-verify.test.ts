import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyAgentChallenge } from '../lib/gateway/agents';
import { seedAgentWorld, type AgentWorld } from './helpers/agent-fixture';
import { issueAndSign, registerPending } from './helpers/agent-test-utils';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);

describe('agent verify', () => {
  let world: AgentWorld;

  beforeEach(async () => {
    world = await seedAgentWorld();
  }, 30_000);

  afterEach(async () => {
    await world.db.close();
  });

  async function pendingAgent() {
    const pending = await registerPending(world.store, world.ownerId, world.missionId, account);
    const agent = await world.store.getAgentById(pending.agentId);
    if (!agent) throw new Error('agent missing');
    return agent;
  }

  it('verifies a valid signature and marks the agent REGISTERED', async () => {
    const agent = await pendingAgent();
    const signed = await issueAndSign(world.store, world.ownerId, agent, account);
    const result = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
    });
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      agentId: agent.id,
      address: account.address.toLowerCase(),
      status: 'REGISTERED',
    });
    expect((await world.store.getAgentById(agent.id))?.status).toEqual('REGISTERED');
    const assignment = await world.store.getAssignment(world.missionId, agent.id);
    expect(assignment?.status).toEqual('REGISTERED');
  });

  it('rejects a signature from the wrong key', async () => {
    const agent = await pendingAgent();
    const signed = await issueAndSign(world.store, world.ownerId, agent, other);
    const result = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
    });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
    expect((await world.store.getAgentById(agent.id))?.status).toEqual('PENDING');
  });

  it('rejects an expired challenge', async () => {
    const agent = await pendingAgent();
    const nowMs = 1_700_000_000_000;
    const signed = await issueAndSign(world.store, world.ownerId, agent, account, { nowMs });
    const result = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
      nowMs: nowMs + 300_001,
    });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'CHALLENGE_EXPIRED' } });
  });

  it('rejects an already-consumed challenge', async () => {
    const agent = await pendingAgent();
    const signed = await issueAndSign(world.store, world.ownerId, agent, account);
    await world.store.consumeChallenge(agent.id, signed.challenge, new Date().toISOString());
    const result = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
    });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'CHALLENGE_ALREADY_CONSUMED' } });
  });

  it('rejects an unknown challenge', async () => {
    const agent = await pendingAgent();
    const result = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: '11'.repeat(32),
      signature: `0x${'22'.repeat(65)}`,
      chainId: 177,
    });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'CHALLENGE_UNKNOWN' } });
  });

  it('returns 200 idempotently for an already REGISTERED agent', async () => {
    const agent = await pendingAgent();
    const signed = await issueAndSign(world.store, world.ownerId, agent, account);
    const first = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
    });
    const second = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
    });
    expect(first.status).toEqual(200);
    expect(second.status).toEqual(200);
    expect(second.json).toMatchObject({ status: 'REGISTERED' });
  });
});
