# Succra — Submission Package

> **Agents can fail. Missions don't have to.**

**Succra** is a non-custodial continuity layer for autonomous economic missions on Robinhood Chain. The mission owns the vault, policy, session key, checkpoints, and succession rules. The agent receives bounded, revocable authority. If the agent goes rogue, gets hacked, or disappears, the mission survives.

**Live app:** https://succra.vercel.app<br />
**Live simulation:** https://succra.vercel.app/missions/demo<br />
**Backend:** https://succra-backend.onrender.com<br />
**Demo video:** [`../demo-video/succra_demo.mp4`](../demo-video/succra_demo.mp4)<br />
**Docs:** [`README.md`](./README.md)

---

## The problem: the mission dies with the agent

Autonomous agents are becoming the operating layer for money, procurement, and online work. Most agent systems still bind the mission too tightly to the current agent.

> If an agent has a **$10,000 budget** and is compromised, the money is exposed. If it starts paying a scammer, there is no on-chain policy to stop it. If it crashes, the work stops.

The usual responses are equally bad:

- give the agent broad wallet access and hope it behaves;
- keep a human in every payment loop and lose the autonomy;
- stop the mission and rebuild from scratch when the agent changes;
- give the replacement agent broad access with no inherited context.

Succra moves continuity from the **agent** to the **mission**.

---

## The solution: three guarantees

### 1. Bounded authority

Funds live in `SuccraMission`, not in the agent's wallet.

- The owner deposits at creation and can withdraw unallocated funds at **any** status.
- The agent never holds the session key, the vault, or the owner's private key.
- The contract enforces per-payment ceilings, cumulative budget, merchant allowlists, token rules, and expected state versions.
- The runtime holds a scoped session key, not an owner/admin key.

The agent can act. It cannot drain the mission.

### 2. Quarantine

Three authenticated policy violations freeze execution and revoke authority.

- A blocked request counts only when it is authenticated, signed by the current agent, and rejected by a mission policy rule.
- On threshold, the guardian quarantines the mission and revokes the session key.
- No new USDG x402 payments or WIF treasury transfers can execute.
- The owner can still withdraw unallocated funds immediately.
- There is no `QUARANTINED → ACTIVE` shortcut.

The money stays in the vault. The mission stops spending without losing control.

### 3. Succession

A pre-approved backup agent inherits the mission, not the old keys.

- Successors are registered by the owner at mission creation.
- Activation requires `QUARANTINED` or `RECOVERING`; the current agent cannot be reactivated as its own successor.
- The successor gets a fresh session key and a **lower recovery ceiling**.
- The mission keeps its vault, policy, checkpoints, and audit trail.

The mission continues with reduced authority, never unrestricted authority.

---

## Two settlement rails, one authority model

| Asset | Rail | Enforcement |
|---|---|---|
| **USDG** | x402 / EIP-3009 | ERC-1271 contract signer (Variant A) or funded session key (Variant B); caps, merchants, budget, state versions |
| **WIF** | Policy-bounded ERC-20 treasury | `executeERC20Transfer` checks token + merchant allowlists, per-payment ceiling, budget, available balance, and records violations |

WIF is a standard ERC-20 without EIP-3009 support. Succra does not pretend it is an x402 asset. It treats WIF as a **treasury asset** with strict transfer policy. USDG remains the live x402 settlement asset.

---

## Live demo: the five-minute judge path

1. Open https://succra.vercel.app.
2. Click **View Live Demo Mission**.
3. Click **Run USDG payment** to execute a real EIP-3009 settlement through the contract's ERC-1271 signer.
4. Click **Run WIF Treasury Transfer** to execute a policy-bounded ERC-20 treasury transfer.
5. Click **Inject 3 violations** to simulate an unsafe agent.
6. Click **Quarantine + withdraw** to revoke the session key and prove the owner can still withdraw.
7. Click **Activate successor** to hand the mission to the pre-approved backup agent.
8. Click **Recovery payment** to execute under the lower recovery ceiling.

Every action produces a real Robinhood Chain transaction, shown in the mission timeline and linked to Blockscout.

> The Render backend may cold-start in 30–60 seconds on the free tier.

---

## What is implemented

### Contracts

