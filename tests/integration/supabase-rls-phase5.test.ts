// Integration tests: RLS allow/deny for the Phase 5 audit_events table.
//
// Same harness pattern as tests/integration/supabase-rls-phase4.test.ts:
// PGlite applies the ACTUAL migrations (Phase 3 core + Phase 4 gateway +
// Phase 5 guardian), with the auth stub in the test harness only. Proves
// audit_events follows the mission owner (allow own, deny foreign, for
// SELECT/INSERT/UPDATE/DELETE) like action_requests.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

function readMigration(name: string): string {
  return readFileSync(join(HERE, '..', '..', 'supabase', 'migrations', name), 'utf8');
}

const USER_A = randomUUID();
const USER_B = randomUUID();
const MISSION_A = randomUUID();

let db: PGlite;

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

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$`);
  await db.exec(readMigration('20260913000000_phase3_core.sql'));
  await db.exec(readMigration('20260914000000_phase4_gateway.sql'));
  await db.exec(readMigration('20260915000000_phase5_guardian.sql'));
  await db.query('CREATE ROLE authenticated NOLOGIN');
  await db.query('GRANT USAGE ON SCHEMA public TO authenticated');
  await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated');

  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B]);
  await asUser(USER_A, async () => {
    await db.query(`INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)`, [
      USER_A,
      `w-${USER_A}`,
    ]);
    await db.query(
      `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
        mint_address, budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1, $2, 'M', 'O', $3, $4,
        '11111111111111111111111111111111', '50000000', '50000000', 'ACTIVE',
        '22222222222222222222222222222222', 1, 'hash', now() + interval '1 hour')`,
      [MISSION_A, USER_A, `pda:${randomUUID()}`, `vault:${randomUUID()}`]
    );
    await db.query(
      `INSERT INTO audit_events
         (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_signature)
       VALUES ($1, 'violation.counted', 'agent', NULL, 'hash', '{}', NULL)`,
      [MISSION_A]
    );
  });
  await asUser(USER_B, async () => {
    await db.query(`INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)`, [
      USER_B,
      `w-${USER_B}`,
    ]);
  });
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('audit_events isolation follows the mission owner', () => {
  it('B sees nothing of A; A reads their own', async () => {
    const seenB = await asUser(USER_B, () => db.query('SELECT id FROM audit_events'));
    expect(seenB.rows.length).toEqual(0);
    const seenA = await asUser(USER_A, () => db.query('SELECT id FROM audit_events'));
    expect(seenA.rows.length).toEqual(1);
  });

  it('B cannot UPDATE, DELETE, or INSERT for A’s mission', async () => {
    const updated = await asUser(USER_B, () =>
      db.query(`UPDATE audit_events SET event_type = 'X' RETURNING id`)
    );
    expect(updated.rows.length).toEqual(0);
    const deleted = await asUser(USER_B, () => db.query('DELETE FROM audit_events RETURNING id'));
    expect(deleted.rows.length).toEqual(0);
    await expect(
      asUser(USER_B, () =>
        db.query(
          `INSERT INTO audit_events
             (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_signature)
           VALUES ($1, 'evil', 'agent', NULL, 'h', '{}', NULL)`,
          [MISSION_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });
});
