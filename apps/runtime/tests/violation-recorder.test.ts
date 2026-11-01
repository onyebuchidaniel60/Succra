import { describe, expect, it, vi } from 'vitest';
import {
  COUNTABLE_VIOLATION_REASON_CODES,
  runViolationRecorder,
  type RecorderAuditEvent,
  type RecorderMission,
  type UnprocessedBlockedRequest,
  type ViolationRecorderDeps,
} from '../src/monitor/violation-recorder.js';

const MISSION_ID = '11111111-1111-4111-8111-111111111111';
const MISSION_ADDRESS = `0x${'11'.repeat(20)}` as `0x${string}`;
const TX = `0x${'aa'.repeat(32)}`;
const QUARANTINE_TX = `0x${'bb'.repeat(32)}`;

function row(index: number): UnprocessedBlockedRequest {
  return {
    id: `action-${index}`,
    mission_id: MISSION_ID,
    agent_id: 'agent-1',
    request_id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
    onchain_request_id: `0x${String(index).padStart(64, '0')}`,
    decision: 'BLOCK',
    decision_reason_code: 'MERCHANT_NOT_ALLOWED',
    created_at: new Date(1_700_000_000_000 + index).toISOString(),
    violation_attempts: 0,
    violation_poisoned: false,
  };
}

function harness(input: { rows?: UnprocessedBlockedRequest[]; threshold?: number } = {}) {
  const rows = input.rows ?? [row(1)];
  const recorded = new Set<string>();
  const poisoned = new Set<string>();
  const events: RecorderAuditEvent[] = [];
  const attempts = new Map<string, number>();
  let count = 0;
  let version = 0;
  let onchainStatus = 'ACTIVE';
  let failRecord = false;
  let failQuarantine = false;

  const mission: RecorderMission = {
    id: MISSION_ID,
    contract_address: MISSION_ADDRESS,
    pda_address: MISSION_ADDRESS,
    status: 'ACTIVE',
    current_agent_id: 'agent-1',
  };

  const deps: ViolationRecorderDeps = {
    listUnprocessed: vi.fn(async () =>
      rows.filter((item) => !recorded.has(item.id) && !poisoned.has(item.id))
    ),
    getMission: vi.fn(async () => mission),
    readState: vi.fn(async () => ({
      status: onchainStatus,
      stateVersion: BigInt(version),
      violationCount: count,
      violationThreshold: input.threshold ?? 3,
    })),
    recordViolation: vi.fn(async ({ expectedVersion }) => {
      if (failRecord) throw Object.assign(new Error('transient'), { errorName: 'RPC_DOWN' });
      if (expectedVersion !== BigInt(version)) {
        throw Object.assign(new Error('stale'), { errorName: 'InvalidVersion' });
      }
      version += 1;
      count += 1;
      return { txHash: TX };
    }),
    quarantine: vi.fn(async () => {
      if (failQuarantine) throw Object.assign(new Error('rejected'), { errorName: 'RPC_DOWN' });
      onchainStatus = 'QUARANTINED';
      version += 1;
      return { txHash: QUARANTINE_TX };
    }),
    markRecorded: vi.fn(async (actionRequestId, txHash) => {
      void txHash;
      recorded.add(actionRequestId);
    }),
    markAttemptFailed: vi.fn(async (actionRequestId, nextAttempts, isPoisoned) => {
      const target = rows.find((item) => item.id === actionRequestId);
      if (target) target.violation_attempts = nextAttempts;
      attempts.set(actionRequestId, nextAttempts);
      if (isPoisoned) poisoned.add(actionRequestId);
    }),
    insertAuditEvent: vi.fn(async (event) => {
      events.push(event);
    }),
    getRecentAuditEvents: vi.fn(async () =>
      events.map((event) => ({ event_type: event.event_type }))
    ),
    updateMissionStatusToQuarantined: vi.fn(async () => undefined),
    updateCurrentAgentStatusToQuarantined: vi.fn(async () => undefined),
    now: () => 1_700_000_100_000,
  };

  return {
    deps,
    rows,
    recorded,
    poisoned,
    events,
    attempts,
    get count() {
      return count;
    },
    setFailRecord(value: boolean) {
      failRecord = value;
    },
    setFailQuarantine(value: boolean) {
      failQuarantine = value;
    },
  };
}

