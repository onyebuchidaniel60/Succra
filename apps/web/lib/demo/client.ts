export type DemoEvent = {
  label: string;
  hash: string;
  block: number;
  kind: string;
};

export type DemoMission = {
  key: 'usdg' | 'wif';
  label: string;
  symbol: string;
  decimals: number;
  tokenAddress: string;
  missionAddress: string;
  status: string;
  deposited: string;
  spent: string;
  available: string;
  sessionKey: string;
  successor: string;
  recoveryCap: string;
};

export type DemoState = {
  initialized: boolean;
  phase: string;
  chainId: number;
  label: string;
  registry: string;
  factory: string;
  owner: string;
  guardian: string;
  primary: string;
  successor: string;
  merchant: string;
  missions: DemoMission[];
  events: DemoEvent[];
  note: string;
};

type DemoParams = { owner?: string; demo?: boolean };
type DemoEnvelope = {
  ok: boolean;
  state?: DemoState;
  error?: string;
  code?: string;
};

const OWNER_TOKEN_KEY = 'succra.demo.ownerToken';

export class DemoAuthError extends Error {
  constructor(public readonly code = 'OWNER_AUTH_REQUIRED') {
    super('Verify the owner wallet to view private mission state.');
    this.name = 'DemoAuthError';
  }
}

export function backendUrl(): string {
  return (process.env.NEXT_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');
}

export function getOwnerToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(OWNER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function hasOwnerToken(): boolean {
  return Boolean(getOwnerToken());
}

export function clearOwnerToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(OWNER_TOKEN_KEY);
  } catch {
    // sessionStorage can be unavailable in hardened browsers.
  }
}

function authHeaders(): Record<string, string> {
  const token = getOwnerToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readEnvelope(response: Response): Promise<DemoEnvelope> {
  try {
    return (await response.json()) as DemoEnvelope;
  } catch {
    return { ok: false, error: 'The mission service returned an invalid response.' };
  }
}

export function demoUrl(params?: DemoParams): string {
  const search = new URLSearchParams();
  if (params?.owner) search.set('owner', params.owner);
  if (params?.demo) search.set('demo', 'true');
  const query = search.toString();
  return `${backendUrl()}/api/demo${query ? `?${query}` : ''}`;
}

export async function fetchDemoState(params?: DemoParams): Promise<DemoState> {
  const response = await fetch(demoUrl(params), {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const body = await readEnvelope(response);
  if (response.status === 401 || body.code === 'OWNER_AUTH_REQUIRED') {
    clearOwnerToken();
    throw new DemoAuthError(body.code);
  }
  if (!body.ok || !body.state) throw new Error(body.error ?? 'Could not load mission state.');
  return body.state;
}

export async function postDemoAction(
  action: string,
  params?: DemoParams,
  payload?: { amount?: string; token?: 'usdg' | 'wif' }
): Promise<DemoState> {
  const response = await fetch(demoUrl(params), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await readEnvelope(response);
  if (response.status === 401 || body.code === 'OWNER_AUTH_REQUIRED') {
    clearOwnerToken();
    throw new DemoAuthError(body.code);
  }
  if (!body.ok || !body.state) throw new Error(body.error ?? 'Mission action failed.');
  return body.state;
}

/** Public deployer address, used only to decide whether to offer unlock. */
export async function fetchDemoOwner(): Promise<string> {
  const response = await fetch(`${backendUrl()}/api/demo/auth`, { cache: 'no-store' });
  const body = (await response.json()) as { ok?: boolean; owner?: string; error?: string };
  if (!response.ok || !body.ok || !body.owner) {
    throw new Error(body.error ?? 'Could not resolve the demo owner.');
  }
  return body.owner;
}

export async function requestOwnerChallenge(address: string): Promise<string> {
  const response = await fetch(`${backendUrl()}/api/demo/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const body = (await response.json()) as {
    ok?: boolean;
    message?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.ok || !body.message) {
    throw new DemoAuthError(body.code ?? 'NOT_AUTHORIZED');
  }
  return body.message;
}

export async function verifyOwnerAccess(address: string, signature: string): Promise<void> {
  const response = await fetch(`${backendUrl()}/api/demo/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  const body = (await response.json()) as {
    ok?: boolean;
    token?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok || !body.ok || !body.token) {
    throw new DemoAuthError(body.code ?? 'INVALID_SIGNATURE');
  }
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(OWNER_TOKEN_KEY, body.token);
  }
}

export function formatAtomic(value: string, decimals: number): string {
  const raw = BigInt(value || '0');
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const fraction = raw % base;
  if (fraction === 0n) return whole.toLocaleString();
  const decimalsText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toLocaleString()}.${decimalsText}`;
}

export function compact(value: string, head = 8, tail = 6): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
