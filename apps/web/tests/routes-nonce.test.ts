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

const WALLET = '0x1111111111111111111111111111111111111111';

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
  it('issues a bound nonce and SuccraLogin typed data', async () => {
    const response = await post({ walletAddress: WALLET });
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as {
      nonce: string;
      typedData: {
        domain: { name: string; version: string; chainId: number };
        primaryType: string;
        message: { walletAddress: string; nonce: string; issuedAt: string };
      };
      expiresAt: string;
    };
    expect(typeof payload.nonce).toEqual('string');
    expect(payload.typedData.domain).toEqual({ name: 'Succra', version: '1', chainId: 177 });
    expect(payload.typedData.primaryType).toEqual('SuccraLogin');
    expect(payload.typedData.message.walletAddress).toEqual(WALLET);
    expect(payload.typedData.message.nonce).toEqual(payload.nonce);
    expect(Number.isNaN(Date.parse(payload.typedData.message.issuedAt))).toEqual(false);
    expect(Number.isNaN(Date.parse(payload.expiresAt))).toEqual(false);
  });

  it('honours a supported chain id', async () => {
    const response = await post({ walletAddress: WALLET, chainId: 133 });
    expect(response.status).toEqual(200);
    const payload = (await response.json()) as { typedData: { domain: { chainId: number } } };
    expect(payload.typedData.domain.chainId).toEqual(133);
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

  it('rejects an unsupported chain id', async () => {
    const response = await post({ walletAddress: WALLET, chainId: 1 });
    expect(response.status).toEqual(400);
  });

  it('rejects a non-JSON body', async () => {
    const response = await post('this is not json');
    expect(response.status).toEqual(400);
  });
});
