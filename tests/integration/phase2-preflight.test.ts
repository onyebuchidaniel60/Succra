// Phase 2 migration integration test: applies the real Phase 3, Phase 4, and
// Phase 2 migrations to PGlite and verifies the extended preflight schema,
// uniqueness constraints, nullable signature, and service-role-only writes.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = [
  '20260913000000_phase3_core.sql',
  '20260914000000_phase4_gateway.sql',
  '20261101000000_phase2_preflight.sql',
].map((name) => readFileSync(join(root, 'supabase', 'migrations', name), 'utf8'));

const USER = randomUUID();
const AGENT = randomUUID();
const MISSION = randomUUID();

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$`);
  for (const migration of MIGRATIONS) await db.exec(migration);
  await db.query('CREATE ROLE authenticated NOLOGIN');
  await db.query('GRANT USAGE ON SCHEMA public TO authenticated');
  await db.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated');

  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [USER]);
  await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
    USER,
    `0x${'11'.repeat(20)}`,
  ]);
  await db.query(
    `INSERT INTO agents (id, owner_id, name, public_key, status)
     VALUES ($1, $2, 'Alpha', $3, 'ACTIVE')`,
    [AGENT, USER, `0x${'22'.repeat(20)}`]
  );
  await db.query(
    `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
      mint_address, budget_atomic, remaining_budget_atomic, status,
      current_agent_id, current_agent_public_key, policy_version, policy_hash, expires_at)
     VALUES ($1, $2, 'Mission', 'Pay', $3, 'unused', $4, 1000, 1000, 'ACTIVE',
      $5, $6, 1, 'hash', now() + interval '1 hour')`,
    [MISSION, USER, `0x${'33'.repeat(20)}`, `0x${'44'.repeat(20)}`, AGENT, `0x${'22'.repeat(20)}`]
  );
});

afterAll(async () => {
  await db.close();
});

function insertRow(overrides: Partial<Record<string, unknown>> = {}) {
  const row = {
    mission_id: MISSION,
    agent_id: AGENT,
    idempotency_key: `idem-${randomUUID()}`,
    request_id: randomUUID(),
    onchain_request_id: `0x${'55'.repeat(32)}`,
    agent_nonce: 1,
    action_type: 'HSP_PAYMENT',
    payload: '{}',
    request_hash: 'hash',
    signature: null,
    decision: 'ALLOW',
    decision_reason_code: null,
    mandate_hash: `0x${'66'.repeat(32)}`,
    mandate_payload: '{}',
    typed_data: '{}',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...overrides,
  };
  return db.query(
    `INSERT INTO action_requests
      (mission_id, agent_id, idempotency_key, request_id, onchain_request_id,
       agent_nonce, action_type, payload, request_hash, signature, decision,
       decision_reason_code, mandate_hash, mandate_payload, typed_data, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)`,
    [
      row.mission_id,
      row.agent_id,
      row.idempotency_key,
      row.request_id,
      row.onchain_request_id,
      row.agent_nonce,
      row.action_type,
      row.payload,
      row.request_hash,
      row.signature,
      row.decision,
      row.decision_reason_code,
      row.mandate_hash,
      row.mandate_payload,
      row.typed_data,
      row.expires_at,
    ]
  );
}

describe('Phase 2 preflight migration', () => {
  it('adds the HSP request and mandate columns', async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'action_requests'`
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    for (const column of [
      'request_id',
      'onchain_request_id',
      'mandate_hash',
      'mandate_payload',
      'typed_data',
    ]) {
      expect(columns.has(column)).toEqual(true);
    }
  });

  it('accepts a NULL signature and a real expires_at', async () => {
    await expect(insertRow()).resolves.toBeDefined();
  });

  it('rejects NULL expires_at after the migration', async () => {
    await expect(insertRow({ expires_at: null })).rejects.toBeDefined();
  });

  it('enforces idempotency and agent-nonce uniqueness per mission', async () => {
    const key = `idem-${randomUUID()}`;
    await insertRow({ idempotency_key: key, agent_nonce: 10 });
    await expect(insertRow({ idempotency_key: key, agent_nonce: 11 })).rejects.toBeDefined();
    await expect(insertRow({ agent_nonce: 10 })).rejects.toBeDefined();
  });

  it('retains only the owner SELECT policy on action_requests', async () => {
    const result = await db.query<{ policyname: string; cmd: string }>(
      `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'action_requests'`
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.cmd).toEqual('SELECT');
  });

  it('keeps agent_request_nonces service-role only', async () => {
    const result = await db.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'agent_request_nonces'`
    );
    expect(result.rows).toHaveLength(0);
    const nonce = `nonce-${randomUUID()}`;
    await db.query(
      `INSERT INTO agent_request_nonces (agent_id, nonce, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes')`,
      [AGENT, nonce]
    );
    await expect(
      db.query(
        `INSERT INTO agent_request_nonces (agent_id, nonce, expires_at)
         VALUES ($1, $2, now() + interval '5 minutes')`,
        [AGENT, nonce]
      )
    ).rejects.toBeDefined();
  });
});
