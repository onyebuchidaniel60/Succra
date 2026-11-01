// PROVISIONAL — validate against live HSP docs in Phase 9.
// HSP's exact typed-data schema is not published in a verifiable form yet.
// Phase 3 uses the mock server; live HSP reconciliation is Phase 9.

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

/** PROVISIONAL — mock HSP settlement status shape. Reconcile in Phase 9. */
export type HspPaymentStatusValue = 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

export interface HspPaymentStatus {
  hspPaymentMandateId: string;
  status: HspPaymentStatusValue;
  transactionHash?: string;
  blockNumber?: number;
  error?: {
    code?: string;
    message?: string;
    raw?: unknown;
  };
}

export interface HspSubmitPaymentRequest {
  paymentMandate: HspPaymentMandate;
  signature: string;
}
