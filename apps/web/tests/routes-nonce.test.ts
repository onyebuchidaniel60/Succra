// Route tests: POST /api/auth/nonce executes for real against an
// in-memory table double (real issueNonce logic; Supabase transport faked).
import { describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/auth/nonce/route';
import { FakeQuery, type Tables } from './helpers/fake-supabase';

const tables: Tables = {};

// The route resolves its table client through admin(); the fake keeps the
// test hermetic while the real issueNonce logic (SQL shape included) runs.
vi.mock('@/lib/supabase', () => ({
  server: () => {
    throw new Error('not used in this file');
  },
  admin: () => ({
    from: (table: string) => new FakeQuery(tables, table),
  }),
}));

const WALLET = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function post(body: unknown): Promise<Response> {
  return POST(
    new Request('http://localhost/api/auth/nonce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

describe('POST /api/auth/nonce', () => {
  it('issues a bound nonce with the exact message to sign', async () => {
    const response = await post({ walletAddress: WALLET });
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as {
      nonce: string;
      message: string;
      expiresAt: string;
    };
    expect(typeof payload.nonce).toEqual('string');
    expect(payload.message).toContain(`Wallet: ${WALLET}`);
    expect(payload.message).toContain(`Nonce: ${payload.nonce}`);
    expect(Number.isNaN(Date.parse(payload.expiresAt))).toEqual(false);
  });

  it('issues unique nonces per call', async () => {
    const first = (await (await post({ walletAddress: WALLET })).json()) as { nonce: string };
    const second = (await (await post({ walletAddress: WALLET })).json()) as { nonce: string };
    expect(first.nonce).not.toEqual(second.nonce);
  });

  it('rejects a non-address wallet with the error envelope', async () => {
    const response = await post({ walletAddress: 'not-an-address' });
    expect(response.status).toEqual(400);
    const payload = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(payload.error.code).toEqual('INVALID_BODY');
    expect(typeof payload.error.requestId).toEqual('string');
  });

  it('rejects a non-JSON body', async () => {
    const response = await post('this is not json');
    expect(response.status).toEqual(400);
  });
});
