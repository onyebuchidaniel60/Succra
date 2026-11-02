import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifyHmac } from '../src/hmac.js';
import { verifyJwtES256K } from '../src/jwt.js';
import type { HspPaymentStatusValue } from '../src/types.js';

export interface MockHspRequest {
  method: string;
  path: string;
}

export interface MockHspPayment {
  hspPaymentMandateId: string;
  mandate: unknown;
  signature: string;
  status: HspPaymentStatusValue;
  transactionHash?: string;
  blockNumber?: number;
  error?: { code: string; message: string };
  createdAt: number;
}

export interface MockHspOptions {
  hmacSecret?: string;
  jwtPublicKey?: string;
  /** Fixed port for E2E; 0 selects an ephemeral port. */
  port?: number;
  /** Status returned by GET after settlementDelayMs. Default CONFIRMED. */
  settlementStatus?: HspPaymentStatusValue;
  settlementDelayMs?: number;
}

export interface MockHspServer {
  url: string;
  requests: MockHspRequest[];
  payments: Map<string, MockHspPayment>;
  close: () => Promise<void>;
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function settlementHash(id: string): `0x${string}` {
  return `0x${createHash('sha256').update(id).digest('hex')}`;
}

function bearer(req: import('node:http').IncomingMessage): string {
  const authorization = String(req.headers.authorization ?? '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

export async function startMockHspServer(options: MockHspOptions = {}): Promise<MockHspServer> {
  const requests: MockHspRequest[] = [];
  const payments = new Map<string, MockHspPayment>();
  const hmacSecret = options.hmacSecret ?? 'test-hmac-secret';
  const jwtPublicKey = options.jwtPublicKey;
  const settlementStatus = options.settlementStatus ?? 'CONFIRMED';
  const settlementDelayMs = options.settlementDelayMs ?? 0;
  let counter = 0;

  const jwtOk = (req: import('node:http').IncomingMessage): boolean => {
    if (!jwtPublicKey) return true;
    return verifyJwtES256K(bearer(req), jwtPublicKey);
  };

  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://mock.local').pathname;
    requests.push({ method: req.method ?? 'GET', path });

    if (req.method === 'GET' && path === '/health') {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && path === '/v1/cart-mandates/echo') {
      const body = await readBody(req);
      const signature = String(req.headers['x-succra-hmac'] ?? '');
      if (!verifyHmac(body, signature, hmacSecret)) {
        json(res, 401, { error: 'INVALID_HMAC' });
        return;
      }
      json(res, 200, JSON.parse(body));
      return;
    }

    if (req.method === 'POST' && path === '/v1/payment-mandates/echo') {
      const body = await readBody(req);
      if (!jwtPublicKey || !verifyJwtES256K(bearer(req), jwtPublicKey)) {
        json(res, 401, { error: 'INVALID_JWT' });
        return;
      }
      json(res, 200, JSON.parse(body));
      return;
    }

    if (req.method === 'POST' && path === '/v1/payment-mandates') {
      const body = await readBody(req);
      const signature = String(req.headers['x-succra-hmac'] ?? '');
      if (!verifyHmac(body, signature, hmacSecret)) {
        json(res, 401, { error: { code: 'INVALID_HMAC', message: 'Invalid HMAC.' } });
        return;
      }
      if (!jwtOk(req)) {
        json(res, 401, { error: { code: 'INVALID_JWT', message: 'Invalid JWT.' } });
        return;
      }
      let parsed: { paymentMandate?: unknown; signature?: unknown };
      try {
        parsed = JSON.parse(body) as { paymentMandate?: unknown; signature?: unknown };
      } catch {
        json(res, 400, { error: { code: 'INVALID_BODY', message: 'Expected JSON.' } });
        return;
      }
      if (typeof parsed.paymentMandate !== 'object' || typeof parsed.signature !== 'string') {
        json(res, 400, {
          error: { code: 'INVALID_BODY', message: 'Expected paymentMandate and signature.' },
        });
        return;
      }
      counter += 1;
      const hspPaymentMandateId = `hsp-payment-${counter}`;
      payments.set(hspPaymentMandateId, {
        hspPaymentMandateId,
        mandate: parsed.paymentMandate,
        signature: parsed.signature,
        status: 'SUBMITTED',
        createdAt: Date.now(),
      });
      json(res, 200, { hspPaymentMandateId, status: 'SUBMITTED' });
      return;
    }

    const statusMatch = /^\/v1\/payment-mandates\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && statusMatch) {
      const id = decodeURIComponent(statusMatch[1] ?? '');
      const body = '';
      const signature = String(req.headers['x-succra-hmac'] ?? '');
      if (!verifyHmac(body, signature, hmacSecret)) {
        json(res, 401, { error: { code: 'INVALID_HMAC', message: 'Invalid HMAC.' } });
        return;
      }
      if (!jwtOk(req)) {
        json(res, 401, { error: { code: 'INVALID_JWT', message: 'Invalid JWT.' } });
        return;
      }
      const payment = payments.get(id);
      if (!payment) {
        json(res, 404, { error: { code: 'PAYMENT_NOT_FOUND', message: 'Unknown mandate.' } });
        return;
      }
      const settled = Date.now() - payment.createdAt >= settlementDelayMs;
      const status = payment.status === 'SUBMITTED' && settled ? settlementStatus : payment.status;
      if (status === 'CONFIRMED') {
        payment.status = 'CONFIRMED';
        payment.transactionHash ??= settlementHash(id);
        payment.blockNumber ??= 1;
        json(res, 200, {
          hspPaymentMandateId: id,
          status,
          transactionHash: payment.transactionHash,
          blockNumber: payment.blockNumber,
        });
        return;
      }
      if (status === 'FAILED') {
        payment.status = 'FAILED';
        payment.error ??= { code: 'HSP_REJECTED', message: 'Mock settlement failure.' };
        json(res, 200, { hspPaymentMandateId: id, status, error: payment.error });
        return;
      }
      json(res, 200, { hspPaymentMandateId: id, status: 'SUBMITTED' });
      return;
    }

    const actionMatch = /^\/v1\/payment-mandates\/([^/]+)\/(confirm|fail)$/.exec(path);
    if (req.method === 'POST' && actionMatch) {
      const id = decodeURIComponent(actionMatch[1] ?? '');
      const action = actionMatch[2];
      const payment = payments.get(id);
      if (!payment) {
        json(res, 404, { error: { code: 'PAYMENT_NOT_FOUND', message: 'Unknown mandate.' } });
        return;
      }
      if (action === 'confirm') {
        payment.status = 'CONFIRMED';
        payment.transactionHash ??= settlementHash(id);
        payment.blockNumber ??= 1;
      } else {
        payment.status = 'FAILED';
        payment.error ??= { code: 'HSP_REJECTED', message: 'Mock settlement failure.' };
      }
      json(res, 200, { hspPaymentMandateId: id, status: payment.status });
      return;
    }

    json(res, 404, { error: 'NOT_FOUND' });
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    payments,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
