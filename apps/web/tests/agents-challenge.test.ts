import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  issueAgentChallenge,
  verifyAgentChallenge,
  AGENT_CHALLENGE_PURPOSE,
} from '../lib/gateway/agents';
import { seedAgentWorld, type AgentWorld } from './helpers/agent-fixture';
import { registerPending } from './helpers/agent-test-utils';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);

describe('agent challenge', () => {
  let world: AgentWorld;

  beforeEach(async () => {
    world = await seedAgentWorld();
  }, 30_000);

  afterEach(async () => {
    await world.db.close();
  });

  async function pending() {
    return registerPending(world.store, world.ownerId, world.missionId, account);
  }

  it('issues a challenge for a PENDING agent', async () => {
    const created = await pending();
    const result = await issueAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: created.agentId,
      chainId: 177,
    });
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      challenge: expect.stringMatching(/^[0-9a-f]{64}$/),
      expiresAt: expect.any(String),
    });
  });

  it('rejects a challenge for an already REGISTERED agent', async () => {
    const created = await pending();
    await world.store.updateAgent(created.agentId, { status: 'REGISTERED' });
    const result = await issueAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: created.agentId,
      chainId: 177,
    });
    expect(result.status).toEqual(409);
    expect(result.json).toMatchObject({ error: { code: 'AGENT_ALREADY_VERIFIED' } });
  });

  it('expires a challenge after five minutes', async () => {
    const nowMs = 1_700_000_000_000;
    const created = await pending();
    const issued = await issueAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: created.agentId,
      chainId: 177,
      nowMs,
    });
    const json = issued.json as {
      challenge: string;
      typedData: Parameters<typeof account.signTypedData>[0];
      expiresAt: string;
    };
    expect(Date.parse(json.expiresAt)).toEqual(nowMs + 300_000);
    const signature = await account.signTypedData(json.typedData);
    const verified = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: created.agentId,
      challenge: json.challenge,
      signature,
      chainId: 177,
      nowMs: nowMs + 300_001,
    });
    expect(verified.status).toEqual(400);
    expect(verified.json).toMatchObject({ error: { code: 'CHALLENGE_EXPIRED' } });
  });

  it('returns a 32-byte hex challenge', async () => {
    const created = await pending();
    const result = await issueAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: created.agentId,
      chainId: 177,
    });
    const challenge = (result.json as { challenge: string }).challenge;
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns well-formed purpose-bound typed data', async () => {
    const created = await pending();
    const result = await issueAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: created.agentId,
      chainId: 177,
    });
    const typedData = (
      result.json as {
        typedData: {
          domain: Record<string, unknown>;
          types: Record<string, unknown>;
          primaryType: string;
          message: Record<string, unknown>;
        };
      }
    ).typedData;
    expect(typedData.domain).toEqual({ name: 'Succra', version: '1', chainId: 177n });
    expect('verifyingContract' in typedData.domain).toEqual(false);
    expect(typedData.primaryType).toEqual('AgentChallenge');
    expect(typedData.message).toMatchObject({
      agentAddress: account.address.toLowerCase(),
      purpose: AGENT_CHALLENGE_PURPOSE,
    });
    expect(String(typedData.message['challenge'])).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
