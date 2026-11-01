// Phase 6 golden-path integration on a REAL Hardhat node.
//
// Proves: initial sequence=0 checkpoint -> settlement checkpoint -> three
// violations -> real quarantine -> succession activation -> signed ACK ->
// recovery payment with the reduced ceiling -> next checkpoint. The HSP mock
// supplies the settlement status; all authority/checkpoint/succession calls hit
// the deployed contracts.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  type Abi,
  type Chain,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { computeRecoveryAckDigest } from '@succra/shared';
import { createPhase6TestDb } from '../../apps/web/tests/helpers/pglite-gateway-store';
import { readMissionState } from '../../apps/web/lib/gateway/contract-reader';
import { writeCheckpoint } from '../../apps/web/lib/gateway/checkpoint-writer';
import { runMissionCheckpointInitializer } from '../../apps/runtime/src/monitor/mission-checkpoint-initializer';
import {
  runSuccessionEngine,
  type SuccessionEngineDeps,
} from '../../apps/runtime/src/succession/succession-engine';
import {
  runViolationRecorder,
  type ViolationRecorderDeps,
} from '../../apps/runtime/src/monitor/violation-recorder';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHAIN_ID = 31337;
const GUARDIAN = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
);
const DEPLOYER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
);
const ALPHA = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
);
const BETA = privateKeyToAccount(
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
);
const GAMMA = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba'
);
const TOKEN = `0x${'77'.repeat(20)}` as const;
const MERCHANT = `0x${'88'.repeat(20)}` as const;

