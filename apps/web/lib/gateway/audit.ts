// Succra gateway — immutable audit event writer (shared by quarantine,
// succession, and checkpoint flows).
//
// Audit rows are append-only facts: (mission, type, actor, signature,
// payload) hashed with SHA-256 over the canonical JSON encoding.
// Phase 5 dotted event-type convention
// (violation.counted, quarantine.submitted, ...) continues in Phase 6
// (checkpoint.verified, succession.*). No step reads audit rows to make
// decisions; the chain stays authoritative.
import { sha256HexUtf8 } from '@succra/shared';
import type { GatewayStore } from './store';

// Named for its Phase 5 origin; covers every gateway actor type.
export type QuarantineActor =
  | { type: 'agent'; id: string }
  | { type: 'guardian'; id: null }
  | { type: 'owner'; id: string }
  | { type: 'system'; id: null };

function eventHash(event: Record<string, unknown>): string {
  return sha256HexUtf8(JSON.stringify(event));
}

/** Write an immutable audit row. */
export async function writeAuditEvent(args: {
  store: GatewayStore;
  missionId: string;
  eventType: string;
  actor: QuarantineActor;
  signature: string | null;
  payload: Record<string, unknown>;
  nowMs: number;
}): Promise<void> {
  const atIso = new Date(args.nowMs).toISOString();
  await args.store.insertAuditEvent({
    mission_id: args.missionId,
    event_type: args.eventType,
    actor_type: args.actor.type,
    actor_id: args.actor.id,
    event_hash: eventHash({
      mission_id: args.missionId,
      event_type: args.eventType,
      actor_type: args.actor.type,
      actor_id: args.actor.id,
      signature: args.signature,
      at: atIso,
      payload: args.payload,
    }),
    payload_public: { ...args.payload, at: atIso },
    onchain_signature: args.signature,
  });
}
