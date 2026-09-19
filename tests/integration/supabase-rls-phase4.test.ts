// Integration tests: RLS allow/deny for the Phase 4 gateway tables.
//
// Same harness pattern as tests/integration/supabase-rls.test.ts: PGlite
// applies the ACTUAL migrations (Phase 3 core + Phase 4 gateway), with
// the auth stub in the test harness only. Proves:
//   - action_requests / onchain_transactions follow the mission owner
//     (allow own, deny foreign, for SELECT/INSERT/UPDATE/DELETE);
//   - agent_request_nonces / agent_challenges are server-only
//     (authenticated sessions get nothing, INSERT rejected).
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
const AGENT_A = randomUUID();
const MISSION_A = randomUUID();
const MISSION_B = randomUUID();

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
      `INSERT INTO agents (id, owner_id, name, public_key, status) VALUES ($1, $2, 'alpha', $3, 'ACTIVE_PRIMARY')`,
      [AGENT_A, USER_A, `agent-key-${randomUUID()}`]
    );
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
      `INSERT INTO action_requests
         (mission_id, agent_id, idempotency_key, agent_nonce, action_type, payload,
          request_hash, signature, decision, decision_reason_code)
       VALUES ($1, $2, 'key-1', 1, 'TRANSFER_SOL', '{}', 'hash', 'sig', 'APPROVED', NULL)`,
      [MISSION_A, AGENT_A]
    );
  });
  await asUser(USER_B, async () => {
    await db.query(`INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)`, [
      USER_B,
      `w-${USER_B}`,
    ]);
    await db.query(
      `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
        mint_address, budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1, $2, 'MB', 'OB', $3, $4,
        '11111111111111111111111111111111', '10', '10', 'DRAFT',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 1, 'hash', now() + interval '1 hour')`,
      [MISSION_B, USER_B, `pda:${randomUUID()}`, `vault:${randomUUID()}`]
    );
  });
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe('action_requests isolation follows the mission owner', () => {
  it('B sees nothing of A; A reads their own', async () => {
    const seenB = await asUser(USER_B, () => db.query('SELECT id FROM action_requests'));
    expect(seenB.rows.length).toEqual(0);
    const seenA = await asUser(USER_A, () => db.query('SELECT id FROM action_requests'));
    expect(seenA.rows.length).toEqual(1);
  });

  it('B cannot UPDATE, DELETE, or INSERT for A’s mission', async () => {
    const updated = await asUser(USER_B, () =>
      db.query(`UPDATE action_requests SET decision = 'X' RETURNING id`)
    );
    expect(updated.rows.length).toEqual(0);
    const deleted = await asUser(USER_B, () =>
      db.query('DELETE FROM action_requests RETURNING id')
    );
    expect(deleted.rows.length).toEqual(0);
    await expect(
      asUser(USER_B, () =>
        db.query(
          `INSERT INTO action_requests
             (mission_id, agent_id, idempotency_key, agent_nonce, action_type, payload,
              request_hash, signature, decision)
           VALUES ($1, $2, 'evil', 9, 'TRANSFER_SOL', '{}', 'h', 's', 'APPROVED')`,
          [MISSION_A, AGENT_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('unique idempotency holds per mission', async () => {
    await expect(
      asUser(USER_A, () =>
        db.query(
          `INSERT INTO action_requests
             (mission_id, agent_id, idempotency_key, agent_nonce, action_type, payload,
              request_hash, signature, decision)
           VALUES ($1, $2, 'key-1', 2, 'TRANSFER_SOL', '{}', 'h', 's', 'APPROVED')`,
          [MISSION_A, AGENT_A]
        )
      )
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('onchain_transactions isolation follows the mission owner', () => {
  it('B sees nothing; A writes and reads their own', async () => {
    await asUser(USER_A, async () => {
      await db.query(
        `INSERT INTO onchain_transactions (mission_id, signature, status)
         VALUES ($1, 'sig-1', 'CONFIRMED')`,
        [MISSION_A]
      );
    });
    const seenB = await asUser(USER_B, () => db.query('SELECT id FROM onchain_transactions'));
    expect(seenB.rows.length).toEqual(0);
    const seenA = await asUser(USER_A, () => db.query('SELECT id FROM onchain_transactions'));
    expect(seenA.rows.length).toEqual(1);
    await expect(
      asUser(USER_B, () =>
        db.query(
          `INSERT INTO onchain_transactions (mission_id, signature, status) VALUES ($1, 'evil', 'SUBMITTED')`,
          [MISSION_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });
});

describe('agent_request_nonces and agent_challenges are server-only', () => {
  it('authenticated sessions get nothing and cannot write', async () => {
    for (const table of ['agent_request_nonces', 'agent_challenges']) {
      const seen = await asUser(USER_A, () => db.query(`SELECT id FROM ${table}`));
      expect(seen.rows.length).toEqual(0);
    }
    await expect(
      asUser(USER_A, () =>
        db.query(
          `INSERT INTO agent_request_nonces (agent_id, nonce, expires_at)
           VALUES ($1, 'n', now() + interval '1 hour')`,
          [AGENT_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(USER_A, () =>
        db.query(
          `INSERT INTO agent_challenges (agent_id, challenge, expires_at)
           VALUES ($1, 'c', now() + interval '1 hour')`,
          [AGENT_A]
        )
      )
    ).rejects.toThrow(/row-level security/);
  });
});
