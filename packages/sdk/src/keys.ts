// Succra SDK — agent keypairs.
//
// The keypair lives ONLY in the agent's process. It is passed in by the
// caller (generated here or loaded from the agent's own secret storage).
// Nothing in this package ever transmits the secret key.
import { sign } from 'tweetnacl';
import { base64ToBytes, bytesToBase58, bytesToBase64 } from '@succra/shared';

export interface AgentKeypair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Generate a fresh Ed25519 keypair for an agent (caller must persist it). */
export function createAgentKeypair(): AgentKeypair {
  const pair = sign.keyPair();
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

/** Load a keypair from a base64 64-byte secret key. Throws on bad input. */
export function agentKeypairFromSecretKey(secretBase64: string): AgentKeypair {
  const secretKey = base64ToBytes(secretBase64);
  if (secretKey.length !== 64) {
    throw new Error('Agent secret key must decode to 64 bytes.');
  }
  const pair = sign.keyPair.fromSecretKey(secretKey);
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

/** Base58 public key (the registered agent identity). */
export function agentPublicKeyBase58(keypair: AgentKeypair): string {
  return bytesToBase58(keypair.publicKey);
}

/** Base64 secret key (for the agent's own storage only — never sent). */
export function agentSecretKeyBase64(keypair: AgentKeypair): string {
  return bytesToBase64(keypair.secretKey);
}
