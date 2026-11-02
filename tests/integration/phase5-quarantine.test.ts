// Phase 5 integration: violation recording, quarantine, audit mirrors, and the
// real Phase 5 migration on PGlite.
//
// The chain double below enforces the same state-version, status, window, and
// per-request idempotency rules as SuccraMission. Contract-level enforcement is
// independently covered by the Hardhat suites; this file proves the runtime/DB
// flow and migration behavior without a second node.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, describe, expect, it } from 'vitest';
import { requestQuarantine, type QuarantineDeps } from '../../apps/web/lib/gateway/quarantine-evm';
import {
  createPhase4TestDb,
  createPhase5TestDb,
} from '../../apps/web/tests/helpers/pglite-gateway-store';
import {
  runViolationRecorder,
  type RecorderMission,
  type RecorderOnChainState,
  type UnprocessedBlockedRequest,
  type ViolationRecorderDeps,
} from '../../apps/runtime/src/monitor/violation-recorder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHASE5_MIGRATION = readFileSync(
  join(ROOT, 'supabase', 'migrations', '20261104000000_phase5_audit_events.sql'),
  'utf8'
);
const COUNTABLE = [
  'INVALID_ACTION_TYPE',
  'MERCHANT_NOT_ALLOWED',
  'TOKEN_NOT_ALLOWED',
  'AMOUNT_EXCEEDS_MAX',
  'BUDGET_EXHAUSTED',
];
const NOW = 1_700_000_000;

class ChainDouble {
  status = 'ACTIVE';
  stateVersion = 0n;
  violationCount = 0;
  lastViolationAt = 0n;
  confirmedSpentAtomic = 0n;
  now = BigInt(NOW);
  readonly threshold: number;
  readonly windowSeconds: bigint;
  private readonly violations = new Set<string>();
  quarantineCalls = 0;
  recordCalls = 0;

  constructor(options: { threshold?: number; windowSeconds?: bigint } = {}) {
    this.threshold = options.threshold ?? 3;
    this.windowSeconds = options.windowSeconds ?? 900n;
  }

  state(): RecorderOnChainState {
    return {
      status: this.status,
      stateVersion: this.stateVersion,
      violationCount: this.violationCount,
      violationThreshold: this.threshold,
    };
  }

  advance(seconds: number): void {
    this.now += BigInt(seconds);
  }

  recordViolation(requestId: string, expectedVersion: bigint): { txHash: string } {
    if (expectedVersion !== this.stateVersion) {
      throw Object.assign(new Error('stale'), { errorName: 'InvalidVersion' });
    }
    if (this.status !== 'ACTIVE' && this.status !== 'ACTIVE_RECOVERY') {
      throw Object.assign(new Error('status'), { errorName: 'InvalidStatus' });
    }
    if (this.violations.has(requestId)) {
      throw Object.assign(new Error('duplicate'), { errorName: 'ViolationAlreadyRecorded' });
    }
    if (this.lastViolationAt > 0n && this.now - this.lastViolationAt > this.windowSeconds) {
      this.violationCount = 0;
    }
    this.recordCalls += 1;
    this.violations.add(requestId);
    this.violationCount += 1;
    this.lastViolationAt = this.now;
    this.stateVersion += 1n;
    return { txHash: `0x${String(this.recordCalls).padStart(64, 'a')}` };
  }

  quarantine(expectedVersion: bigint): { txHash: string } {
    if (expectedVersion !== this.stateVersion) {
      throw Object.assign(new Error('stale'), { errorName: 'InvalidVersion' });
    }
    if (this.status === 'QUARANTINED') {
      throw Object.assign(new Error('already'), { errorName: 'AlreadyQuarantined' });
    }
    if (this.status !== 'ACTIVE' && this.status !== 'ACTIVE_RECOVERY') {
      throw Object.assign(new Error('status'), { errorName: 'InvalidStatus' });
    }
    this.quarantineCalls += 1;
    this.status = 'QUARANTINED';
    this.stateVersion += 1n;
    return { txHash: `0x${String(this.quarantineCalls).padStart(64, 'b')}` };
  }

  recordSettlement(): void {
    this.confirmedSpentAtomic += 1n;
    this.violationCount = 0;
    this.lastViolationAt = 0n;
    this.stateVersion += 1n;
  }
}

interface World {
  db: PGlite;
  ownerId: string;
  missionId: string;
  missionAddress: `0x${string}`;
  agentId: string;
  chain: ChainDouble;
  deps: ViolationRecorderDeps & Pick<QuarantineDeps, 'submitQuarantine'>;
  insertBlocked(reasonCode: string, index: number): Promise<string>;
  close(): Promise<void>;
}

