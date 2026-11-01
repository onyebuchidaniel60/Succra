// Phase 3 end-to-end integration: real Hardhat node + real contracts + mock HSP
// + PGlite. Proves preflight mandate -> agent signature -> authorizePayment ->
// HSP submit -> guardian recordSettlement -> CONFIRMED mirror.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import {
  HspClient,
  buildCartMandateRef,
  buildPaymentMandate,
  hashPaymentMandate,
  publicKeyFromPrivateKey,
} from '@succra/hsp-client';
import { requestIdToBytes32 } from '@succra/shared';
import { createHashkeyTestDb } from '../../apps/web/tests/helpers/pglite-gateway-store';
import { readMissionState } from '../../apps/web/lib/gateway/contract-reader';
import {
  readRecordedSettlement,
  sendAuthorizePayment,
  sendRecordSettlement,
} from '../../apps/web/lib/gateway/contract-writer';
import {
  submitApprovedAction,
  type SubmitPersistence,
} from '../../apps/web/lib/gateway/submit-handler';
import type { HspPaymentRow } from '../../apps/web/lib/gateway/store-settlement';
import type {
  PreflightActionRequestRow,
  PreflightAgentRow,
  PreflightMissionRow,
} from '../../apps/web/lib/gateway/store-preflight';
import { startMockHspServer, type MockHspServer } from '../../packages/hsp-client/test/mock-server';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHAIN_ID = 31337;
const GUARDIAN = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
); // account 2
const DEPLOYER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
); // account 0
const AGENT = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
); // account 3
const MERCHANT = privateKeyToAccount(
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
); // account 4
const TOKEN = `0x${'77'.repeat(20)}` as const;
const HMS_SECRET = 'integration-hmac-secret';
const JWT_PRIVATE_KEY = `0x${'88'.repeat(32)}`;

function chainObject(url: string): Chain {
  return {
    id: CHAIN_ID,
    name: 'Hardhat',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [url] } },
  };
}

async function freePort(): Promise<number> {
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
  if (receipt.status !== 'success') throw new Error('Deployment transaction failed.');
  return receipt;
}

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const path = join(ROOT, 'contracts', 'artifacts', 'src', `${name}.sol`, `${name}.json`);
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: Abi; bytecode: Hex };
  return { abi: json.abi, bytecode: json.bytecode };
}

function paymentFromRow(row: Record<string, unknown>): HspPaymentRow {
  return {
    id: String(row['id']),
    mission_id: String(row['mission_id']),
    action_request_id: String(row['action_request_id']),
    hsp_payment_mandate_id: String(row['hsp_payment_mandate_id']),
    mandate_hash: String(row['mandate_hash']),
    amount_atomic: String(row['amount_atomic']),
    token_address: String(row['token_address']),
    merchant_address: String(row['merchant_address']),
    status: String(row['status']) as HspPaymentRow['status'],
    authorization_tx_hash: row['authorization_tx_hash']
      ? String(row['authorization_tx_hash'])
      : null,
    settlement_tx_hash: row['settlement_tx_hash'] ? String(row['settlement_tx_hash']) : null,
    block_number: row['block_number'] === null ? null : Number(row['block_number']),
    raw_error: row['raw_error'] ?? null,
    submitted_at: row['submitted_at']
      ? new Date(row['submitted_at'] as string).toISOString()
      : null,
    settled_at: row['settled_at'] ? new Date(row['settled_at'] as string).toISOString() : null,
    created_at: new Date(row['created_at'] as string).toISOString(),
  };
}

