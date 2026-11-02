// Integration test: mission creation persistence against real migrations in
// PGlite, with the HashKey chain adapter injected (no network).
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { prepareMissionCreation, finalizeMission } from '../lib/missions/creation';
import type { MissionChain } from '../lib/missions/chain';
import { parsePolicyDocument, type MissionCreateInput } from '../lib/missions';
import { PGliteMissionCreationStore } from './helpers/pglite-mission-store';
import { createPhase6TestDb } from './helpers/pglite-gateway-store';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_WALLET = `0x${'1'.repeat(40)}` as `0x${string}`;
const FACTORY = `0x${'f'.repeat(40)}` as `0x${string}`;
const MISSION_ADDRESS = `0x${'a'.repeat(40)}` as `0x${string}`;
const TX_HASH = `0x${'b'.repeat(64)}` as `0x${string}`;

const input: MissionCreateInput = {
  name: 'Treasury run',
  objective: 'Pay vendors',
  paymentTokenAddress: `0x${'2'.repeat(40)}`,
  budgetAtomic: '50000000',
  maxPaymentAtomic: '5000000',
  recoveryMaxPaymentAtomic: '1000000',
  merchantAllowlist: [`0x${'3'.repeat(40)}`],
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  primaryAgentAddress: `0x${'4'.repeat(40)}`,
  successors: [{ address: `0x${'5'.repeat(40)}`, priority: 1 }],
  violationThreshold: 3,
  violationWindowSeconds: 900,
} as MissionCreateInput;

let db: PGlite;
let store: PGliteMissionCreationStore;

async function setupProfile(): Promise<void> {
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [OWNER_ID]);
  await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
    OWNER_ID,
    OWNER_WALLET,
  ]);
}

function chainWithState(getState: () => Record<string, unknown>): MissionChain {
  return {
    chainId: 177,
    factoryAddress: FACTORY,
    getNextMissionAddress: async () => MISSION_ADDRESS,
    buildCreateTransaction: () => ({
      chainId: 177,
      to: FACTORY,
      data: '0x1234',
      value: '0',
    }),
    verifyDeployment: async (args) => ({
      txHash: args.txHash,
      blockNumber: 42n,
      contractAddress: args.expectedMission,
      ownerAddress: args.expectedOwner,
      policyHash: args.expectedPolicyHash,
      state: getState() as never,
    }),
  };
}

beforeEach(async () => {
  db = await createPhase6TestDb();
  await setupProfile();
  store = new PGliteMissionCreationStore(db);
});

