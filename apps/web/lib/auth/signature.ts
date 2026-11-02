// Succra web — EIP-712 wallet-signature verification.
//
// The wallet signs the `SuccraLogin` typed data returned by
// POST /api/auth/nonce. Verification uses viem's canonical EIP-712
// implementation against the stored typed data; no home-rolled hashing.
import { isAddress, verifyTypedData } from 'viem';
import type { LoginTypedData } from './message';

export interface VerifyLoginSignatureInput {
  walletAddress: string;
  typedData: LoginTypedData;
  signature: `0x${string}`;
}

/**
 * Verify a wallet signature over the exact issued login typed data.
 * Returns true only when the recovered address matches `walletAddress`.
 * Never throws on malformed input — callers treat false as 401.
 */
export async function verifyWalletSignature(input: VerifyLoginSignatureInput): Promise<boolean> {
  if (!isAddress(input.walletAddress)) return false;
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) return false;
  try {
    return await verifyTypedData({
      address: input.walletAddress as `0x${string}`,
      domain: input.typedData.domain,
      types: input.typedData.types,
      primaryType: input.typedData.primaryType,
      message: input.typedData.message,
      signature: input.signature,
    });
  } catch {
    return false;
  }
}
