// Integration tests: RLS allow/deny on the Phase 3 schema.
//
// What this proves (Phase 3 acceptance): user A cannot read or update user
// B's private mission data — with explicit allow/deny cases per table,
// not just "RLS is enabled".
//
// How it runs without Docker: PGlite (real Postgres, in-process) applies
// the ACTUAL migration file (supabase/migrations/20260913000000_phase3_core.sql),
// so the tables, constraints, and policies under test are byte-identical
// to what ships. Two Supabase-only pieces are stubbed in the TEST HARNESS
// (never in the migration):
//   - auth.users: minimal table for the profiles FK;
//   - auth.uid(): Supabase's exact definition (reads request.jwt.claims);
//   - an `authenticated` role + table grants, mirroring PostgREST, which
//     sets request.jwt.claims from the caller JWT and uses a non-superuser
//     role so RLS applies.
// Full local-Supabase (GoTrue session issuance) verification is recorded
// as follow-up for a host with Docker.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATION = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'supabase',
    'migrations',
    '20260913000000_phase3_core.sql'
  ),
  'utf8'
);

const USER_A = randomUUID();
const USER_B = randomUUID();
const WALLET_A = `wallet-a-${randomUUID()}`;
const WALLET_B = `wallet-b-${randomUUID()}`;
const MISSION_A = randomUUID();
const MISSION_B = randomUUID();
const AGENT_A = randomUUID();

let db: PGlite;

/** Run `task` as `role` with `request.jwt.claims.sub = sub`. */
async function asUser<T>(sub: string, task: () => Promise<T>): Promise<T> {
  await db.query('SET ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub, role: 'authenticated' }),
  ]);
  try {
    return await task();
  } finally {
    await db.query('RESET ROLE');
  }
}

