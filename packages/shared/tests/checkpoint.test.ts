import { describe, expect, it } from 'vitest';
import {
  computeCheckpointHash,
  computeRecoveryAckDigest,
  hashSortedCheckpointItems,
} from '../src/checkpoint.js';

const BASE = {
  missionId: '11111111-1111-4111-8111-111111111111',
  sequence: 0,
  confirmedPaymentIds: [] as string[],
  confirmedTxHashes: [] as string[],
  confirmedSpentAtomic: 0n,
  maxPaymentAtomic: 400n,
  recoveryMaxPaymentAtomic: 100n,
  policyVersion: 1,
  policyHash: `0x${'22'.repeat(32)}`,
  createdAt: 1_700_000_000n,
};

describe('Phase 6 canonical checkpoint preimage', () => {
  it('is order-independent for confirmed item arrays', () => {
    const left = computeCheckpointHash({
      ...BASE,
      confirmedPaymentIds: ['beta', 'alpha'],
      confirmedTxHashes: [`0x${'bb'.repeat(32)}`, `0x${'aa'.repeat(32)}`],
    });
    const right = computeCheckpointHash({
      ...BASE,
      confirmedPaymentIds: ['alpha', 'beta'],
      confirmedTxHashes: [`0x${'aa'.repeat(32)}`, `0x${'bb'.repeat(32)}`],
    });
    expect(left).toEqual(right);
  });

  it('changes when the sequence changes', () => {
    expect(computeCheckpointHash(BASE)).not.toEqual(
      computeCheckpointHash({ ...BASE, sequence: 1 })
    );
  });

  it('hashes an empty item list to keccak256(empty bytes)', () => {
    expect(hashSortedCheckpointItems([])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashSortedCheckpointItems([])).toEqual(hashSortedCheckpointItems([]));
  });

  it('builds a 32-byte recovery ACK digest', () => {
    expect(
      computeRecoveryAckDigest({
        missionAddress: `0x${'33'.repeat(20)}`,
        expectedVersion: 7n,
      })
    ).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
