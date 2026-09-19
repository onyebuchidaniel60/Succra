// Gateway pre-flight tests (PGlite + fake chain, no validator).
//
// One shared world (PGlite init is slow); every approval uses a distinct
// agent nonce so the (mission_id, agent_nonce) slot never collides
// across tests. ALLOW returns the unsigned message (hash-stable,
// well-formed); every FR-03 family BLOCKs; duplicates return the
// original decision; nonce-slot conflicts yield an ephemeral STALE
// block; placeholder PDAs and non-PRIMARY assignments BLOCK without
// touching the chain.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToBase58, hashMessageBytes, inspectMessage, messageFromBase64 } from '@succra/shared';
import { handlePreflight } from '../lib/gateway/handlers.js';
import {
  makeFakeChain,
  makeTestAgent,
  makeTestFeePayer,
  preflightBody,
  seedWorld,
  signTestRequest,
  type FixtureWorld,
  type TestAgentKey,
} from './helpers/gateway-fixture.js';
import type { FakeChainOptions } from './helpers/gateway-fixture.js';

const PROGRAM_ID = 'SysvarC1ock11111111111111111111111111111111';

let nonceCounter = 100;

async function preflight(
  world: FixtureWorld,
  body: Record<string, unknown>,
  opts: { chain?: FakeChainOptions; agent?: TestAgentKey; agentId?: string } = {}
): Promise<{ status: number; json: unknown }> {
  const path = `/api/missions/${world.missionId}/actions`;
  const agent = opts.agent ?? world.agent;
  const { headers, rawBody } = signTestRequest({
    agent,
    agentId: opts.agentId ?? world.agentId,
    missionId: world.missionId,
    method: 'POST',
    path,
    body,
  });
  return handlePreflight({
    store: world.store,
    chain: makeFakeChain(world, opts.chain),
    feePayerAddress: makeTestFeePayer().base58,
    programId: PROGRAM_ID,
    headers,
    method: 'POST',
    path,
    rawBody,
    missionId: world.missionId,
    nowMs: Date.now(),
  }) as Promise<{ status: number; json: unknown }>;
}

function nextBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nonceCounter += 1;
  return preflightBody({ agentNonce: String(nonceCounter), ...overrides });
}

function bytes58(fill: number): string {
  return bytesToBase58(new Uint8Array(32).fill(fill));
}

