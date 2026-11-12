// Privacy boundary: private mission state is never returned from a bare
// `?owner=` query. The deployer must prove wallet ownership by signing a
// short-lived challenge before the backend issues a bearer token.
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { GET, POST } from '../app/api/demo/route';
import {
  createOwnerChallenge,
  hasOwnerSession,
  verifyOwnerChallenge,
} from '../lib/demo/auth';
import { demoOwnerAddress } from '../lib/demo/orchestrator';

const OWNER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

describe('demo owner privacy', () => {
  it('issues a bearer token only after a valid owner signature', async () => {
    const owner = privateKeyToAccount(OWNER_KEY);
    expect(owner.address.toLowerCase()).toBe(demoOwnerAddress().toLowerCase());

    const challenge = createOwnerChallenge(owner.address);
    expect(challenge.message).toContain(owner.address);
    const signature = await owner.signMessage({ message: challenge.message });
    const session = await verifyOwnerChallenge(owner.address, signature);

    expect(hasOwnerSession(`Bearer ${session.token}`)).toBe(true);
    expect(hasOwnerSession(null)).toBe(false);
    expect(hasOwnerSession(`Bearer ${'00'.repeat(32)}`)).toBe(false);
  });

  it('returns an empty state when no owner is supplied', async () => {
    const response = await GET(new Request('http://localhost/api/demo'));
    const body = (await response.json()) as {
      ok: boolean;
      state: { missions: unknown[]; events: unknown[]; owner: string };
    };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.state.missions).toEqual([]);
    expect(body.state.events).toEqual([]);
    expect(body.state.owner).toBe('');
  });

  it('rejects a spoofed deployer address without a signature token', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/demo?owner=${demoOwnerAddress()}`
      )
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('OWNER_AUTH_REQUIRED');
  });

  it('rejects owner-scoped actions without a signature token', async () => {
    const response = await POST(
      new Request(`http://localhost/api/demo?owner=${demoOwnerAddress()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'init' }),
      })
    );
    expect(response.status).toBe(403);
  });
});