describe('Phase 5 violation recorder', () => {
  it('uses the PROJECT_SPEC §6 countable reason-code set', () => {
    expect([...COUNTABLE_VIOLATION_REASON_CODES]).toEqual([
      'INVALID_ACTION_TYPE',
      'MERCHANT_NOT_ALLOWED',
      'TOKEN_NOT_ALLOWED',
      'AMOUNT_EXCEEDS_MAX',
      'BUDGET_EXHAUSTED',
    ]);
  });

  it('picks up unprocessed BLOCKED rows and submits recordViolation for each', async () => {
    const h = harness({ rows: [row(1), row(2)] });
    const result = await runViolationRecorder(h.deps);
    expect(h.deps.listUnprocessed).toHaveBeenCalledWith(25);
    expect(h.deps.recordViolation).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ checked: 2, recorded: 2, quarantined: 0, failed: 0 });
  });

  it('marks rows as recorded after confirmation', async () => {
    const h = harness({ rows: [row(1), row(2)] });
    await runViolationRecorder(h.deps);
    expect(h.deps.markRecorded).toHaveBeenCalledWith('action-1', TX);
    expect(h.deps.markRecorded).toHaveBeenCalledWith('action-2', TX);
    expect([...h.recorded]).toEqual(['action-1', 'action-2']);
  });

  it('detects the threshold crossing and submits quarantine exactly once', async () => {
    const h = harness({ rows: [row(1), row(2), row(3)] });
    const result = await runViolationRecorder(h.deps);
    expect(h.count).toEqual(3);
    expect(h.deps.quarantine).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ checked: 3, recorded: 3, quarantined: 1, failed: 0 });
    expect(h.deps.updateMissionStatusToQuarantined).toHaveBeenCalledWith(MISSION_ID);
    expect(h.deps.updateCurrentAgentStatusToQuarantined).toHaveBeenCalledWith(MISSION_ID);
  });

  it('writes violation.threshold_reached, quarantine.submitted, and quarantine.confirmed', async () => {
    const h = harness({ rows: [row(1), row(2), row(3)] });
    await runViolationRecorder(h.deps);
    expect(h.events.map((event) => event.event_type)).toEqual([
      'violation.threshold_reached',
      'quarantine.submitted',
      'quarantine.confirmed',
    ]);
    expect(h.events.every((event) => event.actor_type === 'runtime')).toEqual(true);
    expect(h.events[0]?.payload_public).toMatchObject({ violationCount: 3, violationThreshold: 3 });
  });

  it('is idempotent: re-running on already-processed rows is a no-op', async () => {
    const h = harness({ rows: [row(1), row(2), row(3)] });
    await runViolationRecorder(h.deps);
    const second = await runViolationRecorder(h.deps);
    expect(second).toEqual({ checked: 0, recorded: 0, quarantined: 0, failed: 0 });
    expect(h.deps.quarantine).toHaveBeenCalledTimes(1);
  });

  it('retries failed submissions and poisons after the attempt limit', async () => {
    const h = harness({ rows: [row(1)] });
    h.setFailRecord(true);

    await runViolationRecorder(h.deps);
    await runViolationRecorder(h.deps);
    await runViolationRecorder(h.deps);
    expect(h.attempts.get('action-1')).toEqual(3);
    expect(h.poisoned.has('action-1')).toEqual(true);

    const fourth = await runViolationRecorder(h.deps);
    expect(fourth.checked).toEqual(0);
    expect(h.deps.recordViolation).toHaveBeenCalledTimes(3);
  });

  it('leaves the row unrecorded when quarantine submission fails, then retries', async () => {
    const h = harness({ rows: [row(1), row(2), row(3)] });
    h.setFailQuarantine(true);
    const first = await runViolationRecorder(h.deps);
    expect(first.quarantined).toEqual(0);
    expect(first.failed).toEqual(1);
    expect(h.recorded.has('action-3')).toEqual(false);
    expect(h.attempts.get('action-3')).toEqual(1);

    h.setFailQuarantine(false);
    await runViolationRecorder(h.deps);
    expect(h.deps.quarantine).toHaveBeenCalledTimes(2);
    expect(h.recorded.has('action-3')).toEqual(true);
  });
});
