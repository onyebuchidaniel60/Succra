// Succra web — JSON boundary helper for BigInt/Set/Map values.
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Set) return [...value].map(jsonSafe);
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), jsonSafe(entry)])
    );
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, jsonSafe(entry)])
    );
  }
  return value;
}

/**
 * JSON-safe EIP-712 typed data. `domain.chainId` is sent as a number because
 * viem treats a string chainId differently from the BigInt used by the
 * server-side rebuild; message uint256 values are safe as decimal strings.
 */
export function jsonSafeTypedData(value: unknown): unknown {
  const safe = jsonSafe(value);
  if (safe === null || typeof safe !== 'object') return safe;
  const record = safe as Record<string, unknown>;
  const domain = record['domain'];
  if (domain !== null && typeof domain === 'object') {
    const domainRecord = domain as Record<string, unknown>;
    const chainId = domainRecord['chainId'];
    if (typeof chainId === 'string' && /^\d+$/.test(chainId)) {
      const numeric = Number(chainId);
      if (Number.isSafeInteger(numeric)) domainRecord['chainId'] = numeric;
    }
  }
  return record;
}
