// Succra runtime — Phase 6 succession activation engine.
//
// The contract only validates membership and the active flag. This engine owns
// the off-chain eligibility decision: role SUCCESSOR, Phase 4 status
// REGISTERED/ACTIVE_SUCCESSOR (the concrete form of FR-05 "AVAILABLE"),
// required capabilities, on-chain successor priority/order, and exclusion of
// the quarantined/current agent.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  stringToHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SuccessionTriggerType = 'quarantine' | 'owner_manual' | 'liveness';

export interface SuccessionMission {
  id: string;
  contract_address: string | null;
  pda_address: string;
  current_agent_id: string | null;
  current_agent_address: string | null;
}

export interface SuccessionOnChainState {
  status: string;
  stateVersion: bigint;
  currentAgent: string;
  recoveryMaxPaymentAtomic: bigint;
  successors: Array<{ agent: string; priority: number; active: boolean }>;
}

export interface SuccessorCandidate {
  missionAgentId: string;
  agentId: string;
  address: string;
  priority: number | null;
  status: string;
  capabilities: string[];
  requiredCapabilities: string[];
}

export interface SuccessionEventRow {
  id: string;
  to_agent_address: string;
  activation_tx_hash: string | null;
  checkpoint_hash: string | null;
  checkpoint_sequence: number | null;
}

export interface LatestCheckpoint {
  sequence: number;
  checkpoint_hash: string;
}

export interface SuccessionAuditEvent {
  mission_id: string;
  event_type:
    | 'succession.triggered'
    | 'succession.candidate_selected'
    | 'succession.activate.submitted'
    | 'succession.activate.confirmed';
  actor_type: 'runtime';
  actor_id: null;
  event_hash: string;
  payload_public: Record<string, unknown>;
  onchain_tx_hash: string | null;
}

