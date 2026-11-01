import { describe, expect, it } from 'vitest';
import {
  SUCCRA_EIP712_DOMAIN,
  SUCCRA_REQUEST_TYPES,
  buildSuccraRequestTypedData,
  hashCanonicalBody,
  hashMethodAndPath,
  requestIdToBytes32,
} from '../src/eip712.js';

const MISSION = '0x0000000000000000000000000000000000000001' as const;

describe('Succra EIP-712 helpers', () => {
  it('hashes identical logical bodies deterministically regardless of key order', () => {
    const first = { b: { d: [3, 4], c: 2 }, a: 1 };
    const second = { a: 1, b: { c: 2, d: [3, 4] } };
    expect(hashCanonicalBody(first)).toEqual(hashCanonicalBody(second));
    expect(hashCanonicalBody(first)).toEqual(
      '0x9e8044426c09b4ec68ef8912b43bed5dbd76ef68b11eda0693fcb015d4c1ae39'
    );
  });

  it('hashes method and path with the known vector', () => {
    expect(hashMethodAndPath('POST', '/api/test')).toEqual(
      '0x61cd4e0f00bb39959bba4987e48f0f01bf67d363ccdbdb62f0eb60d2876fcf4c'
    );
  });

  it('binds a UTF-8 request id to bytes32 with keccak256', () => {
    expect(requestIdToBytes32('req-123')).toEqual(
      '0x66a85bfb3dc3941b66ed3a8462fc911295b9669aea5628b5a4512e527d95b2be'
    );
  });

  it('builds the canonical typed-data shape', () => {
    const requestId = requestIdToBytes32('req-123');
    const typedData = buildSuccraRequestTypedData({
      chainId: 177,
      verifyingContract: MISSION,
      missionId: MISSION,
      requestId,
      nonce: 1n,
      timestamp: 2n,
      methodHash: hashMethodAndPath('POST', '/api/missions/1/actions'),
      bodyHash: hashCanonicalBody({ merchant: MISSION }),
    });

    expect(typedData.domain).toEqual(SUCCRA_EIP712_DOMAIN(177, MISSION));
    expect(typedData.domain).toEqual({
      name: 'Succra',
      version: '1',
      chainId: 177n,
      verifyingContract: MISSION,
    });
    expect(typedData.primaryType).toEqual('SuccraRequest');
    expect(typedData.types).toEqual(SUCCRA_REQUEST_TYPES);
    expect(typedData.message.missionId).toEqual(MISSION);
    expect(typedData.message.requestId).toEqual(requestId);
    expect(typedData.message.nonce).toEqual(1n);
    expect(typedData.message.timestamp).toEqual(2n);
  });
});