describe('mission creation with PGlite', () => {
  it('stores a DRAFT mission and policy before the owner signs', async () => {
    const result = await prepareMissionCreation({
      store,
      ownerId: OWNER_ID,
      ownerWallet: OWNER_WALLET,
      input,
      chain: chainWithState(() => ({})),
    });

    expect(result.contractAddress).toEqual(MISSION_ADDRESS);
    expect(result.unsignedTx.to).toEqual(FACTORY);
    expect(result.policyHash).toMatch(/^0x[0-9a-f]{64}$/);

    const mission = await store.getDraft(result.missionId, OWNER_ID);
    expect(mission?.status).toEqual('DRAFT');
    expect(mission?.contract_address).toEqual(MISSION_ADDRESS);
    expect(mission?.owner_address).toEqual(OWNER_WALLET);
    const policyRow = await store.getPolicy(result.missionId, 1);
    const policy = parsePolicyDocument(policyRow?.policy_json);
    expect(policy?.cart_mandate_id).toEqual(`mock-cart-${result.missionId}`);
  });

  it('finalizes only after the deployment matches and attaches agents', async () => {
    const prepared = await prepareMissionCreation({
      store,
      ownerId: OWNER_ID,
      ownerWallet: OWNER_WALLET,
      input,
      chain: chainWithState(() => ({})),
    });
    const policyRow = await store.getPolicy(prepared.missionId, 1);
    const policy = parsePolicyDocument(policyRow?.policy_json);
    if (!policy) throw new Error('policy missing');

    const state = {
      contractAddress: MISSION_ADDRESS,
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
      successors: policy.successors.map((successor) => ({
        agent: successor.address,
        priority: successor.priority,
        active: true,
      })),
      paymentToken: policy.payment_token_address,
      budgetAtomic: BigInt(policy.budget_atomic),
      maxPaymentAtomic: BigInt(policy.max_payment_atomic),
      recoveryMaxPaymentAtomic: BigInt(policy.recovery_max_payment_atomic),
      expiresAt: BigInt(Math.floor(Date.parse(policy.expires_at) / 1000)),
      policyHash: prepared.policyHash,
      cartMandateHash: policy.cart_mandate_hash,
      violationThreshold: policy.violation_threshold,
      violationWindowSeconds: BigInt(policy.violation_window_seconds),
      allowedMerchants: new Set(policy.merchant_allowlist),
    };
    const chain = chainWithState(() => state);

    const finalized = await finalizeMission({
      store,
      ownerId: OWNER_ID,
      ownerWallet: OWNER_WALLET,
      missionId: prepared.missionId,
      txHash: TX_HASH,
      chain,
    });
    expect(finalized.status).toEqual('ACTIVE');
    expect(finalized.idempotent).toEqual(false);

    const mission = await store.getDraft(prepared.missionId, OWNER_ID);
    expect(mission?.status).toEqual('ACTIVE');
    expect(mission?.current_agent_address).toEqual(policy.primary_agent_address);

    const assignments = await db.query<{ role: string; status: string }>(
      'SELECT role, status FROM mission_agents WHERE mission_id = $1 ORDER BY role',
      [prepared.missionId]
    );
    expect(assignments.rows).toEqual([
      { role: 'PRIMARY', status: 'REGISTERED' },
      { role: 'SUCCESSOR', status: 'PENDING' },
    ]);

    const audits = await db.query<{ event_type: string; onchain_tx_hash: string }>(
      'SELECT event_type, onchain_tx_hash FROM audit_events WHERE mission_id = $1',
      [prepared.missionId]
    );
    expect(audits.rows).toEqual([{ event_type: 'mission.created', onchain_tx_hash: TX_HASH }]);

    const again = await finalizeMission({
      store,
      ownerId: OWNER_ID,
      ownerWallet: OWNER_WALLET,
      missionId: prepared.missionId,
      txHash: TX_HASH,
      chain,
    });
    expect(again.idempotent).toEqual(true);

    const count = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM audit_events WHERE mission_id = $1',
      [prepared.missionId]
    );
    expect(count.rows[0]?.count).toEqual('1');
  });

  it('rejects finalization when the deployed policy hash differs', async () => {
    const prepared = await prepareMissionCreation({
      store,
      ownerId: OWNER_ID,
      ownerWallet: OWNER_WALLET,
      input,
      chain: chainWithState(() => ({})),
    });
    const policyRow = await store.getPolicy(prepared.missionId, 1);
    const policy = parsePolicyDocument(policyRow?.policy_json);
    if (!policy) throw new Error('policy missing');
    const state = {
      contractAddress: MISSION_ADDRESS,
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
      successors: [],
      paymentToken: policy.payment_token_address,
      budgetAtomic: BigInt(policy.budget_atomic),
      maxPaymentAtomic: BigInt(policy.max_payment_atomic),
      recoveryMaxPaymentAtomic: BigInt(policy.recovery_max_payment_atomic),
      expiresAt: BigInt(Math.floor(Date.parse(policy.expires_at) / 1000)),
      policyHash: `0x${'99'.repeat(32)}`,
      cartMandateHash: policy.cart_mandate_hash,
      violationThreshold: policy.violation_threshold,
      violationWindowSeconds: BigInt(policy.violation_window_seconds),
      allowedMerchants: new Set(policy.merchant_allowlist),
    };
    await expect(
      finalizeMission({
        store,
        ownerId: OWNER_ID,
        ownerWallet: OWNER_WALLET,
        missionId: prepared.missionId,
        txHash: TX_HASH,
        chain: chainWithState(() => state),
      })
    ).rejects.toMatchObject({ code: 'MISSION_STATE_MISMATCH' });
  });
});
