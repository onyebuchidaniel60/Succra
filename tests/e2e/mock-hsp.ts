// Playwright E2E mock HSP server on a fixed local port.
import { startMockHspServer } from '../../packages/hsp-client/test/mock-server.js';

const port = Number(process.env.E2E_HSP_PORT ?? '8787');
let server: Awaited<ReturnType<typeof startMockHspServer>> | undefined;

async function shutdown(): Promise<void> {
  await server?.close().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

async function main(): Promise<void> {
  server = await startMockHspServer({
    port,
    hmacSecret: process.env.HSP_HMAC_SECRET ?? 'test-hmac-secret',
  });
  process.stdout.write(`mock HSP ready on ${server.url}\n`);
}

void main();
