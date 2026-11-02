// /api/missions — owner-scoped mission list (GET) + mission creation
// preparation (POST).
//
// GET:  200 { missions: [...] } for the authenticated owner, newest first.
// POST: 201 {
//         missionId, contractAddress, predictedContractAddress, policyHash,
//         unsignedTransaction, unsignedTx, cartMandate
//       }
//       Creates a DRAFT mirror and returns the owner-signed
//       MissionFactory.createMission call. The frontend signs it, then calls
//       POST /api/missions/:id/finalize with the transaction hash.
//
// Auth: user session (401 UNAUTHORIZED without one). The owner wallet always
// comes from the authenticated profile; a request-body `owner_id` is stripped
// by the schema and never read.
import { NextResponse } from 'next/server';
import { apiError, unauthorized } from '@/lib/api-error';
import { getSessionWallet } from '@/lib/auth/session';
import { MISSION_CREATE_SCHEMA } from '@/lib/missions';
import { createMissionChain } from '@/lib/missions/chain';
import { createSupabaseMissionCreationStore } from '@/lib/missions/creation-store';
import { MissionFinalizeError, prepareMissionCreation } from '@/lib/missions/creation';
import { server } from '@/lib/supabase';

const MISSION_COLUMNS =
  'id,name,objective,status,budget_atomic,remaining_budget_atomic,contract_address,' +
  'payment_token_address,current_agent_address,expires_at,policy_version,policy_hash,' +
  'created_at,updated_at';

export async function GET(): Promise<NextResponse> {
  const session = await getSessionWallet();
  if (!session) return unauthorized();

  const db = await server();
  // Ownership-scoped twice: explicit owner filter here, RLS as backstop.
  const { data, error } = await db
    .from('missions')
    .select(MISSION_COLUMNS)
    .eq('owner_id', session.userId)
    .order('created_at', { ascending: false });
  if (error) {
    return apiError(500, 'MISSIONS_LIST_FAILED', 'Could not list missions.');
  }
  return NextResponse.json({ missions: data });
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSessionWallet();
  if (!session) return unauthorized();

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
    const first = parsed.error.issues[0];
    return apiError(
      400,
      'INVALID_MISSION_POLICY',
      first ? `${first.path.join('.')}: ${first.message}` : 'Mission policy failed validation.'
    );
  }

  let chain;
  try {
    chain = createMissionChain();
  } catch {
    return apiError(503, 'CHAIN_NOT_CONFIGURED', 'HashKey mission factory is not configured.');
  }

  try {
    const result = await prepareMissionCreation({
      store: createSupabaseMissionCreationStore(await server()),
      ownerId: session.userId,
      ownerWallet: session.walletAddress,
      input: parsed.data,
      chain,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof MissionFinalizeError) {
      return apiError(500, 'MISSION_CREATE_FAILED', 'Could not prepare the mission transaction.');
    }
    return apiError(503, 'CHAIN_UNAVAILABLE', 'Could not prepare the mission on HashKey.');
  }
}
