// POST /api/missions/:id/actions — HSP payment preflight.
//
// Preflight is local: it reads SuccraMission state, evaluates policy, and
// returns an unsigned Payment Mandate + typed data. It never calls HSP and
// never moves funds. Submission/settlement is Phase 3.
//
// Rate limiting is intentionally absent until Phase 9.
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { z } from 'zod';
import {
  buildCartMandateRef,
  buildPaymentMandate,
  buildPaymentMandateTypedData,
  hashPaymentMandate,
} from '@succra/hsp-client';
import { hashCanonicalBody, requestIdToBytes32 } from '@succra/shared';
import { apiError } from '@/lib/api-error';
import { verifyAgentRequest, type AgentAuthReason } from '@/lib/gateway/agent-auth';
import { readMissionState } from '@/lib/gateway/contract-reader';
import {
  evaluateHspPaymentPolicy,
  HSP_POLICY_REASON_MESSAGES,
  type HspPolicyReasonCode,
} from '@/lib/gateway/policy-hsp';
import {
  consumeAgentNonce,
  getActionRequestByMissionAndIdempotencyKey,
  getAgentByAddress,
  getMissionById,
  getOwnerWalletAddress,
  insertActionRequest,
  isAgentAssigned,
  listActionRequestKeys,
  type PreflightActionRequestRow,
} from '@/lib/gateway/store-preflight';
import { admin } from '@/lib/supabase';

const bodySchema = z.object({
  requestId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  agentNonce: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  actionType: z.literal('HSP_PAYMENT'),
  payload: z.object({
    merchantAddress: z.string().min(1),
    tokenAddress: z.string().min(1),
    amountAtomic: z.string().regex(/^\d+$/),
    paymentReference: z.string().optional(),
    expiresAt: z.union([z.string(), z.number()]),
  }),
});

function toUnixSeconds(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid expiry');
    return BigInt(Math.floor(value));
  }
  if (/^\d+$/.test(value)) return BigInt(value);
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) throw new Error('invalid expiry');
  return BigInt(Math.floor(millis / 1000));
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonSafe(entry)])
    );
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

