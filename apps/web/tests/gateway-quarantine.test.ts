// Gateway quarantine tests (PGlite + fake chain, no validator).
// Proves: three authenticated policy violations trigger exactly one
// quarantine; the agent is blocked afterwards; manual quarantine works
// for owner and guardian credential; quarantine is idempotent; audit
// rows are written for counted/threshold/submitted/confirmed; the
// guardian path moves no funds (single quarantine instruction only).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sign as naclSign } from 'tweetnacl';
import { base64ToBytes, bytesToBase58, inspectMessage, parseWireTransaction } from '@succra/shared';
import { handlePreflight, handleQuarantine } from '../lib/gateway/handlers.js';
import {
  makeFakeChain,
  makeTestFeePayer,
  preflightBody,
  seedWorld,
  signTestRequest,
  type FixtureWorld,
} from './helpers/gateway-fixture.js';
import type { FeePayer } from '../lib/gateway/chain.js';

const PROGRAM_ID = 'SysvarC1ock11111111111111111111111111111111';
const CREDENTIAL = 'test-guardian-credential';

let nonceCounter = 8000;

function makeGuardian(): { address: string; guardian: FeePayer } {
  const pair = naclSign.keyPair();
  const address = bytesToBase58(pair.publicKey);
  return {
    address,
    guardian: {
      address,
      signBytes: (message: Uint8Array): Uint8Array => naclSign.detached(message, pair.secretKey),
    },
  };
}

async function preflight(
  world: FixtureWorld,
  guardian: FeePayer | undefined,
  body: Record<string, unknown>,
  chainOpts: Record<string, unknown> = {}
): Promise<{ status: number; json: unknown }> {
  const path = `/api/missions/${world.missionId}/actions`;
  const { headers, rawBody } = signTestRequest({
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
    feePayerAddress: makeTestFeePayer().base58,
    programId: PROGRAM_ID,
    ...(guardian !== undefined ? { guardian } : {}),
    headers,
    method: 'POST',
    path,
    rawBody,
    missionId: world.missionId,
    nowMs: Date.now(),
  }) as Promise<{ status: number; json: unknown }>;
}

function blockedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  nonceCounter += 1;
  return preflightBody({ agentNonce: String(nonceCounter), amountAtomic: '6000000', ...overrides });
}

async function auditTypes(world: FixtureWorld): Promise<string[]> {
  const rows = await world.db.query(
    'SELECT event_type FROM audit_events WHERE mission_id = $1 ORDER BY created_at ASC',
    [world.missionId] as unknown[]
  );
  return rows.rows.map((row) => String((row as Record<string, unknown>)['event_type']));
}

