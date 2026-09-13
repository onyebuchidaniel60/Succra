// /api/missions — dashboard read path (GET) + DRAFT row creation (POST).
//
// GET:  200 { missions: [...] } for the authenticated owner, newest first.
// POST: 201 { id, status: 'DRAFT', policyVersion: 1 }. Creates a DRAFT
//       mission row + version-1 policy row. DB-only: touches no Solana
//       program, prepares no transactions, stores placeholder PDA/vault
//       addresses (real PDAs arrive with on-chain creation later).
//       `remaining_budget_atomic` mirrors the budget; per AGENTS.md
//       invariant #3 the database is NOT the source of truth for funds.
// Auth: user session (401 UNAUTHORIZED envelope without one).
// Owner: ALWAYS derived from the session (auth.uid()). A request body
//       `owner_id` is not part of the schema and is stripped, never read.
import { NextResponse } from 'next/server';
import { apiError, unauthorized } from '@/lib/api-error';
import {
  buildPolicyDocument,
  hashPolicyDocument,
  MISSION_CREATE_SCHEMA,
  placeholderAddress,
} from '@/lib/missions';
import { server } from '@/lib/supabase';

const MISSION_COLUMNS =
  'id,name,objective,status,budget_atomic,remaining_budget_atomic,mint_address,expires_at,policy_version,created_at';

export async function GET(): Promise<NextResponse> {
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return unauthorized();
  }
  // Ownership-scoped twice: explicit owner filter here, RLS as backstop.
  const { data, error } = await supabase
    .from('missions')
    .select(MISSION_COLUMNS)
    .eq('owner_id', auth.user.id)
    .order('created_at', { ascending: false });
  if (error) {
    return apiError(500, 'MISSIONS_LIST_FAILED', 'Could not list missions.');
  }
  return NextResponse.json({ missions: data });
}

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await server();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be JSON.');
  }
  // Unknown keys (including any smuggled `owner_id`) are stripped by the
  // schema; the owner below comes only from the session.
  const parsed = MISSION_CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Mission draft failed validation.');
  }
  const input = parsed.data;
  const ownerId = auth.user.id;

  const policy = buildPolicyDocument(input);
  const policyHash = hashPolicyDocument(policy);
  const now = new Date().toISOString();

  const { data: mission, error: missionError } = await supabase
    .from('missions')
    .insert({
      owner_id: ownerId,
      name: input.name,
      objective: input.objective,
      pda_address: placeholderAddress('pda'),
      vault_address: placeholderAddress('vault'),
      mint_address: input.mintAddress,
      budget_atomic: input.budgetAtomic,
      remaining_budget_atomic: input.budgetAtomic,
      status: 'DRAFT',
      current_agent_id: null,
      current_agent_public_key: input.currentAgentPublicKey,
      policy_version: 1,
      policy_hash: policyHash,
      expires_at: input.expiresAt,
      created_at: now,
      updated_at: now,
    })
    .select('id,status,policy_version')
    .single();
  if (missionError || !mission) {
    return apiError(500, 'MISSION_CREATE_FAILED', 'Could not create mission draft.');
  }

  const { error: policyError } = await supabase.from('mission_policies').insert({
    mission_id: mission.id,
    version: 1,
    max_action_atomic: input.maxActionAtomic,
    recovery_max_action_atomic: input.recoveryMaxActionAtomic,
    allowed_action_types: [...input.allowedActionTypes],
    allowed_recipients: [...input.allowedRecipients],
    violation_threshold: policy.violation_threshold,
    violation_window_seconds: policy.violation_window_seconds,
    policy_json: policy,
    policy_hash: policyHash,
  });
  if (policyError) {
    // Compensate: never leave a draft without its policy row.
    await supabase.from('missions').delete().eq('id', mission.id).eq('owner_id', ownerId);
    return apiError(500, 'MISSION_CREATE_FAILED', 'Could not store mission policy.');
  }

  return NextResponse.json(
    { id: mission.id, status: mission.status, policyVersion: mission.policy_version },
    { status: 201 }
  );
}
