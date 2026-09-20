// FR-04 streak unit tests (pure) + counting rules against PGlite.
// Proves: edge-trigger fires exactly once; CONFIRMED resets; old
// violations drop out of the window; unauthenticated and non-current
// traffic never counts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateStreak, streakWindowStartMs } from '../lib/gateway/streak.js';
import { handlePreflight } from '../lib/gateway/handlers.js';
import {
  makeFakeChain,
  preflightBody,
  seedWorld,
  signTestRequest,
  type FixtureWorld,
} from './helpers/gateway-fixture.js';

const PROGRAM_ID = 'SysvarC1ock11111111111111111111111111111111';

let nonceCounter = 5000;

async function preflight(
  world: FixtureWorld,
  body: Record<string, unknown>,
  chainOpts: Record<string, unknown> = {},
  rawHeaders?: { headers: Headers; rawBody: string }
): Promise<{ status: number; json: unknown }> {
  const path = `/api/missions/${world.missionId}/actions`;
  const signed =
    rawHeaders ??
    signTestRequest({
      agent: world.agent,
      agentId: world.agentId,
      missionId: world.missionId,
      method: 'POST',
      path,
      body,
    });
  return handlePreflight({
    store: world.store,
    chain: makeFakeChain(world, chainOpts),
    feePayerAddress: PROGRAM_ID,
    programId: PROGRAM_ID,
    headers: signed.headers,
    method: 'POST',
    path,
    rawBody: signed.rawBody,
    missionId: world.missionId,
    nowMs: Date.now(),
  }) as Promise<{ status: number; json: unknown }>;
}

function blockedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nonceCounter += 1;
  // Over-max amount: POLICY_BLOCKED, always counted when stored.
  return preflightBody({ agentNonce: String(nonceCounter), amountAtomic: '6000000', ...overrides });
}

describe('evaluateStreak (pure)', () => {
  it('fires only on the crossing edge', () => {
    expect(evaluateStreak({ blockedSinceReset: 0, threshold: 3 })).toEqual({
      streakAfter: 1,
      crossed: false,
    });
    expect(evaluateStreak({ blockedSinceReset: 2, threshold: 3 })).toEqual({
      streakAfter: 3,
      crossed: true,
    });
    // Fourth and later violations do not re-fire.
    expect(evaluateStreak({ blockedSinceReset: 3, threshold: 3 })).toEqual({
      streakAfter: 4,
      crossed: false,
    });
  });

  it('bounds the window by the CONFIRMED reset when newer', () => {
    const now = 1_000_000;
    expect(
      streakWindowStartMs({ nowMs: now, windowSeconds: 900n, lastConfirmedAtMs: null })
    ).toEqual(now - 900_000);
    expect(
      streakWindowStartMs({ nowMs: now, windowSeconds: 900n, lastConfirmedAtMs: now - 100_000 })
    ).toEqual(now - 100_000);
    expect(
      streakWindowStartMs({ nowMs: now, windowSeconds: 900n, lastConfirmedAtMs: now - 9_000_000 })
    ).toEqual(now - 900_000);
  });
});