function chainObject(url: string): Chain {
  return {
    id: CHAIN_ID,
    name: 'Hardhat',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForRpc(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (response.ok) return;
    } catch {
      // retry
    }
    if (Date.now() >= deadline) throw new Error('Hardhat node did not start in time.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForReceipt(publicClient: ReturnType<typeof createPublicClient>, hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Transaction failed.');
  return receipt;
}

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const path = join(ROOT, 'contracts', 'artifacts', 'src', `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: Hex };
  return { abi: json.abi, bytecode: json.bytecode };
}

describe('Phase 6 succession end-to-end', () => {
  let node: ChildProcess | undefined;
  let db: PGlite;
  let url: string;
  let registryAddress: `0x${string}`;
  let factoryAddress: `0x${string}`;
  let guardianWallet: ReturnType<typeof createWalletClient>;
  let publicClient: ReturnType<typeof createPublicClient>;
  let missionAbi: Abi;
  let factoryAbi: Abi;
  let ownerId: string;
  let alphaId: string;
  let betaId: string;
  let gammaId: string;

  beforeAll(async () => {
    execFileSync('pnpm', ['--filter', '@succra/contracts', 'build'], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    const port = await freePort();
    node = spawn(
      'pnpm',
      [
        '--filter',
        '@succra/contracts',
        'exec',
        'hardhat',
        'node',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      { cwd: ROOT, stdio: 'ignore' }
    );
    url = `http://127.0.0.1:${port}`;
    await waitForRpc(url);
    const chain = chainObject(url);
    publicClient = createPublicClient({ chain, transport: http(url) });
    const deployWallet = createWalletClient({ chain, transport: http(url), account: DEPLOYER });
    guardianWallet = createWalletClient({ chain, transport: http(url), account: GUARDIAN });

    const registryArtifact = artifact('GuardianRegistry');
    const registryHash = await deployWallet.deployContract({
      abi: registryArtifact.abi,
      bytecode: registryArtifact.bytecode,
      args: [GUARDIAN.address],
    });
    const registryReceipt = await waitForReceipt(publicClient, registryHash);
    registryAddress = registryReceipt.contractAddress as `0x${string}`;

    const factoryArtifact = artifact('MissionFactory');
    factoryAbi = factoryArtifact.abi;
    const factoryHash = await deployWallet.deployContract({
      abi: factoryArtifact.abi,
      bytecode: factoryArtifact.bytecode,
      args: [registryAddress],
    });
    const factoryReceipt = await waitForReceipt(publicClient, factoryHash);
    factoryAddress = factoryReceipt.contractAddress as `0x${string}`;
    missionAbi = artifact('SuccraMission').abi;

    db = await createPhase6TestDb();
    ownerId = randomUUID();
    alphaId = randomUUID();
    betaId = randomUUID();
    gammaId = randomUUID();
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
    await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
      ownerId,
      DEPLOYER.address,
    ]);
    for (const [id, address] of [
      [alphaId, ALPHA.address],
      [betaId, BETA.address],
      [gammaId, GAMMA.address],
    ] as const) {
      await db.query(
        `INSERT INTO agents (id, owner_id, name, address, public_key, status)
         VALUES ($1,$2,$3,$4,$4,'REGISTERED')`,
        [id, ownerId, `agent-${address.slice(2, 6)}`, address]
      );
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    if (node?.pid) {
      try {
        execFileSync('pkill', ['-P', String(node.pid)]);
      } catch {
        // The child may already be gone.
      }
      node.kill('SIGKILL');
    }
  });

  function one(sql: string, params: unknown[] = []) {
    return db.query<Record<string, unknown>>(sql, params).then((result) => result.rows[0] ?? null);
  }

  async function insertAudit(row: {
    mission_id: string;
    event_type: string;
    actor_type: string;
    actor_id: string | null;
    event_hash: string;
    payload_public: Record<string, unknown>;
    onchain_tx_hash?: string | null;
  }) {
    await db.query(
      `INSERT INTO audit_events
         (mission_id, event_type, actor_type, actor_id, event_hash, payload_public, onchain_tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        row.mission_id,
        row.event_type,
        row.actor_type,
        row.actor_id,
        row.event_hash,
        JSON.stringify(row.payload_public),
        row.onchain_tx_hash ?? null,
      ]
    );
  }

  async function getState(missionAddress: `0x${string}`) {
    return readMissionState(missionAddress, { client: publicClient as never });
  }

  interface World {
    missionId: string;
    missionAddress: `0x${string}`;
    successors: 'two' | 'none' | 'betaOnly';
    [key: string]: unknown;
  }

  async function createWorld(successors: 'two' | 'none' | 'betaOnly'): Promise<World> {
    const missionId = randomUUID();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const configured =
      successors === 'none'
        ? []
        : successors === 'betaOnly'
          ? [{ agent: BETA.address, priority: 1, active: true }]
          : [
              { agent: BETA.address, priority: 1, active: true },
              { agent: GAMMA.address, priority: 2, active: true },
            ];
    const config = {
      paymentToken: TOKEN,
      budgetAtomic: 1000n,
      maxPaymentAtomic: 400n,
      recoveryMaxPaymentAtomic: 100n,
      merchantAllowlist: [MERCHANT],
      expiresAt: now + 3_600n,
      policyHash: keccak256(toHex(`policy-${missionId}`)),
      primaryAgent: ALPHA.address,
      successors: configured,
      violationThreshold: 3,
      violationWindowSeconds: 900n,
      cartMandateHash: keccak256(toHex(`cart-${missionId}`)),
    };
    const createHash = await guardianWallet.writeContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: 'createMission',
      args: [config],
      account: DEPLOYER,
    });
    await waitForReceipt(publicClient, createHash);
    const total = (await publicClient.readContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: 'totalMissions',
    })) as bigint;
    const missionAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: 'getMissionAt',
      args: [total - 1n],
    })) as `0x${string}`;

    await db.query(
      `INSERT INTO missions
         (id, owner_id, name, objective, pda_address, vault_address, mint_address,
          budget_atomic, remaining_budget_atomic, status, current_agent_id,
          current_agent_public_key, policy_version, policy_hash, expires_at,
          contract_address, factory_address, owner_address, payment_token_address,
          current_agent_address)
       VALUES ($1,$2,'Phase 6','Succession',$3,$10,$4,'1000','1000','ACTIVE',$5,
          $6,1,$7,now() + interval '1 hour',$3,$8,$9,$4,$6)`,
      [
        missionId,
        ownerId,
        missionAddress,
        TOKEN,
        alphaId,
        ALPHA.address,
        config.policyHash,
        factoryAddress,
        DEPLOYER.address,
        `vault-${missionId}`,
      ]
    );
    await db.query(
      `INSERT INTO mission_agents (mission_id, agent_id, role, priority, status)
       VALUES ($1,$2,'PRIMARY',NULL,'ACTIVE_PRIMARY')`,
      [missionId, alphaId]
    );
    for (const successor of configured) {
      await db.query(
        `INSERT INTO mission_agents (mission_id, agent_id, role, priority, status)
         VALUES ($1,$2,'SUCCESSOR',$3,'ACTIVE_SUCCESSOR')`,
        [missionId, successor.agent === BETA.address ? betaId : gammaId, successor.priority]
      );
    }
    return { missionId, missionAddress, successors };
  }

  function initializerDeps() {
    return {
      listActiveMissions: async (limit: number) => {
        const result = await db.query<Record<string, unknown>>(
          `SELECT id, contract_address, pda_address, policy_version FROM missions
           WHERE status IN ('ACTIVE','ACTIVE_RECOVERY') ORDER BY created_at ASC LIMIT $1`,
          [limit]
        );
        return result.rows as never;
      },
      readState: async (address: `0x${string}`) => {
        const state = await getState(address);
        return {
          status: state.status,
          stateVersion: state.stateVersion,
          checkpointCount: state.checkpointCount,
          confirmedSpentAtomic: state.confirmedSpentAtomic,
          maxPaymentAtomic: state.maxPaymentAtomic,
          recoveryMaxPaymentAtomic: state.recoveryMaxPaymentAtomic,
          policyHash: state.policyHash,
        };
      },
      commitCheckpoint: async (args: {
        missionAddress: `0x${string}`;
        sequence: bigint;
        checkpointHash: `0x${string}`;
        expectedVersion: bigint;
      }) => {
        const txHash = await guardianWallet.writeContract({
          address: args.missionAddress,
          abi: missionAbi,
          functionName: 'commitCheckpoint',
          args: [args.sequence, args.checkpointHash, args.expectedVersion],
          account: GUARDIAN,
        });
        await waitForReceipt(publicClient, txHash);
        return { txHash };
      },
      insertCheckpoint: async (row: Record<string, unknown>) => {
        await db.query(
          `INSERT INTO mission_checkpoints
             (mission_id, sequence, status, checkpoint_hash, confirmed_payment_ids,
              confirmed_transaction_hashes, hsp_mandate_ids, confirmed_spent_atomic,
              policy_version, policy_hash, committed_tx_hash)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
          [
            row['mission_id'],
            row['sequence'],
            row['status'],
            row['checkpoint_hash'],
            JSON.stringify(row['confirmed_payment_ids']),
            JSON.stringify(row['confirmed_transaction_hashes']),
            JSON.stringify(row['hsp_mandate_ids']),
            row['confirmed_spent_atomic'],
            row['policy_version'],
            row['policy_hash'],
            row['committed_tx_hash'],
          ]
        );
      },
      insertAuditEvent: insertAudit,
    };
  }

  function checkpointDeps() {
    return {
      getMission: async (missionId: string) => {
        const row = await one(
          'SELECT id, contract_address, pda_address, policy_version, policy_hash FROM missions WHERE id = $1',
          [missionId]
        );
        return row as never;
      },
      readState: getState,
      listConfirmedPayments: async (missionId: string) => {
        const result = await db.query<Record<string, unknown>>(
          `SELECT hsp_payment_mandate_id, settlement_tx_hash FROM hsp_payments
           WHERE mission_id = $1 AND status = 'CONFIRMED' ORDER BY created_at ASC`,
          [missionId]
        );
        return result.rows as never;
      },
      commitCheckpoint: initializerDeps().commitCheckpoint,
      insertCheckpoint: initializerDeps().insertCheckpoint,
      insertAuditEvent: insertAudit,
    };
  }

  function successionDeps(
    triggerType: 'quarantine' | 'owner_manual' = 'quarantine'
  ): SuccessionEngineDeps {
    void triggerType;
    return {
      getMission: async (missionId: string) => {
        const row = await one(
          `SELECT id, contract_address, pda_address, current_agent_id, current_agent_address
           FROM missions WHERE id = $1`,
          [missionId]
        );
        return row as never;
      },
      readState: async (address: `0x${string}`) => {
        const state = await getState(address);
        return {
          status: state.status,
          stateVersion: state.stateVersion,
          currentAgent: state.currentAgent,
          recoveryMaxPaymentAtomic: state.recoveryMaxPaymentAtomic,
          successors: state.successors,
        };
      },
      listCandidates: async (missionId: string) => {
        const result = await db.query<Record<string, unknown>>(
          `SELECT ma.id AS mission_agent_id, ma.agent_id, ma.priority, ma.status,
                  ma.required_capabilities, a.address, a.capabilities
           FROM mission_agents ma JOIN agents a ON a.id = ma.agent_id
           WHERE ma.mission_id = $1 AND ma.role = 'SUCCESSOR'
             AND ma.status IN ('REGISTERED','ACTIVE_SUCCESSOR')`,
          [missionId]
        );
        return result.rows.map((row) => ({
          missionAgentId: String(row['mission_agent_id']),
          agentId: String(row['agent_id']),
          address: String(row['address']),
          priority: row['priority'] === null ? null : Number(row['priority']),
          status: String(row['status']),
          capabilities: Array.isArray(row['capabilities']) ? row['capabilities'] : [],
          requiredCapabilities: Array.isArray(row['required_capabilities'])
            ? row['required_capabilities']
            : [],
        }));
      },
      getLatestVerifiedCheckpoint: async (missionId: string) => {
        const row = await one(
          `SELECT sequence, checkpoint_hash FROM mission_checkpoints
           WHERE mission_id = $1 AND status = 'VERIFIED'
           ORDER BY sequence DESC LIMIT 1`,
          [missionId]
        );
        return row
          ? { sequence: Number(row['sequence']), checkpoint_hash: String(row['checkpoint_hash']) }
          : null;
      },
      getPendingSuccession: async (missionId: string) => {
        const row = await one(
          `SELECT id, to_agent_address, activation_tx_hash, checkpoint_hash, checkpoint_sequence
           FROM succession_events WHERE mission_id = $1 AND status = 'PENDING_ACK'`,
          [missionId]
        );
        return row as never;
      },
      failPendingSuccession: async (successionId: string) => {
        await db.query("UPDATE succession_events SET status = 'FAILED' WHERE id = $1", [
          successionId,
        ]);
      },
      insertSuccessionEvent: async (row: Record<string, unknown>) => {
        const inserted = await one(
          `INSERT INTO succession_events
             (mission_id, from_agent_id, from_agent_address, to_agent_id, to_agent_address,
              trigger_type, checkpoint_hash, checkpoint_sequence, recovery_max_payment_atomic,
              status, activation_tx_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            row['mission_id'],
            row['from_agent_id'],
            row['from_agent_address'],
            row['to_agent_id'],
            row['to_agent_address'],
            row['trigger_type'],
            row['checkpoint_hash'],
            row['checkpoint_sequence'],
            row['recovery_max_payment_atomic'],
            row['status'],
            row['activation_tx_hash'],
          ]
        );
        return inserted as never;
      },
      insertAuditEvent: insertAudit,
      activateSuccessor: async (args: {
        missionAddress: `0x${string}`;
        successor: `0x${string}`;
        expectedVersion: bigint;
      }) => {
        const txHash = await guardianWallet.writeContract({
          address: args.missionAddress,
          abi: missionAbi,
          functionName: 'activateSuccessor',
          args: [args.successor, args.expectedVersion],
          account: GUARDIAN,
        });
        await waitForReceipt(publicClient, txHash);
        return { txHash };
      },
    };
  }

  function recorderDeps(): ViolationRecorderDeps {
    return {
      listUnprocessed: async (limit: number) => {
        const result = await db.query<Record<string, unknown>>(
          `SELECT * FROM action_requests
           WHERE decision = 'BLOCK'
             AND decision_reason_code IN ('INVALID_ACTION_TYPE','MERCHANT_NOT_ALLOWED',
               'TOKEN_NOT_ALLOWED','AMOUNT_EXCEEDS_MAX','BUDGET_EXHAUSTED')
             AND violation_recorded_at IS NULL AND violation_poisoned = false
           ORDER BY created_at ASC LIMIT $1`,
          [limit]
        );
        return result.rows as never;
      },
      getMission: async (missionId: string) => {
        const row = await one(
          `SELECT id, contract_address, pda_address, status, current_agent_id
           FROM missions WHERE id = $1`,
          [missionId]
        );
        return row as never;
      },
      readState: async (address: `0x${string}`) => {
        const state = await getState(address);
        return {
          status: state.status,
          stateVersion: state.stateVersion,
          violationCount: state.violationCount,
          violationThreshold: state.violationThreshold,
        };
      },
      recordViolation: async (args: {
        missionAddress: `0x${string}`;
        requestId: `0x${string}`;
        expectedVersion: bigint;
      }) => {
        const txHash = await guardianWallet.writeContract({
          address: args.missionAddress,
          abi: missionAbi,
          functionName: 'recordViolation',
          args: [args.requestId, args.expectedVersion],
          account: GUARDIAN,
        });
        await waitForReceipt(publicClient, txHash);
        return { txHash };
      },
      quarantine: async (args: { missionAddress: `0x${string}`; expectedVersion: bigint }) => {
        const txHash = await guardianWallet.writeContract({
          address: args.missionAddress,
          abi: missionAbi,
          functionName: 'quarantine',
          args: [args.expectedVersion],
          account: GUARDIAN,
        });
        await waitForReceipt(publicClient, txHash);
        return { txHash };
      },
      markRecorded: async (actionRequestId: string, txHash: string | null) => {
        await db.query(
          `UPDATE action_requests SET violation_recorded_at = now(),
             violation_recorded_tx_hash = $2 WHERE id = $1`,
          [actionRequestId, txHash]
        );
      },
      markAttemptFailed: async (actionRequestId: string, attempts: number, poisoned: boolean) => {
        await db.query(
          'UPDATE action_requests SET violation_attempts = $2, violation_poisoned = $3 WHERE id = $1',
          [actionRequestId, attempts, poisoned]
        );
      },
      insertAuditEvent: insertAudit,
      getRecentAuditEvents: async (missionId: string) => {
        const result = await db.query<{ event_type: string }>(
          'SELECT event_type FROM audit_events WHERE mission_id = $1 ORDER BY created_at DESC LIMIT 50',
          [missionId]
        );
        return result.rows;
      },
      getAgentAddress: async (agentId: string) => {
        const row = await one('SELECT address FROM agents WHERE id = $1', [agentId]);
        return row ? String(row['address']) : null;
      },
      updateMissionStatusToQuarantined: async (missionId: string) => {
        await db.query("UPDATE missions SET status = 'QUARANTINED' WHERE id = $1", [missionId]);
      },
      updateCurrentAgentStatusToQuarantined: async (missionId: string) => {
        await db.query(
          "UPDATE mission_agents SET status = 'QUARANTINED' WHERE mission_id = $1 AND role = 'PRIMARY'",
          [missionId]
        );
      },
      triggerSuccession: async (missionId: string) => {
        await runSuccessionEngine(successionDeps('quarantine'), missionId, {
          triggerType: 'quarantine',
        });
      },
    };
  }

  async function insertBlocked(world: World, reasonCode: string, index: number) {
    const actionId = randomUUID();
    const requestId = randomUUID();
    const onchainRequestId = `0x${String(index).padStart(64, '0')}`;
    await db.query(
      `INSERT INTO action_requests
         (id, mission_id, agent_id, idempotency_key, request_id, onchain_request_id,
          agent_nonce, action_type, payload, request_hash, signature, decision,
          decision_reason_code, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'HSP_PAYMENT','{}'::jsonb,'hash','sig','BLOCK',$8,
          now() + interval '1 hour')`,
      [
        actionId,
        world.missionId,
        alphaId,
        `idem-${index}`,
        requestId,
        onchainRequestId,
        index,
        reasonCode,
      ]
    );
  }

  async function insertConfirmedPayment(
    world: World,
    mandateId: string,
    txHash: string,
    amount: string
  ) {
    const actionId = randomUUID();
    await db.query(
      `INSERT INTO action_requests
         (id, mission_id, agent_id, idempotency_key, request_id, onchain_request_id,
          agent_nonce, action_type, payload, request_hash, signature, decision,
          decision_reason_code, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'HSP_PAYMENT','{}'::jsonb,'hash','sig','ALLOW',NULL,
          now() + interval '1 hour')`,
      [
        actionId,
        world.missionId,
        alphaId,
        `payment-${mandateId}`,
        randomUUID(),
        txHash,
        randomInt(1_000_000, 2_000_000_000),
      ]
    );
    await db.query(
      `INSERT INTO hsp_payments
         (mission_id, action_request_id, hsp_payment_mandate_id, mandate_hash,
          amount_atomic, token_address, merchant_address, status, settlement_tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',$8)`,
      [world.missionId, actionId, mandateId, txHash, amount, TOKEN, MERCHANT, txHash]
    );
  }

  async function authorizeAndSettle(
    world: World,
    account: typeof ALPHA,
    amount: bigint,
    nonce: bigint,
    label: string
  ) {
    const mandateHash = keccak256(toHex(label));
    const agentSignature = await account.sign({ hash: mandateHash });
    let state = await getState(world.missionAddress);
    let txHash = await guardianWallet.writeContract({
      address: world.missionAddress,
      abi: missionAbi,
      functionName: 'authorizePayment',
      args: [
        {
          requestId: keccak256(toHex(`request-${label}`)),
          agent: account.address,
          merchant: MERCHANT,
          token: TOKEN,
          amountAtomic: amount,
          paymentNonce: nonce,
          expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
          mandateHash,
          agentSignature,
        },
        state.stateVersion,
      ],
      account: GUARDIAN,
    });
    await waitForReceipt(publicClient, txHash);
    state = await getState(world.missionAddress);
    const settlementTx = keccak256(toHex(`settlement-${label}`));
    txHash = await guardianWallet.writeContract({
      address: world.missionAddress,
      abi: missionAbi,
      functionName: 'recordSettlement',
      args: [keccak256(toHex(`request-${label}`)), amount, settlementTx, state.stateVersion],
      account: GUARDIAN,
    });
    await waitForReceipt(publicClient, txHash);
    await insertConfirmedPayment(world, `mandate-${label}`, settlementTx, amount.toString());
    state = await getState(world.missionAddress);
    return { settlementTx, stateVersion: state.stateVersion };
  }

  it('runs settlement -> checkpoint -> quarantine -> succession -> ACK -> recovery payment', async () => {
    const world = await createWorld('two');
    await runMissionCheckpointInitializer(initializerDeps() as never);
    let state = await getState(world.missionAddress);
    expect(state.checkpointCount).toEqual(1n);
    expect(state.lastCheckpointSequence).toEqual(0n);

    const first = await authorizeAndSettle(world, ALPHA, 50n, 1n, 'alpha-1');
    const checkpoint1 = await writeCheckpoint(
      world.missionId,
      first.stateVersion,
      checkpointDeps() as never
    );
    expect(checkpoint1.sequence).toEqual(1);
    state = await getState(world.missionAddress);
    expect(state.checkpointCount).toEqual(2n);
    expect(state.confirmedSpentAtomic).toEqual(50n);

    for (let index = 1; index <= 3; index += 1) {
      await insertBlocked(world, 'MERCHANT_NOT_ALLOWED', index);
    }
    await runViolationRecorder(recorderDeps());
    state = await getState(world.missionAddress);
    expect(state.status).toEqual('RECOVERING');
    expect(state.currentAgent).toEqual(BETA.address);

    const pending = await one(
      "SELECT * FROM succession_events WHERE mission_id = $1 AND status = 'PENDING_ACK'",
      [world.missionId]
    );
    expect(pending?.['to_agent_address']).toEqual(BETA.address);

    const ackVersion = state.stateVersion;
    const ackSignature = await BETA.sign({
      hash: computeRecoveryAckDigest({
        missionAddress: world.missionAddress,
        expectedVersion: ackVersion,
      }),
    });
    const ackTx = await guardianWallet.writeContract({
      address: world.missionAddress,
      abi: missionAbi,
      functionName: 'acknowledgeRecovery',
      args: [ackVersion, ackSignature],
      account: GUARDIAN,
    });
    await waitForReceipt(publicClient, ackTx);
    await db.query(
      `UPDATE succession_events SET status = 'ACKNOWLEDGED',
         acknowledgement_tx_hash = $2, acknowledged_at = now() WHERE id = $1`,
      [String(pending?.['id']), ackTx]
    );
    await db.query(
      "UPDATE mission_agents SET status = 'REVOKED' WHERE mission_id = $1 AND agent_id = $2",
      [world.missionId, alphaId]
    );
    await db.query(
      "UPDATE mission_agents SET status = 'ACTIVE_PRIMARY' WHERE mission_id = $1 AND agent_id = $2",
      [world.missionId, betaId]
    );
    await db.query(
      "UPDATE missions SET status = 'ACTIVE_RECOVERY', current_agent_id = $2, current_agent_address = $3 WHERE id = $1",
      [world.missionId, betaId, BETA.address]
    );

    state = await getState(world.missionAddress);
    expect(state.status).toEqual('ACTIVE_RECOVERY');
    expect(state.currentAgent).toEqual(BETA.address);

    const second = await authorizeAndSettle(world, BETA, 100n, 1n, 'beta-1');
    const checkpoint2 = await writeCheckpoint(
      world.missionId,
      second.stateVersion,
      checkpointDeps() as never
    );
    expect(checkpoint2.sequence).toEqual(2);
    state = await getState(world.missionAddress);
    expect(state.checkpointCount).toEqual(3n);
    expect(state.confirmedSpentAtomic).toEqual(150n);
    expect(state.status).toEqual('ACTIVE_RECOVERY');

    const over = await authorizeAndSettle(world, BETA, 101n, 2n, 'beta-over').catch(
      (error: unknown) => error
    );
    expect(String(over)).toMatch(/InvalidAmount|exceeds/);
  }, 180_000);

  it('manual owner quarantine activates the approved successor', async () => {
    const world = await createWorld('betaOnly');
    await runMissionCheckpointInitializer(initializerDeps() as never);
    const state = await getState(world.missionAddress);
    const quarantineTx = await guardianWallet.writeContract({
      address: world.missionAddress,
      abi: missionAbi,
      functionName: 'quarantine',
      args: [state.stateVersion],
      account: DEPLOYER,
    });
    await waitForReceipt(publicClient, quarantineTx);
    const result = await runSuccessionEngine(successionDeps('owner_manual'), world.missionId, {
      triggerType: 'owner_manual',
    });
    expect(result.outcome).toEqual('ACTIVATED');
    expect((await getState(world.missionAddress)).currentAgent).toEqual(BETA.address);
  }, 120_000);

  it('keeps the mission QUARANTINED when no successor is eligible', async () => {
    const world = await createWorld('none');
    await runMissionCheckpointInitializer(initializerDeps() as never);
    const state = await getState(world.missionAddress);
    const quarantineTx = await guardianWallet.writeContract({
      address: world.missionAddress,
      abi: missionAbi,
      functionName: 'quarantine',
      args: [state.stateVersion],
      account: GUARDIAN,
    });
    await waitForReceipt(publicClient, quarantineTx);
    const result = await runSuccessionEngine(successionDeps(), world.missionId);
    expect(result.outcome).toEqual('NO_ELIGIBLE');
    expect((await getState(world.missionAddress)).status).toEqual('QUARANTINED');
    const triggered = await one(
      "SELECT payload_public FROM audit_events WHERE mission_id = $1 AND event_type = 'succession.triggered' ORDER BY created_at DESC LIMIT 1",
      [world.missionId]
    );
    expect(triggered?.['payload_public']).toMatchObject({ outcome: 'no_eligible_successor' });
  }, 120_000);

  it('rejects an unapproved successor and a stale activation version at the contract', async () => {
    const world = await createWorld('two');
    await runMissionCheckpointInitializer(initializerDeps() as never);
    const state = await getState(world.missionAddress);
    const quarantineTx = await guardianWallet.writeContract({
      address: world.missionAddress,
      abi: missionAbi,
      functionName: 'quarantine',
      args: [state.stateVersion],
      account: GUARDIAN,
    });
    await waitForReceipt(publicClient, quarantineTx);

    await expect(
      guardianWallet.writeContract({
        address: world.missionAddress,
        abi: missionAbi,
        functionName: 'activateSuccessor',
        args: [DEPLOYER.address, state.stateVersion + 1n],
        account: GUARDIAN,
      })
    ).rejects.toThrow(/NotActiveSuccessor/);

    await expect(
      guardianWallet.writeContract({
        address: world.missionAddress,
        abi: missionAbi,
        functionName: 'activateSuccessor',
        args: [GAMMA.address, state.stateVersion],
        account: GUARDIAN,
      })
    ).rejects.toThrow(/InvalidVersion/);
  }, 120_000);
});
