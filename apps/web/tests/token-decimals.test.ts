// Unit tests: token decimals from source + decimal-aware formatting.
import { beforeEach, describe, expect, it } from 'vitest';
import { formatAtomicUnknown, formatTokenAmount } from '../lib/format';
import {
  clearTokenDecimalsCache,
  configuredTokenDecimals,
  parseTokenDecimalsConfig,
  readTokenDecimals,
} from '../lib/token-decimals';

const TOKEN_6 = `0x${'11'.repeat(20)}`;
const TOKEN_18 = `0x${'22'.repeat(20)}`;
const TOKEN_CONFIG = `0x${'33'.repeat(20)}`;

beforeEach(() => {
  clearTokenDecimalsCache();
  delete process.env.NEXT_PUBLIC_TOKEN_DECIMALS;
});

describe('formatTokenAmount', () => {
  it('formats 6-decimal tokens', () => {
    expect(formatTokenAmount(1_000_000n, 6)).toEqual('1');
    expect(formatTokenAmount(1_500_000n, 6)).toEqual('1.5');
    expect(formatTokenAmount('750000000', 6)).toEqual('750');
  });

  it('formats 18-decimal tokens', () => {
    expect(formatTokenAmount(10n ** 18n, 18)).toEqual('1');
    expect(formatTokenAmount(15n * 10n ** 17n, 18)).toEqual('1.5');
    expect(formatTokenAmount('1234560000000000000000', 18)).toEqual('1,234.56');
  });

  it('does not assume a default when decimals are unknown', () => {
    expect(formatAtomicUnknown('1000000')).toEqual('1000000 atomic');
    expect(formatTokenAmount(1_000_000n, Number.NaN)).toEqual('1000000');
  });
});

describe('token decimals resolution', () => {
  it('parses an explicit deployment mapping', () => {
    const map = parseTokenDecimalsConfig(`${TOKEN_6}:6, ${TOKEN_18}:18, bad:1`);
    expect(map.get(TOKEN_6)).toEqual(6);
    expect(map.get(TOKEN_18)).toEqual(18);
    expect(map.size).toEqual(2);
    process.env.NEXT_PUBLIC_TOKEN_DECIMALS = `${TOKEN_CONFIG}:8`;
    expect(configuredTokenDecimals(TOKEN_CONFIG)).toEqual(8);
  });

  it('reads decimals from a mock 6-decimal token and caches it', async () => {
    let calls = 0;
    const reader = {
      readContract: async () => {
        calls += 1;
        return 6;
      },
    };
    await expect(readTokenDecimals(TOKEN_6, { reader })).resolves.toEqual(6);
    await expect(readTokenDecimals(TOKEN_6, { reader })).resolves.toEqual(6);
    expect(calls).toEqual(1);
  });

  it('reads decimals from a mock 18-decimal token', async () => {
    const reader = { readContract: async () => 18 };
    await expect(readTokenDecimals(TOKEN_18, { reader })).resolves.toEqual(18);
    expect(formatTokenAmount(10n ** 18n, 18)).toEqual('1');
  });

  it('returns null when the token read fails instead of guessing', async () => {
    const reader = {
      readContract: async () => {
        throw new Error('rpc down');
      },
    };
    await expect(readTokenDecimals(TOKEN_6, { reader })).resolves.toBeNull();
  });
});
