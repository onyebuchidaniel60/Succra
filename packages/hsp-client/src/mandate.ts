import { requestIdToBytes32 } from '@succra/shared';
import type { BuildPaymentMandateInput, HspCartMandateRef, HspPaymentMandate } from './types.js';

export function buildCartMandateRef(input: HspCartMandateRef): HspCartMandateRef {
  return {
    ...input,
    merchantAllowlist: [...input.merchantAllowlist],
  };
}

export function buildPaymentMandate(input: BuildPaymentMandateInput): HspPaymentMandate {
  const mandate: HspPaymentMandate = {
    cartMandateId: input.cartMandate.cartMandateId,
    cartMandateHash: input.cartMandate.cartMandateHash,
    requestId: input.requestId,
    onchainRequestId: requestIdToBytes32(input.requestId),
    missionAddress: input.missionAddress,
    agent: input.agent,
    merchant: input.merchant,
    token: input.token,
    amountAtomic: input.amountAtomic,
    paymentNonce: input.paymentNonce,
    expiresAt: input.expiresAt,
  };
  if (input.paymentReference !== undefined) {
    mandate.paymentReference = input.paymentReference;
  }
  return mandate;
}
