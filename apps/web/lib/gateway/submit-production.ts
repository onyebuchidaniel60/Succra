import type { SupabaseClient } from '@supabase/supabase-js';
import { HspClient } from '@succra/hsp-client';
import {
  readRecordedSettlement,
  sendAuthorizePayment,
  sendRecordSettlement,
} from './contract-writer';
import { readMissionState } from './contract-reader';
import type { SubmitChain, SubmitHsp, SubmitPersistence } from './submit-handler';
import {
  getHspPaymentByActionRequestId,
  insertHspPayment,
  mirrorConfirmedSpend,
  transitionHspPayment,
  updateHspPayment,
} from './store-settlement';
import { markActionRequestSubmitted } from './store-preflight';

export function createSubmitChain(): SubmitChain {
  return {
    readMissionState: (missionAddress) => readMissionState(missionAddress),
    authorizePayment: (args) => sendAuthorizePayment(args),
    recordSettlement: (args) => sendRecordSettlement(args),
    readRecordedSettlement: (args) => readRecordedSettlement(args),
  };
}

export function createSubmitHsp(): SubmitHsp {
  const baseUrl = process.env.HSP_API_BASE_URL;
  const hmacSecret = process.env.HSP_HMAC_SECRET;
  if (!baseUrl) throw new Error('Missing HSP_API_BASE_URL.');
  if (!hmacSecret) throw new Error('Missing HSP_HMAC_SECRET.');
  const apiSecret = process.env.HSP_API_SECRET;
  const jwtPrivateKey = apiSecret && /^(0x)?[0-9a-f]{64}$/i.test(apiSecret) ? apiSecret : undefined;
  const client = new HspClient({
    baseUrl,
    hmacSecret,
    ...(jwtPrivateKey !== undefined ? { jwtPrivateKey } : {}),
    ...(process.env.HSP_MERCHANT_ID !== undefined
      ? { merchantId: process.env.HSP_MERCHANT_ID }
      : {}),
  });
  return {
    submit: (mandate, signature) => client.submitPaymentMandate(mandate, signature),
    getStatus: (id) => client.getPaymentStatus(id),
  };
}

export function createSubmitPersistence(db: SupabaseClient): SubmitPersistence {
  return {
    getHspPaymentByActionRequestId: (actionRequestId) =>
      getHspPaymentByActionRequestId(db, actionRequestId),
    insertHspPayment: (row) => insertHspPayment(db, row),
    updateHspPayment: (id, patch) => updateHspPayment(db, id, patch),
    transitionHspPayment: (id, fromStatus, patch) =>
      transitionHspPayment(db, id, fromStatus, patch),
    markActionSubmitted: (actionRequestId, signature, submittedAt) =>
      markActionRequestSubmitted(db, actionRequestId, signature, submittedAt),
    mirrorConfirmedSpend: async (missionId, amountAtomic) => {
      await mirrorConfirmedSpend(db, missionId, amountAtomic);
    },
  };
}
