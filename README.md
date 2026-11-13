<p align="center">
  <img src="apps/web/public/logo.svg" width="76" height="76" alt="Succra logo" />
</p>

<h1 align="center">SUCCRA</h1>

<p align="center">
  <strong>Agents can fail. Missions don't have to.</strong>
</p>

<p align="center">
  <a href="https://succra.vercel.app"><img alt="Live app" src="https://img.shields.io/badge/live_app-succra.vercel.app-black?style=for-the-badge" /></a>
  <a href="docs/README.md"><img alt="Documentation" src="https://img.shields.io/badge/docs-read_the_build-00C805?style=for-the-badge" /></a>
  <a href="demo-video/succra_demo.mp4"><img alt="Demo video" src="https://img.shields.io/badge/demo_video-88_seconds-7C3AED?style=for-the-badge" /></a>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15-black?logo=nextdotjs" />
  <img alt="Solidity" src="https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity" />
  <img alt="Robinhood Chain" src="https://img.shields.io/badge/Robinhood_Chain-4663-00C805" />
  <img alt="x402" src="https://img.shields.io/badge/x402-EIP--3009-7C3AED" />
  <img alt="Contract tests" src="https://img.shields.io/badge/contract_tests-115_passing-brightgreen" />
  <img alt="WIF treasury" src="https://img.shields.io/badge/WIF-policy_bounded_treasury-f59e0b" />
</p>

Succra is a **non-custodial continuity layer for autonomous economic missions** on Robinhood Chain. The mission owns the vault, the policy, the session key, the checkpoints, and the succession rules; the agent receives only bounded, revocable authority. If the agent goes rogue, gets hacked, or disappears, the mission keeps its money, its history, and a path forward.

> Succra is not another agent wallet. It is the authority layer that lets a mission outlive the agent.

---

## Live Demo & Evidence (For Judges)

