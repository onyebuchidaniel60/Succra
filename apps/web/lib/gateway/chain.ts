// Succra gateway — Solana chain access (@solana/kit RPC) + fee payer.
//
// The gateway READS the chain (mission account, blockhash, signature
// statuses) and SENDS fully-signed transactions. It never signs as the
// agent and never touches vault PDAs. Fee-payer funding is operational
// (the key needs lamports for fees); key storage is server-only env.
import { sign as naclSign } from 'tweetnacl';
import {
  address,
  createSolanaRpc,
  type Base64EncodedWireTransaction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit';
import { base58ToBytes, base64ToBytes, bytesToBase58 } from '@succra/shared';
import { decodeMissionAccount, type OnchainMissionState } from './mission-state';

export interface BlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

export interface ChainSignatureStatus {
  slot: number;
  /** null = confirmed ok; otherwise the chain error value. */
  err: unknown;
}

export interface ChainGateway {
  getMissionState(missionPda: string): Promise<OnchainMissionState | null>;
  getLatestBlockhash(): Promise<BlockhashInfo>;
  sendRawTransaction(wireBase64: string): Promise<string>;
  getSignatureStatus(signature: string): Promise<ChainSignatureStatus | null>;
}

type KitRpc = Rpc<SolanaRpcApi>;

function rpcUrl(): string {
  const url = process.env.SUCCRA_RPC_URL;
  if (!url) {
    throw new Error('Missing SUCCRA_RPC_URL.');
  }
  return url;
}

export function programId(): string {
  const id = process.env.SUCCRA_PROGRAM_ID;
  if (!id) {
    throw new Error('Missing SUCCRA_PROGRAM_ID.');
  }
  return id;
}

/** Kit RPC chain adapter. Constructed per call site (cheap). */
export function createKitChainGateway(url?: string): ChainGateway {
  const rpc: KitRpc = createSolanaRpc(url ?? rpcUrl());
  return {
    async getMissionState(missionPda: string): Promise<OnchainMissionState | null> {
      const response = await rpc
        .getAccountInfo(address(missionPda), { encoding: 'base64', commitment: 'confirmed' })
        .send();
      const encoded = response.value?.data?.[0];
      if (!encoded) {
        return null;
      }
      const bytes = base64ToBytes(encoded);
      return decodeMissionAccount(missionPda, bytes);
    },

    async getLatestBlockhash(): Promise<BlockhashInfo> {
      const response = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      return {
        blockhash: response.value.blockhash,
        lastValidBlockHeight: BigInt(response.value.lastValidBlockHeight),
      };
    },

    async sendRawTransaction(wireBase64: string): Promise<string> {
      // Brands are compile-time only; the base64 wire string is validated
      // by shape (wire parse) before it reaches this adapter.
      const signature = await rpc
        .sendTransaction(wireBase64 as unknown as Base64EncodedWireTransaction, {
          encoding: 'base64',
          preflightCommitment: 'confirmed',
        })
        .send();
      return String(signature);
    },

    async getSignatureStatus(signature: string): Promise<ChainSignatureStatus | null> {
      const response = await rpc.getSignatureStatuses([signature as unknown as Signature]).send();
      const info = response.value[0];
      if (!info) {
        return null;
      }
      return { slot: Number(info.slot), err: info.err ?? null };
    },
  };
}

export interface FeePayer {
  address: string;
  signBytes(message: Uint8Array): Uint8Array;
}

/**
 * Load the gateway fee-payer key from SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY
 * (base58 64-byte secret key, server-only). Throws a config error when
 * absent or malformed — callers map it to 500 without details.
 */
export function loadFeePayer(secret?: string): FeePayer {
  const raw = secret ?? process.env.SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY;
  if (!raw) {
    throw new Error('Missing SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY.');
  }
  let secretKey: Uint8Array;
  try {
    secretKey = base58ToBytes(raw.trim());
    if (secretKey.length !== 64) {
      throw new Error('bad length');
    }
  } catch {
    // Also accept the 32-byte seed form? No: exactly one format
    // (base58 64-byte secret key, the `solana-keygen` output shape).
    throw new Error('Invalid SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY.');
  }
  const keypair = naclSign.keyPair.fromSecretKey(secretKey);
  const addressValue = bytesToBase58(keypair.publicKey);
  return {
    address: addressValue,
    signBytes: (message: Uint8Array): Uint8Array => naclSign.detached(message, secretKey),
  };
}
