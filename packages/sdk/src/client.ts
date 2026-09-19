// Succra SDK — thin typed gateway client (runs in the agent's process).
//
// Transport is standard fetch. Every agent-authenticated request carries
// the §10 headers (x-succra-agent-id, x-succra-timestamp, x-succra-nonce,
// x-succra-signature) over the §12 canonical string. Owner-side methods
// (attach, challenge, verify) take the owner's session cookie instead —
// the SDK never mints sessions.
// Bodies are JSON.stringify'd once; the exact bytes are both sent and
// hashed (servers must hash raw received bytes, never re-serialized).
import { randomUUID } from 'node:crypto';
import { sign as naclSign } from 'tweetnacl';
import {
  buildCanonicalString,
  bytesToBase64,
  hexToBytes,
  signCanonicalString,
  type ActionTypeName,
} from '@succra/shared';
import { parseGatewayError, SdkError } from './errors.js';
import type { AgentKeypair } from './keys.js';
import { agentPublicKeyBase58 } from './keys.js';
import { verifyAndSignPreflight, type ExpectedAction } from './verify.js';

export type { ExpectedAction };

export interface SdkOptions {
  baseUrl: string;
  /** Agent UUID (x-succra-agent-id). */
  agentId: string;
  keypair: AgentKeypair;
}

export interface AttachAgentInput {
  missionId: string;
  agentPublicKey: string;
  name: string;
  role?: 'PRIMARY' | 'SUCCESSOR';
}

export interface PreflightInput {
  missionId: string;
  idempotencyKey: string;
  agentNonce: string;
  actionType: ActionTypeName;
  recipient: string;
  amountAtomic: string;
  expiresAt: string;
}

export interface PreflightAllow {
  decision: 'ALLOW';
  requestId: string;
  unsignedTransaction: string;
  expiresAt: string;
}

export interface PreflightBlock {
  decision: 'BLOCK';
  requestId: string;
  reasonCode: string;
  reason: string;
}

export type PreflightResult = PreflightAllow | PreflightBlock;

export interface SubmitResult {
  decision: 'ALLOW';
  requestId: string;
  signature: string | null;
  slot?: number;
  status: 'CONFIRMED' | 'FAILED';
  error?: { code: string; message: string };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Thin client. One instance per agent identity. No retries, no state machine. */
export class SuccraAgentClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly keypair: AgentKeypair;
  readonly agentPublicKey: string;

  constructor(options: SdkOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.agentId = options.agentId;
    this.keypair = options.keypair;
    this.agentPublicKey = agentPublicKeyBase58(options.keypair);
  }

  private signedHeaders(
    method: string,
    path: string,
    missionId: string,
    body: string
  ): Record<string, string> {
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const canonical = buildCanonicalString({
      timestamp,
      nonce,
      missionId,
      method,
      path,
      body,
    });
    return {
      'content-type': 'application/json',
      'x-succra-agent-id': this.agentId,
      'x-succra-timestamp': timestamp,
      'x-succra-nonce': nonce,
      'x-succra-signature': signCanonicalString(canonical, this.keypair.secretKey),
    };
  }

  private async postSigned(path: string, missionId: string, body: unknown): Promise<unknown> {
    const raw = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.signedHeaders('POST', path, missionId, raw),
      body: raw,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw parseGatewayError(response.status, payload);
    }
    return payload;
  }

  private async postOwner(path: string, body: unknown, sessionCookie: string): Promise<unknown> {
    const raw = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: raw,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw parseGatewayError(response.status, payload);
    }
    return payload;
  }

  /** Owner-side: attach this (or another) agent public key to a mission. */
  async registerMissionAgent(
    input: AttachAgentInput,
    sessionCookie: string
  ): Promise<{ agentId: string; status: string }> {
    const payload = (await this.postOwner(
      `/api/missions/${input.missionId}/agents`,
      { publicKey: input.agentPublicKey, name: input.name, role: input.role ?? 'PRIMARY' },
      sessionCookie
    )) as { agentId: string; status: string };
    return payload;
  }

  /** Owner-side: issue a registration challenge for an agent. */
  async requestChallenge(
    agentId: string,
    sessionCookie: string
  ): Promise<{ challenge: string; expiresAt: string }> {
    const payload = (await this.postOwner(
      `/api/agents/${agentId}/challenge`,
      {},
      sessionCookie
    )) as {
      challenge: string;
      expiresAt: string;
    };
    return payload;
  }

  /** Owner-side: prove key possession by signing the challenge locally. */
  async verifyChallenge(
    agentId: string,
    challenge: string,
    sessionCookie: string
  ): Promise<{ agentId: string; status: string }> {
    const signature = bytesToBase64(
      naclSign.detached(hexToBytes(challenge), this.keypair.secretKey)
    );
    const payload = (await this.postOwner(
      `/api/agents/${agentId}/verify`,
      { challenge, signature },
      sessionCookie
    )) as { agentId: string; status: string };
    return payload;
  }

  /** Agent-side: liveness heartbeat. */
  async heartbeat(): Promise<{ agentId: string; lastHeartbeatAt: string }> {
    const payload = (await this.postSigned(
      `/api/agents/${this.agentId}/heartbeat`,
      this.agentId,
      {}
    )) as {
      agentId: string;
      lastHeartbeatAt: string;
    };
    return payload;
  }

  /** Agent-side: pre-flight an action (ALLOW + unsigned tx, or BLOCK). */
  async preflightAction(input: PreflightInput): Promise<PreflightResult> {
    const payload = (await this.postSigned(
      `/api/missions/${input.missionId}/actions`,
      input.missionId,
      {
        idempotencyKey: input.idempotencyKey,
        agentNonce: input.agentNonce,
        actionType: input.actionType,
        payload: { recipient: input.recipient, amountAtomic: input.amountAtomic },
        expiresAt: input.expiresAt,
      }
    )) as PreflightResult;
    return payload;
  }

  /**
   * Verify the pre-flighted transaction matches the requested action and
   * sign it. Throws SdkRefusal (never sends) on any mismatch.
   */
  signPreflight(
    unsignedTransaction: string,
    expected: ExpectedAction
  ): { signedTransaction: string } {
    return verifyAndSignPreflight({
      unsignedTransaction,
      expected,
      agentSecretKey: this.keypair.secretKey,
    });
  }

  /** Agent-side: submit the signed transaction for a pre-flighted request. */
  async submitSignedAction(args: {
    missionId: string;
    requestId: string;
    signedTransaction: string;
  }): Promise<SubmitResult> {
    const payload = (await this.postSigned(
      `/api/missions/${args.missionId}/actions/${args.requestId}/submit`,
      args.missionId,
      { signedTransaction: args.signedTransaction }
    )) as SubmitResult;
    return payload;
  }

  /** Agent-side (or owner-side): fetch agent status. */
  async getAgentStatus(agentId?: string): Promise<{
    agentId: string;
    publicKey: string;
    status: string;
    lastHeartbeatAt: string | null;
    missions: Array<{ missionId: string; role: string }>;
  }> {
    const id = agentId ?? this.agentId;
    const path = `/api/agents/${id}/status`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.signedHeaders('GET', path, id, ''),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw parseGatewayError(response.status, payload);
    }
    return payload as {
      agentId: string;
      publicKey: string;
      status: string;
      lastHeartbeatAt: string | null;
      missions: Array<{ missionId: string; role: string }>;
    };
  }
}

export { SdkError };