- `SuccraMission` — vault custody, policy, authority state, session key, checkpoints, quarantine, succession, recovery, ERC-1271.
- `MissionFactory` — deploy missions owned by `msg.sender`, enforce the token allowlist, index missions by owner.
- `GuardianRegistry` — global guardian, owner-rotatable.
- `executeERC20Transfer` — policy-bounded treasury path for plain ERC-20 assets such as WIF.

### USDG x402 — Variant A

1. Runtime computes the EIP-712 `TransferWithAuthorization` digest.
2. Guardian calls `approvePayment(hash, amount, merchant, expectedVersion)`.
3. Session key signs the EIP-3009 payload.
4. USDG calls `isValidSignature` because `from = SuccraMission`.
5. Contract verifies the approved hash and recovers the session key.
6. A valid check returns `0x1626ba7e`.

**Mainnet proof:** Paxos USDG passed the real ERC-1271 probe. The transfer succeeded with `from = SuccraMission` and `authorizationState = true`.

### USDG x402 — Variant B

- `releaseForPayment(sessionKey, amount, expectedVersion)` transfers exactly the approved amount to the session key.
- The session key signs EIP-3009 directly with `from = sessionKey`.
- The contract still enforces status, cap, budget, and state version at release time.

### WIF treasury path

- `executeERC20Transfer(token, to, amount)` is guardian-only.
- Enforces token, merchant, per-payment cap, budget, available balance, and status.
- Blocked attempts increment the violation streak and emit `TreasuryTransferBlocked`.
- Successful transfers emit `TreasuryTransfer` and reset the violation streak.

### Runtime and privacy

- Render runtime holds the session keys and orchestrates policy-approved transactions.
- Owner-scoped dashboard state requires a signed wallet challenge and a short-lived bearer token.
- A bare `?owner=0x...` is not authorization.
- The public Live Simulation is explicitly opt-in via `/missions/demo`.
- The deployer address is public; it is never treated as a credential.

### Frontend

- Next.js 15, React 19, TypeScript, Tailwind.
- wagmi/viem wallet connection.
- Editable USDG/WIF deposit amounts.
- Owner-scoped dashboard with empty state.
- Mission detail with vault balances, timeline, and **Connect Agent** snippet.
- Owner Controls on private mission detail: amount input, **Max** autofill, direct `withdraw` transaction via wagmi, and balance refresh.
- Live simulation controls only on the demo mission detail.
- Professional footer, logo, and favicon.

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

- Chain ID: `4663`
- RPC: `https://rpc.mainnet.chain.robinhood.com`
- Explorer: `https://robinhoodchain.blockscout.com`

### Mainnet evidence

