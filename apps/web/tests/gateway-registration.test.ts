// Gateway registration tests: attach, challenge, verify (PGlite, no chain).
import { randomUUID } from 'node:crypto';
import { sign as naclSign } from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToBase58, bytesToBase64 } from '@succra/shared';
import {
  handleAttachAgent,
  handleIssueChallenge,
  handleVerifyChallenge,
} from '../lib/gateway/handlers';
import { createGatewayTestDb } from './helpers/pglite-gateway-store';
import { makeTestAgent, seedWorld } from './helpers/gateway-fixture';
import type { PGlite } from '@electric-sql/pglite';
import type { PGliteGatewayStore } from './helpers/pglite-gateway-store';

describe('agent registration', () => {
  let db: PGlite;
  let store: PGliteGatewayStore;
  let ownerId: string;
  let missionId: string;

  beforeAll(async () => {
    const world = await seedWorld({});
    db = world.db;
    store = world.store;
    ownerId = world.ownerId;
    missionId = world.missionId;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it('attaches a new agent PRIMARY (201) and re-attach returns existing (200)', async () => {
    const key = makeTestAgent();
    const first = await handleAttachAgent({
      store,
      ownerId,
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'beta', role: 'PRIMARY' }),
    });
    expect(first.status).toEqual(201);
    const firstJson = first.json as { agentId: string; status: string };
    expect(firstJson.status).toEqual('REGISTERED');
    const second = await handleAttachAgent({
      store,
      ownerId,
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'beta', role: 'PRIMARY' }),
    });
    expect(second.status).toEqual(200);
    expect((second.json as { agentId: string }).agentId).toEqual(firstJson.agentId);
  });

  it('rejects attach for unknown missions, foreign owners, and bad keys', async () => {
    const key = makeTestAgent();
    const missing = await handleAttachAgent({
      store,
      ownerId,
      missionId: randomUUID(),
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'x' }),
    });
    expect(missing.status).toEqual(404);
    const foreign = await handleAttachAgent({
      store,
      ownerId: randomUUID(),
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'x' }),
    });
    expect(foreign.status).toEqual(403);
    const badKey = await handleAttachAgent({
      store,
      ownerId,
      missionId,
      rawBody: JSON.stringify({ publicKey: 'not-an-address', name: 'x' }),
    });
    expect(badKey.status).toEqual(400);
    const noSession = await handleAttachAgent({
      store,
      ownerId: null,
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'x' }),
    });
    expect(noSession.status).toEqual(401);
  });

  it('challenge -> sign -> verify activates the agent (VERIFIED response, ACTIVE_PRIMARY row)', async () => {
    const key = makeTestAgent();
    const attached = await handleAttachAgent({
      store,
      ownerId,
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'gamma' }),
    });
    const agentId = (attached.json as { agentId: string }).agentId;
    const issued = await handleIssueChallenge({
      store,
      ownerId,
      agentId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(issued.status).toEqual(200);
    const { challenge } = issued.json as { challenge: string; expiresAt: string };
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    const signature = bytesToBase64(
      naclSign.detached(Buffer.from(challenge, 'hex'), key.secretKey)
    );
    const verified = await handleVerifyChallenge({
      store,
      ownerId,
      agentId,
      rawBody: JSON.stringify({ challenge, signature }),
      nowMs: Date.now(),
    });
    expect(verified.status).toEqual(200);
    expect(verified.json).toEqual({ agentId, status: 'VERIFIED' });
    const row = await store.getAgentById(agentId);
    expect(row?.status).toEqual('ACTIVE_PRIMARY');
  });

  it('rejects unknown, reused, expired, and mis-signed challenges', async () => {
    const key = makeTestAgent();
    const attached = await handleAttachAgent({
      store,
      ownerId,
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'delta' }),
    });
    const agentId = (attached.json as { agentId: string }).agentId;
    const unknown = await handleVerifyChallenge({
      store,
      ownerId,
      agentId,
      rawBody: JSON.stringify({
        challenge: 'ab'.repeat(32),
        signature: bytesToBase64(new Uint8Array(64)),
      }),
      nowMs: Date.now(),
    });
    expect(unknown.status).toEqual(401);

    const issued = await handleIssueChallenge({
      store,
      ownerId,
      agentId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    const { challenge } = issued.json as { challenge: string };
    const good = bytesToBase64(naclSign.detached(Buffer.from(challenge, 'hex'), key.secretKey));
    const wrongKey = makeTestAgent();
    const badSig = await handleVerifyChallenge({
      store,
      ownerId,
      agentId,
      rawBody: JSON.stringify({
        challenge,
        signature: bytesToBase64(
          naclSign.detached(Buffer.from(challenge, 'hex'), wrongKey.secretKey)
        ),
      }),
      nowMs: Date.now(),
    });
    expect(badSig.status).toEqual(401);
    expect(good.length).toBeGreaterThan(0);

    // Reuse: consume once, then replay the same challenge.
    const first = await handleVerifyChallenge({
      store,
      ownerId,
      agentId,
      rawBody: JSON.stringify({ challenge, signature: good }),
      nowMs: Date.now(),
    });
    expect(first.status).toEqual(200);
    const replay = await handleVerifyChallenge({
      store,
      ownerId,
      agentId,
      rawBody: JSON.stringify({ challenge, signature: good }),
      nowMs: Date.now(),
    });
    expect(replay.status).toEqual(401);

    // Expired: issue then verify 6 minutes later.
    const issued2 = await handleIssueChallenge({
      store,
      ownerId,
      agentId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    const challenge2 = (issued2.json as { challenge: string }).challenge;
    const sig2 = bytesToBase64(naclSign.detached(Buffer.from(challenge2, 'hex'), key.secretKey));
    const expired = await handleVerifyChallenge({
      store,
      ownerId,
      agentId,
      rawBody: JSON.stringify({ challenge: challenge2, signature: sig2 }),
      nowMs: Date.now() + 6 * 60_000,
    });
    expect(expired.status).toEqual(401);
    expect((expired.json as { error: { code: string } }).error.code).toEqual('CHALLENGE_EXPIRED');
  });

  it('challenge issue requires the owning session', async () => {
    const key = makeTestAgent();
    const attached = await handleAttachAgent({
      store,
      ownerId,
      missionId,
      rawBody: JSON.stringify({ publicKey: key.base58, name: 'eps' }),
    });
    const agentId = (attached.json as { agentId: string }).agentId;
    const foreign = await handleIssueChallenge({
      store,
      ownerId: randomUUID(),
      agentId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(foreign.status).toEqual(403);
    expect(bytesToBase58(key.publicKey)).toEqual(key.base58);
  });
});

describe('challenge store hygiene', () => {
  it('creates the agent_challenges table via migration', async () => {
    const db = await createGatewayTestDb();
    try {
      const result = await db.query(`SELECT to_regclass('public.agent_challenges') AS cls`);
      expect((result.rows[0] as { cls: string }).cls).toEqual('agent_challenges');
    } finally {
      await db.close();
    }
  }, 120_000);
});