async function one(
  db: PGlite,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown> | null> {
  const result = await db.query<Record<string, unknown>>(sql, params);
  return result.rows[0] ?? null;
}

async function createWorld(options: { threshold?: number } = {}): Promise<World> {
  const db = await createPhase5TestDb();
  const chain = new ChainDouble({ threshold: options.threshold });
  const ownerId = randomUUID();
  const missionId = randomUUID();
  const agentId = randomUUID();
  const missionAddress =
    `0x${missionId.replace(/-/g, '').padEnd(40, '0').slice(0, 40)}` as `0x${string}`;
  const agentAddress = `0x${'22'.repeat(20)}`;

  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
  await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
    ownerId,
    `0x${'33'.repeat(20)}`,
  ]);
  await db.query(
    `INSERT INTO agents (id, owner_id, name, address, public_key, status)
     VALUES ($1, $2, 'Alpha', $3, $3, 'REGISTERED')`,
    [agentId, ownerId, agentAddress]
  );
  await db.query(
    `INSERT INTO missions
       (id, owner_id, name, objective, pda_address, vault_address, mint_address,
        budget_atomic, remaining_budget_atomic, status, current_agent_id,
        current_agent_public_key, policy_version, policy_hash, expires_at,
        contract_address, factory_address, owner_address, payment_token_address,
        current_agent_address)
     VALUES ($1,$2,'Phase 5','Quarantine',$3,'unused',$4,'1000','1000','ACTIVE',$5,
        $6,1,'hash',now() + interval '1 hour',$3,$7,$8,$4,$6)`,
    [
      missionId,
      ownerId,
      missionAddress,
      `0x${'44'.repeat(20)}`,
      agentId,
      agentAddress,
      `0x${'55'.repeat(20)}`,
      `0x${'33'.repeat(20)}`,
    ]
  );
  await db.query(
    `INSERT INTO mission_agents (mission_id, agent_id, role, status)
     VALUES ($1,$2,'PRIMARY','REGISTERED')`,
    [missionId, agentId]
  );

  const insertAudit = async (row: {
    mission_id: string;
    event_type: string;
    actor_type: string;
    actor_id: string | null;
    event_hash: string;
    payload_public: Record<string, unknown>;
    onchain_tx_hash?: string | null;
  }) => {
    await db.query(
      `INSERT INTO audit_events
         (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        row.mission_id,
        row.event_type,
        row.actor_type,
        row.actor_id,
        row.event_hash,
        JSON.stringify(row.payload_public),
        row.onchain_tx_hash ?? null,
      ]
    );
  };

  const deps: ViolationRecorderDeps & Pick<QuarantineDeps, 'submitQuarantine'> = {
    async listUnprocessed(limit) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM action_requests
         WHERE decision = 'BLOCK'
           AND decision_reason_code IN ('INVALID_ACTION_TYPE','MERCHANT_NOT_ALLOWED',
             'TOKEN_NOT_ALLOWED','AMOUNT_EXCEEDS_MAX','BUDGET_EXHAUSTED')
           AND violation_recorded_at IS NULL
           AND violation_poisoned = false
         ORDER BY created_at ASC
         LIMIT $1`,
        [limit]
      );
      return result.rows as unknown as UnprocessedBlockedRequest[];
    },
    async getMission(id): Promise<RecorderMission | null> {
      const row = await one(
        db,
        'SELECT id, owner_id, contract_address, pda_address, status, current_agent_id FROM missions WHERE id = $1',
        [id]
      );
      return row as unknown as RecorderMission | null;
    },
    async readState() {
      return chain.state();
    },
    async recordViolation({ requestId, expectedVersion }) {
      return chain.recordViolation(requestId, expectedVersion);
    },
    async quarantine({ expectedVersion }) {
      return chain.quarantine(expectedVersion);
    },
    async submitQuarantine({ expectedVersion }) {
      return chain.quarantine(expectedVersion);
    },
    async markRecorded(actionRequestId, txHash) {
      await db.query(
        `UPDATE action_requests
         SET violation_recorded_at = now(), violation_recorded_tx_hash = $2
         WHERE id = $1`,
        [actionRequestId, txHash]
      );
    },
    async markAttemptFailed(actionRequestId, attempts, poisoned) {
      await db.query(
        `UPDATE action_requests
         SET violation_attempts = $2, violation_poisoned = $3
         WHERE id = $1`,
        [actionRequestId, attempts, poisoned]
      );
    },
    insertAuditEvent: insertAudit,
    async getRecentAuditEvents(missionId) {
      const result = await db.query<{ event_type: string }>(
        'SELECT event_type FROM audit_events WHERE mission_id = $1 ORDER BY created_at DESC LIMIT 50',
        [missionId]
      );
      return result.rows;
    },
    async getAgentAddress(agentId) {
      const row = await one(db, 'SELECT address FROM agents WHERE id = $1', [agentId]);
      return row ? String(row['address']) : null;
    },
    async updateMissionStatusToQuarantined(id) {
      await db.query("UPDATE missions SET status = 'QUARANTINED' WHERE id = $1", [id]);
    },
    async updateCurrentAgentStatusToQuarantined(id) {
      await db.query(
        "UPDATE mission_agents SET status = 'QUARANTINED' WHERE mission_id = $1 AND role = 'PRIMARY'",
        [id]
      );
    },
  };

  let nonce = 0;
  const insertBlocked = async (reasonCode: string, index: number): Promise<string> => {
    const actionId = randomUUID();
    const requestId = randomUUID();
    nonce += 1;
    const onchainRequestId = `0x${String(index).padStart(64, '0')}`;
    await db.query(
      `INSERT INTO action_requests
         (id, mission_id, agent_id, idempotency_key, request_id, onchain_request_id,
          agent_nonce, action_type, payload, request_hash, signature, decision,
          decision_reason_code, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'HSP_PAYMENT','{}'::jsonb,'hash','sig','BLOCK',$8,
          now() + interval '1 hour', now() + ($9 || ' microseconds')::interval)`,
      [
        actionId,
        missionId,
        agentId,
        `idem-${index}`,
        requestId,
        onchainRequestId,
        nonce,
        reasonCode,
        String(index),
      ]
    );
    if (COUNTABLE.includes(reasonCode)) {
      await insertAudit({
        mission_id: missionId,
        event_type: 'violation.counted',
        actor_type: 'agent',
        actor_id: agentId,
        event_hash: `0x${requestId.replace(/-/g, '').padEnd(64, '0').slice(0, 64)}`,
        payload_public: {
          requestId,
          reasonCode,
          agentAddress,
          violationCountAfter: index,
        },
        onchain_tx_hash: null,
      });
    }
    return actionId;
  };

  return {
    db,
    ownerId,
    missionId,
    missionAddress,
    agentId,
    chain,
    deps,
    insertBlocked,
    close: () => db.close(),
  };
}

