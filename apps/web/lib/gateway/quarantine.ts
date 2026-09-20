// Succra gateway — quarantine flow (POST /api/missions/:id/quarantine,
// plus the automatic trigger when a pre-flight crosses the threshold).
//
// State machine per ARCHITECTURE.md §11:
//   ACTIVE ──guardian──▶ QUARANTINED (compare-and-set mirror; 0 rows
//   means already handled). The ONLY Phase 5 status transition.
// The chain is authoritative: a mission already QUARANTINED on-chain
// short-circuits to already-quarantined without sending; a mission that
// is not ACTIVE is rejected without sending. The guardian signs exactly
// one instruction (quarantine) and pays its own fees — it never signs as
// an agent and never touches a vault, so it cannot spend (AGENTS.md
// invariants). No DB transaction is held open across chain I/O.
import {
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
import { bytesToBase58, bytesToBase64, encodeWireTransaction } from '@succra/shared';
import { planQuarantineInstruction } from '@succra/shared';
import type { ChainGateway, FeePayer } from './chain';
import type { AgentRow, GatewayStore, MissionRow } from './store';
import { toKitRole } from './preflight';
import { writeAuditEvent, type QuarantineActor } from './audit';

export type { QuarantineActor };

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

export interface QuarantineDeps {
  store: GatewayStore;
  chain: ChainGateway;
  guardian: FeePayer;
  programId: string;
  /** Test-only polling override (production uses the constants above). */
  poll?: { intervalMs: number; timeoutMs: number };
}

export type QuarantineOutcome =
  | { kind: 'confirmed'; signature: string; slot: number }
  | { kind: 'already'; signature: string | null }
  | { kind: 'failed'; signature: string | null; code: string; message: string }
  | { kind: 'error'; status: number; code: string; message: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Quarantine a mission: guardian-signed instruction, polled to terminal,
 * mirrored compare-and-set into the DB, audit rows around submission and
 * confirmation. Idempotent: an already-quarantined mission short-circuits
 * without sending and without double-writing state.
 */
export async function quarantineMission(args: {
  deps: QuarantineDeps;
  mission: MissionRow;
  /** Agent being quarantined, when the trigger knows it (audit payload). */
  agent: AgentRow | null;
  actor: QuarantineActor;
  nowMs: number;
}): Promise<QuarantineOutcome> {
  const { deps, mission, agent, actor, nowMs } = args;
  const { store, chain, guardian } = deps;

  // 1. The chain is authoritative: already-quarantined short-circuits.
  const onchain = await chain.getMissionState(mission.pda_address);
  if (!onchain) {
    return {
      kind: 'error',
      status: 409,
      code: 'QUARANTINE_NOT_ALLOWED',
      message: 'Mission has no on-chain state to quarantine.',
    };
  }
  if (onchain.status === 'Quarantined') {
    await store.markMissionQuarantined(mission.id, new Date(nowMs).toISOString());
    return { kind: 'already', signature: null };
  }
  if (onchain.status !== 'Active') {
    return {
      kind: 'error',
      status: 409,
      code: 'QUARANTINE_NOT_ALLOWED',
      message: `Only ACTIVE missions can be quarantined (on-chain status is ${onchain.status}).`,
    };
  }

  // 2. Build the guardian-signed quarantine message (single instruction,
  // no vault accounts: nothing can move funds through this path).
  const { blockhash, lastValidBlockHeight } = await chain.getLatestBlockhash();
  const planned = planQuarantineInstruction(deps.programId, {
    guardian: guardian.address,
    mission: onchain.address,
  });
  const instruction: Instruction = {
    programAddress: address(planned.programAddress),
    accounts: planned.accounts.map((meta) => ({
      address: address(meta.address),
      role: toKitRole(meta.role),
    })),
    data: planned.data,
  };
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(address(guardian.address), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: address(blockhash) as unknown as Blockhash, lastValidBlockHeight },
        m
      ),
    (m) => appendTransactionMessageInstruction(instruction, m)
  );
  const messageBytes = new Uint8Array(compileTransaction(message).messageBytes);
  const guardianSig = guardian.signBytes(messageBytes);
  const wireB64 = bytesToBase64(encodeWireTransaction([guardianSig], messageBytes));
  const expectedSignature = bytesToBase58(guardianSig);
  const auditPayload = {
    agent_id: agent?.id ?? null,
    agent_public_key: agent?.public_key ?? null,
  };

  // 3. Send. On send failure, reconcile: a landed transaction still
  // counts (a concurrent quarantine may have won the race).
  let signature: string;
  try {
    signature = await chain.sendRawTransaction(wireB64);
  } catch (error) {
    const landed = await chain.getSignatureStatus(expectedSignature).catch(() => null);
    if (landed) {
      return pollToTerminal(
        store,
        chain,
        mission,
        expectedSignature,
        actor,
        auditPayload,
        nowMs,
        deps.poll
      );
    }
    void error;
    return {
      kind: 'failed',
      signature: expectedSignature,
      code: 'CHAIN_REJECTION',
      message: 'Quarantine transaction was rejected before confirmation.',
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
  await writeAuditEvent({
    store,
    missionId: mission.id,
    eventType: 'quarantine.submitted',
    actor,
    signature,
    payload: auditPayload,
    nowMs,
  });
  return pollToTerminal(store, chain, mission, signature, actor, auditPayload, nowMs, deps.poll);
}

/** Poll a submitted quarantine signature to its terminal state. */
async function pollToTerminal(
  store: GatewayStore,
  chain: ChainGateway,
  mission: MissionRow,
  signature: string,
  actor: QuarantineActor,
  auditPayload: Record<string, unknown>,
  nowMs: number,
  poll?: { intervalMs: number; timeoutMs: number }
): Promise<QuarantineOutcome> {
  const interval = poll?.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (poll?.timeoutMs ?? POLL_TIMEOUT_MS);
  for (;;) {
    const status = await chain.getSignatureStatus(signature).catch(() => null);
    if (status && status.err != null) {
      return {
        kind: 'failed',
        signature,
        code: 'CHAIN_REJECTION',
        message: 'Quarantine transaction was rejected by the cluster.',
      };
    }
    if (status && status.err == null) {
      await store.markMissionQuarantined(mission.id, new Date(nowMs).toISOString());
      // Phase 6: mark the latest VERIFIED checkpoint as the recovery
      // boundary (recorded in the audit payload; best-effort).
      const boundary = await store.latestVerifiedCheckpoint(mission.id).catch(() => null);
      await writeAuditEvent({
        store,
        missionId: mission.id,
        eventType: 'quarantine.confirmed',
        actor,
        signature,
        payload: {
          ...auditPayload,
          slot: status.slot,
          checkpoint_boundary: boundary
            ? {
                checkpoint_id: boundary.id,
                sequence: boundary.sequence,
                checkpoint_hash: boundary.checkpoint_hash,
              }
            : null,
        },
        nowMs,
      });
      return { kind: 'confirmed', signature, slot: status.slot };
    }
    if (Date.now() >= deadline) {
      return {
        kind: 'error',
        status: 504,
        code: 'CONFIRMATION_TIMEOUT',
        message: 'Confirmation timed out; retry quarantine to resume polling.',
      };
    }
    await sleep(interval);
  }
}
