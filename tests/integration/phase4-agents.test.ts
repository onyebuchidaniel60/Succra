// Phase 4 integration: EVM agent registration, challenge/verify, heartbeat,
// status, and the real migration on PGlite.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  agentStatusView,
  recordAgentHeartbeat,
  verifyAgentChallenge,
} from '../../apps/web/lib/gateway/agents';
import { seedAgentWorld, type AgentWorld } from '../../apps/web/tests/helpers/agent-fixture';
import { issueAndSign, registerPending } from '../../apps/web/tests/helpers/agent-test-utils';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);

describe('Phase 4 agent lifecycle', () => {
  let world: AgentWorld;

  beforeAll(async () => {
    world = await seedAgentWorld();
  }, 60_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('runs register → challenge → verify end-to-end', async () => {
    const pending = await registerPending(world.store, world.ownerId, world.missionId, account);
    expect(pending.status).toEqual('PENDING');
    const agent = await world.store.getAgentById(pending.agentId);
    if (!agent) throw new Error('agent missing');
    const signed = await issueAndSign(world.store, world.ownerId, agent, account);
    const verified = await verifyAgentChallenge({
      store: world.store,
      ownerId: world.ownerId,
      agentId: agent.id,
      challenge: signed.challenge,
      signature: signed.signature,
      chainId: 177,
    });
    expect(verified.status).toEqual(200);
    expect(verified.json).toMatchObject({ status: 'REGISTERED' });
    expect((await world.store.getAgentById(agent.id))?.status).toEqual('REGISTERED');
  });

  it('records a heartbeat after verification', async () => {
    const agent = await world.store.getAgentByAddress(account.address.toLowerCase());
    if (!agent) throw new Error('verified agent missing');
    const result = await recordAgentHeartbeat({
      store: world.store,
      agent,
      nowMs: 1_700_000_000_000,
    });
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ agentId: agent.id, status: 'REGISTERED' });
  });

  it('returns the documented status shape with mission assignments', async () => {
    const agent = await world.store.getAgentByAddress(account.address.toLowerCase());
    if (!agent) throw new Error('agent missing');
    const result = await agentStatusView({ store: world.store, agent });
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      agentId: agent.id,
      address: account.address.toLowerCase(),
      status: 'REGISTERED',
      missions: [{ missionId: world.missionId, role: 'PRIMARY', status: 'REGISTERED' }],
    });
  });

  it('applies the migration cleanly with the EVM agent columns and indexes', async () => {
    const columns = await world.db.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('agents', 'mission_agents', 'agent_challenges')`
    );
    const names = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const column of [
      'agents.address',
      'agents.public_key',
      'mission_agents.role',
      'mission_agents.status',
      'mission_agents.required_capabilities',
      'agent_challenges.challenge',
      'agent_challenges.consumed_at',
    ]) {
      expect(names.has(column)).toEqual(true);
    }
    const indexes = await world.db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('agents', 'agent_challenges')`
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    expect(indexNames.has('agents_address_key')).toEqual(true);
    expect(indexNames.has('agent_challenges_agent_challenge_key')).toEqual(true);
    expect(indexNames.has('agent_challenges_unconsumed_expires_idx')).toEqual(true);

    const policies = await world.db.query<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM pg_policies
       WHERE tablename IN ('agents', 'mission_agents', 'agent_challenges')`
    );
    const agentPolicies = policies.rows.filter((row) => row.tablename === 'agents');
    expect(agentPolicies.map((row) => row.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);
    expect(policies.rows.filter((row) => row.tablename === 'agent_challenges')).toHaveLength(0);
  });

  it('has no Solana imports in the new agent code paths', () => {
    const files = [
      'apps/web/lib/gateway/agents.ts',
      'apps/web/lib/gateway/store-agents.ts',
      'apps/web/app/api/missions/[id]/agents/route.ts',
      'apps/web/app/api/agents/[id]/challenge/route.ts',
      'apps/web/app/api/agents/[id]/verify/route.ts',
      'apps/web/app/api/agents/[id]/heartbeat/route.ts',
      'apps/web/app/api/agents/[id]/status/route.ts',
    ];
    for (const file of files) {
      const source = readFileSync(join(ROOT, file), 'utf8');
      expect(source).not.toMatch(/@solana|tweetnacl|base58/i);
    }
  });
});
