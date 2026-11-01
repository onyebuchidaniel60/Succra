import type { SupabaseClient } from '@supabase/supabase-js';
import { readMissionState } from './contract-reader';
import {
  getPublicClient,
  MissionTransactionError,
  readRecordedSettlement,
  sendRecordSettlement,
} from './contract-writer';
import type { WebhookChain, WebhookPersistence } from './hsp-webhook';
import {
  getActionRequestOnchainRequestId,
  getHspPaymentByMandateId,
  getMissionContractAddress,
  insertHspWebhookEvent,
  markHspWebhookProcessed,
  mirrorConfirmedSpend,
  transitionHspPayment,
} from './store-settlement';

export function createWebhookPersistence(db: SupabaseClient): WebhookPersistence {
  return {
    insertEvent: (row) => insertHspWebhookEvent(db, row),
    getPaymentByMandateId: (id) => getHspPaymentByMandateId(db, id),
    getActionRequestOnchainRequestId: (id) => getActionRequestOnchainRequestId(db, id),
    getMissionContractAddress: (id) => getMissionContractAddress(db, id),
    transitionPayment: (id, fromStatus, patch) => transitionHspPayment(db, id, fromStatus, patch),
    mirrorConfirmedSpend: async (missionId, amountAtomic) => {
      await mirrorConfirmedSpend(db, missionId, amountAtomic);
    },
    markProcessed: (id, processedAt) => markHspWebhookProcessed(db, id, processedAt),
  };
}

export function createWebhookChain(): WebhookChain {
  return {
    verifySettlement: async (txHash) => {
      try {
        const receipt = await getPublicClient().getTransactionReceipt({
          hash: txHash as `0x${string}`,
        });
        return {
          ok: receipt.status === 'success',
          blockNumber: Number(receipt.blockNumber),
        };
      } catch {
        return { ok: false };
      }
    },
    recordSettlement: async (args) => {
      const state = await readMissionState(args.missionAddress);
      try {
        await sendRecordSettlement({
          missionAddress: args.missionAddress,
          paymentId: args.paymentId,
          amountAtomic: args.amountAtomic,
          txHash: args.txHash,
          expectedVersion: state.stateVersion,
        });
        return {};
      } catch (error) {
        // Another webhook/poller or the submit wait may have recorded this
        // settlement first (AlreadyRecorded, or InvalidVersion after their
        // stateVersion bump). The on-chain mapping is authoritative.
        const recorded = await readRecordedSettlement({
          missionAddress: args.missionAddress,
          paymentId: args.paymentId,
        }).catch(() => false);
        if (recorded) return { alreadyRecorded: true };
        if (error instanceof MissionTransactionError && error.errorName === 'AlreadyRecorded') {
          return { alreadyRecorded: true };
        }
        throw error;
      }
    },
  };
}