async function count(table: string): Promise<number> {
  const result = await db.query<{ n: string }>(`SELECT COUNT(*) AS n FROM ${table}`);
  const row = result.rows[0];
  if (!row) throw new Error(`count failed for ${table}`);
  return Number(row.n);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  // Test-only auth stub (mirrors Supabase semantics; not part of the migration).
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$`);
  await db.exec(MIGRATION);
  await db.query('CREATE ROLE authenticated NOLOGIN');
  await db.query('GRANT USAGE ON SCHEMA public TO authenticated');
  await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated');

  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B]);
  // Fixture owned entirely by A, plus a bare mission owned by B so isolation
  // is proven symmetrically (B is a legitimate other user, not an empty id).
  await asUser(USER_A, async () => {
    await db.query(`INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)`, [USER_A, WALLET_A]);
    await db.query(
      `INSERT INTO agents (id, owner_id, name, public_key, status) VALUES ($1, $2, 'alpha', $3, 'REGISTERED')`,
      [AGENT_A, USER_A, `agent-key-${randomUUID()}`]
    );
    await db.query(
      `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
        mint_address, budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1, $2, 'Treasury run', 'Pay vendors', $3, $4,
        '11111111111111111111111111111111', '50000000', '50000000', 'DRAFT',
        '22222222222222222222222222222222', 1, 'hash', now() + interval '1 hour')`,
      [MISSION_A, USER_A, `pending:pda:${randomUUID()}`, `pending:vault:${randomUUID()}`]
    );
    await db.query(
      `INSERT INTO mission_policies (mission_id, version, policy_json, policy_hash)
       VALUES ($1, 1, '{}', 'hash')`,
      [MISSION_A]
    );
    await db.query(
      `INSERT INTO mission_agents (mission_id, agent_id, role) VALUES ($1, $2, 'PRIMARY')`,
      [MISSION_A, AGENT_A]
    );
  });
  await asUser(USER_B, async () => {
    await db.query(`INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)`, [USER_B, WALLET_B]);
    await db.query(
      `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
        mint_address, budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1, $2, 'B mission', 'B objective', $3, $4,
        '11111111111111111111111111111111', '10', '10', 'DRAFT',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1, 'hash', now() + interval '1 hour')`,
      [MISSION_B, USER_B, `pending:pda:${randomUUID()}`, `pending:vault:${randomUUID()}`]
    );
  });
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('profiles isolation', () => {
  it('each user reads only their own profile', async () => {
    const own = await asUser(USER_A, () =>
      db.query('SELECT id FROM profiles WHERE id = $1', [USER_A])
    );
    expect(own.rows.length).toEqual(1);
    const foreign = await asUser(USER_B, () =>
      db.query('SELECT id FROM profiles WHERE id = $1', [USER_A])
    );
    expect(foreign.rows.length).toEqual(0);
    const ownB = await asUser(USER_B, () =>
      db.query('SELECT id FROM profiles WHERE id = $1', [USER_B])
    );
    expect(ownB.rows.length).toEqual(1);
  });
});

describe('missions isolation (acceptance core)', () => {
  it('each user lists only their own missions; lookup by id leaks nothing', async () => {
    const listB = await asUser(USER_B, () => db.query<{ id: string }>('SELECT id FROM missions'));
    expect(listB.rows.map((row) => row.id)).toEqual([MISSION_B]);
    const byId = await asUser(USER_B, () =>
      db.query('SELECT id FROM missions WHERE id = $1', [MISSION_A])
    );
    expect(byId.rows.length).toEqual(0);
    const listA = await asUser(USER_A, () => db.query<{ id: string }>('SELECT id FROM missions'));
    expect(listA.rows.map((row) => row.id)).toEqual([MISSION_A]);
  });

  it('B cannot UPDATE A’s mission', async () => {
    const result = await asUser(USER_B, () =>
      db.query(`UPDATE missions SET name = 'hijacked' WHERE id = $1`, [MISSION_A])
    );
    expect(result.rows.length).toEqual(0);
    const name = await asUser(USER_A, () =>
      db.query<{ name: string }>('SELECT name FROM missions WHERE id = $1', [MISSION_A])
    );
    expect(name.rows[0]?.name).toEqual('Treasury run');
  });

  it('B cannot DELETE A’s mission', async () => {
    const result = await asUser(USER_B, () =>
      db.query('DELETE FROM missions WHERE id = $1', [MISSION_A])
    );
    expect(result.rows.length).toEqual(0);
    expect(await count('missions')).toEqual(2);
  });

  it('B cannot INSERT a mission owned by A', async () => {
    await expect(
      asUser(USER_B, () =>
        db.query(
          `INSERT INTO missions (owner_id, name, objective, pda_address, vault_address,
            mint_address, budget_atomic, remaining_budget_atomic, status,
            current_agent_public_key, policy_version, policy_hash, expires_at)
           VALUES ($1, 'x', 'y', $2, $3, '11111111111111111111111111111111',
            '1', '1', 'DRAFT', '22222222222222222222222222222222', 1, 'h', now())`,
          [USER_A, `pending:pda:${randomUUID()}`, `pending:vault:${randomUUID()}`]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('A can SELECT and UPDATE their own mission', async () => {
    const seen = await asUser(USER_A, () =>
      db.query('SELECT id FROM missions WHERE id = $1', [MISSION_A])
    );
    expect(seen.rows.length).toEqual(1);
    const updated = await asUser(USER_A, () =>
      db.query(`UPDATE missions SET name = 'Treasury run v2' WHERE id = $1 RETURNING name`, [
        MISSION_A,
      ])
    );
    expect(updated.rows.length).toEqual(1);
  });
});

describe('join-table isolation follows the mission owner', () => {
  it('B sees no rows in mission_policies / mission_agents / agents of A', async () => {
    const policies = await asUser(USER_B, () => db.query('SELECT id FROM mission_policies'));
    const assignments = await asUser(USER_B, () => db.query('SELECT id FROM mission_agents'));
    const agents = await asUser(USER_B, () => db.query('SELECT id FROM agents'));
    expect(policies.rows.length).toEqual(0);
    expect(assignments.rows.length).toEqual(0);
    expect(agents.rows.length).toEqual(0);
  });

  it('B cannot INSERT policy or assignment rows for A’s mission', async () => {
    await expect(
      asUser(USER_B, () =>
        db.query(
          `INSERT INTO mission_policies (mission_id, policy_json, policy_hash) VALUES ($1, '{}', 'h')`,
          [MISSION_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(USER_B, () =>
        db.query(
          `INSERT INTO mission_agents (mission_id, agent_id, role) VALUES ($1, $2, 'SUCCESSOR')`,
          [MISSION_A, AGENT_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('A reads their own policy, assignment, and agent rows', async () => {
    const policies = await asUser(USER_A, () =>
      db.query('SELECT id FROM mission_policies WHERE mission_id = $1', [MISSION_A])
    );
    const assignments = await asUser(USER_A, () =>
      db.query('SELECT id FROM mission_agents WHERE mission_id = $1', [MISSION_A])
    );
    const agents = await asUser(USER_A, () =>
      db.query('SELECT id FROM agents WHERE id = $1', [AGENT_A])
    );
    expect(policies.rows.length).toEqual(1);
    expect(assignments.rows.length).toEqual(1);
    expect(agents.rows.length).toEqual(1);
  });
});

describe('owner delete', () => {
  it('A can delete their own mission (children cascade, other owner mission survives)', async () => {
    const deleted = await asUser(USER_A, () =>
      db.query('DELETE FROM missions WHERE id = $1 RETURNING id', [MISSION_A])
    );
    expect(deleted.rows.length).toEqual(1);
    expect(await count('missions')).toEqual(1);
    expect(await count('mission_policies')).toEqual(0);
    expect(await count('mission_agents')).toEqual(0);
  });
});

describe('auth_nonces is server-only (RLS enabled, no policies)', () => {
  it('authenticated sessions get nothing: SELECT empty, INSERT rejected', async () => {
    const seen = await asUser(USER_A, () => db.query('SELECT nonce FROM auth_nonces'));
    expect(seen.rows.length).toEqual(0);
    await expect(
      asUser(USER_A, () =>
        db.query(
          `INSERT INTO auth_nonces (wallet_address, nonce, message, expires_at)
           VALUES ('w', 'n', 'm', now() + interval '1 hour')`
        )
      )
    ).rejects.toThrow(/row-level security/);
  });
});
