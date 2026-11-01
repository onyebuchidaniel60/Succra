import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { HspClientError, hashPaymentMandate } from '@succra/hsp-client';
import type { HspPaymentMandate, HspPaymentStatus } from '@succra/hsp-client';
import type { MissionOnChainState } from '../lib/gateway/contract-reader';
import { MissionTransactionError } from '../lib/gateway/contract-writer';
import { submitApprovedAction, type SubmitPersistence } from '../lib/gateway/submit-handler';
import type { HspPaymentRow } from '../lib/gateway/store-settlement';
import type {
  PreflightActionRequestRow,
  PreflightAgentRow,
  PreflightMissionRow,
} from '../lib/gateway/store-preflight';

const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'44'.repeat(32)}`);
const MISSION = 'mission-1';
const ACTION = 'action-1';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const MISSION_ADDRESS = `0x${'11'.repeat(20)}` as const;
const MERCHANT = `0x${'33'.repeat(20)}` as const;
const TOKEN = `0x${'44'.repeat(20)}` as const;
const ONCHAIN_REQUEST = `0x${'66'.repeat(32)}` as const;
const AUTH_TX = `0x${'77'.repeat(32)}` as const;

const mandate: HspPaymentMandate = {
  cartMandateId: MISSION,
  cartMandateHash: `0x${'88'.repeat(32)}`,
  requestId: REQUEST,
  onchainRequestId: ONCHAIN_REQUEST,
  missionAddress: MISSION_ADDRESS,
  agent: account.address,
  merchant: MERCHANT,
  token: TOKEN,
  amountAtomic: '100',
  paymentNonce: 1,
  expiresAt: '2000000000',
};
const MANDATE_HASH = hashPaymentMandate(mandate, 177) as `0x${string}`;

function missionRow(): PreflightMissionRow {
  return {
    id: MISSION,
    owner_id: 'owner-1',
    name: 'Mission',
    objective: 'Pay',
    pda_address: MISSION_ADDRESS,
    vault_address: 'unused',
    mint_address: TOKEN,
    budget_atomic: '1000',
    remaining_budget_atomic: '1000',
    status: 'ACTIVE',
    current_agent_id: 'agent-1',
    current_agent_public_key: account.address,
    policy_version: 1,
    policy_hash: `0x${'99'.repeat(32)}`,
    expires_at: '2000000000',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    contract_address: MISSION_ADDRESS,
    payment_token_address: TOKEN,
    current_agent_address: account.address,
  };
}

function agentRow(): PreflightAgentRow {
  return {
    id: 'agent-1',
    owner_id: 'owner-1',
    name: 'Alpha',
    public_key: account.address,
    endpoint_url: null,
    capabilities: [],
    status: 'ACTIVE',
    last_heartbeat_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function actionRow(overrides: Partial<PreflightActionRequestRow> = {}): PreflightActionRequestRow {
  return {
    id: ACTION,
    mission_id: MISSION,
    agent_id: 'agent-1',
    idempotency_key: 'idem-1',
    request_id: REQUEST,
    onchain_request_id: ONCHAIN_REQUEST,
    agent_nonce: 1,
    action_type: 'HSP_PAYMENT',
    payload: {},
    request_hash: 'hash',
    signature: null,
    decision: 'ALLOW',
    decision_reason_code: null,
    mandate_hash: MANDATE_HASH,
    mandate_payload: mandate,
    typed_data: {},
    expires_at: '2000000000',
    created_at: new Date().toISOString(),
    submitted_at: null,
    ...overrides,
  };
}

function paymentRow(overrides: Partial<HspPaymentRow> = {}): HspPaymentRow {
  return {
    id: 'payment-1',
    mission_id: MISSION,
    action_request_id: ACTION,
    hsp_payment_mandate_id: 'hsp-1',
    mandate_hash: MANDATE_HASH,
    amount_atomic: '100',
    token_address: TOKEN,
    merchant_address: MERCHANT,
    status: 'SUBMITTED',
    authorization_tx_hash: AUTH_TX,
    settlement_tx_hash: null,
    block_number: null,
    raw_error: null,
    submitted_at: new Date().toISOString(),
    settled_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function onchain(overrides: Partial<MissionOnChainState> = {}): MissionOnChainState {
  return {
    contractAddress: MISSION_ADDRESS,
    currentAgent: account.address,
    status: 'ACTIVE',
    agentNonce: 0n,
    stateVersion: 0n,
    violationCount: 0,
    lastViolationAt: 0n,
    confirmedSpentAtomic: 0n,
    lastCheckpointHash: `0x${'00'.repeat(32)}`,
    lastCheckpointSequence: 0n,
    checkpointCount: 0n,
    successors: [],
    paymentToken: TOKEN,
    budgetAtomic: 1000n,
    maxPaymentAtomic: 400n,
    recoveryMaxPaymentAtomic: 100n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    policyHash: `0x${'99'.repeat(32)}`,
    cartMandateHash: `0x${'88'.repeat(32)}`,
    violationThreshold: 3,
    violationWindowSeconds: 900n,
    allowedMerchants: new Set([MERCHANT.toLowerCase()]),
    ...overrides,
  };
}

function makeWorld(
  options: {
    authorizeError?: unknown;
    settleStatus?: HspPaymentStatus;
    timeout?: boolean;
    existing?: HspPaymentRow | null;
  } = {}
) {
  let payment: HspPaymentRow | null = options.existing ?? null;
  const persistence: SubmitPersistence = {
    getHspPaymentByActionRequestId: vi.fn(async () => payment),
    insertHspPayment: vi.fn(async (row) => {
      payment = paymentRow({
        hsp_payment_mandate_id: row.hsp_payment_mandate_id,
        status: 'AUTHORIZED',
        authorization_tx_hash: row.authorization_tx_hash,
        submitted_at: null,
      });
      return payment;
    }),
    updateHspPayment: vi.fn(async (_id, patch) => {
      payment = paymentRow({ ...payment, ...patch });
      return payment;
    }),
    transitionHspPayment: vi.fn(async (_id, _from, patch) => {
      payment = paymentRow({ ...payment, ...patch });
      return payment;
    }),
    markActionSubmitted: vi.fn(async () => undefined),
    mirrorConfirmedSpend: vi.fn(async () => undefined),
  };
  const chain = {
    readMissionState: vi.fn(async () => onchain()),
    authorizePayment: vi.fn(async () => {
      if (options.authorizeError) throw options.authorizeError;
      return { txHash: AUTH_TX, blockNumber: 1n };
    }),
    recordSettlement: vi.fn(async () => ({
      txHash: `0x${'aa'.repeat(32)}` as const,
      blockNumber: 2n,
    })),
    readRecordedSettlement: vi.fn(async () => true),
  };
  const hsp = {
    submit: vi.fn(async () => ({ hspPaymentMandateId: 'hsp-1', status: 'SUBMITTED' as const })),
    getStatus: vi.fn(async () => {
      if (options.timeout) return { hspPaymentMandateId: 'hsp-1', status: 'SUBMITTED' as const };
      return (
        options.settleStatus ?? {
          hspPaymentMandateId: 'hsp-1',
          status: 'CONFIRMED' as const,
          transactionHash: `0x${'bb'.repeat(32)}` as const,
          blockNumber: 7,
        }
      );
    }),
  };
  return { persistence, chain, hsp, payment: () => payment };
}

async function signatureFor(hash: string, signer = account): Promise<string> {
  return signer.sign({ hash: hash as `0x${string}` });
}

async function run(
  world: ReturnType<typeof makeWorld>,
  overrides: {
    mandateHash?: string;
    signature?: string;
    action?: PreflightActionRequestRow;
    pollTimeoutMs?: number;
  } = {}
) {
  return submitApprovedAction({
    action: overrides.action ?? actionRow(),
    mission: missionRow(),
    agent: agentRow(),
    missionAddress: MISSION_ADDRESS,
    chainId: 177,
    mandateHash: overrides.mandateHash ?? MANDATE_HASH,
    signature: overrides.signature ?? (await signatureFor(overrides.mandateHash ?? MANDATE_HASH)),
    chain: world.chain,
    hsp: world.hsp,
    persistence: world.persistence,
    nowMs: 1_700_000_000_000,
    pollIntervalMs: 1,
    pollTimeoutMs: overrides.pollTimeoutMs ?? 1_000,
    sleep: async () => undefined,
  });
}

describe('submitApprovedAction', () => {
  it('authorizes, submits, records settlement, and returns CONFIRMED', async () => {
    const world = makeWorld();
    const result = await run(world);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      decision: 'ALLOW',
      requestId: REQUEST,
      hspPaymentMandateId: 'hsp-1',
      status: 'CONFIRMED',
    });
    expect(world.chain.authorizePayment).toHaveBeenCalledTimes(1);
    expect(world.chain.recordSettlement).toHaveBeenCalledTimes(1);
    expect(world.persistence.mirrorConfirmedSpend).toHaveBeenCalledWith(MISSION, '100');
    expect(world.persistence.markActionSubmitted).toHaveBeenCalledTimes(1);
    expect(world.payment()?.status).toEqual('CONFIRMED');
  });

  it('returns FAILED when HSP rejects settlement', async () => {
    const world = makeWorld({
      settleStatus: {
        hspPaymentMandateId: 'hsp-1',
        status: 'FAILED',
        error: { code: 'HSP_REJECTED', message: 'No.' },
      },
    });
    const result = await run(world);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ status: 'FAILED' });
    expect(world.chain.recordSettlement).not.toHaveBeenCalled();
    expect(world.payment()?.status).toEqual('FAILED');
  });

  it('returns FAILED (not 500) when HSP rejects the submission', async () => {
    const world = makeWorld();
    world.hsp.submit.mockRejectedValueOnce(
      new HspClientError('HSP_REJECTED', 'Mandate rejected.', 400)
    );
    const result = await run(world);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      status: 'FAILED',
      error: { code: 'HSP_REJECTED' },
    });
    expect(world.payment()?.status).toEqual('FAILED');
  });

  it('returns 202 SUBMITTED only when the bounded poll times out', async () => {
    const world = makeWorld({ timeout: true });
    const result = await run(world, { pollTimeoutMs: 0 });
    expect(result.status).toEqual(202);
    expect(result.json).toMatchObject({ status: 'SUBMITTED' });
    expect(world.chain.recordSettlement).not.toHaveBeenCalled();
  });

  it('rejects a mandate hash mismatch before any chain call', async () => {
    const world = makeWorld();
    const result = await run(world, { mandateHash: `0x${'cc'.repeat(32)}` });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'MANDATE_MISMATCH' } });
    expect(world.chain.authorizePayment).not.toHaveBeenCalled();
  });

  it('rejects a signature from a different agent', async () => {
    const world = makeWorld();
    const result = await run(world, { signature: await signatureFor(MANDATE_HASH, other) });
    expect(result.status).toEqual(401);
    expect(result.json).toMatchObject({ error: { code: 'INVALID_SIGNATURE' } });
    expect(world.chain.authorizePayment).not.toHaveBeenCalled();
  });

  it('rejects a non-ALLOW preflight', async () => {
    const world = makeWorld();
    const result = await run(world, { action: actionRow({ decision: 'BLOCK' }) });
    expect(result.status).toEqual(400);
    expect(result.json).toMatchObject({ error: { code: 'REQUEST_NOT_APPROVED' } });
  });

  it('rejects a tampered mandate payload that no longer hashes to the preflight', async () => {
    const world = makeWorld();
    const tampered = { ...mandate, amountAtomic: '200' };
    const result = await run(world, {
      action: actionRow({ mandate_payload: tampered }),
    });
    expect(result.status).toEqual(500);
    expect(result.json).toMatchObject({ error: { code: 'SUBMIT_STATE' } });
    expect(world.chain.authorizePayment).not.toHaveBeenCalled();
  });

  it('maps an on-chain InvalidVersion to 409 VERSION_CONFLICT', async () => {
    const world = makeWorld({
      authorizeError: new MissionTransactionError('reverted', 'InvalidVersion'),
    });
    const result = await run(world);
    expect(result.status).toEqual(409);
    expect(result.json).toMatchObject({ error: { code: 'VERSION_CONFLICT' } });
  });

  it('returns the original result for an already-submitted request', async () => {
    const existing = paymentRow({
      status: 'CONFIRMED',
      settlement_tx_hash: `0x${'dd'.repeat(32)}`,
      block_number: 9,
    });
    const world = makeWorld({ existing });
    const result = await run(world);
    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({ status: 'CONFIRMED', blockNumber: 9 });
    expect(world.chain.authorizePayment).not.toHaveBeenCalled();
  });

  it('returns 503 when mission state is unavailable', async () => {
    const world = makeWorld();
    world.chain.readMissionState.mockRejectedValueOnce(new Error('rpc down'));
    const result = await run(world);
    expect(result.status).toEqual(503);
    expect(result.json).toMatchObject({ error: { code: 'MISSION_STATE_UNAVAILABLE' } });
  });
});
