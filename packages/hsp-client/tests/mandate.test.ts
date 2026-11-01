import { describe, expect, it } from 'vitest';
import type { HspCartMandateRef } from '../src/types.js';
import { buildCartMandateRef, buildPaymentMandate } from '../src/mandate.js';
import {
  HSP_PAYMENT_MANDATE_TYPES,
  buildPaymentMandateTypedData,
  hashPaymentMandate,
} from '../src/eip712-mandate.js';

const cart: HspCartMandateRef = {
  cartMandateId: 'cart-1',
  cartMandateHash: `0x${'11'.repeat(32)}`,
  token: `0x${'22'.repeat(20)}`,
  totalBudgetAtomic: '1000000',
  maxPerPaymentAtomic: '100000',
  merchantAllowlist: [`0x${'33'.repeat(20)}`],
  expiresAt: '2000000000',
  issuer: `0x${'44'.repeat(20)}`,
};

describe('HSP payment mandate', () => {
  it('builds a provisional mandate and binds the request id', () => {
    const mandate = buildPaymentMandate({
      cartMandate: buildCartMandateRef(cart),
      requestId: 'req-123',
      missionAddress: `0x${'55'.repeat(20)}`,
      agent: `0x${'66'.repeat(20)}`,
      merchant: `0x${'33'.repeat(20)}`,
      token: cart.token,
      amountAtomic: '1000',
      paymentNonce: 1,
      expiresAt: '2000000000',
      paymentReference: 'invoice-1',
    });

    expect(mandate.cartMandateId).toEqual('cart-1');
    expect(mandate.requestId).toEqual('req-123');
    expect(mandate.onchainRequestId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mandate.paymentReference).toEqual('invoice-1');
  });

  it('produces a deterministic 32-byte EIP-712 digest', () => {
    const mandate = buildPaymentMandate({
      cartMandate: cart,
      requestId: 'req-123',
      missionAddress: `0x${'55'.repeat(20)}`,
      agent: `0x${'66'.repeat(20)}`,
      merchant: cart.merchantAllowlist[0]!,
      token: cart.token,
      amountAtomic: '1000',
      paymentNonce: 1,
      expiresAt: '2000000000',
    });
    const digest = hashPaymentMandate(mandate);
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashPaymentMandate(mandate)).toEqual(digest);
  });

  it('exposes the provisional typed-data definition', () => {
    const mandate = buildPaymentMandate({
      cartMandate: cart,
      requestId: 'req-123',
      missionAddress: `0x${'55'.repeat(20)}`,
      agent: `0x${'66'.repeat(20)}`,
      merchant: cart.merchantAllowlist[0]!,
      token: cart.token,
      amountAtomic: '1000',
      paymentNonce: 1,
      expiresAt: '2000000000',
    });
    const typedData = buildPaymentMandateTypedData(mandate);
    expect(typedData.primaryType).toEqual('PaymentMandate');
    expect(typedData.types).toEqual(HSP_PAYMENT_MANDATE_TYPES);
    expect(typedData.domain.name).toEqual('Succra');
    expect(typedData.domain.chainId).toEqual(177n);
    expect(typedData.message.missionAddress).toEqual(mandate.missionAddress);
  });
});
