// Succra runtime — Phase 5 violation recorder.
//
// Polls authenticated BLOCK rows whose reason code is a countable policy rule,
// reports each one to SuccraMission.recordViolation with a state-version guard,
// detects the threshold crossing, and submits quarantine. On-chain state is
// authoritative; the database is mirrored only after confirmation.
//
// Failures are retried on the next tick. After three failed attempts the row is
// parked as poisoned for Phase 9 alerting instead of blocking the queue.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  keccak256,
  stringToHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const COUNTABLE_VIOLATION_REASON_CODES = [
  'INVALID_ACTION_TYPE',
  'MERCHANT_NOT_ALLOWED',
  'TOKEN_NOT_ALLOWED',
  'AMOUNT_EXCEEDS_MAX',
  'BUDGET_EXHAUSTED',
] as const;

export type CountableViolationReasonCode = (typeof COUNTABLE_VIOLATION_REASON_CODES)[number];

export const VIOLATION_MAX_ATTEMPTS = 3;
const DEFAULT_INTERVAL_MS = 10_000;

export interface UnprocessedBlockedRequest {
  id: string;
  mission_id: string;
  agent_id: string;
  request_id: string;
  onchain_request_id: string;
  decision: string;
  decision_reason_code: CountableViolationReasonCode | string;
  created_at: string;
  violation_attempts: number;
  violation_poisoned: boolean;
}

export interface RecorderMission {
  id: string;
  contract_address: string | null;
  pda_address: string;
  status: string;
  current_agent_id: string | null;
}

export interface RecorderOnChainState {
  status: string;
  stateVersion: bigint;
  violationCount: number;
  violationThreshold: number;
}

export interface RecorderAuditEvent {
  mission_id: string;
  event_type: string;
  actor_type: 'runtime';
  actor_id: null;
  event_hash: string;
  payload_public: Record<string, unknown>;
  onchain_tx_hash: string | null;
}

