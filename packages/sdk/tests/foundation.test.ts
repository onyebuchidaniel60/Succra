// SDK surface test: the Phase 4 thin client is exported.
import { describe, expect, it } from 'vitest';
import { SuccraAgentClient, createAgentKeypair } from '../src/index.js';

describe('sdk surface (Phase 4)', () => {
  it('constructs a client with an agent identity', () => {
    const keypair = createAgentKeypair();
    const client = new SuccraAgentClient({
      baseUrl: 'http://127.0.0.1:3100',
      agentId: 'agent-id',
      keypair,
    });
    expect(client.agentPublicKey.length).toBeGreaterThan(30);
  });
});