async function auditTypes(world: World): Promise<string[]> {
  const result = await world.db.query<{ event_type: string }>(
    'SELECT event_type FROM audit_events WHERE mission_id = $1',
    [world.missionId]
  );
  return result.rows.map((row) => row.event_type).sort();
}

function handlerDeps(world: World): QuarantineDeps {
  return {
    getMission: async (missionId) => {
      const mission = await world.deps.getMission(missionId);
      return mission ? { ...mission, owner_id: world.ownerId } : null;
    },
    readState: (address) => world.deps.readState(address),
    submitQuarantine: (args) => world.deps.submitQuarantine(args),
    insertAuditEvent: (row) => world.deps.insertAuditEvent(row as never),
    updateMissionStatus: (missionId) => world.deps.updateMissionStatusToQuarantined(missionId),
    updateAgentStatus: (missionId) => world.deps.updateCurrentAgentStatusToQuarantined(missionId),
  };
}

async function missionStatus(world: World): Promise<string | null> {
  const row = await one(world.db, 'SELECT status FROM missions WHERE id = $1', [world.missionId]);
  return row ? String(row['status']) : null;
}

async function assignmentStatus(world: World): Promise<string | null> {
  const row = await one(
    world.db,
    "SELECT status FROM mission_agents WHERE mission_id = $1 AND role = 'PRIMARY'",
    [world.missionId]
  );
  return row ? String(row['status']) : null;
}

