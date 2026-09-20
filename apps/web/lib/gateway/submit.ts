// Succra gateway — submit flow (POST /api/missions/:id/actions/:requestId/submit).
//
// State machine per action_requests row + onchain_transactions row:
//   APPROVED ──send──▶ SUBMITTED ──poll──▶ CONFIRMED | FAILED
// Rejections before send (mismatch, expiry, not-approved) do NOT consume
// the row: the agent may retry submit with corrected bytes. A terminal
// (CONFIRMED/FAILED) row makes later submits ALREADY_SUBMITTED.
// No DB transaction is held open across chain I/O: send, insert, poll,
// and finalize are separate steps. Concurrent duplicate submits send
// byte-identical transactions (deterministic signatures), so a double
// send is a safe on-chain no-op and the signature UNIQUE elects one row.
import { sign as naclSign } from 'tweetnacl';
import {
  base58ToBytes32,
  bytesToBase58,
  bytesToBase64,
  encodeWireTransaction,
  inspectMessage,
  messageFromBase64,
  parseWireTransaction,
  sha256Hex,
} from '@succra/shared';
import type { ChainGateway, FeePayer } from './chain';
import { writeAuditEvent } from './audit';
import { ensureActivationCheckpoint, writeVerifiedCheckpoint } from './checkpoints';
import type { ActionRequestRow, AgentRow, GatewayStore, MissionRow } from './store';

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;
const MIRROR_ATTEMPTS = 3;

export interface SubmitDeps {
  store: GatewayStore;
  chain: ChainGateway;
  feePayer: FeePayer;
  /** Test-only polling override (production uses the constants above). */
  poll?: { intervalMs: number; timeoutMs: number };
}

