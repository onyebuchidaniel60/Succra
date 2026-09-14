// Test-only in-memory double for the Supabase query builder surface used
// by routes and lib code (select/insert/update/delete + eq/is/gt/lt/not +
// order/single/maybeSingle/await). Emulates PostgREST row semantics
// (filters apply, UPDATE/DELETE execute on match, RLS is NOT emulated —
// that is proven separately against real Postgres in
// tests/integration/supabase-rls.test.ts).
//
// FakeNonceTable below doubles the NonceTable domain seam with the same
// single-threaded atomicity the SQL gate provides; the exact production
// SQL lives in SupabaseNonceTable and is proven live in CI.
import type { NewNonceRow, NonceTable, StoredNonceRow } from '../../lib/auth/nonces';
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export interface Filter {
  op: 'eq' | 'is' | 'gt' | 'lt' | 'not-is-null';
  col: string;
  val: unknown;
}

export class FakeQuery {
  private filters: Filter[] = [];
  private pendingInsert: Row | null = null;
  private pendingUpdate: Row | null = null;
  private pendingDelete = false;

  constructor(
    private readonly tables: Tables,
    private readonly table: string,
    private readonly tracer?: (table: string, filters: Filter[]) => void
  ) {}

  private trace(): void {
    this.tracer?.(this.table, [...this.filters]);
  }

  private rows(): Row[] {
    let rows = this.tables[this.table];
    if (!rows) {
      rows = [];
      this.tables[this.table] = rows;
    }
    return rows;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      // Absent keys read as SQL NULL (PostgREST returns explicit nulls).
      const value = row[filter.col] ?? null;
      switch (filter.op) {
        case 'eq':
        case 'is':
          return value === filter.val;
        case 'gt':
          return typeof value === 'string' && typeof filter.val === 'string' && value > filter.val;
        case 'lt':
          return typeof value === 'string' && typeof filter.val === 'string' && value < filter.val;
        case 'not-is-null':
          return value !== null && value !== undefined;
      }
    });
  }

  select(): this {
    return this;
  }

  insert(payload: Row): this {
    this.pendingInsert = payload;
    return this;
  }

  update(values: Row): this {
    this.pendingUpdate = values;
    return this;
  }

  delete(): this {
    this.pendingDelete = true;
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ op: 'eq', col, val });
    return this;
  }

  is(col: string, val: null): this {
    this.filters.push({ op: 'is', col, val });
    return this;
  }

  gt(col: string, val: string): this {
    this.filters.push({ op: 'gt', col, val });
    return this;
  }

  lt(col: string, val: string): this {
    this.filters.push({ op: 'lt', col, val });
    return this;
  }

  not(col: string, operator: 'is', val: null): this {
    if (operator !== 'is' || val !== null) {
      throw new Error('FakeQuery.not supports only (col, is, null).');
    }
    this.filters.push({ op: 'not-is-null', col, val });
    return this;
  }

  order(): this {
    return this;
  }

  private execute(): { data: unknown; error: null } {
    if (this.pendingInsert) {
      const row = { ...this.pendingInsert };
      this.rows().push(row);
      this.pendingInsert = null;
      return { data: [row], error: null };
    }
    if (this.pendingUpdate) {
      const updated = this.rows().filter((row) => this.matches(row));
      for (const row of updated) {
        Object.assign(row, this.pendingUpdate);
      }
      this.pendingUpdate = null;
      return { data: updated, error: null };
    }
    if (this.pendingDelete) {
      const kept = this.rows().filter((row) => !this.matches(row));
      const removed = this.rows().filter((row) => this.matches(row));
      this.tables[this.table] = kept;
      this.pendingDelete = false;
      return { data: removed, error: null };
    }
    return { data: this.rows().filter((row) => this.matches(row)), error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    this.trace();
    const result = this.execute();
    const rows = result.data as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    this.trace();
    const result = this.execute();
    const rows = result.data as Row[];
    return rows.length === 1
      ? { data: rows[0] ?? null, error: null }
      : { data: null, error: { message: 'not single' } };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null
  ): Promise<TResult1 | TResult2> {
    this.trace();
    return Promise.resolve(this.execute()).then(onfulfilled) as Promise<TResult1 | TResult2>;
  }
}

/** In-memory NonceTable double with the same gate semantics as the SQL. */
export class FakeNonceTable implements NonceTable {
  private readonly rows = new Map<string, StoredNonceRow>();

  async insert(row: NewNonceRow): Promise<void> {
    if (this.rows.has(row.nonce)) {
      throw new Error('duplicate nonce');
    }
    this.rows.set(row.nonce, { ...row, consumed_at: null });
  }

  async consumeAtomically(input: {
    nonce: string;
    walletAddress: string;
    nowIso: string;
  }): Promise<StoredNonceRow | null> {
    const row = this.rows.get(input.nonce);
    if (
      !row ||
      row.wallet_address !== input.walletAddress ||
      row.consumed_at !== null ||
      !(row.expires_at > input.nowIso)
    ) {
      return null;
    }
    const consumed: StoredNonceRow = { ...row, consumed_at: input.nowIso };
    this.rows.set(input.nonce, consumed);
    return { ...consumed };
  }

  async findByNonce(nonce: string): Promise<StoredNonceRow | null> {
    const row = this.rows.get(nonce);
    return row ? { ...row } : null;
  }

  async removeNonce(nonce: string): Promise<void> {
    this.rows.delete(nonce);
  }

  async deleteExpired(nowIso: string): Promise<void> {
    for (const [nonce, row] of this.rows) {
      if (!(row.expires_at > nowIso)) {
        this.rows.delete(nonce);
      }
    }
  }

  size(): number {
    return this.rows.size;
  }
}
