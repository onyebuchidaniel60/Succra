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

The factory accepts an allowlisted settlement-token set. Mainnet configuration uses:

- **Paxos USDG** — 6 decimals, `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- **WIF** — 18 decimals, `0x5173b8eA6923c2d40267890D45C46a3480954773`

The local deterministic demo deploys interface-compatible mock tokens (`Global Dollar` / `World is Flat`) so the full EIP-3009 flow can run without mainnet funds. The UI mission cards, vault accounting, EIP-712 domain, and EIP-3009 signing are token-aware. A mission selects one settlement token at creation; the vault holds that token and the owner can withdraw it.

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

- Live frontend: https://succra.vercel.app
- Live backend: https://succra-backend.onrender.com
- Video: `demo-video/succra_demo.mp4`
- Resolution: 1920×1080, H.264/AAC
- Runtime: 88.3 seconds
- Voiceover: ElevenLabs, scene-synced
- Music: royalty-free “Lounge Noir” (Fesliyan Studios), mixed at 12%
- Chain: Robinhood mainnet, chain ID `4663`

The video was recorded against the live Vercel UI and the Render backend, which reads the live mainnet mission state. The transaction hashes shown in the UI are real Robinhood mainnet transactions linked to Blockscout.

**Settlement note:** the live demo executes the on-chain EIP-3009 `transferWithAuthorization` settlement directly against Paxos USDG. The x402 client includes a mock facilitator, but no public facilitator is wired into the live settlement path; the on-chain token and contract state are authoritative.

## Mainnet deployment

| Contract | Address |
|---|---|
| GuardianRegistry | `0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B` |
| MissionFactory | `0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917` |
| USDG mission | `0x37522496E38f7859C96bCAC058d23f7296BB646b` |
| WIF treasury mission | `0x5bdC628D1b0c7DE78579E076398f4c5216e10e08` |

- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- WIF: `0x5173b8eA6923c2d40267890D45C46a3480954773`
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`

### Mainnet evidence

- USDG ERC-1271 probe PASS: `0x7024fd4153b3d378952118002122ea9861ded8998bac032d5eaeae0de0cea3a8`
- USDG EIP-3009 payment: `0xbcb910b839c792160325abd00c515455560d0f0e68a356bc9f24d143f9528000`
- Third violation: `0x9997d68f984a29c28f3109662f7e937fb725fc2ebf9a26adc40abd59ed20e5df`
- USDG quarantine: `0xb4177d9487ab6e30412770d547d5838a33f6637d9ac7d52b01d536132b251e4f`
- Owner withdrawal: `0xcf0134577703090575699c452a008a23b272fc841a701efa311710326eb4aada`
- Successor activation: `0x6594d51e6fee11696425780222cb675a4b92514f4248b7eab95f6053adebdf06`
- Recovery acknowledgement: `0x08dde2cedae2c7fc6f3942ec8fbeaef8177b88647e86fe74f82607e329ea9a0b`
- Recovery payment: `0x0049f7fc029b92f093257b6dab49605794dc271bb8f57360251d89a7a655b8fc`

Every hash links to `https://robinhoodchain.blockscout.com/tx/<hash>`.

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

- WIF is a first-class vault asset and factory-allowlisted token; a live WIF mission holds 1 WIF.
- **Mainnet finding:** the deployed WIF token is a plain ERC-20. Its bytecode exposes neither `transferWithAuthorization` (`0xe3ee160e`) nor `isValidSignature` (`0x1626ba7e`). A real WIF EIP-3009 attempt reverted before any transfer. WIF now uses the separately deployed policy-bounded treasury mission `0x5bdC628D1b0c7DE78579E076398f4c5216e10e08` and `executeERC20Transfer`.
- Because x402 EIP-3009 is the only authorized payment rail, WIF cannot settle through x402 on this deployment. USDG remains the live settlement asset.
- The UI shows the WIF mission as a vault position and explicitly labels the WIF x402 path unavailable instead of faking a payment.
- The contract/factory support selecting WIF as `paymentToken`; a future WIF wrapper or an EIP-3009-compatible WIF deployment would enable the full flow.
- USDG uses 6 decimals and WIF uses 18; the UI renders both token-aware.

## Why this matters

Succra is not another agent wallet. It is the authority and continuity layer around an agent:

- funds are in a program-controlled vault, not in the agent;
- the owner keeps an unconditional withdrawal right;
- the session key is scoped, revocable, and never held by the agent;
- quarantine revokes authority immediately;
- successors inherit a lower ceiling, never unrestricted authority;
- every material step is visible as an on-chain event and a transaction hash.