| Evidence | Transaction |
|---|---|
| Real Paxos USDG ERC-1271 probe | [`0x7024fd41…cea3a8`](https://robinhoodchain.blockscout.com/tx/0x7024fd4153b3d378952118002122ea9861ded8998bac032d5eaeae0de0cea3a8) |
| USDG EIP-3009 payment | [`0xbcb910b8…528000`](https://robinhoodchain.blockscout.com/tx/0xbcb910b839c792160325abd00c515455560d0f0e68a356bc9f24d143f9528000) |
| Third violation | [`0x9997d68f…20e5df`](https://robinhoodchain.blockscout.com/tx/0x9997d68f984a29c28f3109662f7e937fb725fc2ebf9a26adc40abd59ed20e5df) |
| USDG quarantine | [`0xb4177d94…251e4f`](https://robinhoodchain.blockscout.com/tx/0xb4177d9487ab6e30412770d547d5838a33f6637d9ac7d52b01d536132b251e4f) |
| Owner withdrawal while quarantined | [`0xcf013457…b4aada`](https://robinhoodchain.blockscout.com/tx/0xcf0134577703090575699c452a008a23b272fc841a701efa311710326eb4aada) |
| Successor activation | [`0x6594d51e…3adebdf06`](https://robinhoodchain.blockscout.com/tx/0x6594d51e6fee11696425780222cb675a4b92514f4248b7eab95f6053adebdf06) |
| Recovery acknowledgement | [`0x08dde2ce…29ea9a0b`](https://robinhoodchain.blockscout.com/tx/0x08dde2cedae2c7fc6f3942ec8fbeaef8177b88647e86fe74f82607e329ea9a0b) |
| Recovery payment | [`0x0049f7fc…655b8fc`](https://robinhoodchain.blockscout.com/tx/0x0049f7fc029b92f093257b6dab49605794dc271bb8f57360251d89a7a655b8fc) |
| WIF treasury deployment | [`0x74645d94…d296ea`](https://robinhoodchain.blockscout.com/tx/0x74645d94a5619c4ff7d22d92834c8377ed757ee52f63ff4ed108ee2443d296ea) |
| Live WIF treasury transfer | [`0x4945743c…d3da4032014`](https://robinhoodchain.blockscout.com/tx/0x4945743cc237cb65ca2e6ec7a5c120df6e8d3cdfdd6ad4b34ec6d3d9a4032014) |
| Live 1 WIF mission deposit | [`0xae311e03…a12ef92`](https://robinhoodchain.blockscout.com/tx/0xae311e032f500df429ed4c80b9aa0295cb152fbb7d8270e70eda58a4fa12ef92) |

---

## Verification

| Check | Result |
|---|---|
| `pnpm -r typecheck` | pass |
| `pnpm --filter @succra/contracts test` | **115 passing** |
| `pnpm --filter @succra/contracts compile` | pass |
| `pnpm --filter @succra/x402-client typecheck` | pass |
| `pnpm exec vitest run packages/x402-client/tests/client.test.ts` | **5 passing** |
| `pnpm --filter @succra/web typecheck` | pass |
| `pnpm --filter @succra/web build` | pass |
| Demo auth/privacy tests | **5 passing** |
| Real Paxos USDG ERC-1271 probe | **PASS** |
| Mainnet continuity flow | **complete** |
| Live WIF treasury transfer | **PASS** |
| Live 1 WIF mission creation | **PASS** |

The repository-wide legacy Vitest suite still has unrelated HashKey/Solana-era failures and slow PGlite hook timeouts. The active Robinhood/x402/WIF paths are covered by the contract, package, and targeted web tests above.

---

## Honest limitations

- **WIF is not an x402 asset.** It is a plain ERC-20; Succra uses a policy-bounded treasury transfer path instead of pretending EIP-3009 works.
- **The live app is owner-operated.** The public can explore the Live Simulation. Non-owner wallets get an empty dashboard; multi-tenant factory creation from the UI is not enabled.
- **The live demo settles directly on-chain.** The x402 client includes a mock facilitator, but no public facilitator is wired into the live settlement path. The on-chain token and contract state are authoritative.
- **Render free tier can cold-start.** The first request may take 30–60 seconds.
- **The WIF token has its own post-transfer mechanics.** The vault records the submitted amount; the token contract determines the recipient's final balance behavior.
- **Historical HashKey/Solana code remains in the repository** for context and is not part of the active Robinhood path.
- **Secrets are server-side only.** The mainnet deployer key and Neon credentials are never committed.

---

## Why this is different

Succra is not another agent wallet, payment wrapper, or monitoring dashboard.

- Funds are in a program-controlled vault, not in the agent.
- The owner keeps an unconditional withdrawal right.
- The session key is scoped, revocable, and never held by the agent.
- Quarantine revokes authority immediately.
- Successors inherit a lower ceiling, never unrestricted authority.
- Every material step is an on-chain event with a transaction hash.
- The same authority model covers an x402 asset (USDG) and a plain ERC-20 treasury asset (WIF).

**The mission is the durable unit. Agents are replaceable.**

---

## Links

- [Root README](../README.md)
- [Documentation home](./README.md)
- [Architecture](./ARCHITECTURE.md)
- [Product Spec](./PROJECT_SPEC.md)
- [Implementation Plan](./IMPLEMENTATION_PLAN.md)
- [Agent Rules](./AGENTS.md)
- [Session Handoff](./AI_HANDOFF.md)
- [Blueprint](./SUCCRA_BLUEPRINT.md)
- [Live app](https://succra.vercel.app)
- [Live simulation](https://succra.vercel.app/missions/demo)
- [GitHub](https://github.com/onyebuchidaniel60/Succra)
