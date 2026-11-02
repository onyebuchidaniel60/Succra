// Route-handler tests: real validation/persistence logic against programmable
// Supabase transport fakes, plus an injected MissionChain so no HashKey node is
// required. Contract-event parsing is tested separately in mission-chain.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
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

const chainFixture = vi.hoisted(() => ({
  factoryAddress: `0x${'f'.repeat(40)}` as `0x${string}`,
  predictedAddress: `0x${'a'.repeat(40)}` as `0x${string}`,
  txHash: `0x${'b'.repeat(64)}` as `0x${string}`,
  buildCalls: 0,
  verifyCalls: 0,
}));

vi.mock('@/lib/missions/chain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/missions/chain')>();
  return {
    ...actual,
    createMissionChain: () => ({
      chainId: 177,
      factoryAddress: chainFixture.factoryAddress,
      getNextMissionAddress: async () => chainFixture.predictedAddress,
      buildCreateTransaction: () => {
        chainFixture.buildCalls += 1;
        return {
          chainId: 177,
          to: chainFixture.factoryAddress,
          data: '0x1234',
          value: '0' as const,
        };
      },
      verifyDeployment: async (args: {
        expectedOwner: string;
        expectedMission: string;
        expectedPolicyHash: string;
      }) => {
        chainFixture.verifyCalls += 1;
        const rows = fixtures.tables['mission_policies'] ?? [];
        const policy = (rows[rows.length - 1]?.['policy_json'] ?? {}) as Record<string, unknown>;
        return {
          txHash: chainFixture.txHash,
          blockNumber: 42n,
          contractAddress: args.expectedMission,
          ownerAddress: args.expectedOwner,
          policyHash: args.expectedPolicyHash,
          state: {
            contractAddress: args.expectedMission,
            currentAgent: String(policy['primary_agent_address']),
            status: 'ACTIVE',
            agentNonce: 0n,
            stateVersion: 0n,
            violationCount: 0,
            lastViolationAt: 0n,
            confirmedSpentAtomic: 0n,
            lastCheckpointHash: `0x${'00'.repeat(32)}`,
            lastCheckpointSequence: 0n,
            checkpointCount: 0n,
            successors: (policy['successors'] as Array<{ address: string; priority: number }>).map(
              (successor) => ({
                agent: successor.address,
                priority: successor.priority,
                active: true,
              })
            ),
            paymentToken: String(policy['payment_token_address']),
            budgetAtomic: BigInt(String(policy['budget_atomic'])),
            maxPaymentAtomic: BigInt(String(policy['max_payment_atomic'])),
            recoveryMaxPaymentAtomic: BigInt(String(policy['recovery_max_payment_atomic'])),
            expiresAt: BigInt(Math.floor(Date.parse(String(policy['expires_at'])) / 1000)),
            policyHash: args.expectedPolicyHash,
            cartMandateHash: String(policy['cart_mandate_hash']),
            violationThreshold: Number(policy['violation_threshold']),
            violationWindowSeconds: BigInt(String(policy['violation_window_seconds'])),
            allowedMerchants: new Set(
              (policy['merchant_allowlist'] as string[]).map((value) => value.toLowerCase())
            ),
          },
        };
      },
    }),
  };
});

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
const { POST: postFinalize } = await import('../app/api/missions/[id]/finalize/route');

const ACCOUNT = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
);
const USER_ID = 'user-session-1';

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authenticate(walletAddress = ACCOUNT.address): void {
  fixtures.sessionUser = { id: USER_ID };
  fixtures.tables['profiles'] = [{ id: USER_ID, wallet_address: walletAddress.toLowerCase() }];
}

function missionBody(): Record<string, unknown> {
  return {
    name: 'Treasury run',
    objective: 'Pay vendors',
    paymentTokenAddress: '0x1111111111111111111111111111111111111111',
    budgetAtomic: '50000000',
    maxPaymentAtomic: '5000000',
    recoveryMaxPaymentAtomic: '1000000',
    merchantAllowlist: ['0x2222222222222222222222222222222222222222'],
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    primaryAgentAddress: '0x3333333333333333333333333333333333333333',
    successors: [{ address: '0x4444444444444444444444444444444444444444', priority: 1 }],
    violationThreshold: 3,
    violationWindowSeconds: 900,
  };
}