describe('Phase 5 violation → quarantine flow', () => {
  const worlds: World[] = [];

  afterAll(async () => {
    for (const world of worlds) await world.close();
  });

  async function world(options: { threshold?: number } = {}): Promise<World> {
    const created = await createWorld(options);
    worlds.push(created);
    return created;
  }

  it('three authenticated violations quarantine once and mirror the chain', async () => {
    const w = await world();
    await w.insertBlocked('MERCHANT_NOT_ALLOWED', 1);
    await w.insertBlocked('AMOUNT_EXCEEDS_MAX', 2);
    await w.insertBlocked('TOKEN_NOT_ALLOWED', 3);

    const result = await runViolationRecorder(w.deps);

    expect(result).toMatchObject({ checked: 3, recorded: 3, quarantined: 1, failed: 0 });
    expect(w.chain.status).toEqual('QUARANTINED');
    expect(w.chain.violationCount).toEqual(3);
    expect(w.chain.quarantineCalls).toEqual(1);
    expect(await missionStatus(w)).toEqual('QUARANTINED');
    expect(await assignmentStatus(w)).toEqual('QUARANTINED');
    expect(await auditTypes(w)).toEqual(
      [
        'quarantine.confirmed',
        'quarantine.submitted',
        'violation.counted',
        'violation.counted',
        'violation.counted',
        'violation.recorded',
        'violation.recorded',
        'violation.recorded',
        'violation.threshold_reached',
      ].sort()
    );

    const linked = await w.db.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM action_requests WHERE mission_id = $1 AND violation_recorded_at IS NOT NULL',
      [w.missionId]
    );
    expect(Number(linked.rows[0]?.n)).toEqual(3);
  }, 60_000);

  it('does not count non-countable BLOCK reasons', async () => {
    const w = await world();
    for (let i = 1; i <= 5; i += 1) await w.insertBlocked('AGENT_NOT_CURRENT', i);

    const result = await runViolationRecorder(w.deps);

    expect(result).toEqual({ checked: 0, recorded: 0, quarantined: 0, failed: 0 });
    expect(w.chain.violationCount).toEqual(0);
    expect(w.chain.status).toEqual('ACTIVE');
    expect(await missionStatus(w)).toEqual('ACTIVE');
    expect(await auditTypes(w)).toEqual([]);
  }, 30_000);

  it('applies window expiry before incrementing the next violation', async () => {
    const w = await world();
    await w.insertBlocked('MERCHANT_NOT_ALLOWED', 1);
    await w.insertBlocked('TOKEN_NOT_ALLOWED', 2);
    await runViolationRecorder(w.deps);
    expect(w.chain.violationCount).toEqual(2);

    w.chain.advance(901);
    await w.insertBlocked('AMOUNT_EXCEEDS_MAX', 3);
    await runViolationRecorder(w.deps);

    expect(w.chain.violationCount).toEqual(1);
    expect(w.chain.status).toEqual('ACTIVE');
    expect(w.chain.quarantineCalls).toEqual(0);
  }, 30_000);

  it('resets the streak after a confirmed settlement', async () => {
    const w = await world();
    await w.insertBlocked('MERCHANT_NOT_ALLOWED', 1);
    await w.insertBlocked('TOKEN_NOT_ALLOWED', 2);
    await runViolationRecorder(w.deps);
    expect(w.chain.violationCount).toEqual(2);

    w.chain.recordSettlement();
    await w.insertBlocked('AMOUNT_EXCEEDS_MAX', 3);
    await w.insertBlocked('BUDGET_EXHAUSTED', 4);
    await runViolationRecorder(w.deps);

    expect(w.chain.violationCount).toEqual(2);
    expect(w.chain.status).toEqual('ACTIVE');
    expect(w.chain.quarantineCalls).toEqual(0);
  }, 30_000);

  it('quarantines manually with zero violations and is idempotent afterwards', async () => {
    const w = await world();
    const first = await requestQuarantine({
      deps: handlerDeps(w),
      missionId: w.missionId,
      actor: { type: 'owner', id: w.ownerId },
    });
    expect(first.status).toEqual(200);
    expect(first.json).toMatchObject({ status: 'QUARANTINED', idempotent: false });
    expect(w.chain.status).toEqual('QUARANTINED');
    expect(await missionStatus(w)).toEqual('QUARANTINED');

    const version = w.chain.stateVersion;
    const second = await requestQuarantine({
      deps: handlerDeps(w),
      missionId: w.missionId,
      actor: { type: 'owner', id: w.ownerId },
    });
    expect(second.status).toEqual(200);
    expect(second.json).toMatchObject({ status: 'QUARANTINED', idempotent: true });
    expect(w.chain.stateVersion).toEqual(version);
  }, 30_000);

  it('supports the guardian actor path (Mode B)', async () => {
    const w = await world();
    const result = await requestQuarantine({
      deps: handlerDeps(w),
      missionId: w.missionId,
      actor: { type: 'guardian', id: null },
    });
    expect(result.status).toEqual(200);
    expect(w.chain.status).toEqual('QUARANTINED');
    const events = await w.db.query<{ actor_type: string }>(
      "SELECT actor_type FROM audit_events WHERE mission_id = $1 AND event_type = 'quarantine.confirmed'",
      [w.missionId]
    );
    expect(events.rows[0]?.actor_type).toEqual('guardian');
  }, 30_000);
});

