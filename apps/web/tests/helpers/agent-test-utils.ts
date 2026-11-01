import {
  buildSuccraRequestTypedData,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '@succra/shared';
import type { PrivateKeyAccount } from 'viem/accounts';
import {
  issueAgentChallenge,
  registerAgent,
  verifyAgentChallenge,
  type AgentRecord,
  type AgentStore,
  type RegisterAgentInput,
} from '../../lib/gateway/agents';

export interface PendingAgent {
  agentId: string;
  missionAgentId: string;
  address: string;
  status: string;
}

export async function registerPending(
  store: AgentStore,
  ownerId: string,
  missionId: string,
  account: PrivateKeyAccount,
  overrides: Partial<RegisterAgentInput> = {}
): Promise<PendingAgent> {
  const result = await registerAgent({
    store,
    ownerId,
    missionId,
    input: {
      address: account.address,
      name: overrides.name ?? 'Alpha',
      role: overrides.role ?? 'PRIMARY',
      ...(overrides.priority !== undefined ? { priority: overrides.priority } : {}),
      ...(overrides.requiredCapabilities !== undefined
        ? { requiredCapabilities: overrides.requiredCapabilities }
        : {}),
      ...(overrides.endpointUrl !== undefined ? { endpointUrl: overrides.endpointUrl } : {}),
    },
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new Error(`register failed: ${JSON.stringify(result.json)}`);
  }
  const json = result.json as {
    agentId: string;
    missionAgentId: string;
    address: string;
    status: string;
  };
  return json;
}

export async function issueAndSign(
  store: AgentStore,
  ownerId: string,
  agent: AgentRecord,
  account: PrivateKeyAccount,
  options: { nowMs?: number; chainId?: number } = {}
): Promise<{
  challenge: string;
  typedData: unknown;
  signature: string;
  expiresAt: string;
}> {
  const issued = await issueAgentChallenge({
    store,
    ownerId,
    agentId: agent.id,
    chainId: options.chainId ?? 177,
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
  });
  if (issued.status !== 200) {
    throw new Error(`challenge failed: ${JSON.stringify(issued.json)}`);
  }
  const json = issued.json as {
    challenge: string;
    typedData: Parameters<PrivateKeyAccount['signTypedData']>[0];
    expiresAt: string;
  };
  const signature = await account.signTypedData(json.typedData);
  return {
    challenge: json.challenge,
    typedData: json.typedData,
    signature,
    expiresAt: json.expiresAt,
  };
}

export async function registerAndVerify(
  store: AgentStore,
  ownerId: string,
  missionId: string,
  account: PrivateKeyAccount,
  overrides: Partial<RegisterAgentInput> = {}
): Promise<{ agent: AgentRecord; pending: PendingAgent }> {
  const pending = await registerPending(store, ownerId, missionId, account, overrides);
  const agent = await store.getAgentById(pending.agentId);
  if (!agent) throw new Error('registered agent missing');
  const signed = await issueAndSign(store, ownerId, agent, account);
  const verified = await verifyAgentChallenge({
    store,
    ownerId,
    agentId: agent.id,
    challenge: signed.challenge,
    signature: signed.signature,
    chainId: 177,
  });
  if (verified.status !== 200) {
    throw new Error(`verify failed: ${JSON.stringify(verified.json)}`);
  }
  const updated = await store.getAgentById(agent.id);
  if (!updated) throw new Error('verified agent missing');
  return { agent: updated, pending };
}

export async function agentHeaders(args: {
  account: PrivateKeyAccount;
  agent: AgentRecord;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  requestId?: string;
  nonce?: string;
  timestamp?: number;
  chainId?: number;
}): Promise<Headers> {
  const method = args.method ?? 'POST';
  const body = args.body ?? {};
  const timestamp = args.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = args.nonce ?? '1';
  const typedData = buildSuccraRequestTypedData({
    chainId: args.chainId ?? 177,
    verifyingContract: args.agent.address as `0x${string}`,
    missionId: args.agent.address as `0x${string}`,
    requestId: requestIdToBytes32(args.requestId ?? 'agent-test'),
    nonce: BigInt(nonce),
    timestamp: BigInt(timestamp),
    methodHash: hashMethodAndPath(method, args.path),
    bodyHash: hashCanonicalBody(body),
  });
  const signature = await args.account.signTypedData(typedData);
  return new Headers({
    'content-type': 'application/json',
    'x-succra-agent-address': args.account.address,
    'x-succra-timestamp': String(timestamp),
    'x-succra-nonce': nonce,
    'x-succra-signature': signature,
  });
}