function createPglitePersistence(db: PGlite): SubmitPersistence {
  const one = async (
    sql: string,
    params: unknown[] = []
  ): Promise<Record<string, unknown> | null> => {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return result.rows[0] ?? null;
  };
  return {
    getHspPaymentByActionRequestId: async (actionRequestId) => {
      const row = await one('SELECT * FROM hsp_payments WHERE action_request_id = $1', [
        actionRequestId,
      ]);
      return row ? paymentFromRow(row) : null;
    },
    insertHspPayment: async (row) => {
      const inserted = await one(
        `INSERT INTO hsp_payments
           (mission_id, action_request_id, hsp_payment_mandate_id, mandate_hash,
            amount_atomic, token_address, merchant_address, status,
            authorization_tx_hash, submitted_at, settled_at, raw_error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
         RETURNING *`,
        [
          row.mission_id,
          row.action_request_id,
          row.hsp_payment_mandate_id,
          row.mandate_hash,
          row.amount_atomic,
          row.token_address,
          row.merchant_address,
          row.status,
          row.authorization_tx_hash,
          row.submitted_at ?? null,
          row.settled_at ?? null,
          row.raw_error === undefined ? null : JSON.stringify(row.raw_error),
        ]
      );
      if (!inserted) throw new Error('insert failed');
      return paymentFromRow(inserted);
    },
    updateHspPayment: async (id, patch) => {
      const row = await one(
        `UPDATE hsp_payments SET
           hsp_payment_mandate_id = COALESCE($2, hsp_payment_mandate_id),
           status = COALESCE($3, status),
           submitted_at = COALESCE($4, submitted_at),
           settlement_tx_hash = COALESCE($5, settlement_tx_hash),
           block_number = COALESCE($6, block_number),
           settled_at = COALESCE($7, settled_at),
           raw_error = COALESCE($8::jsonb, raw_error)
         WHERE id = $1 RETURNING *`,
        [
          id,
          patch.hsp_payment_mandate_id ?? null,
          patch.status ?? null,
          patch.submitted_at ?? null,
          patch.settlement_tx_hash ?? null,
          patch.block_number ?? null,
          patch.settled_at ?? null,
          patch.raw_error === undefined ? null : JSON.stringify(patch.raw_error),
        ]
      );
      return row ? paymentFromRow(row) : null;
    },
    transitionHspPayment: async (id, fromStatus, patch) => {
      const row = await one(
        `UPDATE hsp_payments SET
           hsp_payment_mandate_id = COALESCE($3, hsp_payment_mandate_id),
           status = COALESCE($4, status),
           submitted_at = COALESCE($5, submitted_at),
           settlement_tx_hash = COALESCE($6, settlement_tx_hash),
           block_number = COALESCE($7, block_number),
           settled_at = COALESCE($8, settled_at),
           raw_error = COALESCE($9::jsonb, raw_error)
         WHERE id = $1 AND status = $2 RETURNING *`,
        [
          id,
          fromStatus,
          patch.hsp_payment_mandate_id ?? null,
          patch.status ?? null,
          patch.submitted_at ?? null,
          patch.settlement_tx_hash ?? null,
          patch.block_number ?? null,
          patch.settled_at ?? null,
          patch.raw_error === undefined ? null : JSON.stringify(patch.raw_error),
        ]
      );
      return row ? paymentFromRow(row) : null;
    },
    markActionSubmitted: async (actionRequestId, signature, submittedAt) => {
      await db.query('UPDATE action_requests SET signature = $2, submitted_at = $3 WHERE id = $1', [
        actionRequestId,
        signature,
        submittedAt,
      ]);
    },
    mirrorConfirmedSpend: async (missionId, amountAtomic) => {
      await db.query('SELECT mirror_confirmed_spend($1, $2)', [missionId, amountAtomic]);
    },
  };
}

