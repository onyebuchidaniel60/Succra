// Test-only PGlite GatewayStore: the production seam over real SQL.
//
// Applies the ACTUAL migrations (Phase 3 core + Phase 4 gateway +
// Phase 5 guardian + Phase 6 succession), so the
// schema under test is byte-identical to what ships. Plus the same
// test-only auth stub as tests/integration/supabase-rls.test.ts
// (auth.users, auth.uid(), authenticated role + grants). RLS is NOT
// emulated here beyond what Postgres enforces for the harness role —
// RLS allow/deny is proven separately (PGlite RLS file + live suite).
// Service-role semantics: the harness queries as the table owner, the
// same visibility the service-role key has in production.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type {
  ActionRequestRow,
  AgentRow,
  AuditEventRow,
  ChallengeRow,
  CheckpointRow,
  GatewayStore,
  InsertActionOutcome,
  MissionAgentRow,
  MissionRow,
  NewActionRequest,
  NewAgent,
  NewAssignment,
  NewAuditEvent,
  NewCheckpoint,
  NewSuccessionEvent,
  OnchainTxRow,
  OnchainTxStatus,
  PolicyRow,
  SuccessionEventRow,
} from '../../lib/gateway/store';

const HERE = dirname(fileURLToPath(import.meta.url));

function readMigration(name: string): string {
  return readFileSync(join(HERE, '..', '..', '..', '..', 'supabase', 'migrations', name), 'utf8');
}