function authError(reason: AgentAuthReason): NextResponse {
  switch (reason) {
    case 'UNAUTHENTICATED':
      return apiError(401, 'UNAUTHENTICATED', 'Agent authentication is required.');
    case 'STALE_REQUEST':
      return apiError(401, 'STALE_REQUEST', 'The request timestamp is outside the allowed window.');
    case 'REPLAY_DETECTED':
      return apiError(409, 'REPLAY_DETECTED', 'This agent request nonce has already been used.');
    case 'INVALID_SIGNATURE':
      return apiError(401, 'INVALID_SIGNATURE', 'The agent signature is invalid.');
    case 'AGENT_NOT_CURRENT':
      return apiError(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
  }
}

function rowResponse(row: PreflightActionRequestRow): NextResponse {
  if (row.decision === 'BLOCK') {
    const reasonCode = (row.decision_reason_code ?? 'MISSION_NOT_ACTIVE') as HspPolicyReasonCode;
    return NextResponse.json({
      decision: 'BLOCK',
      requestId: row.request_id,
      reasonCode,
      reason: HSP_POLICY_REASON_MESSAGES[reasonCode] ?? 'Request blocked.',
    });
  }
  return NextResponse.json({
    decision: 'ALLOW',
    requestId: row.request_id,
    paymentMandate: row.mandate_payload,
    mandateHash: row.mandate_hash,
    typedData: row.typed_data,
    expiresAt: row.expires_at,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params;
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body could not be read.');
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return apiError(400, 'INVALID_BODY', 'Request body must be valid JSON.');
  }
  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Request body does not match the preflight schema.');
  }
  if (typeof parsedBody !== 'object' || parsedBody === null) {
    return apiError(400, 'INVALID_BODY', 'Request body must be an object.');
  }

  let requestExpiry: bigint;
  try {
    requestExpiry = toUnixSeconds(parsed.data.payload.expiresAt);
  } catch {
    return apiError(400, 'INVALID_BODY', 'payload.expiresAt must be ISO-8601 or Unix seconds.');
  }

  const db = admin();
  try {
    const mission = await getMissionById(db, id);
    if (!mission) {
      return apiError(404, 'MISSION_NOT_FOUND', 'Mission not found.');
    }
    const missionAddressValue = mission.contract_address ?? mission.pda_address;
    if (!isAddress(missionAddressValue)) {
      return apiError(500, 'MISSION_CONTRACT_INVALID', 'Mission contract address is invalid.');
    }
    const missionAddress = missionAddressValue as `0x${string}`;
    const headerAgent = request.headers.get('x-succra-agent-address');
    if (!headerAgent) {
      return apiError(401, 'UNAUTHENTICATED', 'Agent authentication is required.');
    }
    const agent = await getAgentByAddress(db, headerAgent);
    if (!agent) {
      return apiError(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
    }

    const auth = await verifyAgentRequest({
      headers: request.headers,
      method: request.method,
      path: new URL(request.url).pathname,
      body: parsedBody as Record<string, unknown>,
      missionId: id,
      missionAddress,
      chainId: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177),
      currentAgent: mission.current_agent_address ?? mission.current_agent_public_key,
      agent: { id: agent.id, address: agent.public_key },
      store: {
        consumeAgentNonce: (agentId, nonce, expiresAt) =>
          consumeAgentNonce(db, agentId, nonce, expiresAt),
        isAgentAssigned: (missionId, agentId) => isAgentAssigned(db, missionId, agentId),
      },
      nowMs: Date.now(),
    });
    if (!auth.ok) {
      return authError(auth.reason);
    }

    let onchain;
    try {
      onchain = await readMissionState(missionAddress);
    } catch {
      return apiError(
        503,
        'MISSION_STATE_UNAVAILABLE',
        'Mission state is temporarily unavailable.'
      );
    }

    if (onchain.currentAgent.toLowerCase() !== agent.public_key.toLowerCase()) {
      return apiError(403, 'AGENT_NOT_CURRENT', 'The agent is not the current mission agent.');
    }

    const existing = await getActionRequestByMissionAndIdempotencyKey(
      db,
      id,
      parsed.data.idempotencyKey
    );
    if (existing) {
      return rowResponse(existing);
    }

    const keys = await listActionRequestKeys(db, id);
    const agentNonce =
      typeof parsed.data.agentNonce === 'number'
        ? BigInt(parsed.data.agentNonce)
        : BigInt(parsed.data.agentNonce);
    const amountAtomic = BigInt(parsed.data.payload.amountAtomic);
    const submittedAt = BigInt(Math.floor(Date.now() / 1000));

    const policy = evaluateHspPaymentPolicy({
      missionOnChain: {
        currentAgent: onchain.currentAgent,
        status: onchain.status,
        agentNonce: onchain.agentNonce,
        confirmedSpentAtomic: onchain.confirmedSpentAtomic,
        paymentToken: onchain.paymentToken,
        budgetAtomic: onchain.budgetAtomic,
        maxPaymentAtomic: onchain.maxPaymentAtomic,
        recoveryMaxPaymentAtomic: onchain.recoveryMaxPaymentAtomic,
        expiresAt: onchain.expiresAt,
        allowedMerchants: onchain.allowedMerchants,
      },
      missionMirror: {
        remainingBudgetAtomic: BigInt(mission.remaining_budget_atomic),
      },
      request: {
        requestId: parsed.data.requestId,
        idempotencyKey: parsed.data.idempotencyKey,
        agentNonce,
        actionType: parsed.data.actionType,
        payload: {
          merchant: parsed.data.payload.merchantAddress.toLowerCase(),
          token: parsed.data.payload.tokenAddress.toLowerCase(),
          amountAtomic,
          expiresAt: requestExpiry,
          ...(parsed.data.payload.paymentReference !== undefined
            ? { paymentReference: parsed.data.payload.paymentReference }
            : {}),
        },
        submittedAt,
      },
      seenRequestIds: keys.requestIds,
      seenIdempotencyKeys: keys.idempotencyKeys,
    });

    const requestHash = hashCanonicalBody(parsedBody);
    const onchainRequestId = requestIdToBytes32(parsed.data.requestId);
    const signature = request.headers.get('x-succra-signature');
    const expiresAtIso = new Date(Number(requestExpiry) * 1000).toISOString();

    if (policy.decision === 'BLOCK') {
      try {
        await insertActionRequest(db, {
          mission_id: id,
          agent_id: agent.id,
          idempotency_key: parsed.data.idempotencyKey,
          request_id: parsed.data.requestId,
          onchain_request_id: onchainRequestId,
          agent_nonce: Number(agentNonce),
          action_type: parsed.data.actionType,
          payload: parsedBody,
          request_hash: requestHash,
          signature,
          decision: 'BLOCK',
          decision_reason_code: policy.reasonCode,
          mandate_hash: null,
          mandate_payload: null,
          typed_data: null,
          expires_at: expiresAtIso,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const raced = await getActionRequestByMissionAndIdempotencyKey(
            db,
            id,
            parsed.data.idempotencyKey
          );
          if (raced) return rowResponse(raced);
          return apiError(409, 'DUPLICATE_NONCE', 'This agent nonce was already used.');
        }
        throw error;
      }
      return NextResponse.json({
        decision: 'BLOCK',
        requestId: parsed.data.requestId,
        reasonCode: policy.reasonCode,
        reason: HSP_POLICY_REASON_MESSAGES[policy.reasonCode],
      });
    }

    const ownerWallet = await getOwnerWalletAddress(db, mission.owner_id);
    if (!ownerWallet) {
      return apiError(500, 'MISSION_OWNER_UNAVAILABLE', 'Mission owner wallet is unavailable.');
    }

    const cartMandate = buildCartMandateRef({
      cartMandateId: mission.id,
      cartMandateHash: onchain.cartMandateHash,
      token: onchain.paymentToken,
      totalBudgetAtomic: onchain.budgetAtomic.toString(),
      maxPerPaymentAtomic: onchain.maxPaymentAtomic.toString(),
      merchantAllowlist: [...onchain.allowedMerchants],
      expiresAt: onchain.expiresAt.toString(),
      issuer: ownerWallet,
    });

    const mandate = buildPaymentMandate({
      cartMandate,
      requestId: policy.mandatePayload.requestId,
      missionAddress,
      agent: agent.public_key,
      merchant: policy.mandatePayload.merchant,
      token: policy.mandatePayload.token,
      amountAtomic: policy.mandatePayload.amountAtomic.toString(),
      paymentNonce: Number(policy.mandatePayload.agentNonce),
      expiresAt: policy.mandatePayload.expiresAt.toString(),
      ...(policy.mandatePayload.paymentReference !== undefined
        ? { paymentReference: policy.mandatePayload.paymentReference }
        : {}),
    });
    const mandateHash = hashPaymentMandate(
      mandate,
      Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177)
    );
    const typedData = buildPaymentMandateTypedData(
      mandate,
      Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? 177)
    );

    try {
      await insertActionRequest(db, {
        mission_id: id,
        agent_id: agent.id,
        idempotency_key: parsed.data.idempotencyKey,
        request_id: parsed.data.requestId,
        onchain_request_id: onchainRequestId,
        agent_nonce: Number(agentNonce),
        action_type: parsed.data.actionType,
        payload: parsedBody,
        request_hash: requestHash,
        signature,
        decision: 'ALLOW',
        decision_reason_code: null,
        mandate_hash: mandateHash,
        mandate_payload: mandate,
        typed_data: jsonSafe(typedData),
        expires_at: expiresAtIso,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await getActionRequestByMissionAndIdempotencyKey(
          db,
          id,
          parsed.data.idempotencyKey
        );
        if (raced) return rowResponse(raced);
        return apiError(409, 'DUPLICATE_NONCE', 'This agent nonce was already used.');
      }
      throw error;
    }

    return NextResponse.json({
      decision: 'ALLOW',
      requestId: parsed.data.requestId,
      paymentMandate: mandate,
      mandateHash,
      typedData: jsonSafe(typedData),
      expiresAt: expiresAtIso,
    });
  } catch {
    return apiError(500, 'INTERNAL_ERROR', 'The preflight request could not be completed.');
  }
}