| Surface | Link |
|---|---|
| **Live app** | [succra.vercel.app](https://succra.vercel.app) |
| **Live simulation** | [succra.vercel.app/missions/demo](https://succra.vercel.app/missions/demo) |
| **Demo video** | [`demo-video/succra_demo.mp4`](demo-video/succra_demo.mp4) |
| **Documentation** | [`docs/README.md`](docs/README.md) |
| **Backend API** | [succra-backend.onrender.com](https://succra-backend.onrender.com) |
| **Explorer** | [Robinhood Chain Blockscout](https://robinhoodchain.blockscout.com) |

### Mainnet contracts

| Contract | Address |
|---|---|
| GuardianRegistry | [`0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B`](https://robinhoodchain.blockscout.com/address/0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B) |
| MissionFactory | [`0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917`](https://robinhoodchain.blockscout.com/address/0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917) |
| USDG mission | [`0x37522496E38f7859C96bCAC058d23f7296BB646b`](https://robinhoodchain.blockscout.com/address/0x37522496E38f7859C96bCAC058d23f7296BB646b) |
| WIF treasury mission | [`0x5bdC628D1b0c7DE78579E076398f4c5216e10e08`](https://robinhoodchain.blockscout.com/address/0x5bdC628D1b0c7DE78579E076398f4c5216e10e08) |
| Paxos USDG | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |
| WIF | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |

### Live simulation mode

The app includes a public **Live Simulation** at [`/missions/demo`](https://succra.vercel.app/missions/demo). Judges can execute the full continuity lifecycle against the live mainnet mission:

1. Run a real USDG x402 payment.
2. Run a policy-bounded WIF treasury transfer.
3. Inject three policy violations.
4. Quarantine the mission and revoke the session key.
5. Activate the pre-approved successor with a lower recovery ceiling.
6. Execute a recovery payment.

Every action produces a real Robinhood Chain transaction, visible in the mission timeline and linked to Blockscout.

---

## The Problem

Autonomous agents are becoming the operating layer for money, procurement, and online work. But most agent systems have a fatal architectural flaw:

> **The mission is bound to the agent.**

If the agent has a **$10,000 budget** and is compromised, the money is exposed. If the agent starts paying a scammer, there is no on-chain policy to stop it. If the agent crashes, the work stops. If the agent is replaced, the new agent usually starts from scratch with broad access and no inherited mission state.

The result is a choice between giving an agent too much authority or not letting it operate at all.

Succra removes that trade-off by moving continuity from the **agent** to the **mission**.

---

## The Solution

Succra gives every mission three guarantees.

### 1. Bounded Authority

The vault holds the funds. The agent never does.

- Funds live in `SuccraMission`, not in the agent's wallet.
- The runtime holds a scoped **session key**, not the owner's private key.
- The contract enforces per-payment ceilings, a cumulative budget, merchant allowlists, token rules, and expected state versions.
- The owner can withdraw unallocated funds at **any** mission status, including quarantine.

The agent can act, but it cannot drain the mission.

### 2. Quarantine

Three policy violations freeze the mission and revoke authority.

- Attempts to pay a non-allowlisted merchant, exceed the cap, exceed the budget, or use the wrong token count as policy violations.
- On the third violation, the guardian quarantines the mission.
- Quarantine immediately revokes the session key.
- No new payments can be approved. The owner can still withdraw.

The money stays in the vault. The mission stops spending without losing control.

### 3. Succession

A pre-approved backup agent inherits the mission, not the old keys.

- Successors are registered by the owner at mission creation.
- The successor is activated only from `QUARANTINED` or `RECOVERING`.
- The successor gets a **fresh session key** and a **lower recovery ceiling**.
- The mission keeps its vault, policy, checkpoints, and audit history.

The mission continues with reduced authority, never unrestricted authority.

### Two payment rails, one authority model

| Asset | Rail | What Succra enforces |
|---|---|---|
| **USDG** | x402 / EIP-3009 | Contract-as-signer via ERC-1271 (Variant A) or funded session-key signing (Variant B). Caps, merchants, budget, expiry, session-key state. |
| **WIF** | Policy-bounded ERC-20 treasury | `executeERC20Transfer` checks the token, merchant allowlist, per-payment ceiling, budget, and available balance. Policy failures record an on-chain violation. |

WIF is a standard ERC-20 without EIP-3009 support, so Succra treats it as a **treasury asset** with strict transfer policy. USDG remains the live x402 settlement asset.

```text
Owner wallet
   │ deposit / withdraw / successor management
   ▼
SuccraMission vault ──────────────────────────────┐
   │ policy · caps · status · checkpoints          │
   │ Variant A: ERC-1271 signer                    │
   ▼                                               ▼
x402 EIP-3009 authorization ──▶ USDG          WIF treasury transfer
   │                                               │
   ▼                                               ▼
Transfer log / settlement verification      allowlisted merchant
```

---

## The User Journey

### 1. Connect your wallet

Connect MetaMask, OKX, or another injected EVM wallet on Robinhood Chain. Your dashboard is scoped to the connected address. Private mission state requires a one-time wallet signature; the deployer address alone is never accepted as a credential.

### 2. Create a mission

Open [`/missions/new`](https://succra.vercel.app/missions/new). Choose **USDG** for x402 payments or **WIF** for treasury transfers. The mission gets a vault, a policy, a primary agent, and a pre-approved successor.

### 3. Deposit funds

Enter any amount greater than zero. USDG uses 6 decimals; WIF uses 18. The deposit is approved and moved into the mission vault. The owner keeps the unconditional withdrawal right.

### 4. Run the simulator

Open the [Live Simulation](https://succra.vercel.app/missions/demo) and use the mission detail controls:

- **Run USDG payment** — a real EIP-3009 settlement through the contract's ERC-1271 signer.
- **Run WIF Treasury Transfer** — a policy-bounded ERC-20 transfer.
- **Inject 3 violations** — simulate an agent repeatedly requesting disallowed payments.
- **Quarantine + withdraw** — revoke the session key and prove the owner can still withdraw.
- **Activate successor** — hand the mission to the pre-approved backup agent.
- **Recovery payment** — execute a payment under the lower recovery ceiling.

### 5. Activate the successor

Succession is not a restart. The successor inherits the mission's identity, vault, checkpoints, and policy, but only a reduced recovery budget. The old session key is gone.

### 6. Withdraw

The owner can withdraw unallocated funds directly from the vault at any status. No agent, guardian, or runtime cooperation is required.

> **Five-minute judge path:** Live app → View Live Demo Mission → Inject 3 violations → Quarantine + withdraw → Activate successor → Recovery payment.

---

## Architecture & Tech Stack

### The SuccraMission vault

`SuccraMission` is the authoritative source of mission authority and policy. It holds the mission token, tracks deposited/withdrawn/reserved/released/spent balances, enforces policy, and records checkpoints and violations. The owner can withdraw unallocated funds at any status.

### ERC-1271 — Variant A

`SuccraMission` implements `IERC1271.isValidSignature`.

1. The runtime computes an EIP-712 `TransferWithAuthorization` digest.
2. The guardian calls `approvePayment(hash, amount, merchant, expectedVersion)`.
3. The session key signs the EIP-3009 payload.
4. USDG calls `isValidSignature` because `from = SuccraMission`.
5. The contract checks the approved hash and recovers the session key.
6. A valid signature returns the ERC-1271 magic value `0x1626ba7e`.

**Mainnet proof:** Paxos USDG passed the real ERC-1271 probe. The transfer succeeded with `from = SuccraMission` and `authorizationState = true`.

### Variant B — funded session key

If a token does not code-route through ERC-1271, `releaseForPayment` transfers the exact approved amount from the vault to the session key. The session key then signs EIP-3009 directly with `from = sessionKey`. The contract still enforces status, cap, budget, and state version at release time.

### Session-key lifecycle

The session key is a scoped EIP-3009 signer held server-side by the Render runtime. It is **not** an owner/admin key.

```text
Mission created
  → session key registered by owner
  → agent requests payment
  → runtime preflights policy
  → runtime approves and submits
  → session key signs EIP-3009
  → three violations
  → quarantine revokes the session key
  → successor activated
  → new session key registered with the lower recovery cap
```

Agents never hold the session key, the vault funds, or the owner's private key.

### WIF treasury adapter

`executeERC20Transfer(token, to, amount)` is the policy-bounded path for plain ERC-20 treasury assets:

- `token` must equal the mission's configured payment token.
- `to` must be on the merchant allowlist.
- `amount` must be below the active per-payment ceiling.
- The cumulative budget and available balance must cover the transfer.
- A blocked attempt increments the violation streak and emits `TreasuryTransferBlocked`.
- A successful transfer emits `TreasuryTransfer` and resets the violation streak.

### Render runtime

The Render backend:

- holds the runtime session keys;
- builds and signs EIP-712/EIP-3009 payloads;
- submits policy-approved transactions;
- verifies settlement against the on-chain Transfer log;
- serves the owner-scoped dashboard state behind a signed wallet challenge;
- keeps the public Live Simulation available without exposing private dashboard state.

### Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Wallet | wagmi, viem, injected EVM wallets |
| Contracts | Solidity 0.8.24, Hardhat, OpenZeppelin |
| Payments | x402, EIP-3009, ERC-1271 |
| Chain | Robinhood Chain mainnet, chain ID `4663` |
| Backend | Next.js route handlers, viem, Node.js 24 |
| Database mirror | Neon Postgres |
| Deployment | Vercel frontend, Render backend |

Read the full design in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Local Development

### Prerequisites

- **Node.js 24**
- **pnpm 9+**
- A browser wallet for the connect-wallet UI

### Install

```bash
pnpm install
```

### Run the frontend

```bash
SUCCRA_ROOT="$PWD" pnpm --filter @succra/web dev
```

For the live-mainnet console, set:

```bash
export SUCCRA_DEMO_MODE=mainnet
export ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY=0x...
export DATABASE_URL=postgresql://...
```

Never commit those values.

### Compile and test the contracts

```bash
cd contracts
npx hardhat compile
npx hardhat test
```

Expected: **115 passing**.

### Run the x402 client tests

```bash
pnpm --filter @succra/x402-client typecheck
pnpm exec vitest run packages/x402-client/tests/client.test.ts
```

Expected: **5 passing**.

### Production build

```bash
pnpm --filter @succra/web build
```

### Deploy mainnet

```bash
cd contracts
npx hardhat run scripts/deploy-mainnet.ts --network robinhoodMainnet
```

### Verification snapshot

| Check | Result |
|---|---|
| `pnpm -r typecheck` | pass |
| `pnpm --filter @succra/contracts test` | **115 passing** |
| `pnpm --filter @succra/x402-client typecheck` | pass |
| `pnpm exec vitest run packages/x402-client/tests/client.test.ts` | **5 passing** |
| `pnpm --filter @succra/web build` | pass |
| Real Paxos USDG ERC-1271 probe | **PASS** |
| Mainnet continuity flow | **complete** |
| Live WIF treasury transfer | **PASS** (`0x4945743c…d3da4032014`) |
| Live WIF mission creation | **PASS** (`0xae311e03…a12ef92`) |

The legacy HashKey/Solana suites are retained for historical reference and are not part of the active Robinhood/x402 path.

---

## Documentation Index

| Document | What it covers |
|---|---|
| [Documentation Home](docs/README.md) | Judge path, developer path, operator path, and the full docs map |
| [Product Spec](docs/PROJECT_SPEC.md) | Business logic, policy rules, state machines, user flows, and acceptance criteria |
| [Architecture](docs/ARCHITECTURE.md) | Data model, ERC-1271 flow, session-key lifecycle, API, database, security, deployment |
| [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) | R0–R4 build sequence and acceptance gates |
| [Agent Rules](docs/AGENTS.md) | Scope, invariants, coding, security, and testing rules |
| [Session Handoff](docs/AI_HANDOFF.md) | Current live deployment, evidence, and open items |
| [Blueprint](docs/SUCCRA_BLUEPRINT.md) | Complete implementation-ready design reference |
| [Submission Package](docs/SUBMISSION.md) | Judge-facing pitch, mainnet evidence, limitations, and verification |

---

<p align="center">
  <strong>Succra</strong> · Built for World is Flat · Robinhood Chain 4663
</p>

<p align="center">
  <a href="https://succra.vercel.app">Live app</a> ·
  <a href="docs/README.md">Docs</a> ·
  <a href="https://github.com/onyebuchidaniel60/Succra">GitHub</a> ·
  <a href="https://robinhoodchain.blockscout.com">Blockscout</a>
</p>
