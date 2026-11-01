import { signHmac } from './hmac.js';
import { signJwtES256K } from './jwt.js';
import type { HspPaymentMandate, HspPaymentStatus, HspPaymentStatusValue } from './types.js';

// PROVISIONAL — the HSP HTTP surface is not published in a verifiable form.
// Phase 3 uses the mock server; Phase 9 reconciles against live HSP.

export interface HspClientOptions {
  baseUrl: string;
  hmacSecret: string;
  jwtPrivateKey?: string;
  jwtKid?: string;
  merchantId?: string;
  fetchImpl?: typeof fetch;
}

export class HspClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly kind: 'REJECTED' | 'UNAVAILABLE';

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'HspClientError';
    this.code = code;
    this.status = status;
    this.kind = status >= 500 ? 'UNAVAILABLE' : 'REJECTED';
  }
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function parseStatus(value: unknown): HspPaymentStatusValue {
  if (value === 'SUBMITTED' || value === 'CONFIRMED' || value === 'FAILED') return value;
  throw new Error('HSP returned an unknown payment status.');
}

export class HspClient {
  private readonly baseUrl: string;
  private readonly hmacSecret: string;
  private readonly jwtPrivateKey: string | undefined;
  private readonly jwtKid: string;
  private readonly merchantId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HspClientOptions) {
    if (!options.baseUrl) throw new Error('HSP base URL is required.');
    if (!options.hmacSecret) throw new Error('HSP HMAC secret is required.');
    this.baseUrl = trimBaseUrl(options.baseUrl);
    this.hmacSecret = options.hmacSecret;
    this.jwtPrivateKey = options.jwtPrivateKey;
    this.jwtKid = options.jwtKid ?? 'succra';
    this.merchantId = options.merchantId ?? 'succra';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(body: string): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-succra-hmac': signHmac(body, this.hmacSecret),
    };
    if (this.jwtPrivateKey) {
      headers['authorization'] = `Bearer ${signJwtES256K(
        { sub: this.merchantId, iss: 'succra' },
        this.jwtPrivateKey,
        this.jwtKid
      )}`;
    }
    return headers;
  }

  private async parseResponse(response: Response): Promise<HspPaymentStatus> {
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) {
      const error = json as { error?: { code?: unknown; message?: unknown } } | null;
      const code =
        typeof error?.error?.code === 'string' ? error.error.code : `HSP_HTTP_${response.status}`;
      const message =
        typeof error?.error?.message === 'string'
          ? error.error.message
          : `HSP request failed with status ${response.status}.`;
      throw new HspClientError(code, message, response.status);
    }
    const record = json as Record<string, unknown> | null;
    if (!record || typeof record['hspPaymentMandateId'] !== 'string') {
      throw new HspClientError(
        'HSP_INVALID_RESPONSE',
        'HSP response is missing a mandate id.',
        502
      );
    }
    const status: HspPaymentStatus = {
      hspPaymentMandateId: record['hspPaymentMandateId'],
      status: parseStatus(record['status']),
    };
    if (typeof record['transactionHash'] === 'string') {
      status.transactionHash = record['transactionHash'];
    }
    if (typeof record['blockNumber'] === 'number') {
      status.blockNumber = record['blockNumber'];
    }
    if (record['error'] !== undefined && record['error'] !== null) {
      status.error = record['error'] as NonNullable<HspPaymentStatus['error']>;
    }
    return status;
  }

  /** Submit an agent-signed Payment Mandate. Does not move funds by itself. */
  async submitPaymentMandate(
    mandate: HspPaymentMandate,
    signature: string
  ): Promise<HspPaymentStatus> {
    const body = JSON.stringify({ paymentMandate: mandate, signature });
    const response = await this.fetchImpl(`${this.baseUrl}/v1/payment-mandates`, {
      method: 'POST',
      headers: this.headers(body),
      body,
    });
    return this.parseResponse(response);
  }

  /** Read the authoritative HSP settlement status for a mandate. */
  async getPaymentStatus(hspPaymentMandateId: string): Promise<HspPaymentStatus> {
    const path = `/v1/payment-mandates/${encodeURIComponent(hspPaymentMandateId)}`;
    const body = '';
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(body),
    });
    return this.parseResponse(response);
  }
}
