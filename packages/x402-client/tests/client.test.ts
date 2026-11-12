import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  MockFacilitator,
  buildEip3009TypedData,
  buildPaymentPayload,
  hashTransferWithAuthorization,
  parsePaymentRequired,
  selectAccept,
  signTransferWithAuthorization,
  verifyTransferLog,
} from '../src/index.js';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as const;
const PAYEE = '0x1111111111111111111111111111111111111111' as const;

const body = {
  x402Version: 1,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:4663',
      asset: USDG,
      payTo: PAYEE,
      maxAmountRequired: '100000',
      resource: 'https://merchant.example/data',
    },
  ],
};

describe('x402 client', () => {
  it('parses and validates accepts[]', () => {
    const parsed = parsePaymentRequired(body);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0]?.asset).toBe(USDG);
  });

  it('rejects malformed offers', () => {
    expect(() => parsePaymentRequired({ x402Version: 1, accepts: [] })).toThrow(/accepts/);
    expect(() =>
      parsePaymentRequired({
        x402Version: 1,
        accepts: [{ ...body.accepts[0], asset: 'nope' }],
      })
    ).toThrow(/asset/);
  });

  it('selects an offer that matches policy', () => {
    const parsed = parsePaymentRequired(body);
    expect(selectAccept(parsed.accepts, {
      network: 'eip155:4663',
      asset: USDG,
      payTo: PAYEE,
      maxAmountAtomic: 100000n,
    }).payTo).toBe(PAYEE);
    expect(() =>
      selectAccept(parsed.accepts, {
        network: 'eip155:4663',
        asset: USDG,
        payTo: PAYEE,
        maxAmountAtomic: 99n,
      })
    ).toThrow(/No x402 accept/);
  });

  it('signs canonical EIP-3009 typed data and settles through the mock facilitator', async () => {
    const offer = parsePaymentRequired(body).accepts[0]!;
    const typedData = buildEip3009TypedData({
      domain: {
        name: 'Global Dollar',
        version: '1',
        chainId: 4663,
        verifyingContract: USDG,
      },
      message: {
        from: account.address,
        to: PAYEE,
        value: 100n,
        validAfter: 0n,
        validBefore: 2_000_000_000n,
        nonce: `0x${'11'.repeat(32)}`,
      },
    });
    const hash = hashTransferWithAuthorization(typedData);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    const signature = await signTransferWithAuthorization(account, typedData);
    const payload = buildPaymentPayload({
      accept: offer,
      message: typedData.message,
      signature,
    });
    const facilitator = new MockFacilitator();
    const receipt = facilitator.settle(payload, offer);
    expect(receipt.success).toBe(true);
    expect(receipt.payer).toBe(account.address);
    expect(receipt.amountAtomic).toBe('100');
  });

  it('verifies the Transfer log against the preflighted payment', () => {
    const txHash = `0x${'22'.repeat(32)}` as const;
    const result = verifyTransferLog({
      log: {
        from: '0x3333333333333333333333333333333333333333',
        to: PAYEE,
        value: 100n,
        transactionHash: txHash,
      },
      expectedFrom: '0x3333333333333333333333333333333333333333',
      expectedTo: PAYEE,
      expectedValue: 100n,
      expectedTransactionHash: txHash,
    });
    expect(result.valid).toBe(true);
    expect(
      verifyTransferLog({
        log: {
          from: '0x3333333333333333333333333333333333333333',
          to: PAYEE,
          value: 99n,
          transactionHash: txHash,
        },
        expectedFrom: '0x3333333333333333333333333333333333333333',
        expectedTo: PAYEE,
        expectedValue: 100n,
        expectedTransactionHash: txHash,
      }).valid
    ).toBe(false);
  });
});
