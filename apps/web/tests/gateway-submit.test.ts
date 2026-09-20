// Gateway submit tests (PGlite + fake chain, no validator).
//
// One shared world; every approval uses a distinct agent nonce.
// CONFIRMED (row + slot + DB mirror), FAILED (chain rejection, no
// mirror, no violation counting), TRANSACTION_MISMATCH,
// TRANSACTION_EXPIRED (row not consumed), ALREADY_SUBMITTED,
// ACTION_NOT_APPROVED, bad agent signatures, fee-payer slot overwrite,
// send-throw reconciliation (landed vs lost), poll resume, and
// confirmation timeout with resume.
import { randomUUID } from 'node:crypto';
import { sign as naclSign } from 'tweetnacl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase58,
  bytesToBase64,
  emptySignature,
  encodeWireTransaction,
  hashMessageBytes,
  inspectMessage,
  messageFromBase64,
  parseWireTransaction,
} from '@succra/shared';
import { handlePreflight, handleSubmit } from '../lib/gateway/handlers.js';
import {
  makeFakeChain,
  makeTestAgent,
  makeTestFeePayer,
  preflightBody,
  seedWorld,
  signTestRequest,
  type FixtureWorld,
} from './helpers/gateway-fixture.js';
import type { ChainGateway } from '../lib/gateway/chain.js';

const PROGRAM_ID = 'SysvarC1ock11111111111111111111111111111111';

let nonceCounter = 1000;

interface ApprovedRequest {
  requestId: string;
  unsignedTransaction: string;
  messageBytes: Uint8Array;
}

/** Pre-flight an ALLOW through the handler (fake chain). */
async function approve(
  world: FixtureWorld,
  chain: ChainGateway,
  feePayerAddress: string,
  nonce: string,
  body: Record<string, unknown> = {}
): Promise<ApprovedRequest> {
  const path = `/api/missions/${world.missionId}/actions`;
  const fullBody = preflightBody({ agentNonce: nonce, ...body });
  const { headers, rawBody } = signTestRequest({
    agent: world.agent,
    agentId: world.agentId,
    missionId: world.missionId,
    method: 'POST',
    path,
    body: fullBody,
  });
  const result = await handlePreflight({
    store: world.store,
    chain,
    feePayerAddress,
    programId: PROGRAM_ID,
    headers,
    method: 'POST',
    path,
    rawBody,
    missionId: world.missionId,
    nowMs: Date.now(),
  });
  const json = result.json as { decision: string; requestId: string; unsignedTransaction: string };
  expect(json.decision).toEqual('ALLOW');
  const messageBytes = messageFromBase64(json.unsignedTransaction);
  return { requestId: json.requestId, unsignedTransaction: json.unsignedTransaction, messageBytes };
}

/** Agent-side signing exactly like the SDK: zeros slot, agent signs. */
function agentSign(
  messageBytes: Uint8Array,
  agent: { secretKey: Uint8Array; base58: string }
): string {
  const view = inspectMessage(messageBytes);
  const signature = naclSign.detached(messageBytes, agent.secretKey);
  const sigs = view.signerAddresses.map((signer) =>
    signer === agent.base58 ? signature : emptySignature()
  );
  return bytesToBase64(encodeWireTransaction(sigs, messageBytes));
}

async function submit(
  world: FixtureWorld,
  chain: ChainGateway,
  feePayer: { address: string; signBytes: (m: Uint8Array) => Uint8Array },
  requestId: string,
  signedTransaction: string,
  missionId?: string,
  poll?: { intervalMs: number; timeoutMs: number }
): Promise<{ status: number; json: unknown }> {
  const target = missionId ?? world.missionId;
  const path = `/api/missions/${target}/actions/${requestId}/submit`;
  const body = { signedTransaction };
  const { headers, rawBody } = signTestRequest({
    agent: world.agent,
    agentId: world.agentId,
    missionId: target,
    method: 'POST',
    path,
    body,
  });
  return handleSubmit({
    store: world.store,
    chain,
    feePayer: { address: feePayer.address, signBytes: feePayer.signBytes },
    headers,
    method: 'POST',
    path,
    rawBody,
    missionId: target,
    requestId,
    nowMs: Date.now(),
    ...(poll !== undefined ? { poll } : {}),
  }) as Promise<{ status: number; json: unknown }>;
}

function nextNonce(): string {
  nonceCounter += 1;
  return String(nonceCounter);
}

