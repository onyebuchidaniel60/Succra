// Phase 3 migration integration test: real migrations on PGlite.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = [
  '20260913000000_phase3_core.sql',
  '20260914000000_phase4_gateway.sql',
  '20260915000000_phase5_guardian.sql',
  '20261101000000_phase2_preflight.sql',
  '20261102000000_phase3_hashkey_missions.sql',
].map((name) => readFileSync(join(root, 'supabase', 'migrations', name), 'utf8'));

const USER = randomUUID();
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
});

afterAll(async () => {
  await db.close();
});

describe('Phase 3 HashKey mission migration', () => {
  it('adds the five HashKey columns and keeps the legacy columns', async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'missions'`
    );
    const columns = new Set(result.rows.map((row) => row.column_name));
    for (const column of [
      'contract_address',
      'factory_address',
      'owner_address',
      'payment_token_address',
      'current_agent_address',
      'pda_address',
      'mint_address',
      'current_agent_public_key',
    ]) {
      expect(columns.has(column)).toEqual(true);
    }
  });

  it('backfills the HashKey columns from legacy inserts', async () => {
    const mission = randomUUID();
    await db.query(
      `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
        mint_address, budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1, $2, 'M', 'O', $3, 'unused', $4, 1000, 1000, 'ACTIVE', $5, 1, 'hash',
        now() + interval '1 hour')`,
      [mission, USER, `0x${'22'.repeat(20)}`, `0x${'33'.repeat(20)}`, `0x${'44'.repeat(20)}`]
    );
    const row = await db.query<{
      contract_address: string;
      owner_address: string;
      payment_token_address: string;
      current_agent_address: string;
      factory_address: string;
    }>(
      `SELECT contract_address, owner_address, payment_token_address,
              current_agent_address, factory_address
       FROM missions WHERE id = $1`,
      [mission]
    );
    expect(row.rows[0]?.contract_address).toEqual(`0x${'22'.repeat(20)}`);
    expect(row.rows[0]?.owner_address).toEqual(`0x${'11'.repeat(20)}`);
    expect(row.rows[0]?.payment_token_address).toEqual(`0x${'33'.repeat(20)}`);
    expect(row.rows[0]?.current_agent_address).toEqual(`0x${'44'.repeat(20)}`);
    expect(row.rows[0]?.factory_address).toEqual('0x0000000000000000000000000000000000000000');
  });

  it('enforces unique contract addresses', async () => {
    const first = randomUUID();
    const second = randomUUID();
    const insert = (id: string) =>
      db.query(
        `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
          mint_address, budget_atomic, remaining_budget_atomic, status,
          current_agent_public_key, policy_version, policy_hash, expires_at, contract_address)
         VALUES ($1, $2, 'M', 'O', $3, $5, $4, 1000, 1000, 'ACTIVE', $6, 1, 'hash',
          now() + interval '1 hour', $7)`,
        [
          id,
          USER,
          `legacy-${id}`,
          `0x${'33'.repeat(20)}`,
          `vault-${id}`,
          `0x${'44'.repeat(20)}`,
          `0x${'55'.repeat(20)}`,
        ]
      );
    await insert(first);
    await expect(insert(second)).rejects.toBeDefined();
  });

  it('creates hsp_payments with owner SELECT only', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'hsp_payments'`
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const column of [
      'id',
      'mission_id',
      'action_request_id',
      'hsp_payment_mandate_id',
      'mandate_hash',
      'amount_atomic',
      'token_address',
      'merchant_address',
      'status',
      'authorization_tx_hash',
      'settlement_tx_hash',
      'block_number',
      'raw_error',
      'submitted_at',
      'settled_at',
      'created_at',
    ]) {
      expect(names.has(column)).toEqual(true);
    }
    const policies = await db.query<{ cmd: string }>(
      `SELECT cmd FROM pg_policies WHERE tablename = 'hsp_payments'`
    );
    expect(policies.rows.map((row) => row.cmd)).toEqual(['SELECT']);
  });

  it('creates hsp_webhook_events with signature_verified and processed_at, service-role only', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'hsp_webhook_events'`
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const column of [
      'id',
      'hsp_payment_mandate_id',
      'event_id',
      'event_hash',
      'payload',
      'signature_verified',
      'received_at',
      'processed_at',
    ]) {
      expect(names.has(column)).toEqual(true);
    }
    const policies = await db.query(
      `SELECT * FROM pg_policies WHERE tablename = 'hsp_webhook_events'`
    );
    expect(policies.rows).toHaveLength(0);
  });

  it('provides an atomic confirmed-spend mirror function', async () => {
    const mission = randomUUID();
    await db.query(
      `INSERT INTO missions (id, owner_id, name, objective, pda_address, vault_address,
        mint_address, budget_atomic, remaining_budget_atomic, status,
        current_agent_public_key, policy_version, policy_hash, expires_at)
       VALUES ($1, $2, 'M', 'O', $3, $6, $4, 1000, 1000, 'ACTIVE', $5, 1, 'hash',
        now() + interval '1 hour')`,
      [
        mission,
        USER,
        `0x${'66'.repeat(20)}`,
        `0x${'77'.repeat(20)}`,
        `0x${'88'.repeat(20)}`,
        `vault-${mission}`,
      ]
    );
    const result = await db.query<{ mirror_confirmed_spend: string }>(
      `SELECT mirror_confirmed_spend($1, $2)`,
      [mission, 250]
    );
    expect(String(result.rows[0]?.mirror_confirmed_spend)).toEqual('750');
  });
});