describe('streak counting rules', () => {
  let world: FixtureWorld;

  beforeAll(async () => {
    world = await seedWorld({});
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('counts POLICY_BLOCKED rows with the streak on the row', async () => {
    const first = await preflight(world, blockedBody());
    const firstJson = first.json as { decision: string; requestId: string };
    expect(firstJson.decision).toEqual('BLOCK');
    const row = await world.store.getActionById(firstJson.requestId);
    expect(row?.decision_reason_code).toEqual('POLICY_BLOCKED');
    expect(row?.violation_count_after).toEqual(1);
    const second = await preflight(world, blockedBody());
    const secondRow = await world.store.getActionById(
      (second.json as { requestId: string }).requestId
    );
    expect(secondRow?.violation_count_after).toEqual(2);
  });

  it('unauthenticated requests never count', async () => {
    const path = `/api/missions/${world.missionId}/actions`;
    const before = await world.store.countPolicyBlockedSince(
      world.missionId,
      world.agentId,
      'POLICY_BLOCKED',
      new Date(0).toISOString()
    );
    const result = await handlePreflight({
      store: world.store,
      chain: makeFakeChain(world, {}),
      feePayerAddress: PROGRAM_ID,
      programId: PROGRAM_ID,
      headers: new Headers({ 'content-type': 'application/json' }),
      method: 'POST',
      path,
      rawBody: JSON.stringify(blockedBody()),
      missionId: world.missionId,
      nowMs: Date.now(),
    });
    expect(result.status).toEqual(400);
    const after = await world.store.countPolicyBlockedSince(
      world.missionId,
      world.agentId,
      'POLICY_BLOCKED',
      new Date(0).toISOString()
    );
    expect(after).toEqual(before);
  });

  it('non-current-agent blocks do not count', async () => {
    const other = '11111111111111111111111111111111';
    const result = await preflight(world, blockedBody(), { currentAgent: other });
    const json = result.json as { decision: string; reasonCode: string; requestId: string };
    expect(json.decision).toEqual('BLOCK');
    expect(json.reasonCode).toEqual('AGENT_NOT_CURRENT');
    const row = await world.store.getActionById(json.requestId);
    expect(row?.violation_count_after).toBeNull();
  });

  it('a CONFIRMED action resets the streak', async () => {
    // Two counted blocks so far in this world (streak 2 from the first test
    // run in file order plus none from the non-counting tests above).
    const approved = await world.store.insertAction({
      mission_id: world.missionId,
      agent_id: world.agentId,
      idempotency_key: randomUUID(),
      agent_nonce: 9500,
      action_type: 'TRANSFER_SOL',
      payload: {},
      request_hash: 'h',
      signature: 's',
      decision: 'APPROVED',
      decision_reason_code: null,
      violation_count_after: null,
      unsigned_tx_hash: null,
      unsigned_tx_b64: null,
      expires_at: null,
    });
    if (!('inserted' in approved)) throw new Error('approved seed failed');
    const tx = await world.store.insertOnchainTx({
      mission_id: world.missionId,
      action_request_id: approved.inserted.id,
      signature: `sig-${randomUUID()}`,
      status: 'SUBMITTED',
    });
    if (!('inserted' in tx)) throw new Error('tx seed failed');
    await world.store.updateOnchainTxConfirmed(tx.inserted.signature, 99, new Date().toISOString());
    const next = await preflight(world, blockedBody());
    const row = await world.store.getActionById((next.json as { requestId: string }).requestId);
    // Everything before the CONFIRMED action dropped: streak restarts at 1.
    expect(row?.violation_count_after).toEqual(1);
  });

  it('violations older than the window do not count', { timeout: 120_000 }, async () => {
    // Self-contained world: one stale counted row must not contribute.
    const fresh = await seedWorld({});
    try {
      const stale = await fresh.store.insertAction({
        mission_id: fresh.missionId,
        agent_id: fresh.agentId,
        idempotency_key: randomUUID(),
        agent_nonce: 9600,
        action_type: 'TRANSFER_SOL',
        payload: {},
        request_hash: 'h',
        signature: 's',
        decision: 'BLOCKED',
        decision_reason_code: 'POLICY_BLOCKED',
        violation_count_after: 7,
        unsigned_tx_hash: null,
        unsigned_tx_b64: null,
        expires_at: null,
      });
      if (!('inserted' in stale)) throw new Error('stale seed failed');
      await fresh.db.query(`UPDATE action_requests SET created_at = $2 WHERE id = $1`, [
        stale.inserted.id,
        new Date(Date.now() - 2 * 3600_000).toISOString(),
      ] as unknown[]);
      const path = `/api/missions/${fresh.missionId}/actions`;
      const body = blockedBody();
      const { headers, rawBody } = signTestRequest({
        agent: fresh.agent,
        agentId: fresh.agentId,
        missionId: fresh.missionId,
        method: 'POST',
        path,
        body,
      });
      const next = (await handlePreflight({
        store: fresh.store,
        chain: makeFakeChain(fresh, {}),
        feePayerAddress: PROGRAM_ID,
        programId: PROGRAM_ID,
        headers,
        method: 'POST',
        path,
        rawBody,
        missionId: fresh.missionId,
        nowMs: Date.now(),
      })) as { status: number; json: unknown };
      const row = await fresh.store.getActionById((next.json as { requestId: string }).requestId);
      // The 2-hour-old row is outside the 900s window: fresh streak of 1.
      expect(row?.violation_count_after).toEqual(1);
    } finally {
      await fresh.db.close();
    }
  });
});
