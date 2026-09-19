// SDK HTTP serialization tests (stub server, no gateway, no chain).
//
// Proves the client builds §12 headers, sends the documented shapes,
// and parses §10 envelopes — against a stub that records requests.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCanonicalString, verifyCanonicalSignature } from '@succra/shared';
import { SuccraAgentClient, SdkError } from '../src/index.js';
import { createAgentKeypair, agentPublicKeyBase58 } from '../src/keys.js';

interface SeenRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

describe('sdk http serialization', () => {
  let server: Server;
  let baseUrl: string;
  let seen: SeenRequest[] = [];
  let stub: { status: number; json: unknown } = { status: 200, json: {} };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async (): Promise<void> => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers[key] = value;
        }
        seen.push({
          method: req.method ?? '',
          path: new URL(req.url ?? '/', 'http://x').pathname,
          headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(stub.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(stub.json));
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('signs heartbeat with §12 headers over the raw body', async () => {
    stub = { status: 200, json: { agentId: 'a', lastHeartbeatAt: 't' } };
    seen = [];
    const keypair = createAgentKeypair();
    const client = new SuccraAgentClient({ baseUrl, agentId: 'agent-1', keypair });
    const result = await client.heartbeat();
    expect(result).toEqual({ agentId: 'a', lastHeartbeatAt: 't' });
    expect(seen.length).toEqual(1);
    const request = seen[0];
    expect(request).toBeDefined();
    if (!request) throw new Error('unseen');
    expect(request.method).toEqual('POST');
    expect(request.path).toEqual('/api/agents/agent-1/heartbeat');
    expect(request.headers['x-succra-agent-id']).toEqual('agent-1');
    const canonical = buildCanonicalString({
      timestamp: request.headers['x-succra-timestamp'] ?? '',
      nonce: request.headers['x-succra-nonce'] ?? '',
      missionId: 'agent-1',
      method: 'POST',
      path: '/api/agents/agent-1/heartbeat',
      body: request.body,
    });
    expect(
      verifyCanonicalSignature({
        publicKeyBase58: agentPublicKeyBase58(keypair),
        canonical,
        signatureBase64: request.headers['x-succra-signature'] ?? '',
      })
    ).toEqual(true);
  });

  it('parses preflight ALLOW and throws SdkError on envelopes', async () => {
    const keypair = createAgentKeypair();
    const client = new SuccraAgentClient({ baseUrl, agentId: 'agent-1', keypair });
    stub = {
      status: 200,
      json: { decision: 'ALLOW', requestId: 'r', unsignedTransaction: 'u', expiresAt: 'e' },
    };
    const allow = await client.preflightAction({
      missionId: 'm',
      idempotencyKey: 'k',
      agentNonce: '1',
      actionType: 'TRANSFER_SOL',
      recipient: '11111111111111111111111111111111',
      amountAtomic: '1',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect(allow).toEqual({
      decision: 'ALLOW',
      requestId: 'r',
      unsignedTransaction: 'u',
      expiresAt: 'e',
    });
    stub = {
      status: 400,
      json: { error: { code: 'TRANSACTION_MISMATCH', message: 'Nope.', requestId: 'x' } },
    };
    const failure = await client
      .submitSignedAction({ missionId: 'm', requestId: 'r', signedTransaction: 's' })
      .then(
        () => 'unexpected-success',
        (error: unknown) => error
      );
    expect(failure).toBeInstanceOf(SdkError);
    expect((failure as SdkError).code).toEqual('TRANSACTION_MISMATCH');
  });

  it('sends owner calls with the session cookie', async () => {
    const keypair = createAgentKeypair();
    const client = new SuccraAgentClient({ baseUrl, agentId: 'agent-1', keypair });
    stub = { status: 200, json: { agentId: 'a', status: 'VERIFIED' } };
    seen = [];
    await client.verifyChallenge('agent-1', 'ab'.repeat(32), 'session-cookie-value');
    expect(seen.length).toEqual(1);
    expect(seen[0]?.headers['cookie']).toEqual('session-cookie-value');
    expect(seen[0]?.path).toEqual('/api/agents/agent-1/verify');
    const sent = JSON.parse(seen[0]?.body ?? '{}') as { challenge?: string; signature?: string };
    expect(sent.challenge).toEqual('ab'.repeat(32));
    expect(typeof sent.signature).toEqual('string');
  });
});
