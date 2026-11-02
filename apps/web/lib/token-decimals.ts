// Succra web — ERC-20 decimals resolution.
//
// Display amounts are only meaningful with the token's own decimals. The
// on-chain `decimals()` value is authoritative; an explicit deployment
// mapping may be supplied through NEXT_PUBLIC_TOKEN_DECIMALS for environments
// where the RPC is unavailable. No global 6/18 default is assumed.
import { createPublicClient, http, isAddress } from 'viem';

export const ERC20_DECIMALS_ABI = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

export const ERC20_SYMBOL_ABI = [
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

export interface DecimalsReader {
  readContract(args: {
    address: `0x${string}`;
    abi: typeof ERC20_DECIMALS_ABI;
    functionName: 'decimals';
  }): Promise<number>;
}

export interface SymbolReader {
  readContract(args: {
    address: `0x${string}`;
    abi: typeof ERC20_SYMBOL_ABI;
    functionName: 'symbol';
  }): Promise<string>;
}

export interface ReadTokenDecimalsOptions {
  reader?: DecimalsReader;
  rpcUrl?: string;
}

export interface ReadTokenSymbolOptions {
  reader?: SymbolReader;
  rpcUrl?: string;
}

const cache = new Map<string, number>();
const symbolCache = new Map<string, string>();

/** Parse `0xabc...:6,0xdef...:18`; invalid entries are ignored. */
export function parseTokenDecimalsConfig(raw: string | undefined): Map<string, number> {
  const result = new Map<string, number>();
  if (!raw) return result;
  for (const entry of raw.split(',')) {
    const [address, decimalsText] = entry.split(':');
    if (!address || decimalsText === undefined || !isAddress(address.trim())) continue;
    const decimals = Number(decimalsText.trim());
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) continue;
    result.set(address.trim().toLowerCase(), decimals);
  }
  return result;
}

export function configuredTokenDecimals(
  address: string,
  raw = process.env.NEXT_PUBLIC_TOKEN_DECIMALS
): number | null {
  if (!isAddress(address)) return null;
  return parseTokenDecimalsConfig(raw).get(address.toLowerCase()) ?? null;
}

/** Parse `0xabc...:USDC,0xdef...:HSK`; invalid entries are ignored. */
export function parseTokenSymbolConfig(raw: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!raw) return result;
  for (const entry of raw.split(',')) {
    const separator = entry.lastIndexOf(':');
    if (separator <= 0) continue;
    const address = entry.slice(0, separator).trim();
    const symbol = entry.slice(separator + 1).trim();
    if (!isAddress(address) || symbol.length === 0 || symbol.length > 32) continue;
    result.set(address.toLowerCase(), symbol);
  }
  return result;
}

export function configuredTokenSymbol(
  address: string,
  raw = process.env.NEXT_PUBLIC_TOKEN_SYMBOLS
): string | null {
  if (!isAddress(address)) return null;
  return parseTokenSymbolConfig(raw).get(address.toLowerCase()) ?? null;
}

function rpcUrl(explicit?: string): string {
  const url = explicit ?? process.env.SUCCRA_RPC_URL ?? process.env.NEXT_PUBLIC_HASHKEY_RPC_URL;
  if (!url) throw new Error('Missing SUCCRA_RPC_URL or NEXT_PUBLIC_HASHKEY_RPC_URL.');
  return url;
}

/**
 * Resolve token decimals, preferring an explicit deployment mapping and
 * falling back to `decimals()` on HashKey. Results are cached per token for
 * the lifetime of the server process; decimals are immutable for an ERC-20.
 */
export async function readTokenDecimals(
  address: string,
  options: ReadTokenDecimalsOptions = {}
): Promise<number | null> {
  if (!isAddress(address)) return null;
  const key = address.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const configured = configuredTokenDecimals(address);
  if (configured !== null) {
    cache.set(key, configured);
    return configured;
  }
  try {
    const reader =
      options.reader ??
      (createPublicClient({
        transport: http(rpcUrl(options.rpcUrl)),
      }) as unknown as DecimalsReader);
    const decimals = await reader.readContract({
      address: key as `0x${string}`,
      abi: ERC20_DECIMALS_ABI,
      functionName: 'decimals',
    });
    const value = Number(decimals);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    cache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

/** Test-only cache reset. */
export function clearTokenDecimalsCache(): void {
  cache.clear();
  symbolCache.clear();
}

/**
 * Resolve the token display symbol, preferring explicit deployment config.
 * A missing symbol only affects label text; amounts still use decimals.
 */
export async function readTokenSymbol(
  address: string,
  options: ReadTokenSymbolOptions = {}
): Promise<string | null> {
  if (!isAddress(address)) return null;
  const key = address.toLowerCase();
  const cached = symbolCache.get(key);
  if (cached !== undefined) return cached;
  const configured = configuredTokenSymbol(address);
  if (configured !== null) {
    symbolCache.set(key, configured);
    return configured;
  }
  try {
    const reader =
      options.reader ??
      (createPublicClient({
        transport: http(rpcUrl(options.rpcUrl)),
      }) as unknown as SymbolReader);
    const symbol = await reader.readContract({
      address: key as `0x${string}`,
      abi: ERC20_SYMBOL_ABI,
      functionName: 'symbol',
    });
    const value = String(symbol).trim();
    if (value.length === 0 || value.length > 32) return null;
    symbolCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}
