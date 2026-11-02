// Test-only PGlite adapter for the mission-creation persistence seam. It
// runs the real Phase 6 migrations from createPhase6TestDb(), so the columns
// and constraints under test are the ones that ship.
import type { PGlite } from '@electric-sql/pglite';
import type {
  ActiveMissionPatch,
  AgentSummary,
  MissionAuditRow,
  MissionAuditRecord,
  MissionCreationStore,
  MissionDraftRow,
  MissionPolicyRow,
  MissionSummary,
} from '../../lib/missions/creation-store';

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function draft(row: Row): MissionDraftRow {
  return {
    id: str(row['id']),
    owner_id: str(row['owner_id']),
    owner_address: str(row['owner_address']),
    name: str(row['name']),
    objective: str(row['objective']),
    status: str(row['status']),
    contract_address: str(row['contract_address']),
    factory_address: str(row['factory_address']),
    payment_token_address: str(row['payment_token_address']),
    budget_atomic: str(row['budget_atomic']),
    remaining_budget_atomic: str(row['remaining_budget_atomic']),
    current_agent_id: row['current_agent_id'] ? str(row['current_agent_id']) : null,
    current_agent_address: str(row['current_agent_address']),
    policy_version: Number(row['policy_version']),
    policy_hash: str(row['policy_hash']),
    expires_at: new Date(row['expires_at'] as string).toISOString(),
    created_at: new Date(row['created_at'] as string).toISOString(),
    updated_at: new Date(row['updated_at'] as string).toISOString(),
  };
}

export class PGliteMissionCreationStore implements MissionCreationStore {
  constructor(private readonly db: PGlite) {}