export async function createGatewayTestDb(): Promise<PGlite> {
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$`);
  await db.exec(readMigration('20260913000000_phase3_core.sql'));
  await db.exec(readMigration('20260914000000_phase4_gateway.sql'));
  await db.exec(readMigration('20260915000000_phase5_guardian.sql'));
  await db.exec(readMigration('20260916000000_phase6_succession.sql'));
  return db;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

type SqlValue = string | number | boolean | null;

/** PGlite-backed GatewayStore. Values are coerced to the seam's row types. */
export class PGliteGatewayStore implements GatewayStore {
  constructor(private readonly db: PGlite) {}

  private async one<T>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    const result = await this.db.query<Record<string, unknown>>(sql, params as unknown[]);
    const row = result.rows[0];
    return (row ?? null) as T | null;
  }

  private async many<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const result = await this.db.query<Record<string, unknown>>(sql, params as unknown[]);
    return result.rows as T[];
  }

  private static agent(row: Record<string, unknown>): AgentRow {
    return {
      id: String(row['id']),
      owner_id: String(row['owner_id']),
      name: String(row['name']),
      public_key: String(row['public_key']),
      endpoint_url: (row['endpoint_url'] as string | null) ?? null,
      capabilities: row['capabilities'] ?? [],
      status: String(row['status']),
      last_heartbeat_at: row['last_heartbeat_at'] ? iso(row['last_heartbeat_at']) : null,
      created_at: iso(row['created_at']),
      updated_at: iso(row['updated_at']),
    };
  }

  private static mission(row: Record<string, unknown>): MissionRow {
    return {
      id: String(row['id']),
      owner_id: String(row['owner_id']),
      name: String(row['name']),
      objective: String(row['objective']),
      pda_address: String(row['pda_address']),
      vault_address: String(row['vault_address']),
      mint_address: String(row['mint_address']),
      budget_atomic: String(row['budget_atomic']),
      remaining_budget_atomic: String(row['remaining_budget_atomic']),
      status: String(row['status']),
      current_agent_id: row['current_agent_id'] ? String(row['current_agent_id']) : null,
      current_agent_public_key: String(row['current_agent_public_key']),
      policy_version: num(row['policy_version']),
      policy_hash: String(row['policy_hash']),
      expires_at: iso(row['expires_at']),
      created_at: iso(row['created_at']),
      updated_at: iso(row['updated_at']),
    };
  }

  private static action(row: Record<string, unknown>): ActionRequestRow {
    return {
      id: String(row['id']),
      mission_id: String(row['mission_id']),
      agent_id: String(row['agent_id']),
      idempotency_key: String(row['idempotency_key']),
      agent_nonce: num(row['agent_nonce']),
      action_type: String(row['action_type']),
      payload: row['payload'] ?? null,
      request_hash: String(row['request_hash']),
      signature: String(row['signature']),
      decision: String(row['decision']),
      decision_reason_code: row['decision_reason_code']
        ? String(row['decision_reason_code'])
        : null,
      violation_count_after:
        row['violation_count_after'] == null ? null : num(row['violation_count_after']),
      unsigned_tx_hash: row['unsigned_tx_hash'] ? String(row['unsigned_tx_hash']) : null,
      unsigned_tx_b64: row['unsigned_tx_b64'] ? String(row['unsigned_tx_b64']) : null,
      expires_at: row['expires_at'] ? iso(row['expires_at']) : null,
      submitted_at: row['submitted_at'] ? iso(row['submitted_at']) : null,
      created_at: iso(row['created_at']),
    };
  }

  async getAgentById(agentId: string): Promise<AgentRow | null> {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM agents WHERE id = $1', [
      agentId,
    ]);
    return row ? PGliteGatewayStore.agent(row) : null;
  }

  async getAgentByPublicKey(publicKey: string): Promise<AgentRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM agents WHERE public_key = $1',
      [publicKey]
    );
    return row ? PGliteGatewayStore.agent(row) : null;
  }

  async insertAgent(row: NewAgent): Promise<AgentRow> {
    const created = await this.one<Record<string, unknown>>(
      `INSERT INTO agents (owner_id, name, public_key, status, capabilities)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [
        row.owner_id,
        row.name,
        row.public_key,
        row.status,
        JSON.stringify(row.capabilities ?? []),
      ]
    );
    if (!created) throw new Error('Agent insert returned nothing.');
    return PGliteGatewayStore.agent(created);
  }

  async updateAgentStatus(agentId: string, status: string): Promise<AgentRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE agents SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [agentId, status]
    );
    return row ? PGliteGatewayStore.agent(row) : null;
  }

  async updateAgentHeartbeat(agentId: string, atIso: string): Promise<AgentRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE agents SET last_heartbeat_at = $2, updated_at = $2 WHERE id = $1 RETURNING *`,
      [agentId, atIso]
    );
    return row ? PGliteGatewayStore.agent(row) : null;
  }

  async updateAgentCapabilities(agentId: string, capabilities: unknown): Promise<AgentRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE agents SET capabilities = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
      [agentId, JSON.stringify(capabilities ?? [])]
    );
    return row ? PGliteGatewayStore.agent(row) : null;
  }

  async getMissionById(missionId: string): Promise<MissionRow | null> {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM missions WHERE id = $1', [
      missionId,
    ]);
    return row ? PGliteGatewayStore.mission(row) : null;
  }

  async updateMissionRemaining(missionId: string, remainingAtomic: string): Promise<void> {
    await this.db.query(
      'UPDATE missions SET remaining_budget_atomic = $2, updated_at = now() WHERE id = $1',
      [missionId, remainingAtomic] as unknown[]
    );
  }

  async getLatestPolicy(missionId: string): Promise<PolicyRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `SELECT * FROM mission_policies WHERE mission_id = $1 ORDER BY version DESC NULLS LAST LIMIT 1`,
      [missionId]
    );
    if (!row) return null;
    return {
      id: String(row['id']),
      mission_id: String(row['mission_id']),
      version: row['version'] == null ? null : num(row['version']),
      max_action_atomic: row['max_action_atomic'] ? String(row['max_action_atomic']) : null,
      recovery_max_action_atomic: row['recovery_max_action_atomic']
        ? String(row['recovery_max_action_atomic'])
        : null,
      allowed_action_types: (row['allowed_action_types'] as string[] | null) ?? null,
      allowed_recipients: (row['allowed_recipients'] as string[] | null) ?? null,
      violation_threshold:
        row['violation_threshold'] == null ? null : num(row['violation_threshold']),
      violation_window_seconds:
        row['violation_window_seconds'] == null ? null : num(row['violation_window_seconds']),
      policy_json: row['policy_json'] ?? null,
      policy_hash: String(row['policy_hash']),
      created_at: iso(row['created_at']),
    };
  }

  async getAssignment(missionId: string, agentId: string): Promise<MissionAgentRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM mission_agents WHERE mission_id = $1 AND agent_id = $2',
      [missionId, agentId]
    );
    if (!row) return null;
    return {
      id: String(row['id']),
      mission_id: String(row['mission_id']),
      agent_id: String(row['agent_id']),
      role: row['role'] ? String(row['role']) : null,
      priority: row['priority'] == null ? null : num(row['priority']),
      required_capabilities: row['required_capabilities'] ?? null,
      status: row['status'] ? String(row['status']) : null,
      activated_at: row['activated_at'] ? iso(row['activated_at']) : null,
      revoked_at: row['revoked_at'] ? iso(row['revoked_at']) : null,
    };
  }

  async listAssignmentsForAgent(agentId: string): Promise<MissionAgentRow[]> {
    const rows = await this.many<Record<string, unknown>>(
      'SELECT * FROM mission_agents WHERE agent_id = $1',
      [agentId]
    );
    const out: MissionAgentRow[] = [];
    for (const row of rows) {
      const assignment = await this.getAssignment(
        String(row['mission_id']),
        String(row['agent_id'])
      );
      if (assignment) out.push(assignment);
    }
    return out;
  }

  async insertAssignment(row: NewAssignment): Promise<MissionAgentRow> {
    const created = await this.one<Record<string, unknown>>(
      `INSERT INTO mission_agents (mission_id, agent_id, role, priority, required_capabilities, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
      [
        row.mission_id,
        row.agent_id,
        row.role,
        row.priority ?? null,
        row.required_capabilities === undefined
          ? null
          : JSON.stringify(row.required_capabilities ?? null),
        row.status ?? null,
      ]
    );
    if (!created) throw new Error('Assignment insert returned nothing.');
    const assignment = await this.getAssignment(
      created['mission_id'] as string,
      created['agent_id'] as string
    );
    if (!assignment) throw new Error('Assignment insert vanished.');
    return assignment;
  }

  async listMissionAssignments(missionId: string): Promise<MissionAgentRow[]> {
    const rows = await this.many<Record<string, unknown>>(
      'SELECT * FROM mission_agents WHERE mission_id = $1',
      [missionId]
    );
    const out: MissionAgentRow[] = [];
    for (const row of rows) {
      const assignment = await this.getAssignment(
        String(row['mission_id']),
        String(row['agent_id'])
      );
      if (assignment) out.push(assignment);
    }
    return out;
  }

  async updateAssignment(
    assignmentId: string,
    patch: { status?: string; activated_at?: string | null; revoked_at?: string | null }
  ): Promise<MissionAgentRow | null> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.status !== undefined) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`);
    }
    if (patch.activated_at !== undefined) {
      params.push(patch.activated_at);
      sets.push(`activated_at = $${params.length}`);
    }
    if (patch.revoked_at !== undefined) {
      params.push(patch.revoked_at);
      sets.push(`revoked_at = $${params.length}`);
    }
    if (sets.length === 0) {
      const row = await this.one<Record<string, unknown>>(
        'SELECT * FROM mission_agents WHERE id = $1',
        [assignmentId]
      );
      if (!row) return null;
      const assignment = await this.getAssignment(
        String(row['mission_id']),
        String(row['agent_id'])
      );
      return assignment;
    }
    params.push(assignmentId);
    const row = await this.one<Record<string, unknown>>(
      `UPDATE mission_agents SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!row) return null;
    return this.getAssignment(String(row['mission_id']), String(row['agent_id']));
  }

  async markAgentAssignmentsAvailable(agentId: string): Promise<number> {
    const result = await this.db.query(
      `UPDATE mission_agents SET status = 'AVAILABLE'
       WHERE agent_id = $1 AND status = 'PENDING' RETURNING id`,
      [agentId] as unknown[]
    );
    return result.rows.length;
  }

  async updateMissionAuthority(
    missionId: string,
    patch: {
      status: string;
      current_agent_id: string | null;
      current_agent_public_key: string;
      atIso: string;
    }
  ): Promise<void> {
    await this.db.query(
      `UPDATE missions
       SET status = $2, current_agent_id = $3, current_agent_public_key = $4, updated_at = $5
       WHERE id = $1`,
      [
        missionId,
        patch.status,
        patch.current_agent_id,
        patch.current_agent_public_key,
        patch.atIso,
      ] as unknown[]
    );
  }

  async markMissionHalted(missionId: string, atIso: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE missions SET status = 'HALTED', updated_at = $2
       WHERE id = $1 AND status = 'QUARANTINED' RETURNING id`,
      [missionId, atIso] as unknown[]
    );
    return result.rows.length > 0;
  }

  async getActionById(requestId: string): Promise<ActionRequestRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM action_requests WHERE id = $1',
      [requestId]
    );
    return row ? PGliteGatewayStore.action(row) : null;
  }

  async getActionByIdempotency(missionId: string, key: string): Promise<ActionRequestRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM action_requests WHERE mission_id = $1 AND idempotency_key = $2',
      [missionId, key]
    );
    return row ? PGliteGatewayStore.action(row) : null;
  }

  async insertAction(row: NewActionRequest): Promise<InsertActionOutcome> {
    try {
      const created = await this.one<Record<string, unknown>>(
        `INSERT INTO action_requests
           (mission_id, agent_id, idempotency_key, agent_nonce, action_type, payload,
            request_hash, signature, decision, decision_reason_code, violation_count_after,
            unsigned_tx_hash, unsigned_tx_b64, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          row.mission_id,
          row.agent_id,
          row.idempotency_key,
          row.agent_nonce,
          row.action_type,
          JSON.stringify(row.payload),
          row.request_hash,
          row.signature,
          row.decision,
          row.decision_reason_code,
          row.violation_count_after,
          row.unsigned_tx_hash,
          row.unsigned_tx_b64,
          row.expires_at,
        ]
      );
      if (!created) throw new Error('Action insert returned nothing.');
      return { inserted: PGliteGatewayStore.action(created) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.getActionByIdempotency(row.mission_id, row.idempotency_key);
      return { conflict: existing ? 'idempotency' : 'agent-nonce' };
    }
  }

  async markActionSubmitted(requestId: string, atIso: string): Promise<void> {
    await this.db.query('UPDATE action_requests SET submitted_at = $2 WHERE id = $1', [
      requestId,
      atIso,
    ] as unknown[]);
  }

  async getOnchainTxByRequest(requestId: string): Promise<OnchainTxRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM onchain_transactions WHERE action_request_id = $1',
      [requestId]
    );
    if (!row) return null;
    return {
      id: String(row['id']),
      mission_id: String(row['mission_id']),
      action_request_id: row['action_request_id'] ? String(row['action_request_id']) : null,
      signature: String(row['signature']),
      slot: row['slot'] == null ? null : num(row['slot']),
      status: String(row['status']),
      raw_error: row['raw_error'] ?? null,
      confirmed_at: row['confirmed_at'] ? iso(row['confirmed_at']) : null,
      created_at: iso(row['created_at']),
    };
  }

  async insertOnchainTx(row: {
    mission_id: string;
    action_request_id: string;
    signature: string;
    status: OnchainTxStatus;
  }): Promise<{ inserted: OnchainTxRow } | { conflict: 'signature' }> {
    try {
      const created = await this.one<Record<string, unknown>>(
        `INSERT INTO onchain_transactions (mission_id, action_request_id, signature, status)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [row.mission_id, row.action_request_id, row.signature, row.status]
      );
      if (!created) throw new Error('Onchain insert returned nothing.');
      const tx = await this.getOnchainTxByRequest(row.action_request_id);
      if (!tx) throw new Error('Onchain insert vanished.');
      return { inserted: tx };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return { conflict: 'signature' };
    }
  }

  async updateOnchainTxConfirmed(signature: string, slot: number, atIso: string): Promise<void> {
    await this.db.query(
      `UPDATE onchain_transactions SET status = 'CONFIRMED', slot = $2, confirmed_at = $3 WHERE signature = $1`,
      [signature, slot, atIso] as unknown[]
    );
  }

  async updateOnchainTxFailed(signature: string, rawError: unknown): Promise<void> {
    await this.db.query(
      `UPDATE onchain_transactions SET status = 'FAILED', raw_error = $2::jsonb WHERE signature = $1`,
      [signature, JSON.stringify(rawError ?? null)] as unknown[]
    );
  }

  async insertRequestNonce(
    agentId: string,
    nonce: string,
    expiresAtIso: string
  ): Promise<'ok' | 'duplicate'> {
    try {
      await this.db.query(
        'INSERT INTO agent_request_nonces (agent_id, nonce, expires_at) VALUES ($1, $2, $3)',
        [agentId, nonce, expiresAtIso] as unknown[]
      );
      return 'ok';
    } catch (error) {
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }

  async consumeRequestNonce(agentId: string, nonce: string, nowIso: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE agent_request_nonces SET consumed_at = $3
       WHERE agent_id = $1 AND nonce = $2 AND consumed_at IS NULL RETURNING id`,
      [agentId, nonce, nowIso] as unknown[]
    );
    return result.rows.length > 0;
  }

  async sweepRequestNonces(nowIso: string): Promise<void> {
    await this.db.query('DELETE FROM agent_request_nonces WHERE expires_at < $1', [
      nowIso,
    ] as unknown[]);
  }

  async insertChallenge(agentId: string, challenge: string, expiresAtIso: string): Promise<void> {
    await this.db.query(
      'INSERT INTO agent_challenges (agent_id, challenge, expires_at) VALUES ($1, $2, $3)',
      [agentId, challenge, expiresAtIso] as unknown[]
    );
  }

  async findChallenge(agentId: string, challenge: string): Promise<ChallengeRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM agent_challenges WHERE agent_id = $1 AND challenge = $2',
      [agentId, challenge]
    );
    if (!row) return null;
    return {
      id: String(row['id']),
      agent_id: String(row['agent_id']),
      challenge: String(row['challenge']),
      expires_at: iso(row['expires_at']),
      consumed_at: row['consumed_at'] ? iso(row['consumed_at']) : null,
      created_at: iso(row['created_at']),
    };
  }

  async consumeChallenge(agentId: string, challenge: string, nowIso: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE agent_challenges SET consumed_at = $3
       WHERE agent_id = $1 AND challenge = $2 AND consumed_at IS NULL AND expires_at > $3 RETURNING id`,
      [agentId, challenge, nowIso] as unknown[]
    );
    return result.rows.length > 0;
  }

  async countPolicyBlockedSince(
    missionId: string,
    agentId: string,
    reasonCode: string,
    sinceIso: string
  ): Promise<number> {
    const result = await this.db.query(
      `SELECT COUNT(*)::int AS n FROM action_requests
       WHERE mission_id = $1 AND agent_id = $2 AND decision = 'BLOCKED'
         AND decision_reason_code = $3 AND created_at > $4`,
      [missionId, agentId, reasonCode, sinceIso] as unknown[]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? num(row['n']) : 0;
  }

  async lastConfirmedAt(missionId: string, agentId: string): Promise<string | null> {
    const row = await this.one<Record<string, unknown>>(
      `SELECT t.confirmed_at AS confirmed_at FROM onchain_transactions t
       JOIN action_requests a ON a.id = t.action_request_id
       WHERE t.status = 'CONFIRMED' AND a.mission_id = $1 AND a.agent_id = $2
       ORDER BY t.confirmed_at DESC NULLS LAST LIMIT 1`,
      [missionId, agentId]
    );
    return row && row['confirmed_at'] ? iso(row['confirmed_at']) : null;
  }

  async setActionViolationCount(requestId: string, count: number): Promise<void> {
    await this.db.query('UPDATE action_requests SET violation_count_after = $2 WHERE id = $1', [
      requestId,
      count,
    ] as unknown[]);
  }

  async markMissionQuarantined(missionId: string, atIso: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE missions SET status = 'QUARANTINED', updated_at = $2
       WHERE id = $1 AND status = 'ACTIVE' RETURNING id`,
      [missionId, atIso] as unknown[]
    );
    return result.rows.length > 0;
  }

  async insertAuditEvent(row: NewAuditEvent): Promise<AuditEventRow> {
    const created = await this.one<Record<string, unknown>>(
      `INSERT INTO audit_events
         (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_signature)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING *`,
      [
        row.mission_id,
        row.event_type,
        row.actor_type,
        row.actor_id,
        row.event_hash,
        JSON.stringify(row.payload_public ?? null),
        row.onchain_signature,
      ]
    );
    if (!created) throw new Error('Audit insert returned nothing.');
    return {
      id: String(created['id']),
      mission_id: String(created['mission_id']),
      event_type: String(created['event_type']),
      actor_type: String(created['actor_type']),
      actor_id: created['actor_id'] ? String(created['actor_id']) : null,
      event_hash: String(created['event_hash']),
      payload_public: created['payload_public'] ?? null,
      onchain_signature: created['onchain_signature'] ? String(created['onchain_signature']) : null,
      created_at: iso(created['created_at']),
    };
  }

  private static checkpoint(row: Record<string, unknown>): CheckpointRow {
    return {
      id: String(row['id']),
      mission_id: String(row['mission_id']),
      sequence: num(row['sequence']),
      status: String(row['status']),
      checkpoint_hash: String(row['checkpoint_hash']),
      confirmed_action_ids: row['confirmed_action_ids'] ?? null,
      remaining_budget_atomic: String(row['remaining_budget_atomic']),
      state_snapshot: row['state_snapshot'] ?? null,
      committed_signature: row['committed_signature']
        ? String(row['committed_signature'])
        : null,
      created_at: iso(row['created_at']),
    };
  }

  async insertCheckpoint(row: NewCheckpoint): Promise<CheckpointRow> {
    try {
      const created = await this.one<Record<string, unknown>>(
        `INSERT INTO mission_checkpoints
           (mission_id, sequence, status, checkpoint_hash, confirmed_action_ids,
            remaining_budget_atomic, state_snapshot, committed_signature)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8) RETURNING *`,
        [
          row.mission_id,
          row.sequence,
          row.status,
          row.checkpoint_hash,
          JSON.stringify(row.confirmed_action_ids ?? null),
          row.remaining_budget_atomic,
          JSON.stringify(row.state_snapshot ?? null),
          row.committed_signature,
        ]
      );
      if (!created) throw new Error('Checkpoint insert returned nothing.');
      return PGliteGatewayStore.checkpoint(created);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.getCheckpoint(row.mission_id, row.sequence);
      if (!existing) throw error;
      return existing;
    }
  }

  async getCheckpoint(missionId: string, sequence: number): Promise<CheckpointRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM mission_checkpoints WHERE mission_id = $1 AND sequence = $2',
      [missionId, sequence]
    );
    return row ? PGliteGatewayStore.checkpoint(row) : null;
  }

  async latestVerifiedCheckpoint(missionId: string): Promise<CheckpointRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `SELECT * FROM mission_checkpoints
       WHERE mission_id = $1 AND status = 'VERIFIED'
       ORDER BY sequence DESC LIMIT 1`,
      [missionId]
    );
    return row ? PGliteGatewayStore.checkpoint(row) : null;
  }

  async supersedeOlderCheckpoints(missionId: string, keepSequence: number): Promise<void> {
    await this.db.query(
      `UPDATE mission_checkpoints SET status = 'SUPERSEDED'
       WHERE mission_id = $1 AND status = 'VERIFIED' AND sequence < $2`,
      [missionId, keepSequence] as unknown[]
    );
  }

  private static succession(row: Record<string, unknown>): SuccessionEventRow {
    return {
      id: String(row['id']),
      mission_id: String(row['mission_id']),
      from_agent_id: row['from_agent_id'] ? String(row['from_agent_id']) : null,
      to_agent_id: String(row['to_agent_id']),
      trigger_type: String(row['trigger_type']),
      checkpoint_id: row['checkpoint_id'] ? String(row['checkpoint_id']) : null,
      recovery_limit_atomic: row['recovery_limit_atomic']
        ? String(row['recovery_limit_atomic'])
        : null,
      status: String(row['status']),
      onchain_signature: row['onchain_signature'] ? String(row['onchain_signature']) : null,
      created_at: iso(row['created_at']),
    };
  }

  async insertSuccessionEvent(row: NewSuccessionEvent): Promise<SuccessionEventRow> {
    const created = await this.one<Record<string, unknown>>(
      `INSERT INTO succession_events
         (mission_id, from_agent_id, to_agent_id, trigger_type, checkpoint_id,
          recovery_limit_atomic, status, onchain_signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        row.mission_id,
        row.from_agent_id,
        row.to_agent_id,
        row.trigger_type,
        row.checkpoint_id,
        row.recovery_limit_atomic,
        row.status,
        row.onchain_signature,
      ]
    );
    if (!created) throw new Error('Succession insert returned nothing.');
    return PGliteGatewayStore.succession(created);
  }

  async getSuccessionById(successionId: string): Promise<SuccessionEventRow | null> {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM succession_events WHERE id = $1',
      [successionId]
    );
    return row ? PGliteGatewayStore.succession(row) : null;
  }

  async latestSuccessionForMission(missionId: string): Promise<SuccessionEventRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `SELECT * FROM succession_events WHERE mission_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [missionId]
    );
    return row ? PGliteGatewayStore.succession(row) : null;
  }

  async updateSuccessionStatus(
    successionId: string,
    patch: { status: string; onchain_signature?: string | null }
  ): Promise<SuccessionEventRow | null> {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE succession_events SET status = $2,
         onchain_signature = COALESCE($3, onchain_signature)
       WHERE id = $1 RETURNING *`,
      [successionId, patch.status, patch.onchain_signature ?? null]
    );
    return row ? PGliteGatewayStore.succession(row) : null;
  }
}
