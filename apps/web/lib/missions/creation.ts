// Succra web — mission creation draft + finalization.
//
// POST /api/missions prepares the owner-signed MissionFactory call and
// stores a DRAFT mirror. POST /api/missions/:id/finalize verifies the
// authoritative receipt, MissionCreated event, and on-chain config before
// activating the mirror and attaching pre-approved agents.
import { randomUUID } from 'node:crypto';
import { auditEventHash } from '@/lib/gateway/store-quarantine';
import {
  buildMockCartMandate,
  buildPolicyDocument,
  hashPolicyDocument,
  parsePolicyDocument,
  type MissionCreateInput,
  type MissionPolicyDocument,
} from '@/lib/missions';
import {
  MissionDeploymentError,
  missionMatchesPolicy,
  type MissionChain,
  type UnsignedMissionTransaction,
  type VerifiedMissionDeployment,
} from './chain';
import type {
  MissionCreationStore,
  MissionDraftRow,
  NewMissionDraftRow,
  NewMissionPolicyRow,
} from './creation-store';

export interface PrepareMissionResult {
  missionId: string;
  contractAddress: `0x${string}`;
  predictedContractAddress: `0x${string}`;
  policyHash: `0x${string}`;
  unsignedTransaction: UnsignedMissionTransaction;
  unsignedTx: UnsignedMissionTransaction;
  cartMandate: { mandateId: string; mandateHash: `0x${string}` };
}

export type MissionFinalizeErrorCode =
  | 'MISSION_NOT_FOUND'
  | 'MISSION_NOT_DRAFT'
  | 'POLICY_MISSING'
  | 'MISSION_STATE_MISMATCH'
  | 'AGENT_OWNED_ELSEWHERE'
  | 'MISSION_FINALIZE_FAILED';

export class MissionFinalizeError extends Error {
  constructor(
    readonly code: MissionFinalizeErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MissionFinalizeError';
  }
}

export async function prepareMissionCreation(args: {
  store: MissionCreationStore;
  ownerId: string;
  ownerWallet: `0x${string}`;
  input: MissionCreateInput;
  chain: MissionChain;
}): Promise<PrepareMissionResult> {
  const missionId = randomUUID();
  const cartMandate = buildMockCartMandate({
    missionId,
    paymentTokenAddress: args.input.paymentTokenAddress,
    budgetAtomic: args.input.budgetAtomic,
    merchantAllowlist: args.input.merchantAllowlist,
  });
  const policy = buildPolicyDocument(args.input, cartMandate);
  const policyHash = hashPolicyDocument(policy);
  const predictedAddress = await args.chain.getNextMissionAddress();
  const unsignedTransaction = args.chain.buildCreateTransaction(policy, policyHash);
  const now = new Date().toISOString();

  const missionRow: NewMissionDraftRow = {
    id: missionId,
    owner_id: args.ownerId,
    name: args.input.name,
    objective: args.input.objective,
    pda_address: predictedAddress,
    vault_address: `pending:vault:${missionId}`,
    mint_address: args.input.paymentTokenAddress,
    budget_atomic: args.input.budgetAtomic,
    remaining_budget_atomic: args.input.budgetAtomic,
    status: 'DRAFT',
    current_agent_id: null,
    current_agent_public_key: args.input.primaryAgentAddress,
    contract_address: predictedAddress,
    factory_address: args.chain.factoryAddress,
    owner_address: args.ownerWallet,
    payment_token_address: args.input.paymentTokenAddress,
    current_agent_address: args.input.primaryAgentAddress,
    policy_version: 1,
    policy_hash: policyHash,
    expires_at: args.input.expiresAt,
    created_at: now,
    updated_at: now,
  };
  const policyRow: NewMissionPolicyRow = {
    mission_id: missionId,
    version: 1,
    max_action_atomic: args.input.maxPaymentAtomic,
    recovery_max_action_atomic: args.input.recoveryMaxPaymentAtomic,
    allowed_action_types: ['HSP_PAYMENT'],
    allowed_recipients: args.input.merchantAllowlist,
    violation_threshold: args.input.violationThreshold,
    violation_window_seconds: args.input.violationWindowSeconds,
    policy_json: policy,
    policy_hash: policyHash,
  };

  try {
    await args.store.insertDraft(missionRow);
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not store mission draft.');
  }
  try {
    await args.store.insertPolicy(policyRow);
  } catch {
    await args.store.deleteDraft(missionId, args.ownerId).catch(() => undefined);
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not store mission policy.');
  }

  return {
    missionId,
    contractAddress: predictedAddress,
    predictedContractAddress: predictedAddress,
    policyHash,
    unsignedTransaction,
    unsignedTx: unsignedTransaction,
    cartMandate,
  };
}

