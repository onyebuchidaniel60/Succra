// Succra web — audit event display mapping.
//
// This module is pure: it turns immutable audit_events rows into human-
// readable timeline entries and proof links. It never writes audit rows.
import { shortenAddress } from '@/lib/format';

export type AuditSeverity = 'success' | 'warning' | 'danger' | 'info';

export interface AuditEvent {
  id: string;
  mission_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  payload_public: Record<string, unknown> | null;
  onchain_tx_hash: string | null;
  created_at: string;
}

export interface FormattedAuditEvent {
  icon: string;
  title: string;
  description: string;
  proofLink: string | null;
  severity: AuditSeverity;
}

const DEFAULT_EXPLORER = 'https://hashkey.blockscout.com';

export function explorerBaseUrl(): string {
  return process.env.NEXT_PUBLIC_HASHKEY_EXPLORER_URL ?? DEFAULT_EXPLORER;
}

export function explorerTxUrl(txHash: string): string {
  return `${explorerBaseUrl().replace(/\/$/, '')}/tx/${txHash}`;
}

function payload(event: AuditEvent): Record<string, unknown> {
  return event.payload_public ?? {};
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return null;
}

function address(value: unknown): string | null {
  const raw = text(value);
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? shortenAddress(raw, 4) : raw;
}

function txHash(event: AuditEvent): string | null {
  return event.onchain_tx_hash ?? text(payload(event)['txHash']);
}

function proofFor(event: AuditEvent): string | null {
  const hash = txHash(event);
  return hash ? explorerTxUrl(hash) : null;
}

function base(event: AuditEvent): Pick<FormattedAuditEvent, 'proofLink'> {
  return { proofLink: proofFor(event) };
}

function reasonLabel(reason: unknown): string {
  const value = text(reason) ?? 'POLICY_BLOCK';
  return value.replaceAll('_', ' ').toLowerCase();
}

export function actorLabel(actorType: string): string {
  switch (actorType) {
    case 'owner':
      return 'Owner';
    case 'guardian':
      return 'Guardian';
    case 'agent':
      return 'Agent';
    case 'runtime':
      return 'Runtime';
    case 'system':
      return 'System';
    default:
      return actorType;
  }
}