export interface ViolationRecorderDeps {
  listUnprocessed(limit: number): Promise<UnprocessedBlockedRequest[]>;
  getMission(missionId: string): Promise<RecorderMission | null>;
  readState(missionAddress: `0x${string}`): Promise<RecorderOnChainState>;
  recordViolation(args: {
    missionAddress: `0x${string}`;
    requestId: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<{ txHash: string }>;
  quarantine(args: {
    missionAddress: `0x${string}`;
    expectedVersion: bigint;
  }): Promise<{ txHash: string }>;
  markRecorded(actionRequestId: string, txHash: string | null): Promise<void>;
  markAttemptFailed(actionRequestId: string, attempts: number, poisoned: boolean): Promise<void>;
  insertAuditEvent(row: RecorderAuditEvent): Promise<void>;
  getRecentAuditEvents(missionId: string, limit: number): Promise<Array<{ event_type: string }>>;
  updateMissionStatusToQuarantined(missionId: string): Promise<void>;
  updateCurrentAgentStatusToQuarantined(missionId: string): Promise<void>;
  now?: () => number;
  intervalMs?: number;
  maxAttempts?: number;
}

export interface ViolationRecorderResult {
  checked: number;
  recorded: number;
  quarantined: number;
  failed: number;
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as { errorName?: unknown }).errorName;
  return typeof name === 'string' ? name : undefined;
}

function eventHash(parts: readonly (string | number | bigint | null)[]): string {
  return keccak256(
    stringToHex(parts.map((part) => (part === null ? '' : String(part).toLowerCase())).join(':'))
  );
}

function executable(status: string): boolean {
  return status === 'ACTIVE' || status === 'ACTIVE_RECOVERY';
}

async function hasAuditEvent(
  deps: ViolationRecorderDeps,
  missionId: string,
  eventType: string
): Promise<boolean> {
  const events = await deps.getRecentAuditEvents(missionId, 50);
  return events.some((event) => event.event_type === eventType);
}

async function recordFailure(
  deps: ViolationRecorderDeps,
  row: UnprocessedBlockedRequest,
  maxAttempts: number
): Promise<void> {
  const attempts = (row.violation_attempts ?? 0) + 1;
  await deps.markAttemptFailed(row.id, attempts, attempts >= maxAttempts);
}

async function quarantineCrossedMission(args: {
  deps: ViolationRecorderDeps;
  row: UnprocessedBlockedRequest;
  mission: RecorderMission;
  missionAddress: `0x${string}`;
  state: RecorderOnChainState;
}): Promise<{ quarantined: boolean; txHash: string | null }> {
  const { deps, row, mission, missionAddress, state } = args;
  if (state.status === 'QUARANTINED') {
    await deps.updateMissionStatusToQuarantined(mission.id);
    await deps.updateCurrentAgentStatusToQuarantined(mission.id);
    return { quarantined: true, txHash: null };
  }

  const thresholdPayload = {
    violationCount: state.violationCount,
    violationThreshold: state.violationThreshold,
    stateVersion: state.stateVersion.toString(),
  };
  if (!(await hasAuditEvent(deps, mission.id, 'violation.threshold_reached'))) {
    await deps.insertAuditEvent({
      mission_id: mission.id,
      event_type: 'violation.threshold_reached',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([mission.id, 'violation.threshold_reached', state.violationCount]),
      payload_public: thresholdPayload,
      onchain_tx_hash: null,
    });
  }

  let txHash: string;
  try {
    const result = await deps.quarantine({
      missionAddress,
      expectedVersion: state.stateVersion,
    });
    txHash = result.txHash;
  } catch (error) {
    const name = errorName(error);
    if (name === 'AlreadyQuarantined' || name === 'InvalidStatus') {
      const latest = await deps.readState(missionAddress).catch(() => null);
      if (latest?.status === 'QUARANTINED') {
        await deps.updateMissionStatusToQuarantined(mission.id);
        await deps.updateCurrentAgentStatusToQuarantined(mission.id);
        return { quarantined: true, txHash: null };
      }
    }
    await recordFailure(deps, row, deps.maxAttempts ?? VIOLATION_MAX_ATTEMPTS);
    return { quarantined: false, txHash: null };
  }

  const payload = { ...thresholdPayload, txHash };
  if (!(await hasAuditEvent(deps, mission.id, 'quarantine.submitted'))) {
    await deps.insertAuditEvent({
      mission_id: mission.id,
      event_type: 'quarantine.submitted',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([mission.id, 'quarantine.submitted', txHash]),
      payload_public: payload,
      onchain_tx_hash: txHash,
    });
  }
  if (!(await hasAuditEvent(deps, mission.id, 'quarantine.confirmed'))) {
    await deps.insertAuditEvent({
      mission_id: mission.id,
      event_type: 'quarantine.confirmed',
      actor_type: 'runtime',
      actor_id: null,
      event_hash: eventHash([mission.id, 'quarantine.confirmed', txHash]),
      payload_public: payload,
      onchain_tx_hash: txHash,
    });
  }
  await deps.updateMissionStatusToQuarantined(mission.id);
  await deps.updateCurrentAgentStatusToQuarantined(mission.id);
  return { quarantined: true, txHash };
}

/** One recorder pass. Safe to call repeatedly: processed rows are filtered out. */
export async function runViolationRecorder(
  deps: ViolationRecorderDeps
): Promise<ViolationRecorderResult> {
  const maxAttempts = deps.maxAttempts ?? VIOLATION_MAX_ATTEMPTS;
  const rows = await deps.listUnprocessed(25);
  const result: ViolationRecorderResult = {
    checked: 0,
    recorded: 0,
    quarantined: 0,
    failed: 0,
  };

  for (const row of rows) {
    result.checked += 1;
    const mission = await deps.getMission(row.mission_id);
    if (!mission) {
      await recordFailure(deps, row, maxAttempts);
      result.failed += 1;
      continue;
    }
    const missionAddressValue = mission.contract_address ?? mission.pda_address;
    if (!isAddress(missionAddressValue)) {
      await recordFailure(deps, row, maxAttempts);
      result.failed += 1;
      continue;
    }
    const missionAddress = missionAddressValue as `0x${string}`;

    let state: RecorderOnChainState;
    try {
      state = await deps.readState(missionAddress);
    } catch {
      await recordFailure(deps, row, maxAttempts);
      result.failed += 1;
      continue;
    }
    if (!executable(state.status)) {
      await recordFailure(deps, row, maxAttempts);
      result.failed += 1;
      continue;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(row.onchain_request_id)) {
      await recordFailure(deps, row, maxAttempts);
      result.failed += 1;
      continue;
    }

    let txHash: string | null = null;
    try {
      const recorded = await deps.recordViolation({
        missionAddress,
        requestId: row.onchain_request_id as `0x${string}`,
        expectedVersion: state.stateVersion,
      });
      txHash = recorded.txHash;
    } catch (error) {
      if (errorName(error) !== 'ViolationAlreadyRecorded') {
        await recordFailure(deps, row, maxAttempts);
        result.failed += 1;
        continue;
      }
    }

    let latest: RecorderOnChainState;
    try {
      latest = await deps.readState(missionAddress);
    } catch {
      await recordFailure(deps, row, maxAttempts);
      result.failed += 1;
      continue;
    }

    if (latest.violationCount >= latest.violationThreshold) {
      const quarantine = await quarantineCrossedMission({
        deps,
        row,
        mission,
        missionAddress,
        state: latest,
      });
      if (!quarantine.quarantined) {
        result.failed += 1;
        continue;
      }
      await deps.markRecorded(row.id, txHash);
      result.recorded += 1;
      result.quarantined += 1;
      continue;
    }

    await deps.markRecorded(row.id, txHash);
    result.recorded += 1;
  }

  return result;
}

/** Starts the 10s loop (configurable). Returns a stop function. */
export function startViolationRecorder(deps: ViolationRecorderDeps): () => void {
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void runViolationRecorder(deps)
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
    ],
  },
  {
    type: 'function',
    name: 'recordViolation',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'requestId', type: 'bytes32' },
      { name: 'expectedVersion', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'quarantine',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'expectedVersion', type: 'uint64' }],
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

function revertName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    return revert.data?.errorName;
  }
  return undefined;
}

