import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { readMissionState } from '../lib/gateway/contract-reader';

const MISSION = `0x${'11'.repeat(20)}` as const;
const AGENT = `0x${'22'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const MERCHANT = `0x${'44'.repeat(20)}`;

function clientWith(
  overrides: { config?: unknown[]; authority?: unknown[]; allowlist?: string[] } = {}
) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'config') {
        return (
          overrides.config ?? [
            TOKEN,
            1000n,
            400n,
            100n,
            2000n,
            `0x${'55'.repeat(32)}`,
            AGENT,
            3,
            900n,
            `0x${'66'.repeat(32)}`,
          ]
        );
      }
      if (functionName === 'authority') {
        return overrides.authority ?? [AGENT, 1, 4n, 2n, 0, 0n, 0n, `0x${'00'.repeat(32)}`, 0n];
      }
      if (functionName === 'getMerchantAllowlist') {
        return overrides.allowlist ?? [MERCHANT];
      }
      throw new Error('unexpected function');
    }),
  } as unknown as PublicClient;
}

describe('EVM mission contract reader', () => {
  it('reads config, authority, status, and the merchant allowlist', async () => {
    const client = clientWith();
    const state = await readMissionState(MISSION, { client });
    expect(state.currentAgent).toEqual(AGENT);
    expect(state.status).toEqual('ACTIVE');
    expect(state.agentNonce).toEqual(4n);
    expect(state.stateVersion).toEqual(2n);
    expect(state.paymentToken).toEqual(TOKEN);
    expect(state.cartMandateHash).toEqual(`0x${'66'.repeat(32)}`);
    expect(state.allowedMerchants.has(MERCHANT.toLowerCase())).toEqual(true);
    expect(client.readContract).toHaveBeenCalledTimes(3);
  });

  it('rejects an invalid contract address', async () => {
    await expect(
      readMissionState('not-an-address' as `0x${string}`, { client: clientWith() })
    ).rejects.toThrow('invalid');
  });

  it('wraps RPC/decode failures as MISSION_STATE_UNAVAILABLE', async () => {
    const client = {
      readContract: vi.fn(async () => {
        throw new Error('rpc down');
      }),
    } as unknown as PublicClient;
    await expect(readMissionState(MISSION, { client })).rejects.toThrow(
      'MISSION_STATE_UNAVAILABLE: rpc down'
    );
  });

  it('fails hard when no RPC URL is configured and no client is injected', async () => {
    const previous = process.env.SUCCRA_RPC_URL;
    const previousPublic = process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
    delete process.env.SUCCRA_RPC_URL;
    delete process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
    try {
      await expect(readMissionState(MISSION)).rejects.toThrow(
        'Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL'
      );
    } finally {
      if (previous !== undefined) process.env.SUCCRA_RPC_URL = previous;
      if (previousPublic !== undefined) process.env.NEXT_PUBLIC_HASHKEY_RPC_URL = previousPublic;
    }
  });
});