describe('Phase 5 migration', () => {
  it('preserves Phase 1-4 data and adds audit/action/agent constraints', async () => {
    const db = await createPhase4TestDb();
    const ownerId = randomUUID();
    const missionId = randomUUID();
    const agentId = randomUUID();
    const actionId = randomUUID();

    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
    await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
      ownerId,
      `0x${'11'.repeat(20)}`,
    ]);
    await db.query(
      `INSERT INTO agents (id, owner_id, name, public_key, status)
       VALUES ($1,$2,'Alpha',$3,'REGISTERED')`,
      [agentId, ownerId, `0x${'22'.repeat(20)}`]
    );
    await db.query(
      `INSERT INTO missions
         (id, owner_id, name, objective, pda_address, vault_address, mint_address,
          budget_atomic, remaining_budget_atomic, status, current_agent_public_key,
          policy_version, policy_hash, expires_at)
       VALUES ($1,$2,'M','O',$3,$4,$5,'1000','1000','ACTIVE',$6,1,'hash',
          now() + interval '1 hour')`,
      [
        missionId,
        ownerId,
        `0x${'33'.repeat(20)}`,
        `vault-${missionId}`,
        `0x${'44'.repeat(20)}`,
        `0x${'22'.repeat(20)}`,
      ]
    );
    await db.query(
      `INSERT INTO action_requests
         (id, mission_id, agent_id, idempotency_key, request_id, onchain_request_id,
          agent_nonce, action_type, payload, request_hash, signature, decision,
          decision_reason_code, expires_at)
       VALUES ($1,$2,$3,'legacy',$4,$5,1,'HSP_PAYMENT','{}'::jsonb,'hash','sig','BLOCK',
          'MERCHANT_NOT_ALLOWED',now() + interval '1 hour')`,
      [actionId, missionId, agentId, randomUUID(), `0x${'77'.repeat(32)}`]
    );
    await db.query(
      `INSERT INTO audit_events
         (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_signature)
       VALUES ($1,'violation.counted','agent',$2,'legacy-hash','{}'::jsonb,'legacy-signature')`,
      [missionId, agentId]
    );

    await db.exec(PHASE5_MIGRATION);

    const auditColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events'`
    );
    const auditNames = new Set(auditColumns.rows.map((row) => row.column_name));
    expect(auditNames.has('onchain_tx_hash')).toEqual(true);
    expect(auditNames.has('onchain_signature')).toEqual(true);

    const actionColumns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'action_requests'`
    );
    const actionNames = new Set(actionColumns.rows.map((row) => row.column_name));
    for (const column of [
      'violation_recorded_at',
      'violation_recorded_tx_hash',
      'violation_attempts',
      'violation_poisoned',
    ]) {
      expect(actionNames.has(column)).toEqual(true);
    }

    const preserved = await db.query<{
      event_hash: string;
      onchain_signature: string;
      onchain_tx_hash: string | null;
    }>(
      'SELECT event_hash, onchain_signature, onchain_tx_hash FROM audit_events WHERE mission_id = $1',
      [missionId]
    );
    expect(preserved.rows[0]).toEqual({
      event_hash: 'legacy-hash',
      onchain_signature: 'legacy-signature',
      onchain_tx_hash: null,
    });

    const policies = await db.query<{ cmd: string }>(
      `SELECT cmd FROM pg_policies WHERE tablename = 'audit_events'`
    );
    expect(policies.rows.map((row) => row.cmd)).toEqual(['SELECT']);

    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('audit_events','action_requests')`
    );
    const indexNames = new Set(indexes.rows.map((row) => row.indexname));
    expect(indexNames.has('audit_events_mission_created_idx')).toEqual(true);
    expect(indexNames.has('audit_events_mission_event_type_idx')).toEqual(true);
    expect(indexNames.has('action_requests_violation_pending_idx')).toEqual(true);

    await expect(
      db.query(
        `INSERT INTO agents (owner_id, name, public_key, status)
         VALUES ($1,'Bad',$2,'ACTIVE')`,
        [ownerId, `0x${'55'.repeat(20)}`]
      )
    ).rejects.toThrow(/agents_status_check/);

    await db.close();
  }, 60_000);

  it('fails when an existing agent status is outside the state machine', async () => {
    const db = await createPhase4TestDb();
    const ownerId = randomUUID();
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
    await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
      ownerId,
      `0x${'11'.repeat(20)}`,
    ]);
    await db.query(
      `INSERT INTO agents (owner_id, name, public_key, status)
       VALUES ($1,'Bad',$2,'ACTIVE')`,
      [ownerId, `0x${'66'.repeat(20)}`]
    );

    await expect(db.exec(PHASE5_MIGRATION)).rejects.toThrow(/agents_status_check/);
    await db.close();
  }, 60_000);
});
