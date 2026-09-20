// Succra gateway — pre-flight flow (POST /api/missions/:id/actions).
//
// DB writes per step (ARCHITECTURE.md §11):
//   1. idempotency pre-check (read; duplicate → return ORIGINAL row);
//   2. on-chain mission read (no write; placeholder PDAs BLOCK);
//   3. policy read + pure FR-03 evaluation (no write);
//   4. insert action_requests (APPROVED or BLOCKED; 23505 → original wins);
//   5. return ALLOW + unsigned message, or BLOCK.
// Pre-flight never sends a transaction, never mutates budget/nonce/vault.
// BLOCK responses are HTTP 200 with a decision envelope (the request was
// valid; the DECISION is BLOCK). True errors use the §10 envelope.
//
// Fee-payer note: the amended wire format transmits the compiled message
// bytes only, so there is no channel for a pre-flight fee-payer
// signature — and Ed25519 determinism makes pre-flight signing
// unobservable (re-signing identical bytes at submit yields the identical
// signature). The gateway therefore attaches its fee-payer signature at
// submit time; submit.ts documents the assembly.
import { randomUUID } from 'node:crypto';
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import {
  base58ToBytes32,
  hashMessageBytes,
  messageToBase64,
  planExecuteInstruction,
  sha256HexUtf8,
  type AccountRoleName,
  type ActionTypeName,
} from '@succra/shared';
import type { ChainGateway } from './chain';
import type { FeePayer } from './chain';
import { findAssociatedTokenAddress, findSplVaultPda, findVaultPda } from './pdas';
import { evaluatePolicy, reasonMessage, type BlockReasonCode } from './policy';
import { COUNTED_REASON_CODE, evaluateStreak, streakWindowStartMs } from './streak';
import { quarantineMission, writeAuditEvent } from './quarantine';
import type { ActionRequestRow, AgentRow, GatewayStore, MissionRow } from './store';

export function toKitRole(role: AccountRoleName): AccountRole {
  switch (role) {
    case 'readonly-signer':
      return AccountRole.READONLY_SIGNER;
    case 'writable-signer':
      return AccountRole.WRITABLE_SIGNER;
    case 'readonly':
      return AccountRole.READONLY;
    case 'writable':
      return AccountRole.WRITABLE;
  }
}

export interface PreflightBody {
  idempotencyKey: string;
  agentNonce: string;
  actionType: ActionTypeName;
  recipient: string;
  amountAtomic: string;
  expiresAt: string;
}

export type PreflightOutcome =
  | { kind: 'allow'; requestId: string; unsignedTransaction: string; expiresAt: string }
  | { kind: 'block'; requestId: string; reasonCode: string; reason: string };

export interface PreflightDeps {
  store: GatewayStore;
  chain: ChainGateway;
  feePayerAddress: string;
  programId: string;
  /**
   * Runtime guardian key for the automatic quarantine trigger. Optional:
   * violation counting and BLOCK responses work without it; only the
   * automatic chain submission is skipped (manual POST /quarantine
   * retries later — quarantine is idempotent).
   */
  guardian?: FeePayer;
}

function blockResponse(row: ActionRequestRow): PreflightOutcome {
  return {
    kind: 'block',
    requestId: row.id,
    reasonCode: row.decision_reason_code ?? 'POLICY_BLOCKED',
    reason: reasonMessage((row.decision_reason_code as BlockReasonCode) ?? 'POLICY_BLOCKED'),
  };
}

function allowResponse(row: ActionRequestRow): PreflightOutcome | null {
  if (!row.unsigned_tx_b64 || !row.expires_at) {
    return null;
  }
  return {
    kind: 'allow',
    requestId: row.id,
    unsignedTransaction: row.unsigned_tx_b64,
    expiresAt: row.expires_at,
  };
}

/** Map an insert conflict to the correct outcome (original row wins). */
async function onInsertConflict(
  store: GatewayStore,
  missionId: string,
  idempotencyKey: string
): Promise<PreflightOutcome | null> {
  const existing = await store.getActionByIdempotency(missionId, idempotencyKey);
  if (!existing) {
    return null;
  }
  if (existing.decision === 'APPROVED') {
    return allowResponse(existing);
  }
  return blockResponse(existing);
}

