// Integration tests: RLS allow/deny for the Phase 5 audit_events table.
//
// Same harness pattern as tests/integration/supabase-rls-phase4.test.ts:
// PGlite applies the ACTUAL migrations (Phase 3 core + Phase 4 gateway +
// legacy Phase 5 guardian + the Phase 5 HashKey audit migration), with the
// auth stub in the test harness only. Proves audit rows are owner-readable
// and immutable to authenticated callers; only the service role writes.
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
  await db.exec(readMigration('20261104000000_phase5_audit_events.sql'));
  await db.query('CREATE ROLE authenticated NOLOGIN');
  await db.query('GRANT USAGE ON SCHEMA public TO authenticated');
  await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated');

  await db.query('INSERT INTO auth.users (id) VALUES ($1), ($2)', [USER_A, USER_B]);
  await db.query(`INSERT INTO profiles (id, wallet_address) VALUES ($1, $2), ($3, $4)`, [
    USER_A,
    `w-${USER_A}`,
    USER_B,
    `w-${USER_B}`,
  ]);
  await db.query(
    `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
      mint_address, budget_atomic, remaining_budget_atomic, status,
      current_agent_public_key, policy_version, policy_hash, expires_at)
     VALUES ($1, $2, 'M', 'O', $3, $4,
      '0x1111111111111111111111111111111111111111', '50000000', '50000000', 'ACTIVE',
      '0x2222222222222222222222222222222222222222', 1, 'hash', now() + interval '1 hour')`,
    [MISSION_A, USER_A, `0x${'33'.repeat(20)}`, `0x${'44'.repeat(20)}`]
  );
  // Service-role equivalent: the harness owns the table and bypasses RLS.
  await db.query(
    `INSERT INTO audit_events
       (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_tx_hash)
     VALUES ($1, 'violation.counted', 'agent', NULL, 'hash', '{}', NULL)`,
    [MISSION_A]
  );
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

  it('authenticated owners cannot UPDATE or DELETE audit rows', async () => {
    const updated = await asUser(USER_A, () =>
      db.query(`UPDATE audit_events SET event_type = 'X' RETURNING id`)
    );
    expect(updated.rows.length).toEqual(0);
    const deleted = await asUser(USER_A, () => db.query('DELETE FROM audit_events RETURNING id'));
    expect(deleted.rows.length).toEqual(0);
  });

  it('authenticated owners cannot INSERT audit rows', async () => {
    await expect(
      asUser(USER_A, () =>
        db.query(
          `INSERT INTO audit_events
             (mission_id, event_type, actor_type, actor_id, event_hash, payload_public)
           VALUES ($1, 'evil', 'agent', NULL, 'h', '{}')`,
          [MISSION_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });
});
