// Succra web — EVM/HSP submit flow.
//
// Synchronous per ARCHITECTURE.md §10:
//   authorizePayment -> wait for chain -> submit to HSP -> wait for settlement
//   -> guardian recordSettlement -> wait for chain -> CONFIRMED/FAILED.
//
// The HTTP response is a snapshot. hsp_payments is the durable state; a timeout
// returns 202 SUBMITTED and the webhook/poller finishes the transition.
import { recoverAddress } from 'viem';
import { HspClientError, hashPaymentMandate } from '@succra/hsp-client';
import type { HspPaymentMandate, HspPaymentStatus } from '@succra/hsp-client';
import type { MissionOnChainState } from './contract-reader';
import { MissionTransactionError, type MissionWriteResult } from './contract-writer';
import type { HspPaymentRow, HspPaymentStatusName, NewHspPayment } from './store-settlement';
import type {
  PreflightActionRequestRow,
  PreflightAgentRow,
  PreflightMissionRow,
} from './store-preflight';

export interface SubmitChain {
  readMissionState(missionAddress: `0x${string}`): Promise<MissionOnChainState>;
  authorizePayment(args: {
    missionAddress: `0x${string}`;
    authorization: {
      requestId: `0x${string}`;
      agent: `0x${string}`;
      merchant: `0x${string}`;
      token: `0x${string}`;
      amountAtomic: bigint;
      paymentNonce: bigint;
      expiresAt: bigint;
      mandateHash: `0x${string}`;
      agentSignature: `0x${string}`;
    };
    expectedVersion: bigint;
  }): Promise<MissionWriteResult>;
  recordSettlement(args: {
    missionAddress: `0x${string}`;
    paymentId: `0x${string}`;
    amountAtomic: bigint;
    txHash: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<MissionWriteResult>;
  readRecordedSettlement(args: {
    missionAddress: `0x${string}`;
    paymentId: `0x${string}`;
  }): Promise<boolean>;
}

export interface SubmitHsp {
  submit(mandate: HspPaymentMandate, signature: string): Promise<HspPaymentStatus>;
  getStatus(hspPaymentMandateId: string): Promise<HspPaymentStatus>;
}

export interface SubmitPersistence {
  getHspPaymentByActionRequestId(actionRequestId: string): Promise<HspPaymentRow | null>;
  insertHspPayment(row: NewHspPayment): Promise<HspPaymentRow>;
  updateHspPayment(id: string, patch: Partial<NewHspPayment>): Promise<HspPaymentRow | null>;
  transitionHspPayment(
    id: string,
    fromStatus: HspPaymentStatusName,
    patch: Partial<NewHspPayment>
  ): Promise<HspPaymentRow | null>;
  markActionSubmitted(
    actionRequestId: string,
    signature: string,
    submittedAt: string
  ): Promise<void>;
  mirrorConfirmedSpend(missionId: string, amountAtomic: string): Promise<void>;
}

export interface SubmitActionArgs {
  action: PreflightActionRequestRow;
  mission: PreflightMissionRow;
  agent: PreflightAgentRow;
  missionAddress: `0x${string}`;
  chainId: number;
  mandateHash: string;
  signature: string;
  chain: SubmitChain;
  hsp: SubmitHsp;
  persistence: SubmitPersistence;
  nowMs?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  postSettlement?(missionId: string, expectedVersion: bigint): Promise<void>;
}

export interface HandlerResult {
  status: number;
  json: unknown;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_POLL_TIMEOUT_MS = 90_000;

function error(status: number, code: string, message: string): HandlerResult {
  return { status, json: { error: { code, message } } };
}

function activeStatus(status: string): boolean {
  return status === 'ACTIVE' || status === 'ACTIVE_RECOVERY';
}

function isHex(value: unknown, bytes: number): value is `0x${string}` {
  return typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value);
}

function mandateFromRow(action: PreflightActionRequestRow): HspPaymentMandate | null {
  const raw = action.mandate_payload;
  if (typeof raw !== 'object' || raw === null) return null;
  const mandate = raw as Record<string, unknown>;
  const required = [
    'cartMandateId',
    'cartMandateHash',
    'requestId',
    'onchainRequestId',
    'missionAddress',
    'agent',
    'merchant',
    'token',
    'amountAtomic',
    'paymentNonce',
    'expiresAt',
  ];
  if (required.some((key) => mandate[key] === undefined || mandate[key] === null)) return null;
  return raw as HspPaymentMandate;
}

function authorizeError(errorValue: unknown): HandlerResult {
  const errorName =
    errorValue instanceof MissionTransactionError ? errorValue.errorName : undefined;
  switch (errorName) {
    case 'InvalidVersion':
      return error(409, 'VERSION_CONFLICT', 'The mission state changed; re-preflight and retry.');
    case 'RequestAlreadyUsed':
      return error(409, 'ALREADY_AUTHORIZED', 'This request was already authorized on-chain.');
    case 'InvalidStatus':
      return error(409, 'MISSION_NOT_ACTIVE', 'The mission is not executable.');
    case 'NotCurrentAgent':
      return error(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
    case 'InvalidSignature':
      return error(400, 'INVALID_SIGNATURE', 'The agent signature was rejected on-chain.');
    case 'InvalidExpiry':
      return error(400, 'REQUEST_EXPIRED', 'The request or mission has expired.');
    case 'InvalidNonce':
      return error(409, 'STALE_NONCE', 'The payment nonce is stale.');
    case 'InvalidAmount':
      return error(400, 'AMOUNT_INVALID', 'The payment amount is outside policy.');
    case 'InvalidMerchant':
      return error(400, 'MERCHANT_NOT_ALLOWED', 'The merchant is not allowlisted.');
    case 'InvalidToken':
      return error(400, 'TOKEN_NOT_ALLOWED', 'The payment token is not allowlisted.');
    default:
      return error(400, 'AUTHORIZE_FAILED', 'On-chain payment authorization failed.');
  }
}

function paymentSnapshot(payment: HspPaymentRow, requestId: string): HandlerResult {
  if (payment.status === 'CONFIRMED') {
    return {
      status: 200,
      json: {
        decision: 'ALLOW',
        requestId,
        authorizationTxHash: payment.authorization_tx_hash,
        hspPaymentMandateId: payment.hsp_payment_mandate_id,
        transactionHash: payment.settlement_tx_hash,
        blockNumber: payment.block_number,
        status: 'CONFIRMED',
      },
    };
  }
  if (payment.status === 'FAILED') {
    return {
      status: 200,
      json: {
        decision: 'ALLOW',
        requestId,
        authorizationTxHash: payment.authorization_tx_hash,
        hspPaymentMandateId: payment.hsp_payment_mandate_id,
        status: 'FAILED',
        error: payment.raw_error ?? { code: 'HSP_REJECTION', message: 'Settlement failed.' },
      },
    };
  }
  return {
    status: 202,
    json: {
      decision: 'ALLOW',
      requestId,
      authorizationTxHash: payment.authorization_tx_hash,
      hspPaymentMandateId: payment.hsp_payment_mandate_id,
      status: 'SUBMITTED',
    },
  };
}

async function failPayment(
  persistence: SubmitPersistence,
  payment: HspPaymentRow,
  hspStatus: HspPaymentStatus,
  requestId: string,
  nowMs: number
): Promise<HandlerResult> {
  void nowMs;
  const rawError = hspStatus.error ?? {
    code: 'HSP_REJECTION',
    message: 'HSP reported a failed settlement.',
  };
  const updated =
    (await persistence.transitionHspPayment(payment.id, 'SUBMITTED', {
      status: 'FAILED',
      raw_error: rawError,
    })) ??
    (await persistence.transitionHspPayment(payment.id, 'AUTHORIZED', {
      status: 'FAILED',
      raw_error: rawError,
    }));
  const row =
    updated ?? (await persistence.getHspPaymentByActionRequestId(payment.action_request_id));
  if (row?.status === 'CONFIRMED') return paymentSnapshot(row, requestId);
  return {
    status: 200,
    json: {
      decision: 'ALLOW',
      requestId,
      authorizationTxHash: row?.authorization_tx_hash ?? payment.authorization_tx_hash,
      hspPaymentMandateId: row?.hsp_payment_mandate_id ?? payment.hsp_payment_mandate_id,
      status: 'FAILED',
      error: rawError,
    },
  };
}

async function confirmPayment(args: {
  chain: SubmitChain;
  persistence: SubmitPersistence;
  mission: PreflightMissionRow;
  missionAddress: `0x${string}`;
  payment: HspPaymentRow;
  hspStatus: HspPaymentStatus;
  requestId: string;
  onchainRequestId: `0x${string}`;
  nowMs: number;
  postSettlement?(missionId: string, expectedVersion: bigint): Promise<void>;
}): Promise<HandlerResult> {
  const {
    chain,
    persistence,
    mission,
    missionAddress,
    payment,
    hspStatus,
    requestId,
    onchainRequestId,
    nowMs,
    postSettlement,
  } = args;
  const amountAtomic = BigInt(payment.amount_atomic);
  if (!isHex(hspStatus.transactionHash, 32)) {
    // A CONFIRMED status without a settlement transaction is not actionable.
    return paymentSnapshot(payment, requestId);
  }
  const txHash = hspStatus.transactionHash;

  const state = await chain.readMissionState(missionAddress);
  let settlementBlock: bigint | undefined;
  try {
    const recorded = await chain.recordSettlement({
      missionAddress,
      paymentId: onchainRequestId,
      amountAtomic,
      txHash,
      expectedVersion: state.stateVersion,
    });
    settlementBlock = recorded.blockNumber;
  } catch {
    const alreadyRecorded = await chain
      .readRecordedSettlement({ missionAddress, paymentId: onchainRequestId })
      .catch(() => false);
    if (!alreadyRecorded) {
      return error(500, 'SETTLEMENT_RECORD_FAILED', 'Settlement recording failed.');
    }
  }

  const blockNumber = hspStatus.blockNumber ?? (settlementBlock ? Number(settlementBlock) : null);
  const confirmed =
    (await persistence.transitionHspPayment(payment.id, 'SUBMITTED', {
      status: 'CONFIRMED',
      settlement_tx_hash: txHash,
      block_number: blockNumber,
      settled_at: new Date(nowMs).toISOString(),
    })) ??
    (await persistence.transitionHspPayment(payment.id, 'AUTHORIZED', {
      status: 'CONFIRMED',
      settlement_tx_hash: txHash,
      block_number: blockNumber,
      settled_at: new Date(nowMs).toISOString(),
    }));

  if (!confirmed) {
    // A concurrent webhook already finalized this row. Never mirror twice.
    const row =
      (await persistence.getHspPaymentByActionRequestId(payment.action_request_id)) ?? payment;
    return paymentSnapshot(row, requestId);
  }

  // The hsp_payments status update and this budget mirror are separate DB
  // statements. That is safe: SuccraMission.confirmedSpentAtomic is the
  // authoritative spend check, so a stale mirror can only block a payment
  // conservatively; it can never authorize an overspend. Reconciliation can
  // replay the mirror, and HSP/HashKey remain authoritative.
  await persistence.mirrorConfirmedSpend(mission.id, amountAtomic.toString());

  if (postSettlement) {
    try {
      const latest = await chain.readMissionState(missionAddress);
      await postSettlement(mission.id, latest.stateVersion);
    } catch {
      // The settlement is already authoritative. Checkpoint/succession
      // reconciliation is retried by the runtime without failing the payment.
    }
  }
  return paymentSnapshot(confirmed, requestId);
}

/**
 * Executes the post-preflight lifecycle. Authentication and row loading happen
 * in the route; this function is the deterministic money path and is fully
 * dependency-injected for tests.
 */
export async function submitApprovedAction(args: SubmitActionArgs): Promise<HandlerResult> {
  const {
    action,
    mission,
    agent,
    missionAddress,
    chainId,
    mandateHash,
    signature,
    chain,
    hsp,
    persistence,
    postSettlement,
  } = args;
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const pollIntervalMs = Math.max(args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 1);
  const pollTimeoutMs = Math.min(args.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS, 120_000);
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  if (action.decision !== 'ALLOW') {
    return error(400, 'REQUEST_NOT_APPROVED', 'Only approved preflights can be submitted.');
  }
  if (!isHex(mandateHash, 32) || action.mandate_hash?.toLowerCase() !== mandateHash.toLowerCase()) {
    return error(400, 'MANDATE_MISMATCH', 'The signed mandate hash does not match the preflight.');
  }
  if (!isHex(signature, 65) && !isHex(signature, 64)) {
    return error(401, 'INVALID_SIGNATURE', 'The agent signature is malformed.');
  }

  let recovered: string;
  try {
    recovered = await recoverAddress({
      hash: mandateHash as `0x${string}`,
      signature: signature as `0x${string}`,
    });
  } catch {
    return error(401, 'INVALID_SIGNATURE', 'The agent signature could not be recovered.');
  }
  if (recovered.toLowerCase() !== agent.public_key.toLowerCase()) {
    return error(401, 'INVALID_SIGNATURE', 'The signature does not belong to the current agent.');
  }

  const existing = await persistence.getHspPaymentByActionRequestId(action.id);
  if (existing) return paymentSnapshot(existing, action.request_id);
  if (action.submitted_at) {
    return error(409, 'ALREADY_SUBMITTED', 'This action request was already submitted.');
  }

  const mandate = mandateFromRow(action);
  if (!mandate) {
    return error(500, 'SUBMIT_STATE', 'The preflight row is missing its mandate payload.');
  }
  if (
    !isHex(action.onchain_request_id, 32) ||
    mandate.onchainRequestId.toLowerCase() !== action.onchain_request_id.toLowerCase()
  ) {
    return error(500, 'SUBMIT_STATE', 'The preflight mandate is not bound to its action row.');
  }
  // Defense in depth: the stored mandate must still hash to the hash the agent
  // signed. A DB-side tamper cannot change the fields the contract authorizes.
  if (hashPaymentMandate(mandate, chainId).toLowerCase() !== mandateHash.toLowerCase()) {
    return error(500, 'SUBMIT_STATE', 'The preflight mandate payload does not match its hash.');
  }

  let state: MissionOnChainState;
  try {
    state = await chain.readMissionState(missionAddress);
  } catch {
    return error(503, 'MISSION_STATE_UNAVAILABLE', 'Mission state is temporarily unavailable.');
  }
  if (!activeStatus(state.status)) {
    return error(409, 'MISSION_NOT_ACTIVE', 'The mission is not executable.');
  }
  if (state.currentAgent.toLowerCase() !== agent.public_key.toLowerCase()) {
    return error(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
  }

  let authorization: MissionWriteResult;
  try {
    authorization = await chain.authorizePayment({
      missionAddress,
      authorization: {
        requestId: action.onchain_request_id as `0x${string}`,
        agent: agent.public_key as `0x${string}`,
        merchant: mandate.merchant as `0x${string}`,
        token: mandate.token as `0x${string}`,
        amountAtomic: BigInt(mandate.amountAtomic),
        paymentNonce: BigInt(mandate.paymentNonce),
        expiresAt: BigInt(mandate.expiresAt),
        mandateHash: mandateHash as `0x${string}`,
        agentSignature: signature as `0x${string}`,
      },
      expectedVersion: state.stateVersion,
    });
  } catch (authorizeFailure) {
    return authorizeError(authorizeFailure);
  }

  await persistence.markActionSubmitted(action.id, signature, nowIso);

  let payment: HspPaymentRow;
  try {
    payment = await persistence.insertHspPayment({
      mission_id: mission.id,
      action_request_id: action.id,
      hsp_payment_mandate_id: `succra-${action.id}`,
      mandate_hash: mandateHash,
      amount_atomic: mandate.amountAtomic,
      token_address: mandate.token,
      merchant_address: mandate.merchant,
      status: 'AUTHORIZED',
      authorization_tx_hash: authorization.txHash,
      submitted_at: null,
      settled_at: null,
      raw_error: null,
    });
  } catch (insertFailure) {
    const raced = await persistence.getHspPaymentByActionRequestId(action.id);
    if (raced) return paymentSnapshot(raced, action.request_id);
    throw insertFailure;
  }

  let submitted: HspPaymentStatus;
  try {
    submitted = await hsp.submit(mandate, signature);
  } catch (hspError) {
    const message = hspError instanceof Error ? hspError.message : 'HSP submission failed.';
    const rejected = hspError instanceof HspClientError && hspError.kind === 'REJECTED';
    await persistence.transitionHspPayment(payment.id, 'AUTHORIZED', {
      status: 'FAILED',
      raw_error: {
        code: rejected && hspError instanceof HspClientError ? hspError.code : 'HSP_UNAVAILABLE',
        message,
      },
    });
    if (rejected) {
      return {
        status: 200,
        json: {
          decision: 'ALLOW',
          requestId: action.request_id,
          authorizationTxHash: authorization.txHash,
          hspPaymentMandateId: payment.hsp_payment_mandate_id,
          status: 'FAILED',
          error: {
            code: hspError instanceof HspClientError ? hspError.code : 'HSP_REJECTION',
            message,
          },
        },
      };
    }
    return error(500, 'HSP_UNAVAILABLE', 'The payment was authorized but HSP submission failed.');
  }

  const submittedPayment = await persistence.updateHspPayment(payment.id, {
    status: 'SUBMITTED',
    hsp_payment_mandate_id: submitted.hspPaymentMandateId,
    submitted_at: nowIso,
  });
  if (!submittedPayment) {
    return error(500, 'SUBMIT_STATE', 'The HSP payment mirror could not be updated.');
  }
  payment = submittedPayment;

  let status = submitted;
  const deadline = Date.now() + pollTimeoutMs;
  for (;;) {
    if (status.status === 'CONFIRMED') {
      return confirmPayment({
        chain,
        persistence,
        mission,
        missionAddress,
        payment,
        hspStatus: status,
        requestId: action.request_id,
        onchainRequestId: action.onchain_request_id as `0x${string}`,
        nowMs,
        ...(postSettlement !== undefined ? { postSettlement } : {}),
      });
    }
    if (status.status === 'FAILED') {
      return failPayment(persistence, payment, status, action.request_id, nowMs);
    }
    if (Date.now() >= deadline) {
      return paymentSnapshot(payment, action.request_id);
    }
    await sleep(pollIntervalMs);
    try {
      status = await hsp.getStatus(payment.hsp_payment_mandate_id);
    } catch {
      // Transient HSP read failure: keep polling until the bounded deadline.
    }
  }
}
