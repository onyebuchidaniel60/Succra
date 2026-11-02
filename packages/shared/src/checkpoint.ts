// Succra shared — Phase 6 deterministic checkpoint and recovery-ACK digests.
//
// Fixed field order is part of the protocol. JSON.stringify is never used.
import { concat, encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';

export interface CheckpointPreimageInput {
  /** Database mission UUID; hashed with keccak256(utf8(uuid)). */
  missionId: string;
  sequence: bigint | number;
  confirmedPaymentIds: readonly string[];
  confirmedTxHashes: readonly string[];
  confirmedSpentAtomic: bigint | number | string;
  maxPaymentAtomic: bigint | number | string;
  recoveryMaxPaymentAtomic: bigint | number | string;
  policyVersion: bigint | number;
  /** On-chain bytes32 policy hash. */
  policyHash: string;
  /** Unix seconds. */
  createdAt: bigint | number;
}

export function missionIdToBytes32(missionId: string): Hex {
  return keccak256(stringToHex(missionId));
}

/** keccak256(concat(sorted items)), with each item UTF-8 encoded. */
export function hashSortedCheckpointItems(items: readonly string[]): Hex {
  const sorted = [...items].sort();
  return keccak256(concat(sorted.map((item) => stringToHex(item))));
}

export function computeCheckpointHash(input: CheckpointPreimageInput): Hex {
  const confirmedPaymentIdsHash = hashSortedCheckpointItems(input.confirmedPaymentIds);
  const confirmedTxHashesHash = hashSortedCheckpointItems(input.confirmedTxHashes);

  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint64' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint64' },
      ],
      [
        missionIdToBytes32(input.missionId),
        BigInt(input.sequence),
        confirmedPaymentIdsHash,
        confirmedTxHashesHash,
        BigInt(input.confirmedSpentAtomic),
        BigInt(input.maxPaymentAtomic),
        BigInt(input.recoveryMaxPaymentAtomic),
        BigInt(input.policyVersion),
        input.policyHash as Hex,
        BigInt(input.createdAt),
      ]
    )
  );
}

export interface RecoveryAckInput {
  missionAddress: `0x${string}`;
  expectedVersion: bigint | number;
}

/** keccak256(abi.encode("succra.recovery.ack.v1", address(this), version)). */
export function computeRecoveryAckDigest(input: RecoveryAckInput): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'address' }, { type: 'uint64' }],
      ['succra.recovery.ack.v1', input.missionAddress, BigInt(input.expectedVersion)]
    )
  );
}
