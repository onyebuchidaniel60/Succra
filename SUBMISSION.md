# Succra — Submission Package

## Project

**Succra** is a continuity layer for autonomous economic missions on Robinhood Chain.

Autonomous agents can fail, go rogue, or be compromised. Most agent systems bind the mission too tightly to the current agent, so the mission dies with it. Succra moves continuity from the agent to the mission: the mission owns the policy, the vault, the session key, the verified checkpoint, and the succession rules. Agents receive bounded execution authority. When authority becomes unsafe, Succra quarantines it, revokes the session key, and activates a pre-approved successor with a lower recovery ceiling.

**Agents can fail. Missions continue.**

## What is implemented

### Model A — program-controlled vault

- `SuccraMission` holds mission USDG or WIF directly.
- The owner deposits at mission creation and can withdraw unallocated funds at any status, including `QUARANTINED`.
- A runtime-held session key signs x402 EIP-3009 `TransferWithAuthorization` payloads. The owner never signs per payment.
- The owner registers, rotates, and revokes the session key.

### Variant A — contract signer via ERC-1271

- `SuccraMission.approvePayment(hash, amount, merchant, version)` records the EIP-712 authorization hash and enforces policy.
- `SuccraMission.isValidSignature(hash, signature)` returns `0x1626ba7e` only when the hash is approved and the signature recovers the registered session key.
- The token calls ERC-1271 when `from` is the mission contract.

### Variant B — funded session key fallback

- `releaseForPayment(sessionKey, amount, version)` releases exactly the approved amount.
- The session key signs EIP-3009 with `from=sessionKey`.
- The contract enforces status, caps, budget, and state version at release time.
- Both variants are implemented and covered by tests.

### WIF integration

The factory accepts an allowlisted settlement-token set. The demo deploys both:

- **USDG** — 6 decimals, `Global Dollar`
- **WIF** — 18 decimals, `World is Flat`

The UI mission cards, vault accounting, EIP-712 domain, and EIP-3009 signing are token-aware. A mission selects one settlement token at creation; the vault holds that token and the owner can withdraw it.

### x402 client

`packages/x402-client` provides:

- HTTP 402 `accepts[]` parsing and validation
- offer selection against mission policy
- canonical EIP-3009 typed data
- session-key signing
- payment payload construction
- deterministic mock facilitator
- Transfer-log verification

### Continuity flow

1. Create a mission and fund the vault.
2. Register a scoped session key.
3. Execute a valid x402 payment through EIP-3009.
4. Record three policy violations.
5. Quarantine the agent and revoke the session key.
6. Withdraw unallocated funds while quarantined.
7. Activate a pre-approved successor.
8. Register a new session key with the reduced recovery ceiling.
9. Execute a recovery payment.

## Demo

- Video: `demo-video/succra_demo.mp4`
- Resolution: 1920×1080, H.264/AAC
- Runtime: 68.3 seconds
- Voiceover: ElevenLabs, scene-synced
- Music: royalty-free “Lounge Noir” (Fesliyan Studios), mixed at 12%
- UI: `/demo` mission continuity console
- Chain: local Hardhat chain, chain ID 31337

The UI, contracts, token transfers, EIP-3009 signatures, quarantine, succession, and recovery are real state transitions. The local chain is used because the supplied `contracts/.env.local` does not contain `ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY`; no mainnet transactions are claimed.

## Local demo deployment

| Contract | Address |
|---|---|
| GuardianRegistry | `0x56fc17a65ccfec6b7ad0ade9bd9416cb365b9be8` |
| MissionFactory | `0x2625760c4a8e8101801d3a48ee64b2bea42f1e96` |
| USDG mission | `0xB98a617AcFBbFc7b8dCDb167b4486c7f20cF5930` |
| WIF mission | `0xD2372ef7d704876bE002105A0ae81C72C6eD4C29` |
| Demo USDG token | `0xfe5f411481565fbf70d8d33d992c78196e014b90` |
| Demo WIF token | `0xd6b040736e948621c5b6e0a494473c47a6113ea8` |

### Evidence transactions

- USDG x402 payment: `0x4843f7064127b1ebf11497e0ef04e5af47b43c07e2fecba3edd7c026410340b6`
- WIF x402 payment: `0x91c5b1c69680e018b8b85a6d728153f17419f742bbf80da35d66ba3eca190a3f`
- Third violation: `0x932953c668b251b6aa2446401584cc5f3db0a57d22dab5666389959b2d1c1431`
- USDG quarantine: `0x5ef4a60b5e0c2b6f0f21e64ba6217afb017ef19a045ab4a532c75cb3691bcccc`
- Owner withdrawal: `0x48d74d38d3ded63808c5fa87332990eda99ea151229dc6379d885c418b1eab18`
- Successor activation: `0x41330168adae0c46eb1f591a3121cf5c07166d10d8199b838b27876bbad221f3`
- Recovery acknowledgement: `0x4bda8c86765d574fb28c076231528cec1db7b8d24a6f1583a4b3fda73b0a5889`
- Recovery payment: `0x7ac2210173744083b5c70b01e194d23d6e78207bc000e9081bab25d6c3c69510`

## Mainnet configuration

- Chain: Robinhood mainnet, chain ID `4663`
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- WIF: `0x5173b8eA6923c2d40267890D45C46a3480954773`
- Deploy script: `contracts/scripts/deploy-mainnet.ts`
- Hardhat network: `robinhoodMainnet`

**Blocker:** no `ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY` exists in `contracts/.env.local` or the environment. The only configured signer is the testnet deployer, which has zero mainnet ETH. Mainnet contract addresses are therefore intentionally not fabricated.

## Verification

- `pnpm -r typecheck` — pass
- `pnpm --filter @succra/contracts test` — **107 passing**
- `pnpm --filter @succra/contracts compile` — pass
- `pnpm --filter @succra/x402-client typecheck` — pass
- `pnpm exec vitest run packages/x402-client/tests/client.test.ts` — **5 passing**
- `pnpm --filter @succra/web typecheck` — pass
- `pnpm --filter @succra/web build` — pass
- Targeted ESLint on new code — pass

The repository-wide legacy Vitest suite still has unrelated HashKey/Solana-era failures and slow PGlite hook timeouts; the new x402, vault, and UI paths are covered by the contract and package suites above.

## WIF integration details

- WIF is a first-class settlement token, not a mock label.
- The factory allowlist is configured with USDG and WIF before mission creation.
- Each mission commits one `paymentToken`; the vault accounting, `deposit`, `withdraw`, `approvePayment`, and `releaseForPayment` operate on that token.
- The EIP-712 domain uses the selected token name, version `1`, chain ID, and verifying contract.
- The UI renders token-aware decimals and amounts; WIF uses 18 decimals and USDG uses 6.
- A second mission demonstrates WIF end-to-end: deposit, EIP-3009 payment, violation path, and quarantine.

## Why this matters

Succra is not another agent wallet. It is the authority and continuity layer around an agent:

- funds are in a program-controlled vault, not in the agent;
- the owner keeps an unconditional withdrawal right;
- the session key is scoped, revocable, and never held by the agent;
- quarantine revokes authority immediately;
- successors inherit a lower ceiling, never unrestricted authority;
- every material step is visible as an on-chain event and a transaction hash.