export interface SuccessionEngineDeps {
  getMission(missionId: string): Promise<SuccessionMission | null>;
  readState(address: `0x${string}`): Promise<SuccessionOnChainState>;
  listCandidates(missionId: string): Promise<SuccessorCandidate[]>;
  getLatestVerifiedCheckpoint(missionId: string): Promise<LatestCheckpoint | null>;
  getPendingSuccession(missionId: string): Promise<SuccessionEventRow | null>;
  failPendingSuccession(successionId: string): Promise<void>;
  insertSuccessionEvent(row: {
    mission_id: string;
    from_agent_id: string | null;
    from_agent_address: string;
    to_agent_id: string;
    to_agent_address: string;
    trigger_type: SuccessionTriggerType;
    checkpoint_hash: string | null;
    checkpoint_sequence: number | null;
    recovery_max_payment_atomic: string;
    status: 'PENDING_ACK';
    activation_tx_hash: string;
  }): Promise<SuccessionEventRow>;
  insertAuditEvent(row: SuccessionAuditEvent): Promise<void>;
  activateSuccessor(args: {
    missionAddress: `0x${string}`;
    successor: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<{ txHash: string }>;
  now?: () => number;
}

export interface SuccessionEngineResult {
  outcome:
    | 'ACTIVATED'
    | 'ALREADY_ACTIVATED'
    | 'NO_ELIGIBLE'
    | 'NO_CHECKPOINT'
    | 'NOT_APPLICABLE'
    | 'ACTIVATION_FAILED';
  successionId?: string;
  toAgentAddress?: string;
}

function eventHash(parts: readonly (string | number | bigint | null)[]): string {
  return keccak256(stringToHex(parts.map((part) => (part === null ? '' : String(part))).join(':')));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function capabilitiesSatisfied(candidate: SuccessorCandidate): boolean {
  const required = stringArray(candidate.requiredCapabilities);
  if (required.length === 0) return true;
  const available = new Set(stringArray(candidate.capabilities));
  return required.every((capability) => available.has(capability));
}

function sortCandidates(
  candidates: SuccessorCandidate[],
  state: SuccessionOnChainState
): SuccessorCandidate[] {
  const onchainOrder = new Map(
    state.successors.map((successor, index) => [successor.agent.toLowerCase(), index])
  );
  const onchainPriority = new Map(
    state.successors.map((successor) => [successor.agent.toLowerCase(), successor.priority])
  );
  return [...candidates]
    .filter((candidate) => onchainOrder.has(candidate.address.toLowerCase()))
    .filter(
      (candidate) =>
        state.successors[onchainOrder.get(candidate.address.toLowerCase()) ?? -1]?.active === true
    )
    .filter((candidate) => candidate.address.toLowerCase() !== state.currentAgent.toLowerCase())
    .map((candidate) => ({
      ...candidate,
      priority: onchainPriority.get(candidate.address.toLowerCase()) ?? candidate.priority ?? null,
    }))
    .sort((left, right) => {
      const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      const leftOrder = onchainOrder.get(left.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = onchainOrder.get(right.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.address.toLowerCase().localeCompare(right.address.toLowerCase());
    });
}

async function auditTriggered(
  deps: SuccessionEngineDeps,
  missionId: string,
  payload: Record<string, unknown>
): Promise<void> {
  await deps.insertAuditEvent({
    mission_id: missionId,
    event_type: 'succession.triggered',
    actor_type: 'runtime',
    actor_id: null,
    event_hash: eventHash([
      missionId,
      'succession.triggered',
      payload['outcome'] === undefined ? '' : String(payload['outcome']),
    ]),
    payload_public: payload,
    onchain_tx_hash: null,
  });
}

/**
 * Activates the best eligible successor, or records why none was chosen.
 * Safe to re-run: an already-pending activation for the current on-chain agent
 * is returned as ALREADY_ACTIVATED.
 */
export async function runSuccessionEngine(
  deps: SuccessionEngineDeps,
  missionId: string,
  options: {
    triggerType?: SuccessionTriggerType;
    preferredSuccessorAddress?: string;
  } = {}
): Promise<SuccessionEngineResult> {
  const triggerType = options.triggerType ?? 'quarantine';
  const mission = await deps.getMission(missionId);
  if (!mission) return { outcome: 'NOT_APPLICABLE' };
  const addressValue = mission.contract_address ?? mission.pda_address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addressValue)) return { outcome: 'NOT_APPLICABLE' };
  const missionAddress = addressValue as `0x${string}`;

  const state = await deps.readState(missionAddress);
  if (state.status !== 'QUARANTINED' && state.status !== 'RECOVERING') {
    return { outcome: 'NOT_APPLICABLE' };
  }

  const pending = await deps.getPendingSuccession(missionId);
  const preferred = options.preferredSuccessorAddress?.toLowerCase();
  if (
    state.status === 'RECOVERING' &&
    pending &&
    pending.to_agent_address.toLowerCase() === state.currentAgent.toLowerCase() &&
    (preferred === undefined || preferred === pending.to_agent_address.toLowerCase())
  ) {
    return {
      outcome: 'ALREADY_ACTIVATED',
      ...(pending.id ? { successionId: pending.id } : {}),
      toAgentAddress: pending.to_agent_address,
    };
  }
  if (pending) await deps.failPendingSuccession(pending.id);

  const checkpoint = await deps.getLatestVerifiedCheckpoint(missionId);
  if (!checkpoint) {
    await auditTriggered(deps, missionId, {
      trigger: triggerType,
      eligible_candidates: [],
      outcome: 'no_verified_checkpoint',
    });
    return { outcome: 'NO_CHECKPOINT' };
  }

  const candidates = sortCandidates(await deps.listCandidates(missionId), state).filter(
    capabilitiesSatisfied
  );
  const eligible =
    options.preferredSuccessorAddress !== undefined
      ? candidates.filter(
          (candidate) =>
            candidate.address.toLowerCase() === options.preferredSuccessorAddress?.toLowerCase()
        )
      : candidates;

  await auditTriggered(deps, missionId, {
    trigger: triggerType,
    eligible_candidates: eligible.map((candidate) => candidate.address),
    checkpoint_sequence: checkpoint.sequence,
    checkpoint_hash: checkpoint.checkpoint_hash,
    outcome: eligible.length === 0 ? 'no_eligible_successor' : 'candidate_found',
  });

  if (eligible.length === 0) return { outcome: 'NO_ELIGIBLE' };

  for (const candidate of eligible) {
    const candidatePayload = {
      candidate: candidate.address,
      priority: candidate.priority,
      checkpoint_sequence: checkpoint.sequence,
      checkpoint_hash: checkpoint.checkpoint_hash,
    };
    await deps.insertAuditEvent({
      mission_id: missionId,
      event_type: 'succession.candidate_selected',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([
        missionId,
        'succession.candidate_selected',
        candidate.address,
        checkpoint.sequence,
      ]),
      payload_public: candidatePayload,
      onchain_tx_hash: null,
    });

    let activation: { txHash: string };
    try {
      activation = await deps.activateSuccessor({
        missionAddress,
        successor: candidate.address as `0x${string}`,
        expectedVersion: state.stateVersion,
      });
    } catch {
      continue;
    }

    const succession = await deps.insertSuccessionEvent({
      mission_id: missionId,
      from_agent_id: mission.current_agent_id,
      from_agent_address: state.currentAgent,
      to_agent_id: candidate.agentId,
      to_agent_address: candidate.address,
      trigger_type: triggerType,
      checkpoint_hash: checkpoint.checkpoint_hash,
      checkpoint_sequence: checkpoint.sequence,
      recovery_max_payment_atomic: state.recoveryMaxPaymentAtomic.toString(),
      status: 'PENDING_ACK',
      activation_tx_hash: activation.txHash,
    });

    const submittedPayload = {
      ...candidatePayload,
      successionId: succession.id,
      txHash: activation.txHash,
    };
    await deps.insertAuditEvent({
      mission_id: missionId,
      event_type: 'succession.activate.submitted',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([missionId, 'succession.activate.submitted', activation.txHash]),
      payload_public: submittedPayload,
      onchain_tx_hash: activation.txHash,
    });
    await deps.insertAuditEvent({
      mission_id: missionId,
      event_type: 'succession.activate.confirmed',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([missionId, 'succession.activate.confirmed', activation.txHash]),
      payload_public: submittedPayload,
      onchain_tx_hash: activation.txHash,
    });

    return {
      outcome: 'ACTIVATED',
      successionId: succession.id,
      toAgentAddress: candidate.address,
    };
  }

  await auditTriggered(deps, missionId, {
    trigger: triggerType,
    eligible_candidates: eligible.map((candidate) => candidate.address),
    checkpoint_sequence: checkpoint.sequence,
    checkpoint_hash: checkpoint.checkpoint_hash,
    outcome: 'activation_failed',
  });
  return { outcome: 'ACTIVATION_FAILED' };
}

// ------------------------------------------------------------ production wiring

const MISSION_ABI = [
  {
    type: 'function',
    name: 'config',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'paymentToken', type: 'address' },
      { name: 'budgetAtomic', type: 'uint256' },
      { name: 'maxPaymentAtomic', type: 'uint256' },
      { name: 'recoveryMaxPaymentAtomic', type: 'uint256' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'policyHash', type: 'bytes32' },
      { name: 'primaryAgent', type: 'address' },
      { name: 'violationThreshold', type: 'uint16' },
      { name: 'violationWindowSeconds', type: 'uint64' },
      { name: 'cartMandateHash', type: 'bytes32' },
    ],
  },
  {
    type: 'function',
    name: 'authority',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'currentAgent', type: 'address' },
      { name: 'status', type: 'uint8' },
      { name: 'agentNonce', type: 'uint64' },
      { name: 'stateVersion', type: 'uint64' },
      { name: 'violationCount', type: 'uint16' },
      { name: 'lastViolationAt', type: 'uint64' },
      { name: 'confirmedSpentAtomic', type: 'uint256' },
      { name: 'lastCheckpointHash', type: 'bytes32' },
      { name: 'lastCheckpointSequence', type: 'uint64' },
      { name: 'checkpointCount', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'getSuccessors',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'agent', type: 'address' },
          { name: 'priority', type: 'uint16' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'activateSuccessor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'successor', type: 'address' },
      { name: 'expectedVersion', type: 'uint64' },
    ],
    outputs: [],
  },
] as const;