function chainConfig() {
  const url = process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!url) throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  const chainId = Number(process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID ?? '177');
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('NEXT_PUBLIC_HASHKEY_CHAIN_ID must be a positive integer.');
  }
  return {
    url,
    chain: {
      id: chainId,
      name: 'Succra',
      nativeCurrency: { name: 'HashKey', symbol: 'HSK', decimals: 18 },
      rpcUrls: { default: { http: [url] } },
    },
  };
}

function supabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.');
  return createClient(url, requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createProductionViolationRecorderDeps(): ViolationRecorderDeps {
  const db = supabaseClient();
  const { chain, url } = chainConfig();
  const privateKey = requiredEnv('HASHKEY_GUARDIAN_SECRET_KEY');
  const account = privateKeyToAccount(
    (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`
  );
  const publicClient = createPublicClient({ chain, transport: http(url) });
  const wallet = createWalletClient({ account, chain, transport: http(url) });

  async function waitForWrite(
    label: string,
    send: () => Promise<`0x${string}`>
  ): Promise<{ txHash: string }> {
    try {
      const txHash = await send();
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error(`${label} receipt failed.`);
      return { txHash };
    } catch (error) {
      const name = revertName(error);
      throw Object.assign(new Error(`${label} failed.`), { errorName: name });
    }
  }

  return {
    async listUnprocessed(limit) {
      const { data, error } = await db
        .from('action_requests')
        .select('*')
        .eq('decision', 'BLOCK')
        .in('decision_reason_code', [...COUNTABLE_VIOLATION_REASON_CODES])
        .is('violation_recorded_at', null)
        .eq('violation_poisoned', false)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data as UnprocessedBlockedRequest[] | null) ?? [];
    },

    async getMission(missionId) {
      const { data, error } = await db
        .from('missions')
        .select('id, contract_address, pda_address, status, current_agent_id')
        .eq('id', missionId)
        .maybeSingle();
      if (error) throw error;
      return (data as RecorderMission | null) ?? null;
    },

    async readState(missionAddress) {
      const [config, authority] = await Promise.all([
        publicClient.readContract({
          address: missionAddress,
          abi: MISSION_ABI,
          functionName: 'config',
        }),
        publicClient.readContract({
          address: missionAddress,
          abi: MISSION_ABI,
          functionName: 'authority',
        }),
      ]);
      const status = STATUS_NAMES[Number(authority[1])];
      if (!status) throw new Error('Mission returned an unknown status.');
      return {
        status,
        stateVersion: authority[3],
        violationCount: Number(authority[4]),
        violationThreshold: Number(config[7]),
      };
    },

    recordViolation({ missionAddress, requestId, expectedVersion }) {
      return waitForWrite('recordViolation', () =>
        wallet.writeContract({
          address: missionAddress,
          abi: MISSION_ABI,
          functionName: 'recordViolation',
          args: [requestId, expectedVersion],
          account,
          chain: wallet.chain,
        })
      );
    },

    quarantine({ missionAddress, expectedVersion }) {
      return waitForWrite('quarantine', () =>
        wallet.writeContract({
          address: missionAddress,
          abi: MISSION_ABI,
          functionName: 'quarantine',
          args: [expectedVersion],
          account,
          chain: wallet.chain,
        })
      );
    },

    async markRecorded(actionRequestId, txHash) {
      const { error } = await db
        .from('action_requests')
        .update({
          violation_recorded_at: new Date().toISOString(),
          violation_recorded_tx_hash: txHash,
        })
        .eq('id', actionRequestId);
      if (error) throw error;
    },

    async markAttemptFailed(actionRequestId, attempts, poisoned) {
      const { error } = await db
        .from('action_requests')
        .update({ violation_attempts: attempts, violation_poisoned: poisoned })
        .eq('id', actionRequestId);
      if (error) throw error;
    },

    async insertAuditEvent(row) {
      const { error } = await db.from('audit_events').insert(row);
      if (error) throw error;
    },

    async getRecentAuditEvents(missionId, limit) {
      const { data, error } = await db
        .from('audit_events')
        .select('event_type')
        .eq('mission_id', missionId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as Array<{ event_type: string }> | null) ?? [];
    },

    async updateMissionStatusToQuarantined(missionId) {
      const { error } = await db
        .from('missions')
        .update({ status: 'QUARANTINED', updated_at: new Date().toISOString() })
        .eq('id', missionId);
      if (error) throw error;
    },

    async updateCurrentAgentStatusToQuarantined(missionId) {
      const { data, error } = await db
        .from('missions')
        .select('current_agent_id')
        .eq('id', missionId)
        .maybeSingle();
      if (error) throw error;
      const currentAgentId = (data as { current_agent_id?: string | null } | null)
        ?.current_agent_id;
      let query = db
        .from('mission_agents')
        .update({ status: 'QUARANTINED' })
        .eq('mission_id', missionId);
      query = currentAgentId ? query.eq('agent_id', currentAgentId) : query.eq('role', 'PRIMARY');
      const result = await query;
      if (result.error) throw result.error;
    },

    intervalMs: Number(process.env.VIOLATION_RECORDER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS),
  };
}