export async function preflightAction(args: {
  deps: PreflightDeps;
  mission: MissionRow;
  agent: AgentRow;
  assignmentRole: string | null;
  body: PreflightBody;
  requestSignature: string;
  rawBody: string;
  nowMs: number;
}): Promise<PreflightOutcome> {
  const { deps, mission, agent, body, nowMs } = args;
  const { store, chain } = deps;

  // 1. Idempotency pre-check: duplicates return the ORIGINAL decision.
  const duplicate = await store.getActionByIdempotency(mission.id, body.idempotencyKey);
  if (duplicate) {
    if (duplicate.decision === 'APPROVED') {
      const allow = allowResponse(duplicate);
      if (allow) return allow;
      throw new Error('Approved action row misses its transaction bytes.');
    }
    return blockResponse(duplicate);
  }

  const requestHash = sha256HexUtf8(args.rawBody);
  const expiresAtMs = Date.parse(body.expiresAt);
  const agentNonce = BigInt(body.agentNonce);
  const amountAtomic = BigInt(body.amountAtomic);

  // 2. On-chain mission state (source of truth for agent/budget/nonce/expiry/status).
  // A DB row whose PDA has no chain account (Phase 3 placeholder draft) is
  // not executable: BLOCK MISSION_NOT_ACTIVE rather than 500.
  // Fetched before the insert closures so the narrowed state is visible
  // inside them (Phase 5 streak evaluation reads threshold/window here).
  const onchain = await chain.getMissionState(mission.pda_address);

  const insertBlocked = async (reasonCode: BlockReasonCode): Promise<PreflightOutcome> => {
    const outcome = await store.insertAction({
      mission_id: mission.id,
      agent_id: agent.id,
      idempotency_key: body.idempotencyKey,
      agent_nonce: Number(agentNonce),
      action_type: body.actionType,
      payload: { recipient: body.recipient, amountAtomic: body.amountAtomic },
      request_hash: requestHash,
      signature: args.requestSignature,
      decision: 'BLOCKED',
      decision_reason_code: reasonCode,
      violation_count_after: null,
      unsigned_tx_hash: null,
      unsigned_tx_b64: null,
      expires_at: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
    });
    if ('inserted' in outcome) {
      return {
        kind: 'block',
        requestId: outcome.inserted.id,
        reasonCode,
        reason: reasonMessage(reasonCode),
      };
    }
    const original = await onInsertConflict(store, mission.id, body.idempotencyKey);
    if (original) return original;
    // Same agent_nonce, different idempotency key: the nonce slot is
    // taken (program requires strictly-greater; gaps are legal, so the
    // agent retries with a higher nonce). Ephemeral id, nothing stored.
    return {
      kind: 'block',
      requestId: randomUUID(),
      reasonCode: 'STALE_AGENT_NONCE',
      reason: reasonMessage('STALE_AGENT_NONCE'),
    };
  };

  // Phase 5: counted policy violation. Only POLICY_BLOCKED rows count
  // toward the FR-04 streak (see streak.ts); the streak is evaluated
  // against the on-chain threshold/window (authoritative), the counted
  // value is stored on the row, and crossing the threshold fires the
  // automatic quarantine exactly once (edge-trigger + idempotent
  // quarantine as backstop). A quarantine failure never changes the
  // BLOCK response: the violation stands and POST /quarantine retries.
  const insertCountedBlock = async (counted: {
    threshold: number;
    windowSeconds: bigint;
  }): Promise<PreflightOutcome> => {
    const threshold = counted.threshold;
    const lastConfirmed = await store.lastConfirmedAt(mission.id, agent.id);
    const sinceIso = new Date(
      streakWindowStartMs({
        nowMs,
        windowSeconds: counted.windowSeconds,
        lastConfirmedAtMs: lastConfirmed ? Date.parse(lastConfirmed) : null,
      })
    ).toISOString();
    const prior = await store.countPolicyBlockedSince(
      mission.id,
      agent.id,
      COUNTED_REASON_CODE,
      sinceIso
    );
    const { streakAfter, crossed } = evaluateStreak({ blockedSinceReset: prior, threshold });
    const outcome = await store.insertAction({
      mission_id: mission.id,
      agent_id: agent.id,
      idempotency_key: body.idempotencyKey,
      agent_nonce: Number(agentNonce),
      action_type: body.actionType,
      payload: { recipient: body.recipient, amountAtomic: body.amountAtomic },
      request_hash: requestHash,
      signature: args.requestSignature,
      decision: 'BLOCKED',
      decision_reason_code: 'POLICY_BLOCKED',
      violation_count_after: streakAfter,
      unsigned_tx_hash: null,
      unsigned_tx_b64: null,
      expires_at: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
    });
    if (!('inserted' in outcome)) {
      const original = await onInsertConflict(store, mission.id, body.idempotencyKey);
      if (original) return original;
      return {
        kind: 'block',
        requestId: randomUUID(),
        reasonCode: 'STALE_AGENT_NONCE',
        reason: reasonMessage('STALE_AGENT_NONCE'),
      };
    }
    const requestId = outcome.inserted.id;
    await writeAuditEvent({
      store,
      missionId: mission.id,
      eventType: 'violation.counted',
      actor: { type: 'agent', id: agent.id },
      signature: null,
      payload: { request_id: requestId, streak_after: streakAfter, threshold },
      nowMs,
    });
    if (crossed) {
      await writeAuditEvent({
        store,
        missionId: mission.id,
        eventType: 'violation.threshold_reached',
        actor: { type: 'system', id: null },
        signature: null,
        payload: { request_id: requestId, streak: streakAfter, threshold },
        nowMs,
      });
      if (deps.guardian) {
        try {
          await quarantineMission({
            deps: {
              store,
              chain,
              guardian: deps.guardian,
              programId: deps.programId,
            },
            mission,
            agent,
            actor: { type: 'system', id: null },
            nowMs,
          });
        } catch {
          // BLOCK stands; manual POST /quarantine retries (idempotent).
        }
      }
    }
    return {
      kind: 'block',
      requestId,
      reasonCode: 'POLICY_BLOCKED',
      reason: reasonMessage('POLICY_BLOCKED'),
    };
  };

  // Phase 4: only PRIMARY assignments submit (successor activation is Phase 6).
  if (args.assignmentRole !== 'PRIMARY') {
    return insertBlocked('AGENT_NOT_CURRENT');
  }

  if (!onchain) {
    return insertBlocked('MISSION_NOT_ACTIVE');
  }

  // 3. Policy snapshot + pure FR-03 evaluation.
  const policy = await store.getLatestPolicy(mission.id);
  const decision = evaluatePolicy({
    policy: {
      maxActionAtomic: policy?.max_action_atomic ? BigInt(policy.max_action_atomic) : null,
      allowedActionTypes: policy?.allowed_action_types ?? null,
      allowedRecipients: policy?.allowed_recipients ?? null,
    },
    chain: {
      status: onchain.status,
      currentAgent: onchain.currentAgent,
      remainingBudgetAtomic: onchain.remainingBudget,
      agentNonce: onchain.agentNonce,
      expiresAtSec: onchain.expiresAtSec,
      mintAddress: onchain.mint,
    },
    intent: {
      agentPublicKey: agent.public_key,
      agentNonce,
      actionType: body.actionType,
      recipient: body.recipient,
      amountAtomic,
      expiresAtMs,
    },
    nowMs,
  });
  if (decision.decision === 'BLOCK') {
    if (decision.reasonCode === 'POLICY_BLOCKED') {
      return insertCountedBlock({
        threshold: onchain.violationThreshold,
        windowSeconds: onchain.violationWindowSeconds,
      });
    }
    return insertBlocked(decision.reasonCode);
  }

  // 4. ALLOW: build the execute_action message (reads only: blockhash
  // for message lifetime; no transaction is sent, nothing is mutated).
  const { blockhash, lastValidBlockHeight } = await chain.getLatestBlockhash();
  const vault = await findVaultPda(deps.programId, onchain.address);
  const planned = planExecuteInstruction(
    deps.programId,
    body.actionType === 'TRANSFER_SOL'
      ? { agent: agent.public_key, mission: onchain.address, recipient: body.recipient, vault }
      : {
          agent: agent.public_key,
          mission: onchain.address,
          recipient: body.recipient,
          vault,
          splVault: await findSplVaultPda(deps.programId, onchain.address),
          recipientTokenAccount: await findAssociatedTokenAddress(body.recipient, onchain.mint),
        },
    {
      actionType: body.actionType,
      recipient: base58ToBytes32(body.recipient),
      amount: amountAtomic,
      nonce: agentNonce,
    }
  );
  const instruction: Instruction = {
    programAddress: address(planned.programAddress),
    accounts: planned.accounts.map((meta) => ({
      address: address(meta.address),
      role: toKitRole(meta.role),
    })),
    data: planned.data,
  };
  // address() already enforces 32-byte base58; the Blockhash brand is
  // compile-time only (kit brands RPC blockhashes identically).
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(address(deps.feePayerAddress), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: address(blockhash) as unknown as Blockhash, lastValidBlockHeight },
        m
      ),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );
  const messageBytes = new Uint8Array(compileTransaction(message).messageBytes);
  const unsignedTransaction = messageToBase64(messageBytes);
  const unsignedTxHash = hashMessageBytes(messageBytes);

  const outcome = await store.insertAction({
    mission_id: mission.id,
    agent_id: agent.id,
    idempotency_key: body.idempotencyKey,
    agent_nonce: Number(agentNonce),
    action_type: body.actionType,
    payload: { recipient: body.recipient, amountAtomic: body.amountAtomic },
    request_hash: requestHash,
    signature: args.requestSignature,
    decision: 'APPROVED',
    decision_reason_code: null,
    violation_count_after: null,
    unsigned_tx_hash: unsignedTxHash,
    unsigned_tx_b64: unsignedTransaction,
    expires_at: new Date(expiresAtMs).toISOString(),
  });
  if ('inserted' in outcome) {
    return {
      kind: 'allow',
      requestId: outcome.inserted.id,
      unsignedTransaction,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }
  const original = await onInsertConflict(store, mission.id, body.idempotencyKey);
  if (original) return original;
  return {
    kind: 'block',
    requestId: randomUUID(),
    reasonCode: 'STALE_AGENT_NONCE',
    reason: reasonMessage('STALE_AGENT_NONCE'),
  };
}