function verifiedAgentStatus(status: string): 'REGISTERED' | 'PENDING' {
  return ['REGISTERED', 'ACTIVE_PRIMARY', 'ACTIVE_SUCCESSOR'].includes(status)
    ? 'REGISTERED'
    : 'PENDING';
}

async function ensureAgent(args: {
  store: MissionCreationStore;
  ownerId: string;
  address: `0x${string}`;
  name: string;
}) {
  let existing;
  try {
    existing = await args.store.getAgentByAddress(args.address);
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not read agent.');
  }
  if (existing) {
    if (existing.owner_id !== args.ownerId) {
      throw new MissionFinalizeError(
        'AGENT_OWNED_ELSEWHERE',
        'An agent address is registered to another owner.'
      );
    }
    return { id: existing.id, status: existing.status };
  }

  try {
    return await args.store.insertAgent({
      owner_id: args.ownerId,
      name: args.name,
      address: args.address,
      public_key: args.address,
      endpoint_url: null,
      capabilities: [],
      status: 'PENDING',
    });
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not create agent record.');
  }
}

async function ensureAssignment(args: {
  store: MissionCreationStore;
  missionId: string;
  agentId: string;
  role: 'PRIMARY' | 'SUCCESSOR';
  priority: number | null;
  status: 'REGISTERED' | 'PENDING';
}): Promise<void> {
  let prior;
  try {
    prior = await args.store.getAssignment(args.missionId, args.agentId);
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not read agent assignment.');
  }
  if (prior) return;
  try {
    await args.store.insertAssignment({
      mission_id: args.missionId,
      agent_id: args.agentId,
      role: args.role,
      priority: args.priority,
      required_capabilities: [],
      status: args.status,
    });
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not create agent assignment.');
  }
}

export interface FinalizeMissionResult {
  missionId: string;
  contractAddress: string;
  status: 'ACTIVE';
  idempotent: boolean;
  txHash: string;
  policyHash: string;
}

