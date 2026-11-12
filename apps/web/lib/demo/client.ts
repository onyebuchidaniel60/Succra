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

export function backendUrl(): string {
  return (process.env.NEXT_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');
}

export function demoUrl(): string {
  return `${backendUrl()}/api/demo`;
}

export async function fetchDemoState(): Promise<DemoState> {
  const response = await fetch(demoUrl(), { cache: 'no-store' });
  const body = (await response.json()) as { ok: boolean; state?: DemoState; error?: string };
  if (!body.ok || !body.state) throw new Error(body.error ?? 'Could not load live mission state.');
  return body.state;
}

export async function postDemoAction(action: string): Promise<DemoState> {
  const response = await fetch(demoUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = (await response.json()) as { ok: boolean; state?: DemoState; error?: string };
  if (!body.ok || !body.state) throw new Error(body.error ?? 'Mission action failed.');
  return body.state;
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
