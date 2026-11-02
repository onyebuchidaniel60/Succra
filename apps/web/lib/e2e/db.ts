// Succra web — test-only Supabase-shaped client for Playwright E2E.
//
// This module is inert unless SUCCRA_E2E_MODE=1. It exists because the demo
// smoke test must run without a Docker/Supabase stack: PGlite executes the
// real migrations in-process, and a narrow Supabase query-builder shim serves
// the app's server routes. It is never used in normal development or
// production.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';

export const E2E_USER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const E2E_WALLET = (
  process.env.SUCCRA_E2E_WALLET ?? '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
).toLowerCase();

export function isE2EMode(): boolean {
  return process.env.SUCCRA_E2E_MODE === '1' && process.env.NODE_ENV !== 'production';
}

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

type JsonColumnMap = Record<string, ReadonlySet<string>>;

const JSON_COLUMNS: JsonColumnMap = {
  audit_events: new Set(['payload_public']),
  action_requests: new Set(['payload', 'mandate_payload', 'typed_data']),
  hsp_payments: new Set(['raw_error']),
  hsp_webhook_events: new Set(['payload']),
  onchain_transactions: new Set(['raw_error']),
  mission_policies: new Set(['allowed_action_types', 'allowed_recipients', 'policy_json']),
  mission_checkpoints: new Set([
    'confirmed_payment_ids',
    'confirmed_transaction_hashes',
    'hsp_mandate_ids',
    'state_snapshot',
  ]),
  mission_agents: new Set(['required_capabilities']),
  agents: new Set(['capabilities']),
};

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        normalizeValue(entry),
      ])
    );
  }
  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
  );
}

function sqlValue(value: unknown, table: string, column: string): { value: unknown; cast: string } {
  if (value === undefined || value === null) return { value: null, cast: '' };
  if (JSON_COLUMNS[table]?.has(column)) {
    return { value: JSON.stringify(value), cast: '::jsonb' };
  }
  if (typeof value === 'bigint') return { value: value.toString(), cast: '' };
  if (value instanceof Date) return { value: value.toISOString(), cast: '' };
  return { value, cast: '' };
}

function errorResult(error: unknown): QueryResult {
  const record = (error ?? {}) as { message?: unknown; code?: unknown };
  return {
    data: null,
    error: {
      message: typeof record.message === 'string' ? record.message : 'E2E database error.',
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
    },
  };
}

class E2EQuery implements PromiseLike<QueryResult> {
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private columns = '*';
  private countMode = false;
  private headMode = false;
  private inserting: Record<string, unknown>[] = [];
  private updating: Record<string, unknown> | null = null;
  private filters: Array<{ sql: string; values: unknown[] }> = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue: number | null = null;

