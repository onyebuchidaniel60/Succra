import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import {
  buildSuccraRequestTypedData,
  computeRecoveryAckDigest,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '@succra/shared';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = 'http://127.0.0.1:8545';
const CHAIN_ID = 177;
const TOKEN = `0x${'77'.repeat(20)}`;
const MERCHANT = `0x${'88'.repeat(20)}`;
const BLOCKED_MERCHANT = `0x${'99'.repeat(20)}`;
const SCREENSHOT_DIR = 'tests/e2e/screenshots';

const OWNER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
);
const ALPHA = privateKeyToAccount(
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
);
const BETA = privateKeyToAccount(
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
);

interface MissionDetailResponse {
  mission: {
    id: string;
    name: string;
    status: string;
    contract_address: string;
    current_agent_address: string;
  };
  onchain: { stateVersion: string; currentAgent: string; status: string } | null;
  successions: Array<{
    id: string;
    to_agent_address: string;
    status: string;
    activation_tx_hash: string | null;
  }>;
  agents: Array<{ agent_id: string; address: string; role: string; status: string }>;
}

async function installWallet(page: Page): Promise<void> {
  await page.exposeFunction(
    '__succraE2eRpc',
    async (method: string, params: unknown[]): Promise<unknown> => {
      const response = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      const payload = (await response.json()) as {
        result?: unknown;
        error?: { message?: string };
      };
      if (payload.error) throw new Error(payload.error.message ?? 'RPC error');
      return payload.result ?? null;
    }
  );

  await page.addInitScript({
    content: `
      (() => {
        const address = ${JSON.stringify(OWNER.address)};
        const listeners = new Map();
        const emit = (event, value) => {
          for (const callback of listeners.get(event) ?? []) callback(value);
        };
        const provider = {
          isMetaMask: true,
          selectedAddress: address,
          chainId: '0xb1',
          request: async ({ method, params }) => {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
            if (method === 'eth_chainId') return '0xb1';
            if (method === 'net_version') return '177';
            if (method === 'wallet_switchEthereumChain') return null;
            if (method === 'wallet_addEthereumChain') return null;
            if (method === 'wallet_getCapabilities') return {};
            if (method === 'eth_signTypedData_v4') {
              const typed = typeof params[1] === 'string' ? params[1] : JSON.stringify(params[1]);
              return window.__succraE2eRpc(method, [address, typed]);
            }
            if (method === 'eth_sendTransaction') {
              const tx = { ...params[0], from: address };
              delete tx.chainId;
              return window.__succraE2eRpc(method, [tx]);
            }
            return window.__succraE2eRpc(method, params ?? []);
          },
          on: (event, callback) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(callback);
          },
          removeListener: (event, callback) => listeners.get(event)?.delete(callback),
          isConnected: () => true,
          enable: async () => [address],
        };
        provider.sendAsync = (payload, callback) => {
          provider.request(payload).then(callback).catch((error) => callback({ error }));
        };
        window.ethereum = provider;
        setTimeout(() => {
          emit('connect', { chainId: '0xb1' });
          emit('accountsChanged', [address]);
        }, 0);
      })();
    `,
  });
}

async function agentHeaders(args: {
  method: string;
  path: string;
  body: Record<string, unknown>;
  requestId: string;
  account: typeof ALPHA;
}): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const typed = buildSuccraRequestTypedData({
    chainId: CHAIN_ID,
    verifyingContract: args.body['__missionAddress'] as `0x${string}`,
    missionId: args.body['__missionAddress'] as `0x${string}`,
    requestId: requestIdToBytes32(args.requestId),
    nonce: BigInt(nonce),
    timestamp: BigInt(timestamp),
    methodHash: hashMethodAndPath(args.method, args.path),
    bodyHash: hashCanonicalBody(args.body),
  });
  const signature = await args.account.signTypedData({
    domain: typed.domain,
    types: typed.types,
    primaryType: typed.primaryType,
    message: typed.message,
  });
  return {
    'content-type': 'application/json',
    'x-succra-agent-address': args.account.address,
    'x-succra-timestamp': timestamp,
    'x-succra-nonce': nonce,
    'x-succra-signature': signature,
  };
}

