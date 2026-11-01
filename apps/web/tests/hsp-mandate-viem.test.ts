import { describe, expect, it } from 'vitest';
import { hashTypedData, recoverAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildCartMandateRef,
  buildPaymentMandate,
  buildPaymentMandateTypedData,
  hashPaymentMandate,
} from '@succra/hsp-client';

const account = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const mission = `0x${'11'.repeat(20)}` as const;
const merchant = `0x${'33'.repeat(20)}` as const;
const token = `0x${'44'.repeat(20)}` as const;

const mandate = buildPaymentMandate({
  cartMandate: buildCartMandateRef({
    cartMandateId: 'cart-1',
    cartMandateHash: `0x${'55'.repeat(32)}`,
    token,
    totalBudgetAtomic: '1000000',
    maxPerPaymentAtomic: '100000',
    merchantAllowlist: [merchant],
    expiresAt: '2000000000',
    issuer: account.address,
  }),
  requestId: 'req-123',
  missionAddress: mission,
  agent: account.address,
  merchant,
  token,
  amountAtomic: '1000',
  paymentNonce: 1,
  expiresAt: '2000000000',
});

describe('HSP mandate digest vs viem', () => {
  it('matches viem hashTypedData exactly', () => {
    const typedData = buildPaymentMandateTypedData(mandate, 177);
    const viemDigest = hashTypedData(typedData);
    expect(hashPaymentMandate(mandate, 177)).toEqual(viemDigest);
  });

  it('produces a digest the agent can sign and recover from', async () => {
    const digest = hashPaymentMandate(mandate, 177) as `0x${string}`;
    const signature = await account.sign({ hash: digest });
    expect(await recoverAddress({ hash: digest, signature })).toEqual(account.address);
  });
});
