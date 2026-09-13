// Route-handler logic tests: verify + missions execute for real against
// programmable in-memory fakes for the Supabase transport.
//
// What this proves (without Docker): request validation, owner derivation
// (always from the session — a smuggled owner_id is stripped and never
// read), ownership scoping of queries, session-cookie issuance, and the
// §10 error envelope. RLS itself (database backstop) is proven separately
// against real Postgres semantics in tests/integration/supabase-rls.test.ts.
import { sign } from 'tweetnacl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeQuery, type Filter, type Tables } from './helpers/fake-supabase';

interface Fixtures {
  sessionUser: { id: string } | null;
  recordedFilters: Array<{ table: string; filters: Filter[] }>;
  tables: Tables;
  adminUsers: Record<string, { id: string; email: string; wallet: string }>;
  adminCalls: string[];
  otpResult: { session: { access_token: string } | null; user: { id: string } | null };
  otpError: { message: string } | null;
  cookieSets: Array<{ name: string; value: string }>;
}

const fixtures: Fixtures = vi.hoisted(() => ({
  sessionUser: null as Fixtures['sessionUser'],
  recordedFilters: [] as Fixtures['recordedFilters'],
  tables: {} as Fixtures['tables'],
  adminUsers: {} as Fixtures['adminUsers'],
  adminCalls: [] as Fixtures['adminCalls'],
  otpResult: { session: null, user: null } as Fixtures['otpResult'],
  otpError: null as Fixtures['otpError'],
  cookieSets: [] as Fixtures['cookieSets'],
}));

function tracedQuery(table: string): FakeQuery {
  return new FakeQuery(fixtures.tables, table, (tracedTable, filters) => {
    fixtures.recordedFilters.push({ table: tracedTable, filters });
  });
}

function fakeUserClient(): {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: (table: string) => FakeQuery;
} {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: fixtures.sessionUser } }),
    },
    from: (table: string) => tracedQuery(table),
  };
}

function fakeAdminClient(): {
  from: (table: string) => FakeQuery;
  auth: {
    admin: {
      getUserById: (
        id: string
      ) => Promise<{ data: { user: { id: string; email: string } | null }; error: null }>;
      createUser: (input: {
        email: string;
        app_metadata: Record<string, string>;
      }) => Promise<{ data: { user: { id: string } | null }; error: null }>;
      generateLink: () => Promise<{
        data: { properties: { hashed_token: string } };
        error: null;
      }>;
    };
  };
} {
  return {
    from: (table: string) => tracedQuery(table),
    auth: {
      admin: {
        getUserById: (id: string) => {
          fixtures.adminCalls.push(`getUserById:${id}`);
          const found = Object.values(fixtures.adminUsers).find((user) => user.id === id);
          return Promise.resolve({
            data: { user: found ? { id: found.id, email: found.email } : null },
            error: null,
          });
        },
        createUser: (input: { email: string; app_metadata: Record<string, string> }) => {
          fixtures.adminCalls.push(`createUser:${input.email}`);
          const wallet = input.app_metadata['wallet_address'] ?? 'unknown';
          const id = `user-for-${wallet}`;
          fixtures.adminUsers[input.email] = { id, email: input.email, wallet };
          return Promise.resolve({ data: { user: { id } }, error: null });
        },
        generateLink: () => {
          fixtures.adminCalls.push('generateLink');
          return Promise.resolve({
            data: { properties: { hashed_token: 'token-hash' } },
            error: null,
          });
        },
      },
    },
  };
}

vi.mock('@/lib/supabase', () => ({
  server: () => fakeUserClient(),
  admin: () => fakeAdminClient(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: () => {
        if (fixtures.otpError) {
          return Promise.resolve({ data: { session: null, user: null }, error: fixtures.otpError });
        }
        fixtures.cookieSets.push({ name: 'sb-access-token', value: 'session-jwt' });
        return Promise.resolve({
          data: { session: fixtures.otpResult.session, user: fixtures.otpResult.user },
          error: null,
        });
      },
    },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => undefined,
    }),
}));

const { POST: postNonce } = await import('../app/api/auth/nonce/route');
const { POST: postVerify } = await import('../app/api/auth/verify/route');
const { GET: getMissions, POST: postMissions } = await import('../app/api/missions/route');

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

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function freshWallet(): Promise<{ address: string; secretKey: Uint8Array }> {
  const keys = sign.keyPair();
  return { address: base58Encode(keys.publicKey), secretKey: keys.secretKey };
}

async function signedVerifyInput(): Promise<{
  walletAddress: string;
  nonce: string;
  signature: string;
}> {
  const { address, secretKey } = await freshWallet();
  const nonceRes = await postNonce(jsonRequest('/api/auth/nonce', { walletAddress: address }));
  const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };
  const signature = Buffer.from(
    sign.detached(new TextEncoder().encode(message), secretKey)
  ).toString('base64');
  return { walletAddress: address, nonce, signature };
}

beforeEach(() => {
  // The Supabase transport is fully mocked in this file; the handlers only
  // require the env vars to be present, never to point anywhere real.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  fixtures.sessionUser = null;
  fixtures.recordedFilters = [];
  fixtures.tables = {};
  fixtures.adminUsers = {};
  fixtures.adminCalls = [];
  fixtures.otpResult = { session: null, user: null };
  fixtures.otpError = null;
  fixtures.cookieSets = [];
});

