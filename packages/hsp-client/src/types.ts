// PROVISIONAL — validate against live HSP docs before Phase 3.
// HSP's exact typed-data schema is not published in a verifiable form yet.
// The mock server and Phase 2 tests use this schema; Phase 3 reconciles it.

export interface HspCartMandateRef {
  cartMandateId: string;
  cartMandateHash: string;
  token: string;
  totalBudgetAtomic: string;
  maxPerPaymentAtomic: string;
  merchantAllowlist: string[];
  expiresAt: string;
  issuer: string;
}

export interface HspPaymentMandate {
  cartMandateId: string;
  cartMandateHash: string;
  requestId: string;
  onchainRequestId: string;
  missionAddress: string;
  agent: string;
  merchant: string;
  token: string;
  amountAtomic: string;
  paymentNonce: number;
  expiresAt: string;
  paymentReference?: string;
}

export interface BuildPaymentMandateInput {
  cartMandate: HspCartMandateRef;
  requestId: string;
  missionAddress: string;
  agent: string;
  merchant: string;
  token: string;
  amountAtomic: string;
  paymentNonce: number;
  expiresAt: string;
  paymentReference?: string;
}
