// Unit tests: MissionFactory calldata, CREATE address prediction, deployment
// event parsing, and on-chain config comparison. No RPC is used.
import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getContractAddress,
  type Log,
  type TransactionReceipt,
} from 'viem';
import {
  buildCreateMissionCalldata,
  createMissionChain,
  MISSION_CREATED_EVENT_ABI,
  MISSION_FACTORY_ABI,
  missionMatchesPolicy,
} from '../lib/missions/chain';
import type { MissionOnChainState } from '../lib/gateway/contract-reader';
import type { MissionPolicyDocument } from '../lib/missions';

const FACTORY = `0x${'f'.repeat(40)}` as `0x${string}`;
const MISSION = `0x${'a'.repeat(40)}` as `0x${string}`;
const OWNER = `0x${'1'.repeat(40)}` as `0x${string}`;
const POLICY_HASH = `0x${'9'.repeat(64)}` as `0x${string}`;
const TX_HASH = `0x${'b'.repeat(64)}` as `0x${string}`;

const policy: MissionPolicyDocument = {
  version: 1,
  payment_token_address: `0x${'2'.repeat(40)}`,
  budget_atomic: '50000000',
  max_payment_atomic: '5000000',
  recovery_max_payment_atomic: '1000000',
  merchant_allowlist: [`0x${'3'.repeat(40)}`],
  expires_at: '2030-01-01T00:00:00.000Z',
  primary_agent_address: `0x${'4'.repeat(40)}`,
  successors: [{ address: `0x${'5'.repeat(40)}`, priority: 1 }],
  violation_threshold: 3,
  violation_window_seconds: 900,
  cart_mandate_id: 'mock-cart-1',
  cart_mandate_hash: `0x${'6'.repeat(64)}`,
};

function onchainState(overrides: Partial<MissionOnChainState> = {}): MissionOnChainState {
  return {
    contractAddress: MISSION,
    currentAgent: policy.primary_agent_address,
    status: 'ACTIVE',
    agentNonce: 0n,
    stateVersion: 0n,
    violationCount: 0,
    lastViolationAt: 0n,
    confirmedSpentAtomic: 0n,
    lastCheckpointHash: `0x${'00'.repeat(32)}`,
    lastCheckpointSequence: 0n,
    checkpointCount: 0n,
    successors: [{ agent: policy.successors[0]!.address, priority: 1, active: true }],
    paymentToken: policy.payment_token_address,
    budgetAtomic: BigInt(policy.budget_atomic),
    maxPaymentAtomic: BigInt(policy.max_payment_atomic),
    recoveryMaxPaymentAtomic: BigInt(policy.recovery_max_payment_atomic),
    expiresAt: BigInt(Math.floor(Date.parse(policy.expires_at) / 1000)),
    policyHash: POLICY_HASH,
    cartMandateHash: policy.cart_mandate_hash,
    violationThreshold: policy.violation_threshold,
    violationWindowSeconds: BigInt(policy.violation_window_seconds),
    allowedMerchants: new Set(policy.merchant_allowlist),
    ...overrides,
  };
}

function log(input: {
  address: `0x${string}`;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  logIndex: number;
}): Log {
  return {
    address: input.address,
    topics: [...input.topics],
    data: input.data,
    blockHash: `0x${'11'.repeat(32)}`,
    blockNumber: 1n,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    logIndex: input.logIndex,
    removed: false,
  } as Log;
}

function receipt(): TransactionReceipt {
  const factoryTopics = encodeEventTopics({
    abi: MISSION_FACTORY_ABI,
    eventName: 'MissionFactoryMissionDeployed',
    args: { owner: OWNER, mission: MISSION },
  });
  const missionTopics = encodeEventTopics({
    abi: MISSION_CREATED_EVENT_ABI,
    eventName: 'MissionCreated',
    args: { owner: OWNER, mission: MISSION },
  });
  const missionData = encodeAbiParameters([{ type: 'bytes32' }], [POLICY_HASH]);
  return {
    status: 'success',
    to: FACTORY,
    logs: [
      log({
        address: FACTORY,
        topics: factoryTopics as readonly `0x${string}`[],
        data: '0x',
        logIndex: 0,
      }),
      log({
        address: MISSION,
        topics: missionTopics as readonly `0x${string}`[],
        data: missionData,
        logIndex: 1,
      }),
    ],
    blockNumber: 1n,
    blockHash: `0x${'22'.repeat(32)}`,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    from: OWNER,
    cumulativeGasUsed: 1n,
    gasUsed: 1n,
    effectiveGasPrice: 1n,
    contractAddress: null,
    type: 'eip1559',
  } as TransactionReceipt;
}

