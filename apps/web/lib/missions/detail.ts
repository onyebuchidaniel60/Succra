// Succra web — owner-scoped mission detail aggregation.
//
// The database is a mirror; the contract state is read live when the RPC is
// available. Token decimals are resolved from the token/config and never
// guessed from a global default.
import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePolicyDocument, type MissionPolicyDocument } from '@/lib/missions';
import { readMissionState, type MissionOnChainState } from '@/lib/gateway/contract-reader';
import { readTokenDecimals } from '@/lib/token-decimals';
import type { SuccessionRecordView } from '@/components/SuccessionPanel';

export interface MissionDetailRow {
  id: string;
  owner_id: string;
  name: string;
  objective: string;
  status: string;
  contract_address: string;
  payment_token_address: string;
  current_agent_address: string;
  budget_atomic: string;
  remaining_budget_atomic: string;
  policy_version: number;
  policy_hash: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface MissionCheckpointView {
  sequence: number;
  checkpoint_hash: string;
  committed_tx_hash: string | null;
  created_at: string;
}

export interface MissionAgentView {
  mission_agent_id: string;
  agent_id: string;
  address: string;
  role: string;
  priority: number | null;
  status: string;
}

export interface MissionDetail {
  mission: MissionDetailRow;
  policy: MissionPolicyDocument | null;
  onchain: MissionOnChainState | null;
  tokenDecimals: number | null;
  checkpoints: MissionCheckpointView[];
  successions: SuccessionRecordView[];
  agents: MissionAgentView[];
}

const MISSION_DETAIL_COLUMNS =
  'id,owner_id,name,objective,status,contract_address,payment_token_address,' +
  'current_agent_address,budget_atomic,remaining_budget_atomic,policy_version,' +
  'policy_hash,expires_at,created_at,updated_at';

export async function getMissionDetail(
  db: SupabaseClient,
  missionId: string,
  ownerId: string
): Promise<MissionDetail | null> {
  const { data: missionData, error } = await db
    .from('missions')
    .select(MISSION_DETAIL_COLUMNS)
    .eq('id', missionId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!missionData) return null;
  const mission = missionData as unknown as MissionDetailRow;

  const { data: policyData, error: policyError } = await db
    .from('mission_policies')
    .select('policy_json,policy_hash')
    .eq('mission_id', missionId)
    .eq('version', mission.policy_version)
    .maybeSingle();
  if (policyError) throw policyError;
  const policy = parsePolicyDocument((policyData as { policy_json?: unknown } | null)?.policy_json);

  let onchain: MissionOnChainState | null = null;
  if (/^0x[0-9a-fA-F]{40}$/.test(mission.contract_address)) {
    try {
      onchain = await readMissionState(mission.contract_address as `0x${string}`);
    } catch {
      onchain = null;
    }
  }

  const tokenAddress = onchain?.paymentToken ?? mission.payment_token_address;
  const tokenDecimals = await readTokenDecimals(tokenAddress).catch(() => null);

  const { data: checkpointData } = await db
    .from('mission_checkpoints')
    .select('sequence,checkpoint_hash,committed_tx_hash,created_at')
    .eq('mission_id', missionId)
    .order('sequence', { ascending: false })
    .limit(10);
  const checkpoints = ((checkpointData as unknown as MissionCheckpointView[] | null) ?? []).map(
    (row) => ({
      sequence: Number(row.sequence),
      checkpoint_hash: row.checkpoint_hash,
      committed_tx_hash: row.committed_tx_hash,
      created_at: row.created_at,
    })
  );

  const { data: successionData } = await db
    .from('succession_events')
    .select(
      'id,from_agent_address,to_agent_address,trigger_type,checkpoint_hash,checkpoint_sequence,' +
        'recovery_max_payment_atomic,status,activation_tx_hash,acknowledgement_tx_hash,' +
        'created_at,acknowledged_at'
    )
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false });
  const successions = (successionData as unknown as SuccessionRecordView[] | null) ?? [];

  const { data: assignmentData } = await db
    .from('mission_agents')
    .select('id,agent_id,role,priority,status')
    .eq('mission_id', missionId);
  const assignmentRows = (assignmentData as unknown as Array<Record<string, unknown>> | null) ?? [];
  const agents: MissionAgentView[] = [];
  if (assignmentRows.length > 0) {
    const ids = assignmentRows.map((row) => String(row['agent_id']));
    const { data: agentData } = await db.from('agents').select('id,address').in('id', ids);
    const byId = new Map(
      ((agentData as unknown as Array<{ id: string; address: string }> | null) ?? []).map(
        (agent) => [agent.id, agent.address]
      )
    );
    for (const row of assignmentRows) {
      const agentId = String(row['agent_id']);
      agents.push({
        mission_agent_id: String(row['id']),
        agent_id: agentId,
        address: byId.get(agentId) ?? '—',
        role: String(row['role'] ?? '—'),
        priority:
          row['priority'] === null || row['priority'] === undefined
            ? null
            : Number(row['priority']),
        status: String(row['status'] ?? '—'),
      });
    }
  }

  return { mission, policy, onchain, tokenDecimals, checkpoints, successions, agents };
}