describe('POST /api/auth/verify', () => {
  it('verifies a genuine signature and establishes a session for a new wallet', async () => {
    const input = await signedVerifyInput();
    fixtures.otpResult = {
      session: { access_token: 'session-jwt' },
      user: { id: `user-for-${input.walletAddress}` },
    };
    const response = await postVerify(jsonRequest('/api/auth/verify', input));
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as { user: { id: string; walletAddress: string } };
    expect(payload.user.walletAddress).toEqual(input.walletAddress);
    expect(payload.user.id).toEqual(`user-for-${input.walletAddress}`);
    // Session cookie issued; profile row bootstrapped with the wallet.
    expect(fixtures.cookieSets.length).toBeGreaterThan(0);
    const profiles = fixtures.tables['profiles'] ?? [];
    expect(profiles.length).toEqual(1);
    expect(profiles[0]?.['wallet_address']).toEqual(input.walletAddress);
    expect(profiles[0]?.['id']).toEqual(payload.user.id);
    expect(fixtures.adminCalls).toContain('generateLink');
  });

  it('rejects a reused nonce', async () => {
    const input = await signedVerifyInput();
    fixtures.otpResult = {
      session: { access_token: 's' },
      user: { id: `user-for-${input.walletAddress}` },
    };
    expect((await postVerify(jsonRequest('/api/auth/verify', input))).status).toEqual(200);
    const replay = await postVerify(jsonRequest('/api/auth/verify', input));
    expect(replay.status).toEqual(401);
    const payload = (await replay.json()) as { error: { code: string } };
    expect(payload.error.code).toMatch(/NONCE_/);
  });

  it('rejects a tampered signature', async () => {
    const input = await signedVerifyInput();
    const bytes = Buffer.from(input.signature, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    const response = await postVerify(
      jsonRequest('/api/auth/verify', { ...input, signature: bytes.toString('base64') })
    );
    expect(response.status).toEqual(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toEqual(
      'INVALID_SIGNATURE'
    );
  });

  it('rejects a nonce presented by a different wallet', async () => {
    const input = await signedVerifyInput();
    const other = await freshWallet();
    const response = await postVerify(
      jsonRequest('/api/auth/verify', { ...input, walletAddress: other.address })
    );
    expect(response.status).toEqual(401);
  });

  it('rejects an expired nonce', async () => {
    const { address, secretKey } = await freshWallet();
    // Seed an already-expired nonce row straight into the mocked table.
    const nonce = `expired-${Date.now()}`;
    const message = `msg:${nonce}`;
    fixtures.tables['auth_nonces'] = [
      {
        wallet_address: address,
        nonce,
        message,
        expires_at: new Date(Date.now() - 59_000).toISOString(),
        consumed_at: null,
      },
    ];
    const signature = Buffer.from(
      sign.detached(new TextEncoder().encode(message), secretKey)
    ).toString('base64');
    const response = await postVerify(
      jsonRequest('/api/auth/verify', {
        walletAddress: address,
        nonce,
        signature,
      })
    );
    expect(response.status).toEqual(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toEqual(
      'NONCE_EXPIRED'
    );
  });
});

describe('/api/missions auth + ownership', () => {
  const USER_ID = 'user-session-1';

  function missionBody(): Record<string, unknown> {
    return {
      name: 'Treasury run',
      objective: 'Pay vendors',
      mintAddress: '11111111111111111111111111111111',
      budgetAtomic: '50000000',
      maxActionAtomic: '5000000',
      recoveryMaxActionAtomic: '1000000',
      allowedActionTypes: ['TRANSFER_SOL'],
      allowedRecipients: [],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      currentAgentPublicKey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    };
  }

  it('GET without a session is 401', async () => {
    fixtures.sessionUser = null;
    const response = await getMissions();
    expect(response.status).toEqual(401);
  });

  it('GET scopes the query to the session owner', async () => {
    fixtures.sessionUser = { id: USER_ID };
    fixtures.tables['missions'] = [
      { id: 'm1', owner_id: USER_ID, name: 'Mine' },
      { id: 'm2', owner_id: 'someone-else', name: 'Theirs' },
    ];
    const response = await getMissions();
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as { missions: Array<{ id: string }> };
    expect(payload.missions.map((row) => row.id)).toEqual(['m1']);
    const recorded = fixtures.recordedFilters.find((entry) => entry.table === 'missions');
    expect(recorded?.filters).toContainEqual({ op: 'eq', col: 'owner_id', val: USER_ID });
  });

  it('POST ignores a smuggled owner_id and uses the session owner', async () => {
    fixtures.sessionUser = { id: USER_ID };
    const response = await postMissions(
      jsonRequest('/api/missions', { ...missionBody(), owner_id: 'attacker-user' })
    );
    expect(response.status).toEqual(201);
    const stored = fixtures.tables['missions'] ?? [];
    expect(stored.length).toEqual(1);
    expect(stored[0]?.['owner_id']).toEqual(USER_ID);
    expect(stored[0]?.['status']).toEqual('DRAFT');
    const policies = fixtures.tables['mission_policies'] ?? [];
    expect(policies.length).toEqual(1);
    expect(policies[0]?.['version']).toEqual(1);
    const payload = (await response.json()) as {
      id: string;
      status: string;
      policyVersion: number;
    };
    expect(payload.status).toEqual('DRAFT');
    expect(payload.policyVersion).toEqual(1);
  });

  it('POST without a session is 401 and stores nothing', async () => {
    fixtures.sessionUser = null;
    const response = await postMissions(jsonRequest('/api/missions', missionBody()));
    expect(response.status).toEqual(401);
    expect(fixtures.tables['missions'] ?? []).toEqual([]);
  });

  it('POST with an invalid body is 400', async () => {
    fixtures.sessionUser = { id: USER_ID };
    const response = await postMissions(
      jsonRequest('/api/missions', { ...missionBody(), budgetAtomic: '0' })
    );
    expect(response.status).toEqual(400);
  });
});
