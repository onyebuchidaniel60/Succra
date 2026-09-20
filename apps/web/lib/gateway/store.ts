// Succra gateway — store seam + row types.
//
// All gateway database access goes through GatewayStore. Production uses
// SupabaseGatewayStore (service-role client, RLS bypassed server-side;
// authorization is enforced in code before any write). Tests use a
// PGlite-backed implementation over the REAL migrations. The seam keeps
// route handlers thin and every query assertion deterministic.
export interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  public_key: string;
  endpoint_url: string | null;
  capabilities: unknown;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MissionRow {
  id: string;
  owner_id: string;
  name: string;
  objective: string;
  pda_address: string;
  vault_address: string;
  mint_address: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  status: string;
  current_agent_id: string | null;
  current_agent_public_key: string;
  policy_version: number;
  policy_hash: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface MissionAgentRow {
  id: string;
  mission_id: string;
  agent_id: string;
  role: string | null;
  priority: number | null;
  required_capabilities: unknown;
  status: string | null;
  activated_at: string | null;
  revoked_at: string | null;
}

export interface PolicyRow {
  id: string;
  mission_id: string;
  version: number | null;
  max_action_atomic: string | null;
  recovery_max_action_atomic: string | null;
  allowed_action_types: string[] | null;
  allowed_recipients: string[] | null;
  violation_threshold: number | null;
  violation_window_seconds: number | null;
  policy_json: unknown;
  policy_hash: string;
  created_at: string;
}

export type ActionDecision = 'APPROVED' | 'BLOCKED';

export interface ActionRequestRow {
  id: string;
  mission_id: string;
  agent_id: string;
  idempotency_key: string;
  agent_nonce: number;
  action_type: string;
  payload: unknown;
  request_hash: string;
  signature: string;
  decision: string;
  decision_reason_code: string | null;
  violation_count_after: number | null;
  unsigned_tx_hash: string | null;
  unsigned_tx_b64: string | null;
  expires_at: string | null;
  submitted_at: string | null;
  created_at: string;
}

export type OnchainTxStatus = 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

export interface OnchainTxRow {
  id: string;
  mission_id: string;
  action_request_id: string | null;
  signature: string;
  slot: number | null;
  status: string;
  raw_error: unknown;
  confirmed_at: string | null;
  created_at: string;
}

export interface ChallengeRow {
  id: string;
  agent_id: string;
  challenge: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

export interface AuditEventRow {
  id: string;
  mission_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  event_hash: string;
  payload_public: unknown;
  onchain_signature: string | null;
  created_at: string;
}

export interface NewAuditEvent {
  mission_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  event_hash: string;
  payload_public: unknown;
  onchain_signature: string | null;
}

export interface NewAgent {
  owner_id: string;
  name: string;
  public_key: string;
  status: string;
}

export interface NewAssignment {
  mission_id: string;
  agent_id: string;
  role: string;
}

export interface NewActionRequest {
  mission_id: string;
  agent_id: string;
  idempotency_key: string;
  agent_nonce: number;
  action_type: string;
  payload: unknown;
  request_hash: string;
  signature: string;
  decision: ActionDecision;
  decision_reason_code: string | null;
  /** Streak after a counted violation; null otherwise (Phase 5 owns). */
  violation_count_after: number | null;
  unsigned_tx_hash: string | null;
  unsigned_tx_b64: string | null;
  expires_at: string | null;
}

export type InsertActionOutcome =
  { inserted: ActionRequestRow } | { conflict: 'idempotency' | 'agent-nonce' };

export interface GatewayStore {
  getAgentById(agentId: string): Promise<AgentRow | null>;
  getAgentByPublicKey(publicKey: string): Promise<AgentRow | null>;
  insertAgent(row: NewAgent): Promise<AgentRow>;
  updateAgentStatus(agentId: string, status: string): Promise<AgentRow | null>;
  updateAgentHeartbeat(agentId: string, atIso: string): Promise<AgentRow | null>;
  getMissionById(missionId: string): Promise<MissionRow | null>;
  updateMissionRemaining(missionId: string, remainingAtomic: string): Promise<void>;
  getLatestPolicy(missionId: string): Promise<PolicyRow | null>;
  getAssignment(missionId: string, agentId: string): Promise<MissionAgentRow | null>;
  listAssignmentsForAgent(agentId: string): Promise<MissionAgentRow[]>;
  insertAssignment(row: NewAssignment): Promise<MissionAgentRow>;
  getActionById(requestId: string): Promise<ActionRequestRow | null>;
  getActionByIdempotency(missionId: string, key: string): Promise<ActionRequestRow | null>;
  insertAction(row: NewActionRequest): Promise<InsertActionOutcome>;
  markActionSubmitted(requestId: string, atIso: string): Promise<void>;
  getOnchainTxByRequest(requestId: string): Promise<OnchainTxRow | null>;
  insertOnchainTx(row: {
    mission_id: string;
    action_request_id: string;
    signature: string;
    status: OnchainTxStatus;
  }): Promise<{ inserted: OnchainTxRow } | { conflict: 'signature' }>;
  updateOnchainTxConfirmed(signature: string, slot: number, atIso: string): Promise<void>;
  updateOnchainTxFailed(signature: string, rawError: unknown): Promise<void>;
  insertRequestNonce(
    agentId: string,
    nonce: string,
    expiresAtIso: string
  ): Promise<'ok' | 'duplicate'>;
  consumeRequestNonce(agentId: string, nonce: string, nowIso: string): Promise<boolean>;
  sweepRequestNonces(nowIso: string): Promise<void>;
  insertChallenge(agentId: string, challenge: string, expiresAtIso: string): Promise<void>;
  findChallenge(agentId: string, challenge: string): Promise<ChallengeRow | null>;
  consumeChallenge(agentId: string, challenge: string, nowIso: string): Promise<boolean>;
  /** Counted policy-blocked rows for (mission, agent) newer than sinceIso. */
  countPolicyBlockedSince(
    missionId: string,
    agentId: string,
    reasonCode: string,
    sinceIso: string
  ): Promise<number>;
  /** Latest CONFIRMED action time for (mission, agent), or null. */
  lastConfirmedAt(missionId: string, agentId: string): Promise<string | null>;
  /** Record the streak value on a counted violation row. */
  setActionViolationCount(requestId: string, count: number): Promise<void>;
  /**
   * Compare-and-set mission to QUARANTINED. Returns true when this call
   * flipped the row; false means already handled (idempotent quarantine).
   */
  markMissionQuarantined(missionId: string, atIso: string): Promise<boolean>;
  insertAuditEvent(row: NewAuditEvent): Promise<AuditEventRow>;
}