  private async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.db.query<Row>(sql, params);
    return (result.rows[0] as T | undefined) ?? null;
  }

  async insertDraft(row: Parameters<MissionCreationStore['insertDraft']>[0]): Promise<void> {
    await this.db.query(
      `INSERT INTO missions
         (id, owner_id, name, objective, pda_address, vault_address, mint_address,
          budget_atomic, remaining_budget_atomic, status, current_agent_id,
          current_agent_public_key, contract_address, factory_address, owner_address,
          payment_token_address, current_agent_address, policy_version, policy_hash,
          expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        row.id,
        row.owner_id,
        row.name,
        row.objective,
        row.pda_address,
        row.vault_address,
        row.mint_address,
        row.budget_atomic,
        row.remaining_budget_atomic,
        row.status,
        row.current_agent_id,
        row.current_agent_public_key,
        row.contract_address,
        row.factory_address,
        row.owner_address,
        row.payment_token_address,
        row.current_agent_address,
        row.policy_version,
        row.policy_hash,
        row.expires_at,
        row.created_at,
        row.updated_at,
      ]
    );
  }

  async insertPolicy(row: Parameters<MissionCreationStore['insertPolicy']>[0]): Promise<void> {
    await this.db.query(
      `INSERT INTO mission_policies
         (mission_id, version, max_action_atomic, recovery_max_action_atomic,
          allowed_action_types, allowed_recipients, violation_threshold,
          violation_window_seconds, policy_json, policy_hash)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10)`,
      [
        row.mission_id,
        row.version,
        row.max_action_atomic,
        row.recovery_max_action_atomic,
        JSON.stringify(row.allowed_action_types),
        JSON.stringify(row.allowed_recipients),
        row.violation_threshold,
        row.violation_window_seconds,
        JSON.stringify(row.policy_json),
        row.policy_hash,
      ]
    );
  }

  async deleteDraft(missionId: string, ownerId: string): Promise<void> {
    await this.db.query('DELETE FROM missions WHERE id = $1 AND owner_id = $2', [
      missionId,
      ownerId,
    ]);
  }

  async getDraft(missionId: string, ownerId: string): Promise<MissionDraftRow | null> {
    const row = await this.one<Row>('SELECT * FROM missions WHERE id = $1 AND owner_id = $2', [
      missionId,
      ownerId,
    ]);
    return row ? draft(row) : null;
  }

  async getPolicy(missionId: string, version: number): Promise<MissionPolicyRow | null> {
    const row = await this.one<Row>(
      'SELECT mission_id, version, policy_json, policy_hash FROM mission_policies WHERE mission_id = $1 AND version = $2',
      [missionId, version]
    );
    if (!row) return null;
    return {
      mission_id: str(row['mission_id']),
      version: Number(row['version']),
      policy_json: row['policy_json'],
      policy_hash: str(row['policy_hash']),
    };
  }

  async activateMission(
    missionId: string,
    ownerId: string,
    patch: ActiveMissionPatch
  ): Promise<boolean> {
    const row = await this.one<Row>(
      `UPDATE missions SET
         status = $3, contract_address = $4, pda_address = $5, factory_address = $6,
         owner_address = $7, payment_token_address = $8, current_agent_address = $9,
         current_agent_id = $10, current_agent_public_key = $11, policy_hash = $12,
         updated_at = $13
       WHERE id = $1 AND owner_id = $2 AND status = 'DRAFT'
       RETURNING id`,
      [
        missionId,
        ownerId,
        patch.status,
        patch.contract_address,
        patch.pda_address,
        patch.factory_address,
        patch.owner_address,
        patch.payment_token_address,
        patch.current_agent_address,
        patch.current_agent_id,
        patch.current_agent_public_key,
        patch.policy_hash,
        patch.updated_at,
      ]
    );
    return row !== null;
  }

  async getMissionSummary(missionId: string, ownerId: string): Promise<MissionSummary | null> {
    const row = await this.one<Row>(
      'SELECT status, contract_address, policy_hash FROM missions WHERE id = $1 AND owner_id = $2',
      [missionId, ownerId]
    );
    if (!row) return null;
    return {
      status: str(row['status']),
      contract_address: str(row['contract_address']),
      policy_hash: str(row['policy_hash']),
    };
  }

  async getAgentByAddress(address: string): Promise<AgentSummary | null> {
    const row = await this.one<Row>('SELECT id, owner_id, status FROM agents WHERE address = $1', [
      address,
    ]);
    if (!row) return null;
    return {
      id: str(row['id']),
      owner_id: str(row['owner_id']),
      status: str(row['status']),
    };
  }

  async insertAgent(
    row: Parameters<MissionCreationStore['insertAgent']>[0]
  ): Promise<AgentSummary> {
    const created = await this.one<Row>(
      `INSERT INTO agents (owner_id, name, address, public_key, endpoint_url, capabilities, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING id, owner_id, status`,
      [
        row.owner_id,
        row.name,
        row.address,
        row.public_key,
        row.endpoint_url,
        JSON.stringify(row.capabilities),
        row.status,
      ]
    );
    if (!created) throw new Error('agent insert returned nothing');
    return {
      id: str(created['id']),
      owner_id: str(created['owner_id']),
      status: str(created['status']),
    };
  }

  async getAssignment(missionId: string, agentId: string): Promise<{ id: string } | null> {
    const row = await this.one<Row>(
      'SELECT id FROM mission_agents WHERE mission_id = $1 AND agent_id = $2',
      [missionId, agentId]
    );
    return row ? { id: str(row['id']) } : null;
  }

  async insertAssignment(
    row: Parameters<MissionCreationStore['insertAssignment']>[0]
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO mission_agents
         (mission_id, agent_id, role, priority, required_capabilities, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        row.mission_id,
        row.agent_id,
        row.role,
        row.priority,
        JSON.stringify(row.required_capabilities),
        row.status,
      ]
    );
  }

  async insertAudit(row: MissionAuditRow): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_events
         (mission_id, event_type, actor_type, actor_id, event_hash, payload_public,
          onchain_tx_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        row.mission_id,
        row.event_type,
        row.actor_type,
        row.actor_id,
        row.event_hash,
        JSON.stringify(row.payload_public),
        row.onchain_tx_hash,
        row.created_at,
      ]
    );
  }

  async getMissionCreatedAudit(missionId: string): Promise<MissionAuditRecord | null> {
    const row = await this.one<Row>(
      `SELECT id, payload_public FROM audit_events
       WHERE mission_id = $1 AND event_type = 'mission.created'
       ORDER BY created_at ASC LIMIT 1`,
      [missionId]
    );
    if (!row) return null;
    return { id: str(row['id']), payload_public: row['payload_public'] };
  }

  async updateAuditPayload(id: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.query('UPDATE audit_events SET payload_public = $2::jsonb WHERE id = $1', [
      id,
      JSON.stringify(payload),
    ]);
  }
}
