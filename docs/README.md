# Succra Documentation

> **Agents can fail. Missions don't have to.**

This is the table of contents for the Succra source-of-truth documentation. The root [`README.md`](../README.md) is the product story; this folder is the build, evidence, and operating manual.

---

## Start here

| I am… | Read this first |
|---|---|
| **A judge or first-time visitor** | [Root README](../README.md) → [Submission Package](./SUBMISSION.md) → [Architecture overview](./ARCHITECTURE.md#8-system-architecture) |
| **An end user** | [Root quick start](../README.md#the-user-journey) → [Product Spec user flows](./PROJECT_SPEC.md#4-complete-user-flows) |
| **A developer** | [Architecture](./ARCHITECTURE.md) → [Product Spec](./PROJECT_SPEC.md) → [Agent Rules](./AGENTS.md) |
| **An operator** | [Session Handoff](./AI_HANDOFF.md) → [Architecture deployment](./ARCHITECTURE.md#8-system-architecture) → [Implementation Plan](./IMPLEMENTATION_PLAN.md) |
| **Reviewing the full design** | [Blueprint](./SUCCRA_BLUEPRINT.md) |

---

## Live deployment

| Surface | Link |
|---|---|
| Live app | [succra.vercel.app](https://succra.vercel.app) |
| Live simulation | [succra.vercel.app/missions/demo](https://succra.vercel.app/missions/demo) |
| Backend | [succra-backend.onrender.com](https://succra-backend.onrender.com) |
| Explorer | [Robinhood Chain Blockscout](https://robinhoodchain.blockscout.com) |
| Demo video | [`../demo-video/succra_demo.mp4`](../demo-video/succra_demo.mp4) |

### Mainnet contracts

| Contract | Address |
|---|---|
| GuardianRegistry | [`0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B`](https://robinhoodchain.blockscout.com/address/0x11cE6039d45faDa4EfBd72AF496A08FEA077f31B) |
| MissionFactory | [`0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917`](https://robinhoodchain.blockscout.com/address/0x37d25d2dE8e52188A37A98EdD2b5622B5E4B2917) |
| USDG mission | [`0x37522496E38f7859C96bCAC058d23f7296BB646b`](https://robinhoodchain.blockscout.com/address/0x37522496E38f7859C96bCAC058d23f7296BB646b) |
| WIF treasury mission | [`0x5bdC628D1b0c7DE78579E076398f4c5216e10e08`](https://robinhoodchain.blockscout.com/address/0x5bdC628D1b0c7DE78579E076398f4c5216e10e08) |
| Paxos USDG | [`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |
| WIF | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |

---

## Document map

| Document | Purpose | Read when |
|---|---|---|
| [PROJECT_SPEC.md](./PROJECT_SPEC.md) | Product definition, roles, flows, functional requirements, policy rules, mission/agent/action state machines, UI, and test strategy | You need the business logic or acceptance criteria |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Data model, contract authority, ERC-1271 Variant A, Variant B, session-key lifecycle, API, database behavior, security, and deployment | You need to understand or change the system |
| [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) | R0–R4 phase sequence, dependencies, and acceptance gates | You are planning or auditing delivery |
| [AGENTS.md](./AGENTS.md) | Non-negotiable invariants, scope discipline, coding rules, security rules, testing rules, Git rules, and stop rules | You are about to change code |
| [AI_HANDOFF.md](./AI_HANDOFF.md) | Current live state, latest evidence, completed checkpoints, and known limitations | You need the current operating picture |
| [SUCCRA_BLUEPRINT.md](./SUCCRA_BLUEPRINT.md) | Complete implementation-ready design reference and historical decisions | You need deep background or protocol rationale |
| [SUBMISSION.md](./SUBMISSION.md) | Judge-facing pitch, live demo, mainnet evidence, verification, and honest limitations | You are evaluating the hackathon submission |

---

## What Succra is

Succra is a non-custodial continuity layer for autonomous economic missions on Robinhood Chain. The mission owns the vault, policy, session key, checkpoints, and succession rules. The agent receives bounded, revocable authority. If the agent goes rogue, gets compromised, or disappears, the mission survives.

### Three pillars

1. **Bounded authority** — funds stay in `SuccraMission`; the agent gets policy-limited execution authority, never withdrawal rights.
2. **Quarantine** — three authenticated policy violations revoke the session key and freeze execution while preserving the owner's withdrawal right.
3. **Succession** — a pre-approved successor inherits the mission with a fresh session key and a lower recovery ceiling.

### Two settlement paths

| Asset | Path | Policy |
|---|---|---|
| USDG | x402 / EIP-3009 | ERC-1271 contract signer (Variant A) or funded session key (Variant B); caps, merchants, budget, expiry |
| WIF | Policy-bounded ERC-20 treasury | `executeERC20Transfer`; token + merchant allowlists, cap, budget, available balance, violation recording |

---

## Evidence snapshot

| Evidence | Link |
|---|---|
| Real Paxos USDG ERC-1271 probe | [`0x7024fd41…cea3a8`](https://robinhoodchain.blockscout.com/tx/0x7024fd4153b3d378952118002122ea9861ded8998bac032d5eaeae0de0cea3a8) |
| USDG EIP-3009 payment | [`0xbcb910b8…528000`](https://robinhoodchain.blockscout.com/tx/0xbcb910b839c792160325abd00c515455560d0f0e68a356bc9f24d143f9528000) |
| WIF treasury deployment | [`0x74645d94…d296ea`](https://robinhoodchain.blockscout.com/tx/0x74645d94a5619c4ff7d22d92834c8377ed757ee52f63ff4ed108ee2443d296ea) |
| Live WIF treasury transfer | [`0x4945743c…d3da4032014`](https://robinhoodchain.blockscout.com/tx/0x4945743cc237cb65ca2e6ec7a5c120df6e8d3cdfdd6ad4b34ec6d3d9a4032014) |
| Live 1 WIF mission deposit | [`0xae311e03…a12ef92`](https://robinhoodchain.blockscout.com/tx/0xae311e032f500df429ed4c80b9aa0295cb152fbb7d8270e70eda58a4fa12ef92) |
| Successor activation | [`0x6594d51e…3adebdf06`](https://robinhoodchain.blockscout.com/tx/0x6594d51e6fee11696425780222cb675a4b92514f4248b7eab95f6053adebdf06) |
| Recovery payment | [`0x0049f7fc…655b8fc`](https://robinhoodchain.blockscout.com/tx/0x0049f7fc029b92f093257b6dab49605794dc271bb8f57360251d89a7a655b8fc) |

Verification: `pnpm -r typecheck` pass, contracts **115 passing**, x402 client **5 passing**, web build pass. See [SUBMISSION.md](./SUBMISSION.md#verification) for the full table.

---

## Documentation conventions

- **Contract behavior is authoritative.** The database and UI are mirrors and indexes.
- **Never fabricate a transaction.** Every hash in these documents points to a real Blockscout transaction.
- **Architecture changes require an explicit plan update.** See [AGENTS.md](./AGENTS.md).
- **Historical HashKey/Solana material is retained for context, not as the active path.** The active path is Robinhood Chain 4663.
- **Secrets are server-side only.** The deployer key and database credentials are never committed.

---

<p align="center">
  <a href="../README.md">← Back to the product README</a> ·
  <a href="https://succra.vercel.app">Live app</a> ·
  <a href="https://github.com/onyebuchidaniel60/Succra">GitHub</a>
</p>