async function verifyAgent(
  request: APIRequestContext,
  agentId: string,
  account: typeof BETA
): Promise<void> {
  const challengeResponse = await request.post(`/api/agents/${agentId}/challenge`, { data: {} });
  expect(challengeResponse.status()).toEqual(200);
  const challenge = (await challengeResponse.json()) as {
    challenge: string;
    typedData: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  };
  const signature = await account.signTypedData({
    domain: challenge.typedData.domain,
    types: challenge.typedData.types,
    primaryType: challenge.typedData.primaryType,
    message: challenge.typedData.message,
  });
  const verifyResponse = await request.post(`/api/agents/${agentId}/verify`, {
    data: { challenge: challenge.challenge, signature },
  });
  expect(verifyResponse.status()).toEqual(200);
}

async function pay(args: {
  request: APIRequestContext;
  missionId: string;
  missionAddress: `0x${string}`;
  account: typeof ALPHA;
  agentNonce: number;
  amountAtomic: string;
  merchant?: string;
  amountLabel: string;
}): Promise<void> {
  const requestId = randomUUID();
  const payload = {
    merchantAddress: args.merchant ?? MERCHANT,
    tokenAddress: TOKEN,
    amountAtomic: args.amountAtomic,
    paymentReference: `e2e-${requestId}`,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const body: Record<string, unknown> = {
    requestId,
    idempotencyKey: `e2e-${requestId}`,
    agentNonce: args.agentNonce,
    actionType: 'HSP_PAYMENT',
    payload,
    __missionAddress: args.missionAddress,
  };
  const path = `/api/missions/${args.missionId}/actions`;
  const headers = await agentHeaders({
    method: 'POST',
    path,
    body,
    requestId,
    account: args.account,
  });
  const preflight = await args.request.post(path, {
    headers,
    data: body,
  });
  expect(preflight.status()).toEqual(200);
  const preflightJson = (await preflight.json()) as {
    decision: string;
    reasonCode?: string;
    mandateHash?: string;
    typedData?: {
      domain: Record<string, unknown>;
      types: Record<string, Array<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    };
  };
  if (args.merchant === BLOCKED_MERCHANT) {
    expect(preflightJson.decision).toEqual('BLOCK');
    return;
  }
  expect(preflightJson.decision).toEqual('ALLOW');
  expect(preflightJson.typedData).toBeTruthy();
  const mandateSignature = await args.account.signTypedData({
    domain: preflightJson.typedData!.domain,
    types: preflightJson.typedData!.types,
    primaryType: preflightJson.typedData!.primaryType,
    message: preflightJson.typedData!.message,
  });
  const submitBody: Record<string, unknown> = {
    mandateHash: preflightJson.mandateHash,
    signature: mandateSignature,
    __missionAddress: args.missionAddress,
  };
  const submitPath = `${path}/${requestId}/submit`;
  const submitHeaders = await agentHeaders({
    method: 'POST',
    path: submitPath,
    body: submitBody,
    requestId,
    account: args.account,
  });
  const submitted = await args.request.post(submitPath, {
    headers: submitHeaders,
    data: submitBody,
  });
  expect(submitted.status()).toEqual(200);
  const submittedJson = (await submitted.json()) as { status: string; transactionHash?: string };
  expect(submittedJson.status).toEqual('CONFIRMED');
  void args.amountLabel;
}

test('demo lifecycle: create, pay, violate, quarantine, succeed, recover', async ({
  page,
  request,
}) => {
  test.setTimeout(360_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await installWallet(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Agents can fail/ })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-landing.png`, fullPage: true });

  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);

  await page
    .getByRole('button', { name: /Connect/i })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Sign in with wallet' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with wallet' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-dashboard-empty.png`, fullPage: true });

  await page.getByRole('link', { name: 'New mission' }).click();
  await page.waitForURL('**/missions/new');
  await page.getByPlaceholder('Q4 vendor payouts').fill('E2E continuity mission');
  await page
    .getByPlaceholder('Pay allowlisted vendors on a fixed weekly schedule.')
    .fill('Demonstrate the full mission lifecycle.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByPlaceholder('0x…').first().fill(TOKEN);
  await expect(page.getByText('Token decimals: 6')).toBeVisible();
  await page.getByRole('textbox', { name: 'Budget (USDC)' }).fill('1000');
  await page.getByRole('textbox', { name: 'Per-payment ceiling (USDC)' }).fill('500');
  await page.getByRole('textbox', { name: 'Recovery ceiling (USDC)' }).fill('200');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByLabel('Merchant 1 address').fill(MERCHANT);
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByPlaceholder('0x…').first().fill(ALPHA.address);
  await page.getByPlaceholder('Alpha').fill('Alpha');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await page.getByRole('button', { name: 'Add successor' }).click();
  await page.getByLabel('Successor 1 address').fill(BETA.address);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'E2E continuity mission' })).toBeVisible();
  await page.getByRole('button', { name: 'Create mission' }).click();
  await page.waitForURL(/\/missions\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  const missionId = page.url().split('/').pop()!;
  await expect(page.getByText('ACTIVE').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-mission-created.png`, fullPage: true });

  let detail = (await (
    await request.get(`/api/missions/${missionId}`)
  ).json()) as MissionDetailResponse;
  const betaAgent = detail.agents.find(
    (agent) => agent.address.toLowerCase() === BETA.address.toLowerCase()
  );
  expect(betaAgent).toBeTruthy();
  await verifyAgent(request, betaAgent!.agent_id, BETA);

  await pay({
    request,
    missionId,
    missionAddress: detail.mission.contract_address as `0x${string}`,
    account: ALPHA,
    agentNonce: 1,
    amountAtomic: '200000000',
    amountLabel: '200 USDC',
  });
  await page.reload();
  await expect(page.getByText(/Payment of 200 USDC to/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-payment.png`, fullPage: true });

  for (let index = 0; index < 3; index += 1) {
    await pay({
      request,
      missionId,
      missionAddress: detail.mission.contract_address as `0x${string}`,
      account: ALPHA,
      agentNonce: 2 + index,
      amountAtomic: '10000000',
      merchant: BLOCKED_MERCHANT,
      amountLabel: 'blocked',
    });
  }
  await page.reload();
  await expect(page.getByText(/Policy violation \(merchant not allowed\)/).first()).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-violations.png`, fullPage: true });

  await page.getByRole('button', { name: 'Quarantine mission' }).click();
  await page.getByRole('button', { name: 'Confirm quarantine' }).click();
  await expect(page.getByText(/Successor activated|RECOVERING|Quarantined/).first()).toBeVisible({
    timeout: 120_000,
  });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/06-quarantine-succession.png`, fullPage: true });

  detail = (await (
    await request.get(`/api/missions/${missionId}`)
  ).json()) as MissionDetailResponse;
  expect(detail.onchain?.status).toEqual('RECOVERING');
  const succession = detail.successions[0];
  expect(succession?.status).toEqual('PENDING_ACK');
  const expectedVersion = BigInt(detail.onchain!.stateVersion);
  const ackSignature = await BETA.sign({
    hash: computeRecoveryAckDigest({
      missionAddress: detail.mission.contract_address as `0x${string}`,
      expectedVersion,
    }),
  });
  const ackPath = `/api/missions/${missionId}/succession/${succession.id}/acknowledge`;
  const ackBody = {
    expectedVersion: Number(expectedVersion),
    signature: ackSignature,
    __missionAddress: detail.mission.contract_address,
  };
  const ackHeaders = await agentHeaders({
    method: 'POST',
    path: ackPath,
    body: ackBody,
    requestId: succession.id,
    account: BETA,
  });
  const ackResponse = await request.post(ackPath, { headers: ackHeaders, data: ackBody });
  expect(ackResponse.status()).toEqual(200);
  await page.reload();
  await expect(page.getByText(/Mission recovered under reduced authority/)).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/07-recovered.png`, fullPage: true });

  detail = (await (
    await request.get(`/api/missions/${missionId}`)
  ).json()) as MissionDetailResponse;
  await pay({
    request,
    missionId,
    missionAddress: detail.mission.contract_address as `0x${string}`,
    account: BETA,
    agentNonce: 5,
    amountAtomic: '100000000',
    amountLabel: '100 USDC',
  });
  await page.reload();
  await expect(page.getByText(/Payment of 100 USDC to/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Mission recovered under reduced authority')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/08-recovery-payment.png`, fullPage: true });

  await page.getByRole('link', { name: 'Full audit' }).click();
  await page.waitForURL('**/audit');
  await expect(page.getByText('All immutable events')).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/09-audit.png`, fullPage: true });

  const finalA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(finalA11y.violations).toEqual([]);

  const responsivePages = [
    '/',
    '/dashboard',
    `/missions/${missionId}`,
    `/missions/${missionId}/audit`,
    `/missions/${missionId}/succession`,
    '/settings',
  ];
  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of responsivePages) {
      await page.goto(path);
      await expect(page.locator('main')).toBeVisible();
      const scroll = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth
      );
      expect(scroll, `horizontal scroll at ${width}px on ${path}`).toEqual(false);
    }
    await page.goto(`/missions/${missionId}`);
    await expect(page.getByRole('heading', { name: 'E2E continuity mission' })).toBeVisible();
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/responsive-${width}.png`,
      fullPage: true,
    });
  }

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
