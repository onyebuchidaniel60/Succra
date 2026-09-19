// Gateway auth + heartbeat tests (PGlite, no chain).
//
// Every §12/FR-02 rejection path through handleHeartbeat: happy path,
// stale/future timestamps, wrong-key signatures, replayed nonces,
// unassigned agents, unknown agents, missing headers, path mismatch,
// and the 30s heartbeat rate limit (including recovery after 31s).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleHeartbeat } from '../lib/gateway/handlers';
import { seedWorld, signTestRequest } from './helpers/gateway-fixture';
import type { PGlite } from '@electric-sql/pglite';
import type { PGliteGatewayStore } from './helpers/pglite-gateway-store';
import type { FixtureWorld } from './helpers/gateway-fixture';

describe('agent authentication + heartbeat', () => {
  let db: PGlite;
  let world: FixtureWorld;
  let store: PGliteGatewayStore;

  beforeAll(async () => {
    world = await seedWorld({});
    db = world.db;
    store = world.store;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  function heartbeat(
    args: {
      agentId?: string;
      timestampMs?: number;
      nowMs?: number;
      nonce?: string;
      mutateSig?: boolean;
      pathAgentId?: string;
    } = {}
  ): Promise<{ status: number; json: unknown }> {
    const pathId = args.pathAgentId ?? world.agentId;
    const { headers, rawBody } = signTestRequest({
      agent: world.agent,
      agentId: args.agentId ?? world.agentId,
      missionId: world.agentId,
      method: 'POST',
      path: `/api/agents/${pathId}/heartbeat`,
      body: {},
      timestampMs: args.timestampMs,
      nonce: args.nonce,
    });
    if (args.mutateSig) {
      headers.set('x-succra-signature', Buffer.from(new Uint8Array(64).fill(9)).toString('base64'));
    }
    return handleHeartbeat({
      store,
      headers,
      method: 'POST',
      path: `/api/agents/${pathId}/heartbeat`,
      rawBody,
      agentPathId: pathId,
      nowMs: args.nowMs ?? Date.now(),
    }) as Promise<{ status: number; json: unknown }>;
  }

  it('records a heartbeat for a correctly signed request', async () => {
    const result = await heartbeat({ nowMs: Date.now() });
    expect(result.status).toEqual(200);
    const json = result.json as { agentId: string; lastHeartbeatAt: string };
    expect(json.agentId).toEqual(world.agentId);
    expect(Date.parse(json.lastHeartbeatAt)).toBeLessThanOrEqual(Date.now());
  });

  it('rejects stale and future timestamps', async () => {
    const now = Date.now();
    const stale = await heartbeat({ timestampMs: now - 61_000, nowMs: now });
    expect(stale.status).toEqual(401);
    const future = await heartbeat({ timestampMs: now + 61_000, nowMs: now });
    expect(future.status).toEqual(401);
    // Inside the window and past the rate-limit horizon: recorded.
    const later = now + 40_000;
    const edge = await heartbeat({ timestampMs: later - 59_000, nowMs: later });
    expect(edge.status).toEqual(200);
  });

  it('rejects wrong-key signatures', async () => {
    const result = await heartbeat({ mutateSig: true });
    expect(result.status).toEqual(401);
  });

  it('rejects replayed nonces', async () => {
    const now = Date.now() + 120_000;
    const nonce = randomUUID();
    const first = await heartbeat({ nonce, timestampMs: now, nowMs: now });
    expect(first.status).toEqual(200);
    const replay = await heartbeat({ nonce, timestampMs: now, nowMs: now });
    expect(replay.status).toEqual(401);
    expect((replay.json as { error: { code: string } }).error.code).toEqual('NONCE_REUSED');
  });

  it('rejects unknown agents, missing headers, and path mismatch', async () => {
    const unknown = await heartbeat({ agentId: randomUUID() });
    expect(unknown.status).toEqual(401);
    const missing = await handleHeartbeat({
      store,
      headers: new Headers(),
      method: 'POST',
      path: `/api/agents/${world.agentId}/heartbeat`,
      rawBody: '{}',
      agentPathId: world.agentId,
      nowMs: Date.now(),
    });
    expect(missing.status).toEqual(400);
    const mismatch = await heartbeat({ pathAgentId: randomUUID() });
    expect(mismatch.status).toEqual(403);
  });

  it('enforces the 30s heartbeat minimum interval, then recovers', async () => {
    // Main-world clock is already past +120s (replay test); use +300s so
    // the first call here records, +10s is too soon, +31s recovers.
    const base = Date.now() + 300_000;
    async function beat(atMs: number): Promise<{ status: number; json: unknown }> {
      const { headers, rawBody } = signTestRequest({
        agent: world.agent,
        agentId: world.agentId,
        missionId: world.agentId,
        method: 'POST',
        path: `/api/agents/${world.agentId}/heartbeat`,
        body: {},
        timestampMs: atMs,
      });
      return handleHeartbeat({
        store,
        headers,
        method: 'POST',
        path: `/api/agents/${world.agentId}/heartbeat`,
        rawBody,
        agentPathId: world.agentId,
        nowMs: atMs,
      }) as Promise<{ status: number; json: unknown }>;
    }
    expect((await beat(base)).status).toEqual(200);
    const tooSoon = await beat(base + 10_000);
    expect(tooSoon.status).toEqual(429);
    expect((tooSoon.json as { error: { code: string } }).error.code).toEqual('HEARTBEAT_TOO_SOON');
    expect((await beat(base + 31_000)).status).toEqual(200);
  });
});