export type SubmitOutcome =
  | { kind: 'confirmed'; requestId: string; signature: string; slot: number }
  | { kind: 'failed'; requestId: string; signature: string | null; code: string; message: string }
  | { kind: 'error'; status: number; code: string; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function agentSignatureValid(
  messageBytes: Uint8Array,
  signature: Uint8Array,
  agentBase58: string
): boolean {
  try {
    const publicKey = base58ToBytes32(agentBase58);
    if (signature.length !== 64) {
      return false;
    }
    return naclSign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}

export async function submitAction(args: {
  deps: SubmitDeps;
  mission: MissionRow;
  agent: AgentRow;
  requestId: string;
  signedTxB64: string;
  nowMs: number;
}): Promise<SubmitOutcome> {
  const { deps, mission, agent, requestId, nowMs } = args;
  const { store, chain, feePayer } = deps;

  // 1. The request must exist, belong here, and be APPROVED.
  const row: ActionRequestRow | null = await store.getActionById(requestId);
  if (!row || row.mission_id !== mission.id) {
    return {
      kind: 'error',
      status: 404,
      code: 'ACTION_NOT_FOUND',
      message: 'Action request does not exist.',
    };
  }
  if (row.agent_id !== agent.id) {
    return {
      kind: 'error',
      status: 403,
      code: 'AGENT_NOT_ASSIGNED',
      message: 'Request belongs to another agent.',
    };
  }
  if (row.decision !== 'APPROVED') {
    return {
      kind: 'error',
      status: 409,
      code: 'ACTION_NOT_APPROVED',
      message: 'Only approved requests can be submitted.',
    };
  }

  // 2. Terminal rows are final; interrupted polls resume.
  const prior = await store.getOnchainTxByRequest(row.id);
  if (prior && prior.status === 'CONFIRMED') {
    return {
      kind: 'error',
      status: 409,
      code: 'ALREADY_SUBMITTED',
      message: 'Request already confirmed.',
    };
  }
  if (prior && prior.status === 'FAILED') {
    return {
      kind: 'error',
      status: 409,
      code: 'ALREADY_SUBMITTED',
      message: 'Request already failed.',
    };
  }
  if (prior && prior.status === 'SUBMITTED') {
    return pollToTerminal(store, chain, mission, row, prior.signature, nowMs, deps.poll);
  }

  // 3. Expiry is checked on every attempt (rejection consumes nothing).
  if (!row.expires_at || Date.parse(row.expires_at) <= nowMs) {
    return {
      kind: 'error',
      status: 400,
      code: 'TRANSACTION_EXPIRED',
      message: 'Action request has expired.',
    };
  }
  if (!row.unsigned_tx_hash) {
    return {
      kind: 'error',
      status: 500,
      code: 'SUBMIT_STATE',
      message: 'Approved request misses its transaction hash.',
    };
  }

  // 4. Parse + authenticate the submitted transaction.
  let messageBytes: Uint8Array;
  let submittedSigs: Uint8Array[];
  try {
    const parsed = parseWireTransaction(messageFromBase64(args.signedTxB64));
    messageBytes = parsed.messageBytes;
    submittedSigs = parsed.signatures;
  } catch {
    return {
      kind: 'error',
      status: 400,
      code: 'INVALID_BODY',
      message: 'signedTransaction does not parse.',
    };
  }
  if (sha256Hex(messageBytes) !== row.unsigned_tx_hash) {
    return {
      kind: 'error',
      status: 400,
      code: 'TRANSACTION_MISMATCH',
      message: 'Submitted transaction does not match the pre-flighted message.',
    };
  }
  let view;
  try {
    view = inspectMessage(messageBytes);
  } catch {
    return {
      kind: 'error',
      status: 400,
      code: 'TRANSACTION_MISMATCH',
      message: 'Submitted message does not parse.',
    };
  }
  if (submittedSigs.length !== view.signerAddresses.length) {
    return {
      kind: 'error',
      status: 400,
      code: 'TRANSACTION_MISMATCH',
      message: 'Submitted transaction has a wrong signature count.',
    };
  }
  const agentIndex = view.signerAddresses.indexOf(agent.public_key);
  if (agentIndex < 0) {
    return {
      kind: 'error',
      status: 401,
      code: 'INVALID_SIGNATURE',
      message: 'Agent is not a signer of the submitted transaction.',
    };
  }
  if (
    !agentSignatureValid(
      messageBytes,
      submittedSigs[agentIndex] ?? new Uint8Array(0),
      agent.public_key
    )
  ) {
    return {
      kind: 'error',
      status: 401,
      code: 'INVALID_SIGNATURE',
      message: 'Agent signature rejected.',
    };
  }

  // 5. Attach the fee-payer signature (deterministic over identical
  // bytes) and send. Slot 0 content from the agent is always replaced.
  const feePayerSig = feePayer.signBytes(messageBytes);
  const finalSigs = submittedSigs.map((sig, index) => (index === 0 ? feePayerSig : sig));
  const wireB64 = bytesToBase64(encodeWireTransaction(finalSigs, messageBytes));
  const expectedSignature = bytesToBase58(feePayerSig);

  let signature: string;
  try {
    signature = await chain.sendRawTransaction(wireB64);
  } catch (error) {
    // Send outcome unknown: the transaction may still have landed.
    // Reconcile by status before recording anything.
    const landed = await chain.getSignatureStatus(expectedSignature).catch(() => null);
    if (landed) {
      await insertSubmitted(store, mission.id, row.id, expectedSignature, nowMs);
      return pollToTerminal(store, chain, mission, row, expectedSignature, nowMs, deps.poll);
    }
    await insertSubmitted(store, mission.id, row.id, expectedSignature, nowMs);
    await store.updateOnchainTxFailed(expectedSignature, { message: String(error) });
    await store.markActionSubmitted(row.id, new Date(nowMs).toISOString());
    return {
      kind: 'failed',
      requestId: row.id,
      signature: expectedSignature,
      code: 'CHAIN_REJECTION',
      message: 'Transaction was rejected before confirmation.',
    };
  }
  if (signature !== expectedSignature) {
    return {
      kind: 'error',
      status: 500,
      code: 'SUBMIT_STATE',
      message: 'RPC returned an unexpected signature.',
    };
  }
  const inserted = await insertSubmitted(store, mission.id, row.id, signature, nowMs);
  if (!inserted) {
    // A concurrent duplicate won the insert with byte-identical content.
    return pollToTerminal(store, chain, mission, row, signature, nowMs, deps.poll);
  }
  return pollToTerminal(store, chain, mission, row, signature, nowMs, deps.poll);
}

async function insertSubmitted(
  store: GatewayStore,
  missionId: string,
  requestId: string,
  signature: string,
  nowMs: number
): Promise<boolean> {
  const outcome = await store.insertOnchainTx({
    mission_id: missionId,
    action_request_id: requestId,
    signature,
    status: 'SUBMITTED',
  });
  if ('inserted' in outcome) {
    await store.markActionSubmitted(requestId, new Date(nowMs).toISOString());
    return true;
  }
  return false;
}

/** Poll a submitted signature to its terminal state (no open DB tx). */
async function pollToTerminal(
  store: GatewayStore,
  chain: ChainGateway,
  mission: MissionRow,
  row: ActionRequestRow,
  signature: string,
  nowMs: number,
  poll?: { intervalMs: number; timeoutMs: number }
): Promise<SubmitOutcome> {
  const interval = poll?.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (poll?.timeoutMs ?? POLL_TIMEOUT_MS);
  for (;;) {
    const status = await chain.getSignatureStatus(signature).catch(() => null);
    if (status && status.err != null) {
      await store.updateOnchainTxFailed(signature, status.err);
      await store.markActionSubmitted(row.id, new Date(nowMs).toISOString());
      return {
        kind: 'failed',
        requestId: row.id,
        signature,
        code: 'CHAIN_REJECTION',
        message: 'Transaction was rejected by the cluster.',
      };
    }
    if (status && status.err == null) {
      await store.updateOnchainTxConfirmed(signature, status.slot, new Date(nowMs).toISOString());
      await store.markActionSubmitted(row.id, new Date(nowMs).toISOString());
      await mirrorRemaining(store, chain, mission);
      // Phase 6: every CONFIRMED action writes a VERIFIED checkpoint
      // (sequence = on-chain action order). Best-effort: checkpoint
      // failure must never fail an already-confirmed action.
      await recordConfirmedCheckpoint(store, chain, mission, row, signature, nowMs).catch(
        () => undefined
      );
      return { kind: 'confirmed', requestId: row.id, signature, slot: status.slot };
    }
    if (Date.now() >= deadline) {
      return {
        kind: 'error',
        status: 504,
        code: 'CONFIRMATION_TIMEOUT',
        message: 'Confirmation timed out; retry submit to resume polling.',
      };
    }
    await sleep(interval);
  }
}

/**
 * Mirror the confirmed on-chain remainder into missions (AGENTS.md
 * invariant #3: mirror, never authority). Best-effort with retries; the
 * chain stays authoritative and reconciliation converges on next read.
 */async function mirrorRemaining(
  store: GatewayStore,
  chain: ChainGateway,
  mission: MissionRow
): Promise<void> {
  for (let attempt = 0; attempt < MIRROR_ATTEMPTS; attempt += 1) {
    try {
      const state = await chain.getMissionState(mission.pda_address);
      if (state) {
        await store.updateMissionRemaining(mission.id, state.remainingBudget.toString());
        return;
      }
    } catch {
      // Retry below; fall through to the next attempt.
    }
  }
}

/**
 * Phase 6 checkpoint hook: after a CONFIRMED action, ensure the
 * sequence=0 activation checkpoint exists (cold-start guard), then
 * write the VERIFIED checkpoint for this action (sequence = on-chain
 * agent_nonce = action order). Reads authoritative chain state fresh;
 * throws on unexpected shape so the caller can swallow best-effort.
 */
async function recordConfirmedCheckpoint(
  store: GatewayStore,
  chain: ChainGateway,
  mission: MissionRow,
  row: ActionRequestRow,
  signature: string,
  nowMs: number
): Promise<void> {
  const state = await chain.getMissionState(mission.pda_address);
  if (!state) return;
  const policy = await store.getLatestPolicy(mission.id);
  const checkpointArgs = {
    missionId: mission.id,
    remainingBudgetAtomic: state.remainingBudget,
    maxActionAtomic: state.maxAction,
    recoveryMaxActionAtomic: state.recoveryMaxAction,
    policyVersion: policy?.version ?? mission.policy_version,
    policyHash: policy?.policy_hash ?? mission.policy_hash,
    nowMs,
  };
  await ensureActivationCheckpoint(store, checkpointArgs);
  await writeVerifiedCheckpoint(store, {
    ...checkpointArgs,
    sequence: row.agent_nonce,
    confirmedActionIds: [row.id],
    confirmedSignatures: [signature],
  });
  await writeAuditEventForCheckpoint(store, mission.id, row.id, signature, nowMs);
}

async function writeAuditEventForCheckpoint(
  store: GatewayStore,
  missionId: string,
  requestId: string,
  signature: string,
  nowMs: number
): Promise<void> {
  await writeAuditEvent({
    store,
    missionId,
    eventType: 'checkpoint.verified',
    actor: { type: 'system', id: null },
    signature,
    payload: { action_request_id: requestId },
    nowMs,
  });
}
