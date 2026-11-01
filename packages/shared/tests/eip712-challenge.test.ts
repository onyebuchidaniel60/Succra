import { describe, expect, it } from 'vitest';
import { hashTypedData } from 'viem';
import {
  AGENT_CHALLENGE_PURPOSE,
  AGENT_CHALLENGE_TYPES,
  buildAgentChallengeTypedData,
} from '../src/eip712.js';

const AGENT = `0x${'22'.repeat(20)}` as const;
const CHALLENGE = `0x${'33'.repeat(32)}` as const;

describe('AgentChallenge EIP-712 typed data', () => {
  it('is well-formed and purpose-bound without a verifying contract', () => {
    const typedData = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: CHALLENGE,
      expiresAt: 2_000_000_000n,
      chainId: 177,
    });
    expect(typedData.domain).toEqual({ name: 'Succra', version: '1', chainId: 177n });
    expect('verifyingContract' in typedData.domain).toEqual(false);
    expect(typedData.types).toEqual(AGENT_CHALLENGE_TYPES);
    expect(typedData.primaryType).toEqual('AgentChallenge');
    expect(typedData.message).toEqual({
      agentAddress: AGENT,
      challenge: CHALLENGE,
      expiresAt: 2_000_000_000n,
      purpose: AGENT_CHALLENGE_PURPOSE,
    });
  });

  it('accepts a 32-byte challenge with or without the 0x prefix', () => {
    const prefixed = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: CHALLENGE,
      expiresAt: 2_000_000_000n,
      chainId: 177,
    });
    const bare = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: CHALLENGE.slice(2),
      expiresAt: 2_000_000_000n,
      chainId: 177,
    });
    expect(bare.message.challenge).toEqual(prefixed.message.challenge);
    expect(() =>
      buildAgentChallengeTypedData({
        agentAddress: AGENT,
        challenge: '0x1234',
        expiresAt: 2_000_000_000n,
        chainId: 177,
      })
    ).toThrow('32-byte hex');
  });

  it('changes the digest when any signed field changes', () => {
    const base = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: CHALLENGE,
      expiresAt: 2_000_000_000n,
      chainId: 177,
    });
    const otherChallenge = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: `0x${'44'.repeat(32)}`,
      expiresAt: 2_000_000_000n,
      chainId: 177,
    });
    const otherExpiry = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: CHALLENGE,
      expiresAt: 2_000_000_001n,
      chainId: 177,
    });
    const otherChain = buildAgentChallengeTypedData({
      agentAddress: AGENT,
      challenge: CHALLENGE,
      expiresAt: 2_000_000_000n,
      chainId: 133,
    });

    const digests = [base, otherChallenge, otherExpiry, otherChain].map((typedData) =>
      hashTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      })
    );
    expect(new Set(digests).size).toEqual(4);
  });
});
