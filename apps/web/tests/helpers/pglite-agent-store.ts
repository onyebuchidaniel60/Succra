import type { PGlite } from '@electric-sql/pglite';
import { createPhase4TestDb } from './pglite-gateway-store';
import type {
  AgentChallengeRecord,
  AgentRecord,
  AgentStore,
  MissionAgentRecord,
} from '../../lib/gateway/agents';

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function asAgent(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row['id']),
    owner_id: String(row['owner_id']),
    name: String(row['name']),
    address: String(row['address']),
    public_key: String(row['public_key']),
    endpoint_url: row['endpoint_url'] === null ? null : String(row['endpoint_url']),
    capabilities: stringArray(row['capabilities']),
    status: String(row['status']),
    last_heartbeat_at: row['last_heartbeat_at'] ? iso(row['last_heartbeat_at']) : null,
    created_at: iso(row['created_at']),
    updated_at: iso(row['updated_at']),
  };
}

function asAssignment(row: Record<string, unknown>): MissionAgentRecord {
  return {
    id: String(row['id']),
    mission_id: String(row['mission_id']),
    agent_id: String(row['agent_id']),
    role: String(row['role']) as 'PRIMARY' | 'SUCCESSOR',
    priority: row['priority'] === null ? null : Number(row['priority']),
    required_capabilities: stringArray(row['required_capabilities']),
    status: String(row['status']),
    activated_at: row['activated_at'] ? iso(row['activated_at']) : null,
    revoked_at: row['revoked_at'] ? iso(row['revoked_at']) : null,
  };
}

function asChallenge(row: Record<string, unknown>): AgentChallengeRecord {
  return {
    id: String(row['id']),
    agent_id: String(row['agent_id']),
    challenge: String(row['challenge']),
    expires_at: iso(row['expires_at']),
    consumed_at: row['consumed_at'] ? iso(row['consumed_at']) : null,
    created_at: iso(row['created_at']),
  };
}

export async function createPhase4AgentDb(): Promise<PGlite> {
  return createPhase4TestDb();
}

export class PGliteAgentStore implements AgentStore {
  constructor(private readonly db: PGlite) {}

  private async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const result = await this.db.query<Record<string, unknown>>(sql, params);
    const row = result.rows[0];
    return (row ?? null) as T | null;
  }

  private async many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<Record<string, unknown>>(sql, params);
    return result.rows as T[];
  }

  async getMission(id: string) {
    return this.one<{ id: string; owner_id: string }>(
      'SELECT id, owner_id FROM missions WHERE id = $1',
      [id]
    );
  }

  async getAgentById(id: string) {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM agents WHERE id = $1', [id]);
    return row ? asAgent(row) : null;
  }

  async getAgentByAddress(address: string) {
    const row = await this.one<Record<string, unknown>>('SELECT * FROM agents WHERE address = $1', [
      address,
    ]);
    return row ? asAgent(row) : null;
  }

  async insertAgent(row: Parameters<AgentStore['insertAgent']>[0]) {
    const result = await this.one<Record<string, unknown>>(
      `INSERT INTO agents (owner_id, name, address, public_key, endpoint_url, capabilities, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *`,
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
    if (!result) throw new Error('insert agent failed');
    return asAgent(result);
  }

  async updateAgent(id: string, patch: Parameters<AgentStore['updateAgent']>[1]) {
    const result = await this.one<Record<string, unknown>>(
      `UPDATE agents SET
         name = COALESCE($2, name),
         endpoint_url = COALESCE($3, endpoint_url),
         capabilities = COALESCE($4::jsonb, capabilities),
         status = COALESCE($5, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        patch.name ?? null,
        patch.endpoint_url ?? null,
        patch.capabilities === undefined ? null : JSON.stringify(patch.capabilities),
        patch.status ?? null,
      ]
    );
    return result ? asAgent(result) : null;
  }

  async getAssignment(missionId: string, agentId: string) {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM mission_agents WHERE mission_id = $1 AND agent_id = $2',
      [missionId, agentId]
    );
    return row ? asAssignment(row) : null;
  }

  async countAssignments(missionId: string, role: 'PRIMARY' | 'SUCCESSOR') {
    const row = await this.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM mission_agents WHERE mission_id = $1 AND role = $2',
      [missionId, role]
    );
    return Number(row?.count ?? 0);
  }

  async insertAssignment(row: Parameters<AgentStore['insertAssignment']>[0]) {
    const result = await this.one<Record<string, unknown>>(
      `INSERT INTO mission_agents
         (mission_id, agent_id, role, priority, required_capabilities, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
      [
        row.mission_id,
        row.agent_id,
        row.role,
        row.priority,
        JSON.stringify(row.required_capabilities),
        row.status,
      ]
    );
    if (!result) throw new Error('insert assignment failed');
    return asAssignment(result);
  }

  async updateAssignmentStatus(missionId: string, agentId: string, status: string) {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE mission_agents SET status = $3
       WHERE mission_id = $1 AND agent_id = $2 RETURNING *`,
      [missionId, agentId, status]
    );
    return row ? asAssignment(row) : null;
  }

  async updateAssignmentsStatusForAgent(agentId: string, status: string) {
    await this.db.query(
      `UPDATE mission_agents SET status = $2 WHERE agent_id = $1 AND status = 'PENDING'`,
      [agentId, status]
    );
  }

  async hasRegisteredAssignment(agentId: string) {
    const row = await this.one<{ id: string }>(
      `SELECT id FROM mission_agents WHERE agent_id = $1 AND status = 'REGISTERED' LIMIT 1`,
      [agentId]
    );
    return row !== null;
  }

  async listAssignmentsForAgent(agentId: string) {
    const rows = await this.many<Record<string, unknown>>(
      'SELECT * FROM mission_agents WHERE agent_id = $1',
      [agentId]
    );
    return rows.map(asAssignment);
  }

  async insertChallenge(row: Parameters<AgentStore['insertChallenge']>[0]) {
    const result = await this.one<Record<string, unknown>>(
      `INSERT INTO agent_challenges (agent_id, challenge, expires_at)
       VALUES ($1,$2,$3) RETURNING *`,
      [row.agent_id, row.challenge, row.expires_at]
    );
    if (!result) throw new Error('insert challenge failed');
    return asChallenge(result);
  }

  async findChallenge(agentId: string, challenge: string) {
    const row = await this.one<Record<string, unknown>>(
      'SELECT * FROM agent_challenges WHERE agent_id = $1 AND challenge = $2',
      [agentId, challenge]
    );
    return row ? asChallenge(row) : null;
  }

  async consumeChallenge(agentId: string, challenge: string, consumedAt: string) {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE agent_challenges SET consumed_at = $3
       WHERE agent_id = $1 AND challenge = $2
         AND consumed_at IS NULL AND expires_at > $3
       RETURNING *`,
      [agentId, challenge, consumedAt]
    );
    return row ? asChallenge(row) : null;
  }

  async deleteExpiredChallenges(before: string) {
    await this.db.query('DELETE FROM agent_challenges WHERE expires_at < $1', [before]);
  }

  async updateHeartbeat(agentId: string, at: string) {
    const row = await this.one<Record<string, unknown>>(
      `UPDATE agents SET last_heartbeat_at = $2, updated_at = $2
       WHERE id = $1 RETURNING *`,
      [agentId, at]
    );
    return row ? asAgent(row) : null;
  }
}
