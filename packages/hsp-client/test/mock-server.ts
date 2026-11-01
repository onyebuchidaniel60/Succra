import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { verifyHmac } from '../src/hmac.js';
import { verifyJwtES256K } from '../src/jwt.js';

export interface MockHspRequest {
  method: string;
  path: string;
}

export interface MockHspServer {
  url: string;
  requests: MockHspRequest[];
  close: () => Promise<void>;
}

interface MockHspOptions {
  hmacSecret?: string;
  jwtPublicKey?: string;
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function startMockHspServer(options: MockHspOptions = {}): Promise<MockHspServer> {
  const requests: MockHspRequest[] = [];
  const hmacSecret = options.hmacSecret ?? 'test-hmac-secret';
  const jwtPublicKey = options.jwtPublicKey;

  const server: Server = createServer(async (req, res) => {
    const path = req.url ?? '/';
    requests.push({ method: req.method ?? 'GET', path });

    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'POST' && path === '/v1/cart-mandates/echo') {
      const body = await readBody(req);
      const signature = String(req.headers['x-succra-hmac'] ?? '');
      if (!verifyHmac(body, signature, hmacSecret)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_HMAC' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }

    if (req.method === 'POST' && path === '/v1/payment-mandates/echo') {
      const body = await readBody(req);
      const authorization = String(req.headers.authorization ?? '');
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!jwtPublicKey || !verifyJwtES256K(token, jwtPublicKey)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'INVALID_JWT' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