export async function finalizeMission(args: {
  store: MissionCreationStore;
  ownerId: string;
  ownerWallet: `0x${string}`;
  missionId: string;
  txHash: `0x${string}`;
  chain: MissionChain;
}): Promise<FinalizeMissionResult> {
  let mission: MissionDraftRow | null;
  try {
    mission = await args.store.getDraft(args.missionId, args.ownerId);
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not read mission.');
  }
  if (!mission) {
    throw new MissionFinalizeError('MISSION_NOT_FOUND', 'Mission not found.');
  }

  if (mission.status === 'ACTIVE') {
    return {
      missionId: mission.id,
      contractAddress: mission.contract_address,
      status: 'ACTIVE',
      idempotent: true,
      txHash: args.txHash,
      policyHash: mission.policy_hash,
    };
  }
  if (mission.status !== 'DRAFT') {
    throw new MissionFinalizeError('MISSION_NOT_DRAFT', 'Only a DRAFT mission can be finalized.');
  }

  let policyRow;
  try {
    policyRow = await args.store.getPolicy(args.missionId, 1);
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not read mission policy.');
  }
  if (!policyRow) {
    throw new MissionFinalizeError('POLICY_MISSING', 'Mission policy is missing.');
  }
  const policy = parsePolicyDocument(policyRow.policy_json);
  if (!policy || policyRow.policy_hash !== mission.policy_hash) {
    throw new MissionFinalizeError('POLICY_MISSING', 'Mission policy is malformed.');
  }

  let deployment: VerifiedMissionDeployment;
  try {
    deployment = await args.chain.verifyDeployment({
      txHash: args.txHash,
      expectedOwner: args.ownerWallet,
      expectedMission: mission.contract_address as `0x${string}`,
      expectedPolicyHash: mission.policy_hash as `0x${string}`,
    });
  } catch (error) {
    if (error instanceof MissionDeploymentError) throw error;
    throw new MissionFinalizeError('MISSION_STATE_MISMATCH', 'Could not verify deployment.');
  }
  if (!missionMatchesPolicy(deployment.state, policy, deployment.policyHash)) {
    throw new MissionFinalizeError(
      'MISSION_STATE_MISMATCH',
      'Deployed mission config does not match the stored policy.'
    );
  }

  const primary = await ensureAgent({
    store: args.store,
    ownerId: args.ownerId,
    address: policy.primary_agent_address,
    name: 'Primary agent',
  });
  await ensureAssignment({
    store: args.store,
    missionId: mission.id,
    agentId: primary.id,
    role: 'PRIMARY',
    priority: null,
    status: 'REGISTERED',
  });

  for (const [index, successor] of policy.successors.entries()) {
    const agent = await ensureAgent({
      store: args.store,
      ownerId: args.ownerId,
      address: successor.address,
      name: `Successor ${index + 1}`,
    });
    await ensureAssignment({
      store: args.store,
      missionId: mission.id,
      agentId: agent.id,
      role: 'SUCCESSOR',
      priority: successor.priority,
      status: verifiedAgentStatus(agent.status),
    });
  }

  const updatedAt = new Date().toISOString();
  let activated: boolean;
  try {
    activated = await args.store.activateMission(mission.id, args.ownerId, {
      status: 'ACTIVE',
      contract_address: deployment.contractAddress,
      pda_address: deployment.contractAddress,
      factory_address: args.chain.factoryAddress,
      owner_address: args.ownerWallet,
      payment_token_address: policy.payment_token_address,
      current_agent_address: policy.primary_agent_address,
      current_agent_id: primary.id,
      current_agent_public_key: policy.primary_agent_address,
      policy_hash: deployment.policyHash,
      updated_at: updatedAt,
    });
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not activate mission.');
  }
  if (!activated) {
    // A concurrent finalize won the compare-and-set. Return the winner only
    // when it points at the same authoritative contract.
    const current = await args.store.getMissionSummary(mission.id, args.ownerId);
    if (current?.status === 'ACTIVE' && current.contract_address === deployment.contractAddress) {
      return {
        missionId: mission.id,
        contractAddress: deployment.contractAddress,
        status: 'ACTIVE',
        idempotent: true,
        txHash: args.txHash,
        policyHash: current.policy_hash,
      };
    }
    throw new MissionFinalizeError(
      'MISSION_STATE_MISMATCH',
      'Mission was modified by another request.'
    );
  }

  const auditAt = new Date().toISOString();
  try {
    await args.store.insertAudit({
      mission_id: mission.id,
      event_type: 'mission.created',
      actor_type: 'owner',
      actor_id: args.ownerId,
      event_hash: auditEventHash([
        mission.id,
        'mission.created',
        deployment.txHash,
        deployment.contractAddress,
      ]),
      payload_public: {
        missionId: mission.id,
        contractAddress: deployment.contractAddress,
        factoryAddress: args.chain.factoryAddress,
        ownerAddress: args.ownerWallet,
        policyHash: deployment.policyHash,
        policyVersion: 1,
        cartMandateId: policy.cart_mandate_id,
        cartMandateHash: policy.cart_mandate_hash,
        primaryAgentAddress: policy.primary_agent_address,
        successors: policy.successors,
        chainId: args.chain.chainId,
        blockNumber: deployment.blockNumber.toString(),
        txHash: deployment.txHash,
        at: auditAt,
      },
      onchain_tx_hash: deployment.txHash,
      created_at: auditAt,
    });
  } catch {
    throw new MissionFinalizeError('MISSION_FINALIZE_FAILED', 'Could not write audit event.');
  }

  return {
    missionId: mission.id,
    contractAddress: deployment.contractAddress,
    status: 'ACTIVE',
    idempotent: false,
    txHash: args.txHash,
    policyHash: deployment.policyHash,
  };
}

export type { MissionPolicyDocument };