  constructor(
    private readonly getDb: () => Promise<PGlite>,
    private readonly table: string
  ) {}

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }): this {
    this.columns = columns;
    this.countMode = options?.count === 'exact';
    this.headMode = options?.head === true;
    return this;
  }

  insert(payload: Record<string, unknown> | Record<string, unknown>[]): this {
    this.action = 'insert';
    this.inserting = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.action = 'update';
    this.updating = payload;
    return this;
  }

  delete(): this {
    this.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    if (value === null) {
      this.filters.push({ sql: `${identifier(column)} IS NULL`, values: [] });
    } else {
      this.filters.push({ sql: `${identifier(column)} = $${this.nextParam()}`, values: [value] });
    }
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push({
      sql: `${identifier(column)} IS ${value === null ? 'NULL' : 'NOT NULL'}`,
      values: [],
    });
    return this;
  }

  not(column: string, operator: 'is', value: null): this {
    if (operator !== 'is' || value !== null) throw new Error('Unsupported not filter.');
    this.filters.push({ sql: `${identifier(column)} IS NOT NULL`, values: [] });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ sql: `${identifier(column)} > $${this.nextParam()}`, values: [value] });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ sql: `${identifier(column)} < $${this.nextParam()}`, values: [value] });
    return this;
  }

  in(column: string, values: unknown[]): this {
    if (values.length === 0) {
      this.filters.push({ sql: 'FALSE', values: [] });
      return this;
    }
    const start = this.nextParam();
    const placeholders = values.map((_, index) => `$${start + index}`).join(', ');
    this.filters.push({
      sql: `${identifier(column)} IN (${placeholders})`,
      values: [...values],
    });
    return this;
  }

  ilike(column: string, value: string): this {
    this.filters.push({
      sql: `LOWER(${identifier(column)}) = LOWER($${this.nextParam()})`,
      values: [value],
    });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  private nextParam(): number {
    return this.filters.reduce((total, filter) => total + filter.values.length, 0) + 1;
  }

  private where(): string {
    return this.filters.length === 0
      ? ''
      : ` WHERE ${this.filters.map((filter) => filter.sql).join(' AND ')}`;
  }

  private async execute(): Promise<QueryResult> {
    const db = await this.getDb();
    try {
      if (this.countMode) {
        const sql = `SELECT COUNT(*)::int AS count FROM public.${identifier(this.table)}${this.where()}`;
        const result = await db.query<{ count: number }>(
          sql,
          this.filters.flatMap((filter) => filter.values) as unknown[]
        );
        return { data: null, error: null, count: Number(result.rows[0]?.count ?? 0) };
      }
      if (this.action === 'insert') {
        if (this.inserting.length === 0) return { data: [], error: null };
        const rows: Record<string, unknown>[] = [];
        for (const payload of this.inserting) {
          const columns = Object.keys(payload);
          const params: unknown[] = [];
          const placeholders = columns.map((column) => {
            const converted = sqlValue(payload[column], this.table, column);
            params.push(converted.value);
            return `$${params.length}${converted.cast}`;
          });
          const sql =
            `INSERT INTO public.${identifier(this.table)} (${columns.map(identifier).join(', ')}) ` +
            `VALUES (${placeholders.join(', ')}) RETURNING *`;
          const result = await db.query<Record<string, unknown>>(sql, params);
          rows.push(...result.rows.map(normalizeRow));
        }
        return {
          data: this.columns === '*' ? rows : rows.map((row) => pick(row, this.columns)),
          error: null,
        };
      }
      if (this.action === 'update') {
        const payload = this.updating ?? {};
        const columns = Object.keys(payload);
        const params: unknown[] = [];
        const assignments = columns.map((column) => {
          const converted = sqlValue(payload[column], this.table, column);
          params.push(converted.value);
          return `${identifier(column)} = $${params.length}${converted.cast}`;
        });
        const filterValues = this.filters.flatMap((filter) => filter.values);
        const offset = params.length;
        const where = this.filters.length
          ? ` WHERE ${this.filters
              .map((filter) =>
                filter.sql.replace(/\$(\d+)/g, (_, index) => `$${offset + Number(index)}`)
              )
              .join(' AND ')}`
          : '';
        const sql = `UPDATE public.${identifier(this.table)} SET ${assignments.join(', ')}${where} RETURNING *`;
        const result = await db.query<Record<string, unknown>>(sql, [...params, ...filterValues]);
        const rows = result.rows.map(normalizeRow);
        return {
          data: this.columns === '*' ? rows : rows.map((row) => pick(row, this.columns)),
          error: null,
        };
      }
      if (this.action === 'delete') {
        const sql = `DELETE FROM public.${identifier(this.table)}${this.where()} RETURNING *`;
        const result = await db.query<Record<string, unknown>>(
          sql,
          this.filters.flatMap((filter) => filter.values) as unknown[]
        );
        return { data: result.rows.map(normalizeRow), error: null };
      }

      const order = this.orders.length
        ? ` ORDER BY ${this.orders
            .map((entry) => `${identifier(entry.column)} ${entry.ascending ? 'ASC' : 'DESC'}`)
            .join(', ')}`
        : '';
      const limit = this.limitValue === null ? '' : ` LIMIT ${this.limitValue}`;
      const sql =
        `SELECT ${this.columns} FROM public.${identifier(this.table)}` +
        `${this.where()}${order}${limit}`;
      const result = await db.query<Record<string, unknown>>(
        sql,
        this.filters.flatMap((filter) => filter.values) as unknown[]
      );
      return { data: result.rows.map(normalizeRow), error: null };
    } catch (error) {
      return errorResult(error);
    }
  }

  async single(): Promise<QueryResult> {
    const result = await this.execute();
    if (result.error) return result;
    const rows = result.data as unknown[] | null;
    if (!rows || rows.length !== 1) {
      return { data: null, error: { message: 'Expected exactly one row.' } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle(): Promise<QueryResult> {
    const result = await this.execute();
    if (result.error) return result;
    const rows = result.data as unknown[] | null;
    return { data: rows?.[0] ?? null, error: null };
  }

  // PostgREST returns `{ data, error }` from awaiting the builder.
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

function pick(row: Record<string, unknown>, columns: string): Record<string, unknown> {
  if (columns.trim() === '*') return row;
  const names = columns
    .split(',')
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  return Object.fromEntries(names.map((name) => [name, row[name]]));
}

const E2E_USER = {
  id: E2E_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@wallet.succra.invalid',
  email_confirmed_at: new Date().toISOString(),
  phone: '',
  confirmed_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { wallet_address: E2E_WALLET },
  identities: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  is_anonymous: false,
};

export class E2EClient {
  readonly auth = {
    getUser: async () => ({ data: { user: E2E_USER }, error: null }),
    getSession: async () => ({
      data: { session: { access_token: 'e2e', user: E2E_USER } },
      error: null,
    }),
    signOut: async () => ({ error: null }),
    admin: {
      getUserById: async () => ({ data: { user: E2E_USER }, error: null }),
      createUser: async () => ({ data: { user: E2E_USER }, error: null }),
      generateLink: async () => ({
        data: {
          properties: { hashed_token: 'e2e' },
          user: E2E_USER,
        },
        error: null,
      }),
      deleteUser: async () => ({ data: null, error: null }),
    },
  };

  from(table: string): E2EQuery {
    return new E2EQuery(getDb, table);
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<QueryResult> {
    if (name === 'mirror_confirmed_spend') {
      const db = await getDb();
      try {
        const result = await db.query<{ mirror_confirmed_spend: string }>(
          'SELECT public.mirror_confirmed_spend($1, $2) AS mirror_confirmed_spend',
          [args['p_mission_id'], args['p_amount']]
        );
        return {
          data: result.rows[0]?.mirror_confirmed_spend ?? null,
          error: null,
        };
      } catch (error) {
        return errorResult(error);
      }
    }
    return { data: null, error: { message: `Unsupported E2E RPC: ${name}` } };
  }
}

const DB_KEY = Symbol.for('succra.e2e.pglite');
const globalStore = globalThis as typeof globalThis & {
  [DB_KEY]?: Promise<PGlite>;
};

async function getDb(): Promise<PGlite> {
  globalStore[DB_KEY] ??= initDb();
  return globalStore[DB_KEY];
}

async function initDb(): Promise<PGlite> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.query('CREATE SCHEMA IF NOT EXISTS auth');
  await db.query('CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY)');
  await db.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    $$`);

  const dir =
    process.env.SUCCRA_E2E_MIGRATIONS_DIR ??
    resolve(process.cwd(), '..', '..', 'supabase', 'migrations');
  for (const file of readdirSync(dir)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }

  await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [E2E_USER_ID]);
  await db.query(
    `INSERT INTO public.profiles (id, wallet_address)
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address`,
    [E2E_USER_ID, E2E_WALLET]
  );
  return db;
}

let client: E2EClient | undefined;

export function e2eClient(): E2EClient {
  client ??= new E2EClient();
  return client;
}
