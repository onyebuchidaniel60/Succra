import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { HspClient, HspClientError } from '../src/client.js';
import { publicKeyFromPrivateKey } from '../src/jwt.js';
import { startMockHspServer, type MockHspServer } from '../test/mock-server.js';
import type { HspPaymentMandate } from '../src/types.js';

let mock: MockHspServer | undefined;
const hmacSecret = 'test-hmac-secret';
const jwtPrivateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
const jwtPublicKey = publicKeyFromPrivateKey(jwtPrivateKey);

const mandate: HspPaymentMandate = {
  cartMandateId: 'cart-1',
  cartMandateHash: `0x${'11'.repeat(32)}`,
  requestId: 'req-1',
  onchainRequestId: `0x${'22'.repeat(32)}`,
  missionAddress: `0x${'33'.repeat(20)}`,
  agent: `0x${'44'.repeat(20)}`,
  merchant: `0x${'55'.repeat(20)}`,
  token: `0x${'66'.repeat(20)}`,
  amountAtomic: '1000',
  paymentNonce: 1,
  expiresAt: '2000000000',
};

function client(url: string): HspClient {
  return new HspClient({
    baseUrl: url,
    hmacSecret,
    jwtPrivateKey,
    merchantId: 'merchant-1',
  });
}

afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

describe('HSP client', () => {
  it('submits a signed mandate and reads a confirmed settlement', async () => {
    mock = await startMockHspServer({ hmacSecret, jwtPublicKey, settlementStatus: 'CONFIRMED' });
    const hsp = client(mock.url);
    const submitted = await hsp.submitPaymentMandate(mandate, `0x${'77'.repeat(65)}`);
    expect(submitted.status).toEqual('SUBMITTED');
    expect(submitted.hspPaymentMandateId).toMatch(/^hsp-payment-/);

    const settled = await hsp.getPaymentStatus(submitted.hspPaymentMandateId);
    expect(settled.status).toEqual('CONFIRMED');
    expect(settled.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(settled.blockNumber).toEqual(1);
    expect(mock.payments.get(submitted.hspPaymentMandateId)?.mandate).toEqual(mandate);
  });

  it('reports a failed settlement without claiming success', async () => {
    mock = await startMockHspServer({ hmacSecret, jwtPublicKey, settlementStatus: 'FAILED' });
    const hsp = client(mock.url);
    const submitted = await hsp.submitPaymentMandate(mandate, '0xsig');
    const settled = await hsp.getPaymentStatus(submitted.hspPaymentMandateId);
    expect(settled.status).toEqual('FAILED');
    expect(settled.error?.code).toEqual('HSP_REJECTED');
  });

  it('rejects a bad HMAC instead of accepting the mandate', async () => {
    mock = await startMockHspServer({ hmacSecret, jwtPublicKey });
    const bad = new HspClient({
      baseUrl: mock.url,
      hmacSecret: 'wrong-secret',
      jwtPrivateKey,
    });
    await expect(bad.submitPaymentMandate(mandate, '0xsig')).rejects.toMatchObject({
      name: 'HspClientError',
      code: 'INVALID_HMAC',
      kind: 'REJECTED',
    });
    expect(mock.payments.size).toEqual(0);
  });

  it('wraps a missing mandate as an HSP rejection', async () => {
    mock = await startMockHspServer({ hmacSecret, jwtPublicKey });
    const hsp = client(mock.url);
    await expect(hsp.getPaymentStatus('missing')).rejects.toBeInstanceOf(HspClientError);
  });
});
