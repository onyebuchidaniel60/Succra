import { Pool } from 'pg';

const globalForDb = globalThis as unknown as { __succraNeonPool?: Pool };

function pool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  globalForDb.__succraNeonPool ??= new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
  return globalForDb.__succraNeonPool;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await pool().query<T>(text, values);
  return result.rows;
}

export async function saveDemoSnapshot(state: unknown): Promise<void> {
  await query(
    `insert into demo_snapshots (id, state, updated_at)
     values ('mainnet', $1::jsonb, now())
     on conflict (id) do update set state = excluded.state, updated_at = now()`,
    [JSON.stringify(state)]
  );
}

export async function latestDemoSnapshot<T>(): Promise<T | null> {
  const rows = await query<{ state: T }>(
    `select state from demo_snapshots where id = 'mainnet' limit 1`
  );
  return rows[0]?.state ?? null;
}