describe('MissionFactory transaction', () => {
  it('encodes the policy into createMission calldata', () => {
    const data = buildCreateMissionCalldata(policy, POLICY_HASH);
    const decoded = decodeFunctionData({ abi: MISSION_FACTORY_ABI, data });
    expect(decoded.functionName).toEqual('createMission');
    const config = decoded.args[0];
    expect(config.paymentToken).toEqual(policy.payment_token_address);
    expect(config.budgetAtomic).toEqual(50000000n);
    expect(config.maxPaymentAtomic).toEqual(5000000n);
    expect(config.recoveryMaxPaymentAtomic).toEqual(1000000n);
    expect(config.policyHash).toEqual(POLICY_HASH);
    expect(config.cartMandateHash).toEqual(policy.cart_mandate_hash);
    expect(config.primaryAgent).toEqual(policy.primary_agent_address);
    expect(config.successors).toEqual([
      { agent: policy.successors[0]!.address, priority: 1, active: true },
    ]);
    expect(config.merchantAllowlist).toEqual(policy.merchant_allowlist);
  });

  it('predicts the next CREATE address from the factory nonce', async () => {
    process.env.SUCCRA_MISSION_FACTORY_ADDRESS = FACTORY;
    const chain = createMissionChain({
      client: {
        getTransactionCount: async () => 3n,
      } as never,
      readState: async () => onchainState(),
    });
    await expect(chain.getNextMissionAddress()).resolves.toEqual(
      getContractAddress({ from: FACTORY, nonce: 3n })
    );
  });

  it('verifies factory and MissionCreated events before activation', async () => {
    process.env.SUCCRA_MISSION_FACTORY_ADDRESS = FACTORY;
    process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID = '177';
    const chain = createMissionChain({
      client: {
        getTransactionReceipt: async () => receipt(),
      } as never,
      readState: async () => onchainState(),
    });
    const result = await chain.verifyDeployment({
      txHash: TX_HASH,
      expectedOwner: OWNER,
      expectedMission: MISSION,
      expectedPolicyHash: POLICY_HASH,
    });
    expect(result.contractAddress).toEqual(MISSION);
    expect(result.state.status).toEqual('ACTIVE');
  });

  it('rejects a receipt whose MissionCreated policy hash differs', async () => {
    process.env.SUCCRA_MISSION_FACTORY_ADDRESS = FACTORY;
    const wrong: MissionOnChainState = onchainState();
    const chain = createMissionChain({
      client: {
        getTransactionReceipt: async () => {
          const base = receipt();
          const missionLog = base.logs[1]!;
          return {
            ...base,
            logs: [
              base.logs[0]!,
              {
                ...missionLog,
                data: encodeAbiParameters([{ type: 'bytes32' }], [`0x${'77'.repeat(32)}`]),
              },
            ],
          } as TransactionReceipt;
        },
      } as never,
      readState: async () => wrong,
    });
    await expect(
      chain.verifyDeployment({
        txHash: TX_HASH,
        expectedOwner: OWNER,
        expectedMission: MISSION,
        expectedPolicyHash: POLICY_HASH,
      })
    ).rejects.toMatchObject({ code: 'POLICY_MISMATCH' });
  });

  it('compares the deployed configuration field by field', () => {
    expect(missionMatchesPolicy(onchainState(), policy, POLICY_HASH)).toEqual(true);
    expect(
      missionMatchesPolicy(onchainState({ maxPaymentAtomic: 1n }), policy, POLICY_HASH)
    ).toEqual(false);
    expect(
      missionMatchesPolicy(
        onchainState({ allowedMerchants: new Set([`0x${'8'.repeat(40)}`]) }),
        policy,
        POLICY_HASH
      )
    ).toEqual(false);
  });
});