describe('Phase 3 end-to-end settlement', () => {
  let node: ChildProcess | undefined;
  let mock: MockHspServer | undefined;
  let db: PGlite;
  let missionAddress: `0x${string}`;
  let action: PreflightActionRequestRow;
  let mission: PreflightMissionRow;
  let agent: PreflightAgentRow;
  let mandateHash: `0x${string}`;
  let signature: string;

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
    const url = `http://127.0.0.1:${port}`;
    await waitForRpc(url);
    process.env.SUCCRA_RPC_URL = url;
    process.env.NEXT_PUBLIC_HASHKEY_RPC_URL = url;
    process.env.NEXT_PUBLIC_HASHKEY_CHAIN_ID = String(CHAIN_ID);
    process.env.SUCCRA_RUNTIME_SIGNER_SECRET_KEY =
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    process.env.HASHKEY_GUARDIAN_SECRET_KEY =
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

    const chain = chainObject(url);
    const publicClient = createPublicClient({ chain, transport: http(url) });
    const wallet = createWalletClient({ chain, transport: http(url), account: DEPLOYER });

    const registryArtifact = artifact('GuardianRegistry');
    const registryHash = await wallet.deployContract({
      abi: registryArtifact.abi,
      bytecode: registryArtifact.bytecode,
      args: [GUARDIAN.address],
    });
    const registryReceipt = await waitForReceipt(publicClient, registryHash);
    const registryAddress = registryReceipt.contractAddress;
    if (!registryAddress) throw new Error('registry deployment missing address');

    const factoryArtifact = artifact('MissionFactory');
    const factoryHash = await wallet.deployContract({
      abi: factoryArtifact.abi,
      bytecode: factoryArtifact.bytecode,
      args: [registryAddress],
    });
    const factoryReceipt = await waitForReceipt(publicClient, factoryHash);
    const factoryAddress = factoryReceipt.contractAddress;
    if (!factoryAddress) throw new Error('factory deployment missing address');

    const now = BigInt(Math.floor(Date.now() / 1000));
    const config = {
      paymentToken: TOKEN,
      budgetAtomic: 1000n,
      maxPaymentAtomic: 400n,
      recoveryMaxPaymentAtomic: 100n,
      merchantAllowlist: [MERCHANT.address],
      expiresAt: now + 3_600n,
      policyHash: keccak256(toHex('phase3-policy')),
      primaryAgent: AGENT.address,
      successors: [],
      violationThreshold: 3,
      violationWindowSeconds: 900n,
      cartMandateHash: keccak256(toHex('phase3-cart')),
    };
    const createHash = await wallet.writeContract({
      address: factoryAddress,
      abi: factoryArtifact.abi,
      functionName: 'createMission',
      args: [config],
    });
    await waitForReceipt(publicClient, createHash);
    const total = (await publicClient.readContract({
      address: factoryAddress,
      abi: factoryArtifact.abi,
      functionName: 'totalMissions',
    })) as bigint;
    missionAddress = (await publicClient.readContract({
      address: factoryAddress,
      abi: factoryArtifact.abi,
      functionName: 'getMissionAt',
      args: [total - 1n],
    })) as `0x${string}`;

    db = await createHashkeyTestDb();
    const ownerId = randomUUID();
    const agentId = randomUUID();
    const missionId = randomUUID();
    const actionId = randomUUID();
    const requestId = randomUUID();
    const onchainRequestId = requestIdToBytes32(requestId);
    await db.query('INSERT INTO auth.users (id) VALUES ($1)', [ownerId]);
    await db.query('INSERT INTO profiles (id, wallet_address) VALUES ($1, $2)', [
      ownerId,
      DEPLOYER.address,
    ]);
    await db.query(
      `INSERT INTO agents (id, owner_id, name, public_key, status)
       VALUES ($1, $2, 'Alpha', $3, 'ACTIVE')`,
      [agentId, ownerId, AGENT.address]
    );
    await db.query(
      `INSERT INTO missions
         (id, owner_id, name, objective, pda_address, vault_address, mint_address,
          budget_atomic, remaining_budget_atomic, status, current_agent_id,
          current_agent_public_key, policy_version, policy_hash, expires_at,
          contract_address, factory_address, owner_address, payment_token_address,
          current_agent_address)
       VALUES ($1,$2,'Phase 3','Settle',$3,'unused',$4,'1000','1000','ACTIVE',$5,
          $6,1,'hash',now() + interval '1 hour',$3,$7,$8,$4,$6)`,
      [
        missionId,
        ownerId,
        missionAddress,
        TOKEN,
        agentId,
        AGENT.address,
        factoryAddress,
        DEPLOYER.address,
      ]
    );
    await db.query(
      `INSERT INTO mission_agents (mission_id, agent_id, role, status)
       VALUES ($1,$2,'PRIMARY','ACTIVE')`,
      [missionId, agentId]
    );

    mandateHash = hashPaymentMandate(
      buildPaymentMandate({
        cartMandate: buildCartMandateRef({
          cartMandateId: missionId,
          cartMandateHash: config.cartMandateHash,
          token: TOKEN,
          totalBudgetAtomic: '1000',
          maxPerPaymentAtomic: '400',
          merchantAllowlist: [MERCHANT.address],
          expiresAt: config.expiresAt.toString(),
          issuer: DEPLOYER.address,
        }),
        requestId,
        missionAddress,
        agent: AGENT.address,
        merchant: MERCHANT.address,
        token: TOKEN,
        amountAtomic: '100',
        paymentNonce: 1,
        expiresAt: (now + 3_600n).toString(),
      }),
      CHAIN_ID
    ) as `0x${string}`;
    signature = await AGENT.sign({ hash: mandateHash });

    const mandate = JSON.parse(
      JSON.stringify({
        cartMandateId: missionId,
        cartMandateHash: config.cartMandateHash,
        requestId,
        onchainRequestId,
        missionAddress,
        agent: AGENT.address,
        merchant: MERCHANT.address,
        token: TOKEN,
        amountAtomic: '100',
        paymentNonce: 1,
        expiresAt: (now + 3_600n).toString(),
      })
    ) as unknown;
    await db.query(
      `INSERT INTO action_requests
         (id, mission_id, agent_id, idempotency_key, request_id, onchain_request_id,
          agent_nonce, action_type, payload, request_hash, signature, decision,
          decision_reason_code, mandate_hash, mandate_payload, typed_data, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,'HSP_PAYMENT','{}'::jsonb,'hash',NULL,'ALLOW',
          NULL,$7,$8::jsonb,'{}'::jsonb,now() + interval '1 hour')`,
      [
        actionId,
        missionId,
        agentId,
        `idem-${requestId}`,
        requestId,
        onchainRequestId,
        mandateHash,
        JSON.stringify(mandate),
      ]
    );

    const actionQuery = await db.query<Record<string, unknown>>(
      'SELECT * FROM action_requests WHERE id = $1',
      [actionId]
    );
    const actionRow = actionQuery.rows[0];
    if (!actionRow) throw new Error('action seed failed');
    action = {
      id: String(actionRow['id']),
      mission_id: String(actionRow['mission_id']),
      agent_id: String(actionRow['agent_id']),
      idempotency_key: String(actionRow['idempotency_key']),
      request_id: String(actionRow['request_id']),
      onchain_request_id: String(actionRow['onchain_request_id']),
      agent_nonce: Number(actionRow['agent_nonce']),
      action_type: String(actionRow['action_type']),
      payload: actionRow['payload'],
      request_hash: String(actionRow['request_hash']),
      signature: actionRow['signature'] ? String(actionRow['signature']) : null,
      decision: String(actionRow['decision']),
      decision_reason_code: actionRow['decision_reason_code']
        ? String(actionRow['decision_reason_code'])
        : null,
      mandate_hash: String(actionRow['mandate_hash']),
      mandate_payload: actionRow['mandate_payload'],
      typed_data: actionRow['typed_data'],
      expires_at: new Date(actionRow['expires_at'] as string).toISOString(),
      created_at: new Date(actionRow['created_at'] as string).toISOString(),
      submitted_at: null,
    };
    mission = {
      id: missionId,
      owner_id: ownerId,
      name: 'Phase 3',
      objective: 'Settle',
      pda_address: missionAddress,
      vault_address: 'unused',
      mint_address: TOKEN,
      budget_atomic: '1000',
      remaining_budget_atomic: '1000',
      status: 'ACTIVE',
      current_agent_id: agentId,
      current_agent_public_key: AGENT.address,
      policy_version: 1,
      policy_hash: 'hash',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      contract_address: missionAddress,
      factory_address: factoryAddress,
      owner_address: DEPLOYER.address,
      payment_token_address: TOKEN,
      current_agent_address: AGENT.address,
    };
    agent = {
      id: agentId,
      owner_id: ownerId,
      name: 'Alpha',
      public_key: AGENT.address,
      endpoint_url: null,
      capabilities: [],
      status: 'ACTIVE',
      last_heartbeat_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mock = await startMockHspServer({
      hmacSecret: HMS_SECRET,
      jwtPublicKey: publicKeyFromPrivateKey(JWT_PRIVATE_KEY),
      settlementStatus: 'CONFIRMED',
    });
  }, 180_000);

  afterAll(async () => {
    await mock?.close();
    await db?.close();
    node?.kill('SIGTERM');
  });

  it('runs the golden path and mirrors the authoritative settlement', async () => {
    if (!mock) throw new Error('mock HSP missing');
    const hsp = new HspClient({
      baseUrl: mock.url,
      hmacSecret: HMS_SECRET,
      jwtPrivateKey: JWT_PRIVATE_KEY,
      merchantId: 'merchant-1',
    });
    const result = await submitApprovedAction({
      action,
      mission,
      agent,
      missionAddress,
      chainId: CHAIN_ID,
      mandateHash,
      signature,
      chain: {
        readMissionState,
        authorizePayment: sendAuthorizePayment,
        recordSettlement: sendRecordSettlement,
        readRecordedSettlement,
      },
      hsp: {
        submit: (mandate, sig) => hsp.submitPaymentMandate(mandate, sig),
        getStatus: (id) => hsp.getPaymentStatus(id),
      },
      persistence: createPglitePersistence(db),
      pollIntervalMs: 20,
      pollTimeoutMs: 10_000,
    });

    expect(result.status).toEqual(200);
    expect(result.json).toMatchObject({
      decision: 'ALLOW',
      requestId: action.request_id,
      status: 'CONFIRMED',
    });

    const onchain = await readMissionState(missionAddress);
    expect(onchain.confirmedSpentAtomic).toEqual(100n);
    expect(onchain.stateVersion).toEqual(2n);

    const paymentQuery = await db.query<Record<string, unknown>>(
      'SELECT * FROM hsp_payments WHERE action_request_id = $1',
      [action.id]
    );
    const payment = paymentQuery.rows[0];
    expect(payment?.['status']).toEqual('CONFIRMED');
    expect(payment?.['authorization_tx_hash']).toMatch(/^0x[0-9a-f]{64}$/);
    expect(payment?.['settlement_tx_hash']).toMatch(/^0x[0-9a-f]{64}$/);

    const missionQuery = await db.query<{ remaining_budget_atomic: string }>(
      'SELECT remaining_budget_atomic FROM missions WHERE id = $1',
      [mission.id]
    );
    expect(String(missionQuery.rows[0]?.remaining_budget_atomic)).toEqual('900');
  }, 60_000);
});