async function signedVerifyInput(): Promise<{
  walletAddress: string;
  nonce: string;
  signature: `0x${string}`;
}> {
  const nonceResponse = await postNonce(
    jsonRequest('/api/auth/nonce', { walletAddress: ACCOUNT.address })
  );
  const { typedData } = (await nonceResponse.json()) as {
    typedData: {
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
    };
  };
  const signature = await ACCOUNT.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  return {
    walletAddress: ACCOUNT.address,
    nonce: typedData.message.nonce,
    signature,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID = '177';
  fixtures.sessionUser = null;
  fixtures.recordedFilters = [];
  fixtures.tables = {};
  fixtures.adminUsers = {};
  fixtures.adminCalls = [];
  fixtures.otpResult = { session: null, user: null };
  fixtures.otpError = null;
  fixtures.cookieSets = [];
  chainFixture.buildCalls = 0;
  chainFixture.verifyCalls = 0;
});

describe('POST /api/auth/verify', () => {
  it('verifies a genuine EIP-712 signature and establishes a session', async () => {
    const input = await signedVerifyInput();
    fixtures.otpResult = {
      session: { access_token: 'session-jwt' },
      user: { id: `user-for-${input.walletAddress.toLowerCase()}` },
    };
    const response = await postVerify(jsonRequest('/api/auth/verify', input));
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as { user: { id: string; walletAddress: string } };
    expect(payload.user.walletAddress).toEqual(input.walletAddress.toLowerCase());
    expect(fixtures.cookieSets.length).toBeGreaterThan(0);
    const profiles = fixtures.tables['profiles'] ?? [];
    expect(profiles.length).toEqual(1);
    expect(profiles[0]?.['wallet_address']).toEqual(input.walletAddress.toLowerCase());
  });

  it('rejects a reused nonce', async () => {
    const input = await signedVerifyInput();
    fixtures.otpResult = {
      session: { access_token: 's' },
      user: { id: `user-for-${input.walletAddress.toLowerCase()}` },
    };
    expect((await postVerify(jsonRequest('/api/auth/verify', input))).status).toEqual(200);
    const replay = await postVerify(jsonRequest('/api/auth/verify', input));
    expect(replay.status).toEqual(401);
    const payload = (await replay.json()) as { error: { code: string } };
    expect(payload.error.code).toMatch(/NONCE_/);
  });

  it('rejects a tampered signature', async () => {
    const input = await signedVerifyInput();
    const bytes = input.signature.slice(2).split('');
    bytes[0] = bytes[0] === 'f' ? '0' : 'f';
    const response = await postVerify(
      jsonRequest('/api/auth/verify', { ...input, signature: `0x${bytes.join('')}` })
    );
    expect(response.status).toEqual(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toEqual(
      'INVALID_SIGNATURE'
    );
  });

  it('rejects a signature from a different wallet', async () => {
    const input = await signedVerifyInput();
    const other = privateKeyToAccount(
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
    );
    const response = await postVerify(
      jsonRequest('/api/auth/verify', { ...input, walletAddress: other.address })
    );
    expect(response.status).toEqual(401);
  });
});

describe('/api/missions auth + ownership', () => {
  it('GET without a session is 401', async () => {
    const response = await getMissions();
    expect(response.status).toEqual(401);
  });

  it('GET scopes the query to the session owner', async () => {
    authenticate();
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

  it('POST ignores a smuggled owner_id and returns the unsigned transaction', async () => {
    authenticate();
    const response = await postMissions(
      jsonRequest('/api/missions', { ...missionBody(), owner_id: 'attacker-user' })
    );
    expect(response.status).toEqual(201);
    const payload = (await response.json()) as {
      missionId: string;
      contractAddress: string;
      predictedContractAddress: string;
      policyHash: string;
      unsignedTx: { to: string; data: string; chainId: number; value: string };
    };
    expect(payload.contractAddress).toEqual(chainFixture.predictedAddress);
    expect(payload.predictedContractAddress).toEqual(chainFixture.predictedAddress);
    expect(payload.unsignedTx).toEqual({
      chainId: 177,
      to: chainFixture.factoryAddress,
      data: '0x1234',
      value: '0',
    });
    expect(payload.policyHash).toMatch(/^0x[0-9a-f]{64}$/);

    const stored = fixtures.tables['missions'] ?? [];
    expect(stored.length).toEqual(1);
    expect(stored[0]?.['owner_id']).toEqual(USER_ID);
    expect(stored[0]?.['status']).toEqual('DRAFT');
    expect(stored[0]?.['contract_address']).toEqual(chainFixture.predictedAddress);
    const policies = fixtures.tables['mission_policies'] ?? [];
    expect(policies.length).toEqual(1);
    expect(policies[0]?.['version']).toEqual(1);
  });

  it('POST without a session is 401 and stores nothing', async () => {
    const response = await postMissions(jsonRequest('/api/missions', missionBody()));
    expect(response.status).toEqual(401);
    expect(fixtures.tables['missions'] ?? []).toEqual([]);
  });

  it('POST with an invalid policy is 400', async () => {
    authenticate();
    const response = await postMissions(
      jsonRequest('/api/missions', { ...missionBody(), budgetAtomic: '0' })
    );
    expect(response.status).toEqual(400);
  });
});

describe('POST /api/missions/:id/finalize', () => {
  async function preparedMission(): Promise<string> {
    const response = await postMissions(jsonRequest('/api/missions', missionBody()));
    expect(response.status).toEqual(201);
    return ((await response.json()) as { missionId: string }).missionId;
  }

  it('activates the mission, attaches agents, and writes mission.created', async () => {
    authenticate();
    const missionId = await preparedMission();
    const response = await postFinalize(
      jsonRequest(`/api/missions/${missionId}/finalize`, { txHash: chainFixture.txHash }),
      { params: Promise.resolve({ id: missionId }) }
    );
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as {
      status: string;
      contractAddress: string;
      idempotent: boolean;
    };
    expect(payload).toMatchObject({
      status: 'ACTIVE',
      contractAddress: chainFixture.predictedAddress,
      idempotent: false,
    });
    expect(chainFixture.verifyCalls).toEqual(1);

    const mission = (fixtures.tables['missions'] ?? [])[0];
    expect(mission?.['status']).toEqual('ACTIVE');
    expect(mission?.['current_agent_address']).toEqual(
      '0x3333333333333333333333333333333333333333'
    );
    const assignments = fixtures.tables['mission_agents'] ?? [];
    expect(assignments).toHaveLength(2);
    expect(assignments.map((row) => row['role']).sort()).toEqual(['PRIMARY', 'SUCCESSOR']);
    const audits = fixtures.tables['audit_events'] ?? [];
    expect(audits).toHaveLength(1);
    expect(audits[0]?.['event_type']).toEqual('mission.created');
    expect(audits[0]?.['onchain_tx_hash']).toEqual(chainFixture.txHash);
  });

  it('is idempotent for an already-active mission', async () => {
    authenticate();
    const missionId = await preparedMission();
    const context = { params: Promise.resolve({ id: missionId }) };
    const body = jsonRequest(`/api/missions/${missionId}/finalize`, {
      txHash: chainFixture.txHash,
    });
    expect((await postFinalize(body, context)).status).toEqual(200);
    const second = await postFinalize(
      jsonRequest(`/api/missions/${missionId}/finalize`, { txHash: chainFixture.txHash }),
      context
    );
    expect(second.status).toEqual(200);
    const payload = (await second.json()) as { idempotent: boolean };
    expect(payload.idempotent).toEqual(true);
    expect(chainFixture.verifyCalls).toEqual(1);
  });

  it('rejects an unknown mission', async () => {
    authenticate();
    const response = await postFinalize(
      jsonRequest(`/api/missions/${crypto.randomUUID()}/finalize`, {
        txHash: chainFixture.txHash,
      }),
      { params: Promise.resolve({ id: crypto.randomUUID() }) }
    );
    expect(response.status).toEqual(404);
  });

  it('rejects a malformed transaction hash', async () => {
    authenticate();
    const missionId = await preparedMission();
    const response = await postFinalize(
      jsonRequest(`/api/missions/${missionId}/finalize`, { txHash: '0x1234' }),
      { params: Promise.resolve({ id: missionId }) }
    );
    expect(response.status).toEqual(400);
  });
});