describe('pre-flight', () => {
  let world: FixtureWorld;

  beforeAll(async () => {
    world = await seedWorld({});
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('ALLOW returns a well-formed unsigned message and stores its hash', async () => {
    const key = randomUUID();
    const result = await preflight(world, nextBody({ idempotencyKey: key }));
    expect(result.status).toEqual(200);
    const json = result.json as {
      decision: string;
      requestId: string;
      unsignedTransaction: string;
      expiresAt: string;
    };
    expect(json.decision).toEqual('ALLOW');
    const messageBytes = messageFromBase64(json.unsignedTransaction);
    const view = inspectMessage(messageBytes);
    expect(view.instructions.length).toEqual(1);
    expect(view.signerAddresses.length).toEqual(2);
    const row = await world.store.getActionById(json.requestId);
    expect(row?.decision).toEqual('APPROVED');
    expect(row?.unsigned_tx_hash).toEqual(hashMessageBytes(messageBytes));
    expect(row?.unsigned_tx_b64).toEqual(json.unsignedTransaction);
    expect(row?.violation_count_after).toBeNull();
  });

  it('BLOCKs each FR-03 family without building a transaction', async () => {
    const cases: Array<{ name: string; body: Record<string, unknown>; code: string }> = [
      {
        name: 'amount over max',
        body: nextBody({ amountAtomic: '6000000' }),
        code: 'POLICY_BLOCKED',
      },
      {
        name: 'unknown recipient',
        body: nextBody({ recipient: bytes58(99) }),
        code: 'POLICY_BLOCKED',
      },
      {
        name: 'expired',
        body: nextBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
        code: 'REQUEST_EXPIRED',
      },
    ];
    for (const { name, body, code } of cases) {
      const result = await preflight(world, body);
      expect(result.status, name).toEqual(200);
      const json = result.json as { decision: string; reasonCode: string; requestId: string };
      expect(json.decision, name).toEqual('BLOCK');
      expect(json.reasonCode, name).toEqual(code);
      const row = await world.store.getActionById(json.requestId);
      expect(row?.unsigned_tx_hash, name).toBeNull();
    }
    // Non-current agent (chain state disagrees with the signer).
    const notCurrent = await preflight(world, nextBody({}), {
      chain: { currentAgent: bytes58(98) },
    });
    expect((notCurrent.json as { reasonCode: string }).reasonCode).toEqual('AGENT_NOT_CURRENT');
  });

  it('BLOCKs non-PRIMARY assignments without touching the chain', async () => {
    const successorKey = makeTestAgent();
    const successor = await world.store.insertAgent({
      owner_id: world.ownerId,
      name: 'successor',
      public_key: successorKey.base58,
      status: 'ACTIVE_PRIMARY',
    });
    await world.store.insertAssignment({
      mission_id: world.missionId,
      agent_id: successor.id,
      role: 'SUCCESSOR',
    });
    const path = `/api/missions/${world.missionId}/actions`;
    const body = nextBody({});
    const { headers, rawBody } = signTestRequest({
      agent: successorKey,
      agentId: successor.id,
      missionId: world.missionId,
      method: 'POST',
      path,
      body,
    });
    const result = await handlePreflight({
      store: world.store,
      chain: makeFakeChain(world),
      feePayerAddress: makeTestFeePayer().base58,
      programId: PROGRAM_ID,
      headers,
      method: 'POST',
      path,
      rawBody,
      missionId: world.missionId,
      nowMs: Date.now(),
    });
    expect((result.json as { decision: string; reasonCode: string }).decision).toEqual('BLOCK');
    expect((result.json as { decision: string; reasonCode: string }).reasonCode).toEqual(
      'AGENT_NOT_CURRENT'
    );
  });

  it('duplicate idempotency keys return the ORIGINAL decision and bytes', async () => {
    const key = randomUUID();
    const first = await preflight(world, nextBody({ idempotencyKey: key }));
    const firstJson = first.json as {
      decision: string;
      requestId: string;
      unsignedTransaction: string;
    };
    expect(firstJson.decision).toEqual('ALLOW');
    // Same key, wildly different body: original wins, no new row.
    nonceCounter += 1;
    const second = await preflight(
      world,
      preflightBody({
        idempotencyKey: key,
        amountAtomic: '2000000',
        agentNonce: String(nonceCounter),
      })
    );
    const secondJson = second.json as {
      decision: string;
      requestId: string;
      unsignedTransaction: string;
    };
    expect(secondJson.decision).toEqual('ALLOW');
    expect(secondJson.requestId).toEqual(firstJson.requestId);
    expect(secondJson.unsignedTransaction).toEqual(firstJson.unsignedTransaction);

    // Duplicate of a BLOCK returns the original BLOCK.
    const blockKey = randomUUID();
    const blocked = await preflight(
      world,
      nextBody({ idempotencyKey: blockKey, amountAtomic: '6000000' })
    );
    const blockedJson = blocked.json as { decision: string; requestId: string };
    expect(blockedJson.decision).toEqual('BLOCK');
    nonceCounter += 1;
    const blockedAgain = await preflight(
      world,
      preflightBody({
        idempotencyKey: blockKey,
        amountAtomic: '1',
        agentNonce: String(nonceCounter),
      })
    );
    const blockedAgainJson = blockedAgain.json as {
      decision: string;
      requestId: string;
      reasonCode: string;
    };
    expect(blockedAgainJson.decision).toEqual('BLOCK');
    expect(blockedAgainJson.requestId).toEqual(blockedJson.requestId);
  });

  it('reused agent nonces with fresh keys yield an ephemeral STALE block', async () => {
    const first = await preflight(world, preflightBody({ agentNonce: '5' }));
    expect((first.json as { decision: string }).decision).toEqual('ALLOW');
    const second = await preflight(world, preflightBody({ agentNonce: '5' }));
    const json = second.json as { decision: string; reasonCode: string; requestId: string };
    expect(json.decision).toEqual('BLOCK');
    expect(json.reasonCode).toEqual('STALE_AGENT_NONCE');
    expect(await world.store.getActionById(json.requestId)).toBeNull();
  });

  it('placeholder PDAs BLOCK MISSION_NOT_ACTIVE without chain state', async () => {
    const result = await preflight(world, nextBody({}), { chain: { missingMission: true } });
    const json = result.json as { decision: string; reasonCode: string };
    expect(json.decision).toEqual('BLOCK');
    expect(json.reasonCode).toEqual('MISSION_NOT_ACTIVE');
  });

  it('rejects unauthenticated and malformed pre-flights', async () => {
    const path = `/api/missions/${world.missionId}/actions`;
    const { headers, rawBody } = signTestRequest({
      agent: world.agent,
      agentId: world.agentId,
      missionId: world.missionId,
      method: 'POST',
      path,
      body: nextBody({}),
    });
    const tampered = new Headers(headers);
    tampered.set('x-succra-signature', Buffer.from(new Uint8Array(64).fill(1)).toString('base64'));
    const badSig = await handlePreflight({
      store: world.store,
      chain: makeFakeChain(world),
      feePayerAddress: makeTestFeePayer().base58,
      programId: PROGRAM_ID,
      headers: tampered,
      method: 'POST',
      path,
      rawBody,
      missionId: world.missionId,
      nowMs: Date.now(),
    });
    expect(badSig.status).toEqual(401);
    const badBody = await handlePreflight({
      store: world.store,
      chain: makeFakeChain(world),
      feePayerAddress: makeTestFeePayer().base58,
      programId: PROGRAM_ID,
      headers,
      method: 'POST',
      path,
      rawBody: JSON.stringify({ nonsense: true }),
      missionId: world.missionId,
      nowMs: Date.now(),
    });
    expect(badBody.status).toEqual(400);
  });
});
