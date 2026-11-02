// Unit tests: EIP-712 login typed data + signature verification (no server).
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { buildLoginTypedData, parseLoginTypedData, type LoginTypedData } from '../lib/auth/message';
import { verifyWalletSignature } from '../lib/auth/signature';

const ACCOUNT = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);

async function fixture(): Promise<{
  typedData: LoginTypedData;
  signature: `0x${string}`;
}> {
  const typedData = buildLoginTypedData({
    walletAddress: ACCOUNT.address,
    nonce: 'nonce-1234567890',
    issuedAt: '2026-11-02T00:10:00.000Z',
    chainId: 177,
  });
  const signature = await ACCOUNT.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });
  return { typedData, signature };
}

describe('buildLoginTypedData', () => {
  it('builds a SuccraLogin domain with no verifying contract', async () => {
    const { typedData } = await fixture();
    expect(typedData.domain).toEqual({ name: 'Succra', version: '1', chainId: 177 });
    expect('verifyingContract' in typedData.domain).toEqual(false);
    expect(typedData.primaryType).toEqual('SuccraLogin');
    expect(typedData.message.walletAddress).toEqual(ACCOUNT.address.toLowerCase());
    expect(typedData.message.nonce).toEqual('nonce-1234567890');
  });

  it('normalizes a checksummed wallet to lowercase', () => {
    const typedData = buildLoginTypedData({
      walletAddress: ACCOUNT.address,
      nonce: 'n',
      issuedAt: '2026-11-02T00:00:00.000Z',
      chainId: 133,
    });
    expect(typedData.message.walletAddress).toEqual(ACCOUNT.address.toLowerCase());
  });

  it('round-trips through stored JSON', async () => {
    const { typedData } = await fixture();
    expect(parseLoginTypedData(JSON.stringify(typedData))).toEqual(typedData);
    expect(parseLoginTypedData('not-json')).toBeNull();
    expect(parseLoginTypedData(JSON.stringify({ ...typedData, primaryType: 'Wrong' }))).toBeNull();
  });
});

describe('verifyWalletSignature', () => {
  it('accepts a genuine EIP-712 signature', async () => {
    const { typedData, signature } = await fixture();
    await expect(
      verifyWalletSignature({
        walletAddress: ACCOUNT.address,
        typedData,
        signature,
      })
    ).resolves.toEqual(true);
  });

  it('rejects tampered typed data', async () => {
    const { typedData, signature } = await fixture();
    await expect(
      verifyWalletSignature({
        walletAddress: ACCOUNT.address,
        typedData: {
          ...typedData,
          message: { ...typedData.message, nonce: 'different-nonce' },
        },
        signature,
      })
    ).resolves.toEqual(false);
  });

  it('rejects a signature from a different wallet', async () => {
    const { typedData, signature } = await fixture();
    const other = privateKeyToAccount(
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
    );
    await expect(
      verifyWalletSignature({
        walletAddress: other.address,
        typedData,
        signature,
      })
    ).resolves.toEqual(false);
  });

  it('rejects malformed inputs without throwing', async () => {
    const { typedData } = await fixture();
    await expect(
      verifyWalletSignature({
        walletAddress: ACCOUNT.address,
        typedData,
        signature: '0x1234',
      })
    ).resolves.toEqual(false);
    await expect(
      verifyWalletSignature({
        walletAddress: 'not-an-address',
        typedData,
        signature: `0x${'11'.repeat(65)}`,
      })
    ).resolves.toEqual(false);
  });
});
