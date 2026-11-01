// Succra runtime — Phase 6 initial checkpoint watcher.
//
// FR-07 requires a VERIFIED sequence=0 checkpoint at mission activation. The
// factory cannot sign as the guardian, so this watcher submits it asynchronously
// after observing an active mission whose on-chain checkpointCount is still 0.
// The stateVersion guard makes concurrent/duplicate submissions safe.
import { computeCheckpointHash } from '@succra/shared';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_INTERVAL_MS = 10_000;

export interface InitializerMission {
  id: string;
  contract_address: string | null;
  pda_address: string;
  policy_version: number;
}

export interface InitializerOnChainState {
  status: string;
  stateVersion: bigint;
  checkpointCount: bigint;
  confirmedSpentAtomic: bigint;
  maxPaymentAtomic: bigint;
  recoveryMaxPaymentAtomic: bigint;
  policyHash: string;
}

export interface InitializerAuditEvent {
  mission_id: string;
  event_type: 'checkpoint.verified';
  actor_type: 'runtime';
  actor_id: null;
  event_hash: string;
  payload_public: Record<string, unknown>;
  onchain_tx_hash: string;
}

export interface MissionCheckpointInitializerDeps {
  listActiveMissions(limit: number): Promise<InitializerMission[]>;
  readState(address: `0x${string}`): Promise<InitializerOnChainState>;
  commitCheckpoint(args: {
    missionAddress: `0x${string}`;
    sequence: bigint;
    checkpointHash: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<{ txHash: string }>;
  insertCheckpoint(row: {
    mission_id: string;
    sequence: number;
    status: 'VERIFIED';
    checkpoint_hash: string;
    confirmed_payment_ids: string[];
    confirmed_transaction_hashes: string[];
    hsp_mandate_ids: string[];
    confirmed_spent_atomic: string;
    policy_version: number;
    policy_hash: string;
    committed_tx_hash: string;
  }): Promise<void>;
  insertAuditEvent(row: InitializerAuditEvent): Promise<void>;
  now?: () => number;
  intervalMs?: number;
}

export interface InitializerResult {
  checked: number;
  initialized: number;
}

function eventHash(parts: readonly (string | number | bigint)[]): string {
  return keccak256(stringToHex(parts.map((part) => String(part)).join(':')));
}

export async function runMissionCheckpointInitializer(
  deps: MissionCheckpointInitializerDeps
): Promise<InitializerResult> {
  const missions = await deps.listActiveMissions(25);
  const result: InitializerResult = { checked: 0, initialized: 0 };
  for (const mission of missions) {
    result.checked += 1;
    const addressValue = mission.contract_address ?? mission.pda_address;
    if (!/^0x[0-9a-fA-F]{40}$/.test(addressValue)) continue;
    const missionAddress = addressValue as `0x${string}`;

    let state: InitializerOnChainState;
    try {
      state = await deps.readState(missionAddress);
    } catch {
      continue;
    }
    if (state.status !== 'ACTIVE' && state.status !== 'ACTIVE_RECOVERY') continue;
    if (state.checkpointCount !== 0n) continue;

    const createdAt = BigInt(Math.floor((deps.now ?? Date.now)() / 1000));
    const checkpointHash = computeCheckpointHash({
      missionId: mission.id,
      sequence: 0,
      confirmedPaymentIds: [],
      confirmedTxHashes: [],
      confirmedSpentAtomic: 0n,
      maxPaymentAtomic: state.maxPaymentAtomic,
      recoveryMaxPaymentAtomic: state.recoveryMaxPaymentAtomic,
      policyVersion: mission.policy_version,
      policyHash: state.policyHash,
      createdAt,
    });

    let committed: { txHash: string };
    try {
      committed = await deps.commitCheckpoint({
        missionAddress,
        sequence: 0n,
        checkpointHash,
        expectedVersion: state.stateVersion,
      });
    } catch {
      // Another initializer won, or the mission moved. The next poll re-reads.
      continue;
    }

    await deps.insertCheckpoint({
      mission_id: mission.id,
      sequence: 0,
      status: 'VERIFIED',
      checkpoint_hash: checkpointHash,
      confirmed_payment_ids: [],
      confirmed_transaction_hashes: [],
      hsp_mandate_ids: [],
      confirmed_spent_atomic: '0',
      policy_version: mission.policy_version,
      policy_hash: state.policyHash,
      committed_tx_hash: committed.txHash,
    });
    await deps.insertAuditEvent({
      mission_id: mission.id,
      event_type: 'checkpoint.verified',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([mission.id, 'checkpoint.verified', 0, checkpointHash]),
      payload_public: {
        sequence: 0,
        checkpointHash,
        txHash: committed.txHash,
        confirmedPaymentIds: [],
        confirmedTxHashes: [],
        hspMandateIds: [],
        confirmedSpentAtomic: '0',
        policyVersion: mission.policy_version,
        policyHash: state.policyHash,
      },
      onchain_tx_hash: committed.txHash,
    });
    result.initialized += 1;
  }
  return result;
}

export function startMissionCheckpointInitializer(
  deps: MissionCheckpointInitializerDeps
): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runMissionCheckpointInitializer(deps)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(timer);
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
    name: 'commitCheckpoint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'sequence', type: 'uint64' },
      { name: 'checkpointHash', type: 'bytes32' },
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

export function createProductionCheckpointInitializerDeps(): MissionCheckpointInitializerDeps {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
  const db: SupabaseClient = createClient(supabaseUrl, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const rpcUrl = process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!rpcUrl) throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  const chain = {
    id: Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? '177'),
    name: 'Succra',
    nativeCurrency: { name: 'HashKey', symbol: 'HSK', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
  const key = requiredEnv('HASHKEY_GUARDIAN_SECRET_KEY');
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  return {
    async listActiveMissions(limit) {
      const { data, error } = await db
        .from('missions')
        .select('id, contract_address, pda_address, policy_version')
        .in('status', ['ACTIVE', 'ACTIVE_RECOVERY'])
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data as InitializerMission[] | null) ?? [];
    },

    async readState(address) {
      const [config, authority] = await Promise.all([
        publicClient.readContract({ address, abi: MISSION_ABI, functionName: 'config' }),
        publicClient.readContract({ address, abi: MISSION_ABI, functionName: 'authority' }),
      ]);
      const status = STATUS_NAMES[Number(authority[1])];
      if (!status) throw new Error('Unknown mission status.');
      return {
        status,
        stateVersion: authority[3],
        checkpointCount: authority[9],
        confirmedSpentAtomic: authority[6],
        maxPaymentAtomic: config[2],
        recoveryMaxPaymentAtomic: config[3],
        policyHash: config[5],
      };
    },

    async commitCheckpoint({ missionAddress, sequence, checkpointHash, expectedVersion }) {
      const txHash = await wallet.writeContract({
        address: missionAddress,
        abi: MISSION_ABI,
        functionName: 'commitCheckpoint',
        args: [sequence, checkpointHash, expectedVersion],
        account,
        chain: wallet.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error('commitCheckpoint receipt failed.');
      return { txHash };
    },

    async insertCheckpoint(row) {
      const { error } = await db.from('mission_checkpoints').insert(row);
      if (error) throw error;
    },

    async insertAuditEvent(row) {
      const { error } = await db.from('audit_events').insert(row);
      if (error) throw error;
    },

    intervalMs: Number(process.env.CHECKPOINT_INITIALIZER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
  };
}
