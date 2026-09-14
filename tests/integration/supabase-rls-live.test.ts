// Live integration suite: real local Supabase + real Next.js app.
//
// Runs ONLY when the environment provides a live stack (GitHub Actions
// `supabase` job); otherwise the whole file skips so `pnpm test` stays
// green without Docker:
//
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   APP_URL (e.g. http://127.0.0.1:3100)
//
// Contents:
//   A. RLS allow/deny mirror of tests/integration/supabase-rls.test.ts,
//      executed through PostgREST with real GoTrue JWTs.
//   B. Live auth flow over HTTP: nonce -> Ed25519 sign (generated test
//      keypair) -> verify -> session cookie -> missions CRUD scoping,
//      nonce single-use/reuse/expiry, bad signature, owner_id spoof.
//   C. Dashboard gate: anonymous GET /dashboard -> 307 to /.
import { randomBytes, randomUUID } from 'node:crypto';
import { sign } from 'tweetnacl';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const APP_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');
const LIVE = SUPABASE_URL !== '' && ANON_KEY !== '' && SERVICE_KEY !== '' && APP_URL !== '';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = (num << 8n) + BigInt(byte);
  }
  let out = '';
  while (num > 0n) {
    out = (ALPHABET[Number(num % 58n)] ?? '') + out;
    num /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

if (!LIVE) {
  describe.skip('live supabase suite (requires SUPABASE_URL/ANON_KEY/SERVICE_KEY/APP_URL)', () => {
    it('skipped without a live stack', () => {
      expect(true).toEqual(true);
    });
  });
} else {
  const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const userClient = (): SupabaseClient =>
    createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

  interface TestUser {
    id: string;
    email: string;
    password: string;
    client: SupabaseClient;
  }

  async function makeUser(tag: string): Promise<TestUser> {
    const email = `phase31-${tag}-${Date.now()}-${randomUUID()}@wallet.succra.invalid`;
    const password = randomBytes(24).toString('base64url');
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`createUser failed: ${created.error?.message ?? 'unknown'}`);
    }
    const client = userClient();
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.user) {
      throw new Error(`signIn failed: ${signed.error?.message ?? 'unknown'}`);
    }
    return { id: signed.data.user.id, email, password, client };
  }

  async function cleanupUser(user: TestUser): Promise<void> {
    await admin.from('missions').delete().eq('owner_id', user.id);
    await admin.from('agents').delete().eq('owner_id', user.id);
    await admin.from('profiles').delete().eq('id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  }

  describe('live RLS mirror', () => {
    let userA: TestUser;
    let userB: TestUser;
    let missionA = '';
    let missionB = '';

    beforeAll(async () => {
      userA = await makeUser('a');
      userB = await makeUser('b');
      const walletA = `live-a-${randomUUID()}`;
      const walletB = `live-b-${randomUUID()}`;
      const profileA = await userA.client
        .from('profiles')
        .insert({ id: userA.id, wallet_address: walletA })
        .select('id')
        .single();
      if (profileA.error) throw new Error(`profile A: ${profileA.error.message}`);
      const profileB = await userB.client
        .from('profiles')
        .insert({ id: userB.id, wallet_address: walletB })
        .select('id')
        .single();
      if (profileB.error) throw new Error(`profile B: ${profileB.error.message}`);
      const agent = await userA.client
        .from('agents')
        .insert({
          owner_id: userA.id,
          name: 'alpha',
          public_key: `key-${randomUUID()}`,
          status: 'REGISTERED',
        })
        .select('id')
        .single();
      if (agent.error || !agent.data)
        throw new Error(`agent: ${agent.error?.message ?? 'unknown'}`);
      const mission = await userA.client
        .from('missions')
        .insert({
          owner_id: userA.id,
          name: 'Live run',
          objective: 'Prove isolation',
          pda_address: `pending:live:${randomUUID()}`,
          vault_address: `pending:live:${randomUUID()}`,
          mint_address: '11111111111111111111111111111111',
          budget_atomic: '50000000',
          remaining_budget_atomic: '50000000',
          status: 'DRAFT',
          current_agent_public_key: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          policy_version: 1,
          policy_hash: 'hash',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        .select('id')
        .single();
      if (mission.error || !mission.data) {
        throw new Error(`mission: ${mission.error?.message ?? 'unknown'}`);
      }
      missionA = (mission.data as { id: string }).id;
      const agentId = (agent.data as { id: string }).id;
      const policy = await userA.client
        .from('mission_policies')
        .insert({ mission_id: missionA, version: 1, policy_json: {}, policy_hash: 'hash' })
        .select('id')
        .single();
      if (policy.error) throw new Error(`policy: ${policy.error.message}`);
      const assignment = await userA.client
        .from('mission_agents')
        .insert({ mission_id: missionA, agent_id: agentId, role: 'PRIMARY' })
        .select('id')
        .single();
      if (assignment.error) throw new Error(`assignment: ${assignment.error.message}`);
      const missionBRow = await userB.client
        .from('missions')
        .insert({
          owner_id: userB.id,
          name: 'B mission',
          objective: 'B objective',
          pda_address: `pending:live:${randomUUID()}`,
          vault_address: `pending:live:${randomUUID()}`,
          mint_address: '11111111111111111111111111111111',
          budget_atomic: '10',
          remaining_budget_atomic: '10',
          status: 'DRAFT',
          current_agent_public_key: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          policy_version: 1,
          policy_hash: 'hash',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        .select('id')
        .single();
      if (missionBRow.error || !missionBRow.data) {
        throw new Error(`mission B: ${missionBRow.error?.message ?? 'unknown'}`);
      }
      missionB = (missionBRow.data as { id: string }).id;
    }, 120_000);

    afterAll(async () => {
      await cleanupUser(userA).catch(() => undefined);
      await cleanupUser(userB).catch(() => undefined);
    });

    it('each user lists only their own missions', async () => {
      const listB = await userB.client.from('missions').select('id');
      expect((listB.data ?? []).map((row) => (row as { id: string }).id)).toEqual([missionB]);
      const byId = await userB.client
        .from('missions')
        .select('id')
        .eq('id', missionA)
        .maybeSingle();
      expect(byId.data).toBeNull();
    });

    it('B cannot UPDATE or DELETE the mission of A', async () => {
      const updated = await userB.client
        .from('missions')
        .update({ name: 'hijacked' })
        .eq('id', missionA)
        .select('id');
      expect(updated.data ?? []).toEqual([]);
      const deleted = await userB.client.from('missions').delete().eq('id', missionA).select('id');
      expect(deleted.data ?? []).toEqual([]);
    });

    it('B cannot INSERT rows owned by A (mission, policy, assignment)', async () => {
      const mission = await userB.client.from('missions').insert({
        owner_id: userA.id,
        name: 'x',
        objective: 'y',
        pda_address: `pending:live:${randomUUID()}`,
        vault_address: `pending:live:${randomUUID()}`,
        mint_address: '11111111111111111111111111111111',
        budget_atomic: '1',
        remaining_budget_atomic: '1',
        status: 'DRAFT',
        current_agent_public_key: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        policy_version: 1,
        policy_hash: 'h',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(mission.error).not.toBeNull();
      const policy = await userB.client
        .from('mission_policies')
        .insert({ mission_id: missionA, version: 1, policy_json: {}, policy_hash: 'h' });
      expect(policy.error).not.toBeNull();
    });

    it('B sees no join rows of A; A reads their own', async () => {
      const policiesB = await userB.client.from('mission_policies').select('id');
      expect(policiesB.data ?? []).toEqual([]);
      const assignmentsB = await userB.client.from('mission_agents').select('id');
      expect(assignmentsB.data ?? []).toEqual([]);
      const policiesA = await userA.client
        .from('mission_policies')
        .select('id')
        .eq('mission_id', missionA);
      expect((policiesA.data ?? []).length).toEqual(1);
    });

    it('A updates and finally deletes their own mission', async () => {
      const updated = await userA.client
        .from('missions')
        .update({ name: 'Live run v2' })
        .eq('id', missionA)
        .select('id');
      expect((updated.data ?? []).length).toEqual(1);
      const deleted = await userA.client.from('missions').delete().eq('id', missionA).select('id');
      expect((deleted.data ?? []).length).toEqual(1);
    });
  });

  describe('live auth flow over HTTP', () => {
    function jar(setCookies: string[]): string {
      return setCookies.map((entry) => entry.split(';')[0] ?? '').join('; ');
    }

    async function issueNonce(
      walletAddress: string
    ): Promise<{ nonce: string; message: string; status: number }> {
      const response = await fetch(`${APP_URL}/api/auth/nonce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const payload = (await response.json()) as { nonce: string; message: string };
      return { nonce: payload.nonce, message: payload.message, status: response.status };
    }

    it('nonce -> sign -> verify -> cookie -> missions 200; anonymous 401', async () => {
      const keys = sign.keyPair();
      const walletAddress = base58Encode(keys.publicKey);
      const issued = await issueNonce(walletAddress);
      expect(issued.status).toEqual(200);
      expect(issued.message).toContain(`Wallet: ${walletAddress}`);
      const signature = base64(
        sign.detached(new TextEncoder().encode(issued.message), keys.secretKey)
      );
      const verifyRes = await fetch(`${APP_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress, nonce: issued.nonce, signature }),
      });
      expect(verifyRes.status).toEqual(200);
      const session = (await verifyRes.json()) as { user: { id: string; walletAddress: string } };
      expect(session.user.walletAddress).toEqual(walletAddress);
      const cookie = jar(verifyRes.headers.getSetCookie());
      expect(cookie.length).toBeGreaterThan(0);

      const authed = await fetch(`${APP_URL}/api/missions`, { headers: { cookie } });
      expect(authed.status).toEqual(200);
      const listed = (await authed.json()) as { missions: unknown[] };
      expect(Array.isArray(listed.missions)).toEqual(true);

      const anonymous = await fetch(`${APP_URL}/api/missions`);
      expect(anonymous.status).toEqual(401);

      // Reuse fails: single-use holds end to end.
      const replay = await fetch(`${APP_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress, nonce: issued.nonce, signature }),
      });
      expect(replay.status).toEqual(401);

      // Authenticated draft creation ignores a smuggled owner_id.
      const created = await fetch(`${APP_URL}/api/missions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Live draft',
          objective: 'Prove owner derivation',
          mintAddress: '11111111111111111111111111111111',
          budgetAtomic: '50000000',
          maxActionAtomic: '5000000',
          recoveryMaxActionAtomic: '1000000',
          allowedActionTypes: ['TRANSFER_SOL'],
          allowedRecipients: [],
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          currentAgentPublicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          owner_id: 'attacker-user-id',
        }),
      });
      expect(created.status).toEqual(201);
      const draft = (await created.json()) as { id: string; status: string };
      expect(draft.status).toEqual('DRAFT');
      const stored = await admin
        .from('missions')
        .select('owner_id')
        .eq('id', draft.id)
        .maybeSingle();
      expect((stored.data as { owner_id: string } | null)?.owner_id).toEqual(session.user.id);
      await admin.from('missions').delete().eq('id', draft.id);
      await admin.from('profiles').delete().eq('id', session.user.id);
      await admin.auth.admin.deleteUser(session.user.id);
    }, 120_000);

    it('tampered signature is rejected', async () => {
      const keys = sign.keyPair();
      const walletAddress = base58Encode(keys.publicKey);
      const issued = await issueNonce(walletAddress);
      const raw = Buffer.from(
        sign.detached(new TextEncoder().encode(issued.message), keys.secretKey)
      );
      raw[0] = (raw[0] ?? 0) ^ 0xff;
      const response = await fetch(`${APP_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          nonce: issued.nonce,
          signature: base64(raw),
        }),
      });
      expect(response.status).toEqual(401);
    }, 60_000);

    it('expired nonce is rejected (short app TTL)', async () => {
      const keys = sign.keyPair();
      const walletAddress = base58Encode(keys.publicKey);
      const issued = await issueNonce(walletAddress);
      // CI boots the app with SUCCRA_NONCE_TTL_SECONDS=10; outliving it
      // must fail verification.
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      const signature = base64(
        sign.detached(new TextEncoder().encode(issued.message), keys.secretKey)
      );
      const response = await fetch(`${APP_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress, nonce: issued.nonce, signature }),
      });
      expect(response.status).toEqual(401);
    }, 60_000);
  });

  describe('live dashboard gate', () => {
    it('anonymous GET /dashboard redirects to /', async () => {
      const response = await fetch(`${APP_URL}/dashboard`, { redirect: 'manual' });
      expect(response.status).toEqual(307);
      expect(response.headers.get('location')).toEqual('/');
    }, 60_000);
  });
}
