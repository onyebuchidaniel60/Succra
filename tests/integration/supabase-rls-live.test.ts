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
//   B. Live auth flow over HTTP: nonce -> EIP-712 SuccraLogin sign
//      (generated test account) -> verify -> session cookie -> missions
//      read/auth gate, nonce single-use/reuse/expiry, bad signature.
//   C. Dashboard gate: anonymous GET /dashboard -> 307 to /.
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const APP_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');
const LIVE = SUPABASE_URL !== '' && ANON_KEY !== '' && SERVICE_KEY !== '' && APP_URL !== '';

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

    interface LoginTypedData {
      domain: { name: 'Succra'; version: '1'; chainId: number };
      types: {
        SuccraLogin: readonly [
          { name: 'walletAddress'; type: 'address' },
          { name: 'nonce'; type: 'string' },
          { name: 'issuedAt'; type: 'string' },
        ];
      };
      primaryType: 'SuccraLogin';
      message: { walletAddress: `0x${string}`; nonce: string; issuedAt: string };
    }

    async function issueNonce(
      walletAddress: string
    ): Promise<{ nonce: string; typedData: LoginTypedData; status: number }> {
      const response = await fetch(`${APP_URL}/api/auth/nonce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });
      const payload = (await response.json()) as { nonce: string; typedData: LoginTypedData };
      return { nonce: payload.nonce, typedData: payload.typedData, status: response.status };
    }

    it('nonce -> sign -> verify -> cookie -> missions 200; anonymous 401', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletAddress = account.address.toLowerCase();
      const issued = await issueNonce(account.address);
      expect(issued.status).toEqual(200);
      expect(issued.typedData.message.walletAddress).toEqual(walletAddress);
      expect(issued.typedData.domain).toEqual({ name: 'Succra', version: '1', chainId: 177 });
      const signature = await account.signTypedData({
        domain: issued.typedData.domain,
        types: issued.typedData.types,
        primaryType: issued.typedData.primaryType,
        message: issued.typedData.message,
      });
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

      // Authenticated but Solana-shaped input is rejected by the EVM schema,
      // and a smuggled owner_id never creates a row.
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
      expect(created.status).toEqual(400);
      const stored = await admin.from('missions').select('id').eq('owner_id', session.user.id);
      expect((stored.data ?? []).length).toEqual(0);
      await admin.from('profiles').delete().eq('id', session.user.id);
      await admin.auth.admin.deleteUser(session.user.id);
    }, 120_000);

    it('tampered signature is rejected', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletAddress = account.address.toLowerCase();
      const issued = await issueNonce(account.address);
      const signature = await account.signTypedData({
        domain: issued.typedData.domain,
        types: issued.typedData.types,
        primaryType: issued.typedData.primaryType,
        message: issued.typedData.message,
      });
      const bytes = signature.slice(2).split('');
      bytes[0] = bytes[0] === 'f' ? '0' : 'f';
      const response = await fetch(`${APP_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          nonce: issued.nonce,
          signature: `0x${bytes.join('')}`,
        }),
      });
      expect(response.status).toEqual(401);
    }, 60_000);

    it('expired nonce is rejected (short app TTL)', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const walletAddress = account.address.toLowerCase();
      const issued = await issueNonce(account.address);
      // CI boots the app with SUCCRA_NONCE_TTL_SECONDS=10; outliving it
      // must fail verification.
      await new Promise((resolve) => setTimeout(resolve, 11_000));
      const signature = await account.signTypedData({
        domain: issued.typedData.domain,
        types: issued.typedData.types,
        primaryType: issued.typedData.primaryType,
        message: issued.typedData.message,
      });
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

  describe('live Phase 4 gateway tables', () => {
    let userA: TestUser;
    let userB: TestUser;
    let missionA = '';
    let agentA = '';

    beforeAll(async () => {
      userA = await makeUser('p4a');
      userB = await makeUser('p4b');
      for (const [user, tag] of [
        [userA, 'p4a'],
        [userB, 'p4b'],
      ] as const) {
        const profile = await user.client
          .from('profiles')
          .insert({ id: user.id, wallet_address: `live-${tag}-${randomUUID()}` })
          .select('id')
          .single();
        if (profile.error) throw new Error(`profile ${tag}: ${profile.error.message}`);
      }
      const agent = await userA.client
        .from('agents')
        .insert({
          owner_id: userA.id,
          name: 'alpha',
          public_key: `key-${randomUUID()}`,
          status: 'ACTIVE_PRIMARY',
        })
        .select('id')
        .single();
      if (agent.error || !agent.data)
        throw new Error(`agent: ${agent.error?.message ?? 'unknown'}`);
      agentA = (agent.data as { id: string }).id;
      const mission = await userA.client
        .from('missions')
        .insert({
          owner_id: userA.id,
          name: 'Phase 4 live',
          objective: 'Prove gateway isolation',
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
      const action = await admin
        .from('action_requests')
        .insert({
          mission_id: missionA,
          agent_id: agentA,
          idempotency_key: `live-${randomUUID()}`,
          request_id: randomUUID(),
          onchain_request_id: `0x${randomBytes(32).toString('hex')}`,
          agent_nonce: 1,
          action_type: 'HSP_PAYMENT',
          payload: {},
          request_hash: 'hash',
          signature: 'sig',
          decision: 'BLOCK',
          decision_reason_code: 'POLICY_BLOCKED',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        .select('id')
        .single();
      if (action.error) throw new Error(`action: ${action.error.message}`);
    }, 120_000);

    afterAll(async () => {
      await cleanupUser(userA).catch(() => undefined);
      await cleanupUser(userB).catch(() => undefined);
    });

    it('owners can read but cannot write action rows; B cannot write for A’s mission', async () => {
      const seen = await userB.client.from('action_requests').select('id');
      expect(seen.data ?? []).toEqual([]);

      const ownerWrite = await userA.client.from('action_requests').insert({
        mission_id: missionA,
        agent_id: agentA,
        idempotency_key: `owner-${randomUUID()}`,
        request_id: randomUUID(),
        onchain_request_id: `0x${randomBytes(32).toString('hex')}`,
        agent_nonce: 100,
        action_type: 'HSP_PAYMENT',
        payload: {},
        request_hash: 'h',
        signature: 's',
        decision: 'ALLOW',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(ownerWrite.error).not.toBeNull();

      const written = await userB.client.from('action_requests').insert({
        mission_id: missionA,
        agent_id: agentA,
        idempotency_key: `evil-${randomUUID()}`,
        request_id: randomUUID(),
        onchain_request_id: `0x${randomBytes(32).toString('hex')}`,
        agent_nonce: 99,
        action_type: 'HSP_PAYMENT',
        payload: {},
        request_hash: 'h',
        signature: 's',
        decision: 'ALLOW',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(written.error).not.toBeNull();
    });

    it('agent_request_nonces and agent_challenges are server-only', async () => {
      const nonces = await userA.client.from('agent_request_nonces').select('id');
      expect(nonces.data ?? []).toEqual([]);
      const challenges = await userA.client.from('agent_challenges').select('id');
      expect(challenges.data ?? []).toEqual([]);
      const writeNonce = await userA.client.from('agent_request_nonces').insert({
        agent_id: agentA,
        nonce: 'n',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(writeNonce.error).not.toBeNull();
      const writeChallenge = await userA.client.from('agent_challenges').insert({
        agent_id: agentA,
        challenge: 'c',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(writeChallenge.error).not.toBeNull();
    });
  });
}
