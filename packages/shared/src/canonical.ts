// Succra shared — §12 canonical request signing string.
//
// Exact format (ARCHITECTURE.md §12):
//   SUCCRA-V1\n{timestamp}\n{nonce}\n{missionId}\n{method}\n{path}\n{sha256(body)}
// - timestamp: milliseconds since unix epoch, decimal string.
// - nonce: fresh per-request random value (UUID/hex), request-level replay
//   protection only (amendment v2 §12: never the on-chain agentNonce).
// - missionId: for mission-scoped routes the mission UUID from the path;
//   for agent-scoped routes (heartbeat, status) the agent UUID. Server and
//   SDK must construct it identically; the gateway re-derives it from the
//   path and verified headers, never trusting it beyond signature scope.
// - method: uppercase HTTP method (e.g. POST). path: exact route path
//   starting with `/api/` (no query string).
// - sha256(body): hex of SHA-256 over the RAW JSON body bytes. Callers
//   must hash the exact bytes sent; servers must hash the exact bytes
//   received (req.text(), never a re-serialized parse).
import { sha256HexUtf8 } from './base.js';

export interface CanonicalRequestInput {
  timestamp: string;
  nonce: string;
  missionId: string;
  method: string;
  path: string;
  /** Raw JSON body bytes as sent on the wire. */
  body: string;
}

/** SHA-256 hex over the raw JSON body bytes (the {sha256(body)} field). */
export function hashBody(body: string): string {
  return sha256HexUtf8(body);
}

/** Build the exact §12 signing string. Pure: byte-identical everywhere. */
export function buildCanonicalString(input: CanonicalRequestInput): string {
  return [
    'SUCCRA-V1',
    input.timestamp,
    input.nonce,
    input.missionId,
    input.method,
    input.path,
    hashBody(input.body),
  ].join('\n');
}