describe('submit', () => {
  let world: FixtureWorld;

  beforeAll(async () => {
    world = await seedWorld({});
  }, 120_000);

  afterAll(async () => {
    await world.db.close();
  });

  it('CONFIRMED writes the row, slot, and DB mirror', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world, { remainingBudget: 49_000_000n });
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    const result = await submit(world, chain, feePayer.feePayer, approved.requestId, signed);
    expect(result.status).toEqual(200);
    const json = result.json as {
      decision: string;
      requestId: string;
      signature: string;
      slot: number;
      status: string;
    };
    expect(json.decision).toEqual('ALLOW');
    expect(json.status).toEqual('CONFIRMED');
    expect(json.slot).toEqual(42);
    const tx = await world.store.getOnchainTxByRequest(approved.requestId);
    expect(tx?.status).toEqual('CONFIRMED');
    expect(tx?.slot).toEqual(42);
    expect(tx?.signature).toEqual(json.signature);
    const mission = await world.store.getMissionById(world.missionId);
    expect(mission?.remaining_budget_atomic).toEqual('49000000');
    // Sent wire: fee-payer slot holds the gateway signature, agent slot
    // holds the agent signature, message hash is unchanged.
    expect(chain.sent.length).toEqual(1);
    const sent = parseWireTransaction(base64ToBytes(chain.sent[0] ?? ''));
    expect(hashMessageBytes(sent.messageBytes)).toEqual(hashMessageBytes(approved.messageBytes));
    expect(
      naclSign.detached.verify(
        sent.messageBytes,
        sent.signatures[0] ?? new Uint8Array(0),
        feePayer.publicKey
      )
    ).toEqual(true);
    expect(
      naclSign.detached.verify(
        sent.messageBytes,
        sent.signatures[1] ?? new Uint8Array(0),
        world.agent.publicKey
      )
    ).toEqual(true);
  });

  it('FAILED records the chain error with no mirror and no violation counting', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world, {
      statuses: [{ slot: 9, err: { InstructionError: [0, 'Custom'] } }],
    });
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    const result = await submit(world, chain, feePayer.feePayer, approved.requestId, signed);
    expect(result.status).toEqual(200);
    const json = result.json as { status: string; signature: string; error: { code: string } };
    expect(json.status).toEqual('FAILED');
    expect(json.error.code).toEqual('CHAIN_REJECTION');
    const tx = await world.store.getOnchainTxByRequest(approved.requestId);
    expect(tx?.status).toEqual('FAILED');
    expect(tx?.raw_error).toEqual({ InstructionError: [0, 'Custom'] });
    const mission = await world.store.getMissionById(world.missionId);
    expect(mission?.remaining_budget_atomic).toEqual('49000000');
    const row = await world.store.getActionById(approved.requestId);
    expect(row?.violation_count_after).toBeNull();
  });

  it('mismatched transactions are rejected without consuming the row', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world);
    const first = await approve(world, chain, feePayer.base58, nextNonce());
    const second = await approve(world, chain, feePayer.base58, nextNonce());
    // Sign the SECOND message but submit it against the FIRST request.
    const signed = agentSign(second.messageBytes, world.agent);
    const result = await submit(world, chain, feePayer.feePayer, first.requestId, signed);
    expect(result.status).toEqual(400);
    expect((result.json as { error: { code: string } }).error.code).toEqual('TRANSACTION_MISMATCH');
    expect(chain.sent.length).toEqual(0);
    expect(await world.store.getOnchainTxByRequest(first.requestId)).toBeNull();
    const row = await world.store.getActionById(first.requestId);
    expect(row?.submitted_at).toBeNull();
  });

  it('expired requests are rejected without consuming the row', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world);
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    await world.db.query('UPDATE action_requests SET expires_at = $2 WHERE id = $1', [
      approved.requestId,
      new Date(Date.now() - 1000).toISOString(),
    ] as unknown[]);
    const signed = agentSign(approved.messageBytes, world.agent);
    const result = await submit(world, chain, feePayer.feePayer, approved.requestId, signed);
    expect(result.status).toEqual(400);
    expect((result.json as { error: { code: string } }).error.code).toEqual('TRANSACTION_EXPIRED');
    expect(chain.sent.length).toEqual(0);
  });

  it('second submit after terminal state is ALREADY_SUBMITTED', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world);
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    const first = await submit(world, chain, feePayer.feePayer, approved.requestId, signed);
    expect((first.json as { status: string }).status).toEqual('CONFIRMED');
    const second = await submit(world, chain, feePayer.feePayer, approved.requestId, signed);
    expect(second.status).toEqual(409);
    expect((second.json as { error: { code: string } }).error.code).toEqual('ALREADY_SUBMITTED');
  });

  it('interrupted polls resume without resending', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world);
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    // Simulate a crash after send: SUBMITTED row present, nothing confirmed.
    const parsed = parseWireTransaction(messageFromBase64(signed));
    const signature = bytesToBase58(feePayer.feePayer.signBytes(parsed.messageBytes));
    await world.store.insertOnchainTx({
      mission_id: world.missionId,
      action_request_id: approved.requestId,
      signature,
      status: 'SUBMITTED',
    });
    const sentBefore = chain.sent.length;
    const result = await submit(world, chain, feePayer.feePayer, approved.requestId, signed);
    expect((result.json as { status: string }).status).toEqual('CONFIRMED');
    expect(chain.sent.length).toEqual(sentBefore);
  });

  it('rejects unknown requests, foreign missions, and unapproved rows', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world);
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    const unknown = await submit(world, chain, feePayer.feePayer, randomUUID(), signed);
    expect(unknown.status).toEqual(404);
    // Agent assigned to a second mission submits there with mission-1's row.
    const otherMissionId = randomUUID();
    await world.db.query(
      `INSERT INTO missions
         (id, owner_id, name, objective, pda_address, vault_address, mint_address,
          budget_atomic, remaining_budget_atomic, status,
          current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1,$2,'M2','O',$3,$4,'11111111111111111111111111111111',
        '10','10','ACTIVE',$5,1,'h', now() + interval '1 hour')`,
      [
        otherMissionId,
        world.ownerId,
        bytesToBase58(new Uint8Array(32).fill(21)),
        bytesToBase58(new Uint8Array(32).fill(22)),
        world.agent.base58,
      ] as unknown[]
    );
    await world.store.insertAssignment({
      mission_id: otherMissionId,
      agent_id: world.agentId,
      role: 'PRIMARY',
    });
    const foreign = await submit(
      world,
      chain,
      feePayer.feePayer,
      approved.requestId,
      signed,
      otherMissionId
    );
    expect(foreign.status).toEqual(404);
    // BLOCKED rows cannot submit.
    const blocked = await world.store.insertAction({
      mission_id: world.missionId,
      agent_id: world.agentId,
      idempotency_key: randomUUID(),
      agent_nonce: 900,
      action_type: 'TRANSFER_SOL',
      payload: {},
      request_hash: 'h',
      signature: 's',
      decision: 'BLOCKED',
      decision_reason_code: 'POLICY_BLOCKED',
      violation_count_after: null,
      unsigned_tx_hash: null,
      unsigned_tx_b64: null,
      expires_at: null,
    });
    if (!('inserted' in blocked)) throw new Error('blocked seed failed');
    const blockedSubmit = await submit(
      world,
      chain,
      feePayer.feePayer,
      blocked.inserted.id,
      bytesToBase64(new Uint8Array(20))
    );
    expect(blockedSubmit.status).toEqual(409);
  });

  it('rejects foreign agent signatures and overwrites fee-payer slot garbage', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world);
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const stranger = makeTestAgent();
    const forged = agentSign(approved.messageBytes, stranger);
    const badSig = await submit(world, chain, feePayer.feePayer, approved.requestId, forged);
    expect(badSig.status).toEqual(401);
    // Garbage in slot 0 is replaced by the gateway signature; send succeeds.
    const parsed = parseWireTransaction(
      messageFromBase64(agentSign(approved.messageBytes, world.agent))
    );
    const garbage = bytesToBase64(
      encodeWireTransaction(
        [new Uint8Array(64).fill(9), parsed.signatures[1] ?? new Uint8Array(64)],
        parsed.messageBytes
      )
    );
    const recovered = await submit(world, chain, feePayer.feePayer, approved.requestId, garbage);
    expect((recovered.json as { status: string }).status).toEqual('CONFIRMED');
  });

  it('reconciles send-throws: landed confirms, lost records FAILED', async () => {
    const feePayer = makeTestFeePayer();
    // Landed: send throws but the signature is already known on-chain.
    const landedChain = makeFakeChain(world, {
      send: () => Promise.reject(new Error('send timed out')),
      statuses: [{ slot: 7, err: null }],
    });
    const approved = await approve(world, landedChain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    const landedResult = await submit(
      world,
      landedChain,
      feePayer.feePayer,
      approved.requestId,
      signed
    );
    expect((landedResult.json as { status: string }).status).toEqual('CONFIRMED');
    // Lost: send throws and nothing is known → FAILED with the tx signature.
    const lostChain = makeFakeChain(world, {
      send: () => Promise.reject(new Error('connection refused')),
      statuses: [null, null, null],
    });
    const approvedLost = await approve(world, lostChain, feePayer.base58, nextNonce());
    const signedLost = agentSign(approvedLost.messageBytes, world.agent);
    const lostResult = await submit(
      world,
      lostChain,
      feePayer.feePayer,
      approvedLost.requestId,
      signedLost
    );
    expect((lostResult.json as { status: string }).status).toEqual('FAILED');
    const tx = await world.store.getOnchainTxByRequest(approvedLost.requestId);
    expect(tx?.status).toEqual('FAILED');
    expect(tx?.signature).not.toBeNull();
  });

  it('confirmation timeout resumes on retry', async () => {
    const feePayer = makeTestFeePayer();
    const chain = makeFakeChain(world, { statuses: new Array<null>(30).fill(null) });
    const approved = await approve(world, chain, feePayer.base58, nextNonce());
    const signed = agentSign(approved.messageBytes, world.agent);
    const timedOut = await submit(
      world,
      chain,
      feePayer.feePayer,
      approved.requestId,
      signed,
      undefined,
      {
        intervalMs: 5,
        timeoutMs: 30,
      }
    );
    expect(timedOut.status).toEqual(504);
    expect((timedOut.json as { error: { code: string } }).error.code).toEqual(
      'CONFIRMATION_TIMEOUT'
    );
    // Retry resumes the interrupted poll (fresh chain confirms immediately).
    const resumed = await submit(
      world,
      makeFakeChain(world),
      feePayer.feePayer,
      approved.requestId,
      signed
    );
    expect((resumed.json as { status: string }).status).toEqual('CONFIRMED');
  }, 120_000);
});
