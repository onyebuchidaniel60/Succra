import { verifyTypedData } from 'viem';
import {
  buildSuccraRequestTypedData,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '@succra/shared';

export type AgentAuthReason =
  | 'UNAUTHENTICATED'
  | 'STALE_REQUEST'
  | 'REPLAY_DETECTED'
  | 'INVALID_SIGNATURE'
  | 'AGENT_NOT_CURRENT';

export interface AgentAuthStore {
  consumeAgentNonce(
    agentId: string,
    nonce: string,
    expiresAt: string
  ): Promise<'CONSUMED' | 'REPLAY_DETECTED'>;
  isAgentAssigned(missionId: string, agentId: string): Promise<boolean>;
}

export interface AgentAuthInput {
  headers: Headers;
  method: string;
  path: string;
  body: Record<string, unknown>;
  missionId: string;
  missionAddress: `0x${string}`;
  chainId: number;
  /** Required unless authorization is 'agent-only'. */
  currentAgent?: string;
  agent: { id: string; address: string };
  store: AgentAuthStore;
  nowMs?: number;
  /** Path-bound request id for routes whose body does not carry requestId. */
  requestId?: string;
  /**
   * 'current-agent' (default) keeps action-submission semantics.
   * 'agent-only' proves address possession for heartbeat/status without
   * requiring current-agent status or mission assignment.
   */
  authorization?: 'current-agent' | 'agent-only';
}

export type AgentAuthResult = { ok: true } | { ok: false; reason: AgentAuthReason };

const MAX_CLOCK_SKEW_SECONDS = 60;
const NONCE_TTL_SECONDS = 300;

export async function verifyAgentRequest(input: AgentAuthInput): Promise<AgentAuthResult> {
  const agentAddress = input.headers.get('x-succra-agent-address');
  const timestamp = input.headers.get('x-succra-timestamp');
  const nonce = input.headers.get('x-succra-nonce');
  const signature = input.headers.get('x-succra-signature');

  if (!agentAddress || !timestamp || !nonce || !signature) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  const nowMs = input.nowMs ?? Date.now();
  const nowSeconds = Math.floor(nowMs / 1000);
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: 'STALE_REQUEST' };
  }

  let nonceValue: bigint;
  try {
    nonceValue = BigInt(nonce);
    if (nonceValue < 0n) throw new Error('negative');
  } catch {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  // Consume before signature/assignment checks: a failed authenticated request
  // burns the nonce, preventing replay of a partially valid request.
  const consumed = await input.store.consumeAgentNonce(
    input.agent.id,
    nonce,
    new Date(nowMs + NONCE_TTL_SECONDS * 1000).toISOString()
  );
  if (consumed === 'REPLAY_DETECTED') {
    return { ok: false, reason: 'REPLAY_DETECTED' };
  }

  const requestId = input.requestId ?? input.body['requestId'];
  if (typeof requestId !== 'string' || requestId.length === 0) {
    return { ok: false, reason: 'UNAUTHENTICATED' };
  }

  const typedData = buildSuccraRequestTypedData({
    chainId: input.chainId,
    verifyingContract: input.missionAddress,
    missionId: input.missionAddress,
    requestId: requestIdToBytes32(requestId),
    nonce: nonceValue,
    timestamp: BigInt(timestampSeconds),
    methodHash: hashMethodAndPath(input.method, input.path),
    bodyHash: hashCanonicalBody(input.body),
  });

  let valid = false;
  try {
    valid = await verifyTypedData({
      address: agentAddress as `0x${string}`,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid || agentAddress.toLowerCase() !== input.agent.address.toLowerCase()) {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }

  if (input.authorization === 'agent-only') {
    return { ok: true };
  }

  if (
    !input.currentAgent ||
    input.currentAgent.toLowerCase() !== input.agent.address.toLowerCase()
  ) {
    return { ok: false, reason: 'AGENT_NOT_CURRENT' };
  }
  if (!(await input.store.isAgentAssigned(input.missionId, input.agent.id))) {
    return { ok: false, reason: 'AGENT_NOT_CURRENT' };
  }

  return { ok: true };
}