const STATUS_NAMES = [
  'DRAFT',
  'ACTIVE',
  'DEGRADED',
  'QUARANTINED',
  'RECOVERING',
  'ACTIVE_RECOVERY',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'HALTED',
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
  return undefined;
}

export function createProductionSuccessionEngineDeps(): SuccessionEngineDeps {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
  const db: SupabaseClient = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rpcUrl = process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!rpcUrl) throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  const chainId = Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? '177');
  const chain = {
    id: chainId,
    name: 'Succra',
    nativeCurrency: { name: 'HashKey', symbol: 'HSK', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
  const guardianKey = requiredEnv('HASHKEY_GUARDIAN_SECRET_KEY');
  const account = privateKeyToAccount(
    (guardianKey.startsWith('0x') ? guardianKey : `0x${guardianKey}`) as `0x${string}`
  );
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  return {
    async getMission(missionId) {
      const { data, error } = await db
        .from('missions')
        .select('id, contract_address, pda_address, current_agent_id, current_agent_address')
        .eq('id', missionId)
        .maybeSingle();
      if (error) throw error;
      return (data as SuccessionMission | null) ?? null;
    },

    async readState(address) {
      const [config, authority, successors] = await Promise.all([
        publicClient.readContract({ address, abi: MISSION_ABI, functionName: 'config' }),
        publicClient.readContract({ address, abi: MISSION_ABI, functionName: 'authority' }),
        publicClient.readContract({ address, abi: MISSION_ABI, functionName: 'getSuccessors' }),
      ]);
      const status = STATUS_NAMES[Number(authority[1])];
      if (!status) throw new Error('Unknown mission status.');
      return {
        status,
        stateVersion: authority[3],
        currentAgent: authority[0],
        recoveryMaxPaymentAtomic: config[3],
        successors: successors.map((successor) => ({
          agent: successor.agent,
          priority: Number(successor.priority),
          active: successor.active,
        })),
      };
    },

    async listCandidates(missionId) {
      const { data: assignments, error: assignmentError } = await db
        .from('mission_agents')
        .select('id, agent_id, priority, status, required_capabilities')
        .eq('mission_id', missionId)
        .eq('role', 'SUCCESSOR')
        .in('status', ['REGISTERED', 'ACTIVE_SUCCESSOR']);
      if (assignmentError) throw assignmentError;
      const rows = (assignments as Array<Record<string, unknown>> | null) ?? [];
      if (rows.length === 0) return [];
      const agentIds = rows.map((row) => String(row['agent_id']));
      const { data: agents, error: agentError } = await db
        .from('agents')
        .select('id, address, capabilities')
        .in('id', agentIds);
      if (agentError) throw agentError;
      const agentsById = new Map(
        ((agents as Array<Record<string, unknown>> | null) ?? []).map((agent) => [
          String(agent['id']),
          agent,
        ])
      );
      return rows.flatMap((row) => {
        const agent = agentsById.get(String(row['agent_id']));
        if (!agent) return [];
        return [
          {
            missionAgentId: String(row['id']),
            agentId: String(row['agent_id']),
            address: String(agent['address']),
            priority: row['priority'] === null ? null : Number(row['priority']),
            status: String(row['status']),
            capabilities: stringArrayValue(agent['capabilities']),
            requiredCapabilities: stringArrayValue(row['required_capabilities']),
          },
        ];
      });
    },

    async getLatestVerifiedCheckpoint(missionId) {
      const { data, error } = await db
        .from('mission_checkpoints')
        .select('sequence, checkpoint_hash')
        .eq('mission_id', missionId)
        .eq('status', 'VERIFIED')
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            sequence: Number((data as { sequence: number }).sequence),
            checkpoint_hash: String((data as { checkpoint_hash: string }).checkpoint_hash),
          }
        : null;
    },

    async getPendingSuccession(missionId) {
      const { data, error } = await db
        .from('succession_events')
        .select('id, to_agent_address, activation_tx_hash, checkpoint_hash, checkpoint_sequence')
        .eq('mission_id', missionId)
        .eq('status', 'PENDING_ACK')
        .maybeSingle();
      if (error) throw error;
      return (data as SuccessionEventRow | null) ?? null;
    },

    async failPendingSuccession(successionId) {
      const { error } = await db
        .from('succession_events')
        .update({ status: 'FAILED' })
        .eq('id', successionId)
        .eq('status', 'PENDING_ACK');
      if (error) throw error;
    },

    async insertSuccessionEvent(row) {
      const { data, error } = await db.from('succession_events').insert(row).select('*').single();
      if (error) throw error;
      return data as SuccessionEventRow;
    },

    async insertAuditEvent(row) {
      const { error } = await db.from('audit_events').insert(row);
      if (error) throw error;
    },

    async activateSuccessor({ missionAddress, successor, expectedVersion }) {
      try {
        const txHash = await wallet.writeContract({
          address: missionAddress,
          abi: MISSION_ABI,
          functionName: 'activateSuccessor',
          args: [successor, expectedVersion],
          account,
          chain: wallet.chain,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status !== 'success') throw new Error('activateSuccessor receipt failed.');
        return { txHash };
      } catch (error) {
        throw Object.assign(new Error('activateSuccessor failed.'), {
          errorName: revertName(error),
        });
      }
    },
  };
}
