# Succra

> **Agents can fail. Missions don't have to.**

Succra is a Robinhood Chain-native continuity layer for autonomous economic missions. The mission owns a program-controlled vault, deterministic policy, a revocable session key, verified checkpoints, and pre-approved succession rules — so a failed, unsafe, or compromised agent does not take the mission down with it.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs)](https://nextjs.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-4663-00C805)](https://robinhoodchain.blockscout.com/)
[![x402](https://img.shields.io/badge/x402-EIP--3009-7C3AED)](https://x402.org/)
[![Contract tests](https://img.shields.io/badge/contract%20tests-107%20passing-brightgreen)](https://github.com/onyebuchidaniel60/Succra)
[![Live app](https://img.shields.io/badge/live%20app-succra.vercel.app-black)](https://succra.vercel.app)

---

## Live links

| Surface | URL |
|---|---|
| **Frontend** | https://succra.vercel.app |
| **Submitted hackathon link** | https://succra-osxcvllaa-uhhh2.vercel.app |
| **Backend API** | https://succra-backend.onrender.com |
| **Explorer** | https://robinhoodchain.blockscout.com |
| **Demo video** | [`demo-video/succra_demo.mp4`](demo-video/succra_demo.mp4) |

> The Render backend runs on a free instance. A cold start can take 30–60 seconds.

---

## Quick start — use the live app

1. **Connect your wallet.** Click **Connect Wallet** and choose MetaMask, OKX, or another injected EVM wallet. The dashboard is scoped to the connected address.
2. **Inspect your dashboard.** `/dashboard` shows only missions owned by the connected wallet. A wallet with no missions gets a clean empty state — the deployer’s private missions are never returned.
3. **Open the demo.** Click **View Live Demo Mission** to enter `/missions/demo`. This is the only public view of the deployer’s live mainnet missions. The owner wallet can additionally sign a short message to unlock private dashboard state.
4. **Create a mission.** `/missions/new` selects USDG or the WIF vault, deposits into the live USDG vault, and redirects to `/missions/<vault>` after success.
5. **Trigger continuity.** Inside the demo mission detail, use **Inject 3 violations** → **Quarantine + withdraw** → **Activate successor** → **Recovery payment** to walk the full lifecycle. Simulator controls live only on the mission detail page.

The live demo orchestrator executes mainnet transactions server-side so judges can reproduce the flow without funding a wallet. The owner-scoped dashboard requires a signed wallet challenge; a bare `?owner=0x...` query is not authorization.

---

## Architecture overview

```text
Owner wallet
   │  deposit / withdraw / session-key management
   ▼
SuccraMission vault ────────────────┐
   │  policy · caps · status · checkpoints
   │  Variant A: ERC-1271 signer     │
   ▼                                 ▼
x402 EIP-3009 authorization ───▶ USDG / allowlisted ERC-20
   │
   ▼
Facilitator / on-chain Transfer log ───▶ settlement verified
```

### The SuccraMission vault

`SuccraMission` holds mission USDG directly. The owner deposits at creation, can withdraw unallocated funds at **any** mission status, and never signs per payment. The contract enforces per-payment ceilings, cumulative budget, merchant/token allowlists, expiry, recovery ceilings, session-key state, and expected state versions.

### ERC-1271 — Variant A

`SuccraMission` implements `IERC1271.isValidSignature`. The runtime approves an EIP-712 authorization hash on-chain, the session key signs the EIP-3009 payload, and the token calls `isValidSignature` when `from` is the contract. A successful check returns the ERC-1271 magic value `0x1626ba7e`.

**Mainnet proof:** Paxos USDG passed the real ERC-1271 probe. The transfer succeeded with `from=SuccraMission` and `authorizationState=true`.

### Variant B

If a settlement token does not support ERC-1271, `releaseForPayment` transfers the exact approved amount to the session key, which signs EIP-3009 directly with `from=sessionKey`. The contract still enforces status, caps, and cumulative budget at release time.

### x402 and session keys

The runtime-held session key is a scoped EIP-3009 signer — not an owner/admin key. It is registered at mission creation, revoked on quarantine, and replaced on succession with the lower recovery cap. Agents never hold the session key, mission funds, or token signing keys.

### Continuity lifecycle

```text
Deposit → Valid x402 payment → 3 violations → Quarantine
       → Session key revoked → Owner withdrawal
       → Successor activated → New session key
       → Recovery payment → Mission continues
```

Read the full design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Mainnet deployment

| Contract | Address |
|---|---|
| GuardianRegistry | [`0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B`](https://robinhoodchain.blockscout.com/address/0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B) |
| MissionFactory | [`0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917`](https://robinhoodchain.blockscout.com/address/0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917) |
| USDG mission | [`0x37522496E38f7859C96bCAC058d23f7296BB646b`](https://robinhoodchain.blockscout.com/address/0x37522496E38f7859C96bCAC058d23f7296BB646b) |
| WIF treasury mission | [`0x5bdC628D1b0c7DE78579E076398f4c5216e10e08`](https://robinhoodchain.blockscout.com/address/0x5bdC628D1b0c7DE78579E076398f4c5216e10e08) |
| Paxos USDG | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |
| WIF | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |

> **WIF note:** WIF is a standard ERC-20 without EIP-3009. It cannot settle through x402, so Succra uses a policy-bounded `executeERC20Transfer` treasury path: allowlisted merchant, per-payment ceiling, cumulative budget, and on-chain violation recording. USDG remains the live x402 settlement asset.

---

## Local development

### Prerequisites

- **Node.js 24**
- **pnpm 9+**
- A browser wallet for the wallet-connect UI

### Install

```bash
pnpm install
```

### Run the frontend

```bash
SUCCRA_ROOT="$PWD" pnpm --filter @succra/web dev
```

For the live-mainnet console, also set:

```bash
export SUCCRA_DEMO_MODE=mainnet
export ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY=0x...
export DATABASE_URL=postgresql://...
```

### Contracts

```bash
cd contracts
npx hardhat compile
npx hardhat test
```

Expected: **107 passing**.

### x402 client

```bash
pnpm --filter @succra/x402-client typecheck
pnpm exec vitest run packages/x402-client/tests/client.test.ts
```

### Production build

```bash
pnpm --filter @succra/web build
```

### Deploy mainnet

```bash
cd contracts
npx hardhat run scripts/deploy-mainnet.ts --network robinhoodMainnet
```

---

## Documentation index

| Document | Description |
|---|---|
| [Product Spec](docs/PROJECT_SPEC.md) | Product requirements, flows, FRs, UI, payments, tests |
| [Architecture](docs/ARCHITECTURE.md) | Data model, contracts, API, security, payments, deployment |
| [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) | R0–R4 phase sequence and acceptance gates |
| [Agent Rules](docs/AGENTS.md) | Scope, invariants, coding/security/testing rules |
| [Session Handoff](docs/AI_HANDOFF.md) | Current deployment state and next task |
| [Blueprint](docs/SUCCRA_BLUEPRINT.md) | Complete implementation-ready design reference |
| [Submission Package](docs/SUBMISSION.md) | Hackathon text, addresses, evidence, limitations |

---

## Repository structure

```text
succra/
├── apps/web/              # Next.js frontend + API routes + mainnet demo orchestrator
├── contracts/             # Hardhat contracts, tests, mainnet scripts
├── packages/x402-client/  # 402 parsing, EIP-3009 typed data, signing, mock facilitator
├── db/migrations/         # Neon Postgres migrations
├── docs/                  # Source-of-truth specification and architecture
├── demo-video/            # Final 1080p demo video
├── apps/web/vercel.json   # Vercel project build configuration
└── render.yaml            # Render backend service definition
```

---

## Verification

| Check | Result |
|---|---|
| `pnpm -r typecheck` | pass |
| `pnpm --filter @succra/contracts test` | **107 passing** |
| `pnpm --filter @succra/x402-client typecheck` | pass |
| `pnpm exec vitest run packages/x402-client/tests/client.test.ts` | **5 passing** |
| `pnpm --filter @succra/web build` | pass |
| Real Paxos USDG ERC-1271 probe | **PASS** |
| Mainnet continuity flow | **complete** |
| Live WIF treasury transfer | **PASS** (`0x4945743c…d3da4032014`) |

The legacy HashKey/Solana test suites are retained for historical reference and are not part of the active x402 path.

---

## Security and limitations

- Private mission state is owner-scoped. The backend returns an empty state unless the request comes from the verified owner; the deployer address alone is public and is never accepted as a credential.
- Succra never holds owner private keys. The runtime holds only a scoped, revocable session key.
- Settlement is verified against the on-chain EIP-3009 Transfer log; a facilitator receipt alone is never confirmation.
- The live demo settles directly on-chain; the x402 client includes a mock facilitator, but no public facilitator is wired into the live path.
- WIF uses the policy-bounded ERC-20 treasury adapter, not x402; the live WIF mission is separately deployed with `executeERC20Transfer`.
- The Render free instance can cold-start slowly.
- The mainnet deployer key and Neon credentials are server-side secrets and are never committed.