describe('quarantine trigger', () => {
  let world: FixtureWorld;
  let guardian: FeePayer;

  beforeAll(async () => {
    world = await seedWorld({});
    ({ guardian } = makeGuardian());
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('three authenticated policy violations trigger exactly one quarantine', async () => {
    const first = await preflight(world, guardian, blockedBody());
    expect((first.json as { decision: string }).decision).toEqual('BLOCK');
    const second = await preflight(world, guardian, blockedBody());
    expect((second.json as { decision: string }).decision).toEqual('BLOCK');
    let mission = await world.store.getMissionById(world.missionId);
    expect(mission?.status).toEqual('ACTIVE');
    const third = await preflight(world, guardian, blockedBody());
    expect((third.json as { decision: string }).decision).toEqual('BLOCK');
    mission = await world.store.getMissionById(world.missionId);
    expect(mission?.status).toEqual('QUARANTINED');
    // Exactly one quarantine submission happened (edge-trigger, once).
    const submitted = await world.db.query(
      `SELECT COUNT(*)::int AS n FROM audit_events
       WHERE mission_id = $1 AND event_type = 'quarantine.submitted'`,
      [world.missionId] as unknown[]
    );
    expect(Number((submitted.rows[0] as Record<string, unknown>)['n'])).toEqual(1);
    const types = await auditTypes(world);
    // Same-ms inserts make created_at order unstable; compare as a multiset.
    expect([...types].sort()).toEqual(
      [
        'violation.counted',
        'violation.counted',
        'violation.counted',
        'violation.threshold_reached',
        'quarantine.submitted',
        'quarantine.confirmed',
      ].sort()
    );
  });

  it('the agent cannot execute after quarantine', async () => {
    const result = await preflight(world, guardian, blockedBody(), { status: 'Quarantined' });
    const json = result.json as { decision: string; reasonCode: string };
    expect(json.decision).toEqual('BLOCK');
    expect(json.reasonCode).toEqual('MISSION_QUARANTINED');
  });

  it('quarantine is idempotent: no double submission, no double audit', async () => {
    const before = await world.db.query(
      `SELECT COUNT(*)::int AS n FROM audit_events
       WHERE mission_id = $1 AND event_type IN ('quarantine.submitted', 'quarantine.confirmed')`,
      [world.missionId] as unknown[]
    );
    const beforeN = Number((before.rows[0] as Record<string, unknown>)['n']);
    const again = await handleQuarantine({
      store: world.store,
      chain: makeFakeChain(world, { status: 'Quarantined' }),
      guardian,
      programId: PROGRAM_ID,
      ownerId: world.ownerId,
      guardianCredentialHeader: null,
      expectedGuardianCredential: CREDENTIAL,
      missionId: world.missionId,
      rawBody: '{}',
      nowMs: Date.now(),
    });
    expect(again.status).toEqual(200);
    expect((again.json as { status: string }).status).toEqual('ALREADY_QUARANTINED');
    const after = await world.db.query(
      `SELECT COUNT(*)::int AS n FROM audit_events
       WHERE mission_id = $1 AND event_type IN ('quarantine.submitted', 'quarantine.confirmed')`,
      [world.missionId] as unknown[]
    );
    expect(Number((after.rows[0] as Record<string, unknown>)['n'])).toEqual(beforeN);
  });

  it(
    'the guardian path moves no funds: single quarantine instruction only',
    { timeout: 120_000 },
    async () => {
      // Re-run the trigger flow on a fresh world and inspect the one sent tx.
      const fresh = await seedWorld({});
      try {
        const { guardian: freshGuardian } = makeGuardian();
        const chain = makeFakeChain(fresh, {});
        await preflight(fresh, freshGuardian, blockedBody());
        await preflight(fresh, freshGuardian, blockedBody());
        // Point the helper at the fresh world for the third (triggering) call.
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
        await handlePreflight({
          store: fresh.store,
          chain,
          feePayerAddress: makeTestFeePayer().base58,
          programId: PROGRAM_ID,
          guardian: freshGuardian,
          headers,
          method: 'POST',
          path,
          rawBody,
          missionId: fresh.missionId,
          nowMs: Date.now(),
        });
        expect(chain.sent.length).toEqual(1);
        const parsed = parseWireTransaction(base64ToBytes(chain.sent[0] as string));
        expect(parsed.signatures.length).toEqual(1);
        const view = inspectMessage(parsed.messageBytes);
        expect(view.signerAddresses).toEqual([freshGuardian.address]);
        expect(view.instructions.length).toEqual(1);
        const ix = view.instructions[0];
        expect(ix).toBeDefined();
        if (!ix) throw new Error('unreachable');
        expect(ix.programAddress).toEqual(PROGRAM_ID);
        expect(ix.data.length).toEqual(8);
        // Guardian signs slot 0 (fee payer + authority); the mission is the
        // only other account and the only writable non-signer. No vault,
        // system, or token accounts exist on this instruction.
        expect(ix.accounts).toEqual([
          { address: freshGuardian.address, role: 'writable-signer' },
          { address: fresh.missionPda, role: 'writable' },
        ]);
      } finally {
        await fresh.db.close();
      }
    }
  );
});

describe('manual quarantine auth', () => {
  let world: FixtureWorld;
  let guardian: FeePayer;

  beforeAll(async () => {
    world = await seedWorld({});
    ({ guardian } = makeGuardian());
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  function call(args: {
    ownerId?: string | null;
    credential?: string | null;
    missionId?: string;
  }): Promise<{ status: number; json: unknown }> {
    return handleQuarantine({
      store: world.store,
      chain: makeFakeChain(world, {}),
      guardian,
      programId: PROGRAM_ID,
      ownerId: args.ownerId ?? null,
      guardianCredentialHeader: args.credential ?? null,
      expectedGuardianCredential: CREDENTIAL,
      missionId: args.missionId ?? world.missionId,
      rawBody: '{}',
      nowMs: Date.now(),
    }) as Promise<{ status: number; json: unknown }>;
  }

  it('rejects unauthenticated callers', async () => {
    const result = await call({});
    expect(result.status).toEqual(401);
  });

  it('rejects wrong-owner sessions and wrong credentials', async () => {
    const foreign = await call({ ownerId: randomUUID() });
    expect(foreign.status).toEqual(403);
    const badCred = await call({ credential: 'wrong' });
    expect(badCred.status).toEqual(401);
  });

  it('owner session quarantines', async () => {
    const result = await call({ ownerId: world.ownerId });
    expect(result.status).toEqual(200);
    expect((result.json as { status: string }).status).toEqual('QUARANTINED');
    expect((result.json as { signature: string }).signature.length).toBeGreaterThan(10);
  });

  it(
    'guardian credential quarantines and rejects unknown missions',
    { timeout: 120_000 },
    async () => {
      const fresh = await seedWorld({});
      try {
        const { guardian: freshGuardian } = makeGuardian();
        const result = await handleQuarantine({
          store: fresh.store,
          chain: makeFakeChain(fresh, {}),
          guardian: freshGuardian,
          programId: PROGRAM_ID,
          ownerId: null,
          guardianCredentialHeader: CREDENTIAL,
          expectedGuardianCredential: CREDENTIAL,
          missionId: fresh.missionId,
          rawBody: '{}',
          nowMs: Date.now(),
        });
        expect(result.status).toEqual(200);
        expect((result.json as { status: string }).status).toEqual('QUARANTINED');
        const missing = await handleQuarantine({
          store: fresh.store,
          chain: makeFakeChain(fresh, {}),
          guardian: freshGuardian,
          programId: PROGRAM_ID,
          ownerId: null,
          guardianCredentialHeader: CREDENTIAL,
          expectedGuardianCredential: CREDENTIAL,
          missionId: randomUUID(),
          rawBody: '{}',
          nowMs: Date.now(),
        });
        expect(missing.status).toEqual(404);
      } finally {
        await fresh.db.close();
      }
    }
  );
});