export function formatAuditEvent(event: AuditEvent): FormattedAuditEvent {
  const data = payload(event);
  switch (event.event_type) {
    case 'mission.created':
      return {
        icon: '✓',
        title: 'Mission created',
        description: `SuccraMission deployed at ${address(data['contractAddress']) ?? '—'}. Policy ${shortenAddress(text(data['policyHash']) ?? '—')}.`,
        severity: 'success',
        ...base(event),
      };
    case 'payment.confirmed':
    case 'payment.settled':
    case 'settlement.confirmed': {
      const amount = text(data['amountAtomic']) ?? '—';
      const token = address(data['tokenAddress']) ?? 'the settlement token';
      const merchant = address(data['merchantAddress']) ?? 'the merchant';
      const mandate = text(data['hspPaymentMandateId']);
      return {
        icon: '↗',
        title: `Payment of ${amount} atomic ${token}`,
        description: `Paid ${merchant}${mandate ? `; HSP mandate ${mandate}` : ''}.`,
        severity: 'success',
        ...base(event),
      };
    }
    case 'checkpoint.verified': {
      const sequence = text(data['sequence']) ?? '?';
      const hash = text(data['checkpointHash']);
      const payments = Array.isArray(data['confirmedPaymentIds'])
        ? data['confirmedPaymentIds'].length
        : 0;
      return {
        icon: '◆',
        title: `Checkpoint #${sequence} committed`,
        description: `${payments} confirmed payment${payments === 1 ? '' : 's'}${hash ? `; hash ${shortenAddress(hash, 6)}` : ''}.`,
        severity: 'success',
        ...base(event),
      };
    }
    case 'violation.counted': {
      const reason = reasonLabel(data['reasonCode']);
      const count = text(data['violationCountAfter']);
      return {
        icon: '⚠',
        title: `Policy violation (${reason})`,
        description: `Request ${text(data['requestId']) ?? '—'} blocked${count ? `; violation count ${count}` : ''}.`,
        severity: 'warning',
        ...base(event),
      };
    }
    case 'violation.recorded':
      return {
        icon: '⚠',
        title: 'Violation confirmed on-chain',
        description: `Request ${text(data['requestId']) ?? '—'} recorded at violation count ${text(data['onchainViolationCount']) ?? '—'}.`,
        severity: 'warning',
        ...base(event),
      };
    case 'violation.threshold_reached':
      return {
        icon: '⚠',
        title: 'Violation threshold reached',
        description: `The consecutive streak reached ${text(data['violationCount']) ?? '—'} of ${text(data['violationThreshold']) ?? '—'}.`,
        severity: 'danger',
        ...base(event),
      };
    case 'quarantine.submitted':
      return {
        icon: '⛨',
        title: 'Quarantine submitted',
        description: `The guardian submitted quarantine from ${text(data['previousStatus']) ?? 'the active state'}.`,
        severity: 'danger',
        ...base(event),
      };
    case 'quarantine.confirmed':
      return {
        icon: '⛔',
        title: 'Mission quarantined',
        description: 'The current agent lost payment authority. No funds moved.',
        severity: 'danger',
        ...base(event),
      };
    case 'succession.triggered': {
      const outcome = text(data['outcome']);
      if (outcome === 'no_eligible_successor') {
        return {
          icon: '⛔',
          title: 'No eligible successor — mission halted',
          description: 'No pre-approved successor passed the deterministic eligibility checks.',
          severity: 'danger',
          ...base(event),
        };
      }
      if (outcome === 'no_verified_checkpoint') {
        return {
          icon: '⛔',
          title: 'Succession blocked — no verified checkpoint',
          description: 'The recovery boundary is missing, so no successor was activated.',
          severity: 'danger',
          ...base(event),
        };
      }
      return {
        icon: '↪',
        title: 'Succession triggered',
        description: `Trigger: ${text(data['trigger']) ?? 'unknown'}. The latest verified checkpoint is the recovery boundary.`,
        severity: 'warning',
        ...base(event),
      };
    }
    case 'succession.candidate_selected':
      return {
        icon: '↪',
        title: `Successor candidate selected: ${address(data['candidate']) ?? '—'}`,
        description: `Priority ${text(data['priority']) ?? '—'}; checkpoint #${text(data['checkpoint_sequence']) ?? '—'}.`,
        severity: 'info',
        ...base(event),
      };
    case 'succession.activate.submitted':
      return {
        icon: '↪',
        title: 'Successor activation submitted',
        description: `${address(data['candidate']) ?? 'The successor'} is being activated with recovery authority.`,
        severity: 'warning',
        ...base(event),
      };
    case 'succession.activate.confirmed':
      return {
        icon: '✓',
        title: 'Successor activated',
        description: `${address(data['candidate']) ?? 'The successor'} is current while the mission is RECOVERING.`,
        severity: 'success',
        ...base(event),
      };
    case 'succession.acknowledge.submitted':
      return {
        icon: '↪',
        title: 'Recovery acknowledgement submitted',
        description: `${address(data['successor']) ?? 'The successor'} signed the recovery acknowledgement.`,
        severity: 'warning',
        ...base(event),
      };
    case 'succession.acknowledge.confirmed':
      return {
        icon: '✓',
        title: 'Recovery acknowledged — successor is now the current agent',
        description: 'The mission is ACTIVE_RECOVERY under the reduced recovery ceiling.',
        severity: 'success',
        ...base(event),
      };
    default:
      return {
        icon: '•',
        title: event.event_type,
        description: Object.keys(data).length > 0 ? JSON.stringify(data) : 'Audit event recorded.',
        severity: 'info',
        ...base(event),
      };
  }
}

/** Input for Timeline checkpoint-pending detection. */
export interface CheckpointPendingState {
  eventId: string;
  pending: boolean;
}

const CHECKPOINT_WINDOW_MS = 5 * 60 * 1000;

/**
 * A settlement event without a following checkpoint.verified within five
 * minutes is shown as pending. Computed client-side from the event array;
 * no extra endpoint is required.
 */
export function checkpointPendingStates(events: AuditEvent[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const ordered = [...events].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)
  );
  for (const [index, event] of ordered.entries()) {
    const isSettlement =
      event.event_type.startsWith('payment.') || event.event_type.includes('settlement');
    if (!isSettlement) continue;
    const at = Date.parse(event.created_at);
    const checkpoint = ordered
      .slice(index + 1)
      .find((candidate) => candidate.event_type === 'checkpoint.verified');
    const inWindow =
      checkpoint !== undefined && Date.parse(checkpoint.created_at) - at <= CHECKPOINT_WINDOW_MS;
    result.set(event.id, !inWindow);
  }
  return result;
}

/** Duplicate checkpoint sequences are impossible on-chain, but display defensively. */
export function duplicateCheckpointSequences(events: AuditEvent[]): Set<number> {
  const counts = new Map<number, number>();
  for (const event of events) {
    if (event.event_type !== 'checkpoint.verified') continue;
    const sequence = Number(payload(event)['sequence']);
    if (!Number.isInteger(sequence)) continue;
    counts.set(sequence, (counts.get(sequence) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([sequence]) => sequence)
  );
}
