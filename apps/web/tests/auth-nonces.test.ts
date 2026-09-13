// Unit tests: DB-backed login nonces (lib/auth/nonces.ts) against the
// in-memory table double (same gate semantics as the SQL). The exact
// production SQL in SupabaseNonceTable is proven live in CI.
import { describe, expect, it } from 'vitest';
import { consumeNonce, issueNonce } from '../lib/auth/nonces';
import { FakeNonceTable } from './helpers/fake-supabase';

const WALLET_A = '11111111111111111111111111111111';
const WALLET_B = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const BUILDER = ({ nonce, expiresAtMs }: { nonce: string; expiresAtMs: number }): string =>
  `message:${nonce}:${expiresAtMs}`;

function codeOf(task: () => Promise<unknown>): Promise<string> {
  return task().then(
    () => {
      throw new Error('expected task to throw');
    },
    (error: unknown) => {
      if (error instanceof Error && 'code' in error) {
        return String(error.code);
      }
      throw error;
    }
  );
}

describe('issueNonce/consumeNonce', () => {
  it('issues unique nonces bound to the wallet with the exact message', async () => {
    const tables = new FakeNonceTable();
    const first = await issueNonce(tables, WALLET_A, BUILDER, 1_000, 60_000);
    const second = await issueNonce(tables, WALLET_A, BUILDER, 1_000, 60_000);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.walletAddress).toEqual(WALLET_A);
    expect(first.message).toEqual(`message:${first.nonce}:61000`);
    expect(first.expiresAtMs).toEqual(61_000);
    expect(tables.size()).toEqual(2);
  });

  it('consumes a valid nonce exactly once', async () => {
    const tables = new FakeNonceTable();
    const issued = await issueNonce(tables, WALLET_A, BUILDER, 1_000, 60_000);
    const consumed = await consumeNonce(tables, issued.nonce, WALLET_A, 2_000);
    expect(consumed.nonce).toEqual(issued.nonce);
    expect(await codeOf(() => consumeNonce(tables, issued.nonce, WALLET_A, 3_000))).toEqual(
      'NONCE_UNKNOWN'
    );
  });

  it('rejects unknown nonces', async () => {
    const tables = new FakeNonceTable();
    expect(await codeOf(() => consumeNonce(tables, 'nope', WALLET_A, 1_000))).toEqual(
      'NONCE_UNKNOWN'
    );
  });

  it('rejects expired nonces', async () => {
    const tables = new FakeNonceTable();
    const issued = await issueNonce(tables, WALLET_A, BUILDER, 1_000, 1_000);
    expect(await codeOf(() => consumeNonce(tables, issued.nonce, WALLET_A, 2_000))).toEqual(
      'NONCE_EXPIRED'
    );
  });

  it('rejects a nonce presented by a different wallet', async () => {
    const tables = new FakeNonceTable();
    const issued = await issueNonce(tables, WALLET_A, BUILDER, 1_000, 60_000);
    expect(await codeOf(() => consumeNonce(tables, issued.nonce, WALLET_B, 2_000))).toEqual(
      'NONCE_WALLET_MISMATCH'
    );
  });

  it('reuse after success finds nothing (consumed rows are removed)', async () => {
    const tables = new FakeNonceTable();
    const issued = await issueNonce(tables, WALLET_A, BUILDER, 1_000, 60_000);
    await consumeNonce(tables, issued.nonce, WALLET_A, 2_000);
    expect(await codeOf(() => consumeNonce(tables, issued.nonce, WALLET_A, 3_000))).toEqual(
      'NONCE_UNKNOWN'
    );
    expect(tables.size()).toEqual(0);
  });

  it('issuance sweeps expired rows', async () => {
    const tables = new FakeNonceTable();
    await issueNonce(tables, WALLET_A, BUILDER, 1_000, 1_000);
    expect(tables.size()).toEqual(1);
    await issueNonce(tables, WALLET_A, BUILDER, 5_000, 60_000);
    expect(tables.size()).toEqual(1);
  });
});
