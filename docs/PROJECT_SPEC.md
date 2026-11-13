# SUCCRA — PROJECT_SPEC.md

# 1. PRODUCT DEFINITION

## Product name
**Succra**

## One-line description
**Succra is a Robinhood Chain-native continuity layer for autonomous economic missions. Payments are the MVP proving ground; the continuity mechanism generalizes to any agent action.**

## Problem
Autonomous agents can make decisions and control economic resources continuously, but most agent systems bind the mission too tightly to the current agent. When the agent becomes unsafe, unavailable, compromised, or otherwise unfit to continue, the available responses are usually to stop the mission, manually intervene, restart the workflow, or give a new agent broad access from scratch.

Succra changes the unit of continuity from the **agent** to the **mission**. The mission owns the policy, budget, verified state, succession rules, and authority boundary. Agents temporarily receive execution authority over that mission.

## Current alternatives / workarounds
Current approaches include:
- agent-side retries and restarts;
- human operators manually revoke credentials and restart work;
- agent firewalls that allow/block individual actions;
- generic delegation systems;
- agent-to-agent handoffs or context transfer;
- multisig/manual approval workflows;
- infrastructure-level failover.

These approaches may solve individual pieces, but Succra focuses on the complete economic lifecycle: **mission authority → failure → quarantine → verified state boundary → constrained succession → continued execution**.

## Target users
### Primary
Developers and operators building autonomous agents that can control money or other consequential economic authority on Robinhood Chain.

### Secondary
- AI-agent application builders
- DeFi/treasury automation developers
- protocol teams operating autonomous agents
- businesses that want bounded autonomous economic agents
- future agent platforms that need portable continuity

## User roles
### Mission Owner
Human EVM wallet owner who creates the mission, approves the mission's x402 offer policy, deposits and withdraws mission USDG, registers the session key, defines policy, approves successors, and retains ultimate control. The owner never signs per-payment EIP-3009 authorizations.

### Primary Agent
The autonomous agent currently authorized to request x402 payments under the mission policy.

### Successor Agent
A pre-approved agent eligible to receive authority when the primary loses mission authority.

### Succra Guardian
A constrained protocol/runtime role that can trigger quarantine and activate only pre-approved successor agents according to the mission policy. The guardian cannot spend, move funds, change the owner, change policy, or add successors.

### Succra Runtime
Off-chain orchestration/monitoring component. It holds the session key server-side and submits payments within the on-chain policy. It does not become the custodian of mission funds; mission USDG is held by the SuccraMission contract, and the owner can withdraw it unilaterally.

## Core value proposition
**The mission survives even when the agent does not.**

Succra gives users:
1. bounded economic authority;
2. automatic or operator-triggered quarantine;
3. verified mission checkpoints;
4. controlled successor activation;
5. reduced recovery authority;
6. verifiable execution history.

## Key differentiator
Succra treats **mission continuity** as the primitive. It does not attempt to modify, restart, or inspect an agent's private internals. It controls the authority surrounding the agent and transfers only policy-approved, verifiable mission state.

## Primary use case
A user creates an economic mission with bounded authority — in the MVP, a payment/rebalancing mission including A2A API payments — and approves the mission's x402 offer policy. The owner deposits USDG into SuccraMission and registers a runtime-held session key. Agent Alpha requests authorized x402 payments; the session key signs the EIP-3009 authorizations. Alpha makes repeated policy violations. Succra quarantines Alpha, revokes the session key, preserves the last verified checkpoint, activates successor Beta with a lower emergency authority limit, and lets Beta continue the mission. The owner can withdraw remaining funds at any time.

## Secondary use cases
- x402 API payments (MVP);
- future: trading agents, procurement, governance, treasury rebalancing — the same continuity primitive.

## Explicit non-goals
Succra MVP does **not**:
- rewrite or modify agent code;
- host arbitrary third-party agents;
- provide a generic agent marketplace;
- provide generic insurance;
- provide generalized agent reputation across all projects;
- guarantee agent profitability;
- guarantee perfect detection of malicious behavior;
- custody user private keys;
- execute arbitrary contracts, arbitrary ERC-20 transfers, or any payment path that bypasses x402;
- trust an LLM as the authoritative security decision-maker;
- support Solana in MVP;
- Succra holding signing keys the owner cannot revoke;
- delegated authority that survives quarantine;
- any withdrawal path that requires agent or guardian cooperation;
- make $SUCCRA token ownership necessary for mission operation.

---

# 2. MVP SCOPE

## MUST HAVE
1. EVM wallet-based user authentication with EIP-712.
2. Mission creation.
3. Mission policy creation with:
   - total budget;
   - per-payment limit;
   - merchant allowlist;
   - allowed token address;
   - X402_PAYMENT action type;
   - expiry;
   - primary agent;
   - ordered successor list.
4. SuccraMission holds mission USDG; owner deposits at creation; owner withdraws unilaterally at any status.
5. Agent registration with EVM address and EIP-712 possession proof.
6. EIP-712-signed agent payment requests.
7. Deterministic policy engine.
8. x402 accepts[] offers constrain each payment (asset, network, payee, amount, expiry). Settlement is EIP-3009 `transferWithAuthorization` of USDG (default) or an allowlisted ERC-20, with SuccraMission as the `from` (Variant A) or a session key funded on-demand by SuccraMission (Variant B); R1-spike decides which. Native ETH is gas only.
9. Session key registered at mission creation, revoked on quarantine, and replaced on succession.
10. Consecutive policy-violation tracking.
11. Automatic quarantine after 3 consecutive blocked actions within the mission's configured window.
12. Succra guardian quarantine authority that cannot spend mission funds.
13. Verified checkpoint creation based on deterministic mission facts.
14. Successor selection from pre-approved successors.
15. Restricted recovery authority for successor.
16. Successful successor execution.
17. Audit timeline for actions, failures, quarantine, succession, and execution.
18. Publicly verifiable Robinhood transaction hash and x402 payment ID / EIP-3009 authorization nonce for executed mission payments.
19. End-to-end demo path proving continuity.

## SHOULD HAVE
1. Heartbeat/liveness monitoring and quarantine after repeated missed heartbeats.
2. Successor suitability score based on deterministic capability/health signals.
3. AI-generated successor recommendation/explanation, never authoritative.
4. On-chain checkpoint hash commitment.
5. Mission continuity metrics: recovery time, capital preserved, number of violations.
6. x402 settlement receipt verification with facilitator polling and Robinhood RPC fallback.
7. Read-only public mission audit page.

## NICE TO HAVE
- multiple successor tiers;
- gradual authority restoration after successful recovery;
- protocol-level risk score;
- A2A Agent Card ingestion;
- agent health history charts;
- downloadable audit receipt.

## FUTURE
- generic action adapters for DeFi protocols;
- cross-chain continuity;
- permission-aware agent marketplace;
- decentralized guardian set/multisig;
- decentralized successor discovery;
- capital graduation/credit layer;
- safety bonds and insurance integrations;
- policy templates;
- enterprise teams/workspaces;
- SDK adapters for major agent frameworks.

## OUT OF SCOPE
- arbitrary contract calls or direct ERC-20 transfers bypassing x402;
- unrestricted wallet custody;
- withdrawal paths that require agent or guardian cooperation;
- automated trading strategy engine;
- generalized AI safety model;
- cross-chain bridges;
- support for Solana in MVP;
- token governance;
- mobile app;
- production-grade decentralized keeper network.

---

# 3. USER ROLES

| Role | Can do | Cannot do |
|---|---|---|
| Mission Owner | create/update/cancel mission, approve the x402 offer policy, deposit and withdraw mission USDG, register/rotate/revoke the session key, define policy, approve successors, stop future payments after cancel/completion | bypass immutable policy without an owner-signed call, or block the owner's own withdrawal right |
| Primary Agent | submit x402 payment requests, heartbeat, submit candidate checkpoint | change policy, change successor set, sign token transfers, move funds directly |
| Successor Agent | act only after activation and within recovery limits | activate itself, change mission policy, access old agent authority |
| Succra Guardian | quarantine mission, activate pre-approved successor within policy | spend funds, add unapproved successor, rewrite mission owner or policy |
| Public Viewer | view public audit page and on-chain proofs | view private user metadata or internal agent credentials |

---

# 4. COMPLETE USER FLOWS

## Flow A — Connect wallet and sign in
Entry: `/`

1. User connects an EVM wallet through wagmi/viem/WalletConnect (MetaMask, OKX, TokenPocket, ImToken).
2. UI requests a nonce/challenge from Succra.
3. Wallet signs the EIP-712 login typed data.
4. Backend verifies the signature against the wallet address.
5. Supabase session is established.
6. User lands on Dashboard.

Success: authenticated dashboard.
Failure: signature rejected, expired nonce, unsupported wallet.
Edge cases: wallet disconnect, switched wallet, stale session.

## Flow B — Create a mission
Entry: Dashboard → Create Mission

```text
Wallet
  ↓
Mission form
  ↓
Client validation
  ↓
POST /api/missions
  ↓
Server validates policy
  ↓
Succra builds the mission's x402 offer policy (accepts[] constraints and EIP-3009 requirements)
  ↓
Owner approves the x402 offer policy in the mission review
  ↓
Succra computes the x402 offer hash
  ↓
Owner signs MissionFactory create transaction (commits the x402 offer hash)
  ↓
SuccraMission deployed + policy committed
  ↓
MissionCreated event verified
  ↓
Owner registers the session key in SuccraMission
  ↓
Mission mirror becomes FUNDED
  ↓
Owner approves USDG + deposits into SuccraMission
  ↓
Mission mirror status: FUNDED → ACTIVE
  ↓
Dashboard shows mission
```

Database changes: mission row, policy row, agent assignments, deposit mirror, audit rows.
On-chain changes: SuccraMission address, owner, settlement token, policy hash, primary/successor addresses, x402 offer hash, deposited USDG, session key.

The mission reaches `ACTIVE` only after the initial USDG deposit confirms. The owner can withdraw at any time thereafter.

## Flow C — Connect/register an agent
Entry: Mission → Add Agent

1. User creates/chooses an agent EVM address.
2. Agent address is displayed/generated.
3. User registers the address with Succra.
4. Agent proves possession by signing an EIP-712 challenge.
5. API stores only the public address and metadata.
6. Agent gets a mission-scoped credential/config.

No private key ever enters Succra.

## Flow D — Agent requests action

```text
Agent
  ↓ EIP-712 signed SuccraRequest
Succra Runtime/API
  ↓ authenticate agent address
Load mission + contract authority
  ↓
Validate nonce/idempotency
  ↓
Deterministic policy evaluation
  ↓
ALLOW / BLOCK
  ↓
If ALLOW → select the x402 accepts[] offer and construct EIP-3009 transferWithAuthorization typed data
  ↓
Runtime approves payment on-chain (Variant A: approvePayment; Variant B: releaseForPayment)
  ↓
Return unsigned EIP-3009 authorization + typed data + approval tx hash
  ↓
Session key signs EIP-3009 (agent never holds funds or the session key)
  ↓
Succra verifies the agent request, session-key authorization, and variant approval
  ↓
Succra submits the x402 payment payload to the facilitator
  ↓
Facilitator verifies the EIP-3009 signature and settles USDG/allowlisted ERC-20 on Robinhood Chain
  ↓
Succra verifies the settlement receipt and on-chain Transfer log
  ↓
Update authoritative off-chain mirror
  ↓
Checkpoint eligible
  ↓
Audit UI
```

## Flow E — Three violations → quarantine
1. Agent submits a blocked x402 payment request.
2. Action is recorded as `BLOCKED`.
3. Consecutive violation counter increments atomically.
4. Counter reaches 3.
5. Runtime submits a guardian `quarantine` call to SuccraMission.
6. Contract verifies guardian and sets mission `QUARANTINED`.
7. Current agent authority is invalidated.
8. The session key is revoked; no new payment can be approved or released.
9. No new x402 payment is authorized for the quarantined agent.
10. Last verified checkpoint is marked the recovery boundary.
11. Succession engine begins.

Failure protection: quarantine is allowed to happen even if the agent is still offline because the guardian is separate from the agent.

## Flow F — Successor activation
1. Succra reads ordered pre-approved successors.
2. Eligibility filters are applied.
3. Highest-priority eligible successor is selected.
4. Guardian submits `activate_successor` to SuccraMission.
5. Contract verifies the successor is pre-approved and eligible.
6. Contract moves mission to `RECOVERING`.
7. Successor receives the verified checkpoint and restricted authority.
8. Contract revokes the previous session key; the owner/runtime registers a new key capped by `recoveryMaxPaymentAtomic`.
9. Successor sends an authenticated off-chain acknowledgement (`POST /api/missions/:id/succession/:successionId/acknowledge`).
10. Runtime submits a second guardian-signed call (`acknowledge_recovery`), moving the mission `RECOVERING` → `ACTIVE_RECOVERY`.

Phase 6 resolution (spec amendment): activation is two guardian-signed calls, not one (`activate_successor`: `QUARANTINED` → `RECOVERING`; `acknowledge_recovery`: `RECOVERING` → `ACTIVE_RECOVERY`). Collapsing `RECOVERING` into the activation step is a Phase 9 simplification candidate, not a Phase 6 change. The guardian is the normal activator; if the runtime/guardian is unavailable, the owner may trigger the same pre-approved successor path with the same eligibility and state-version checks.

## Flow G — Recovery execution
1. Successor proposes an x402 payment.
2. Policy engine uses recovery limits, not primary limits.
3. If valid, Succra constructs the EIP-3009 authorization; the runtime approves/releases on-chain; the session key signs it; the x402 facilitator settles it.
4. Robinhood transaction confirms.
5. Mission checkpoint is updated.
6. Mission remains under recovery authority until explicit promotion logic exists.

## Flow H — Audit
Entry: Mission → Audit

The UI constructs a receipt from:
- mission policy version/hash;
- action request hash;
- decision;
- failure counter at decision time;
- checkpoint hash;
- succession event if applicable;
- Robinhood transaction hash and x402 payment ID / EIP-3009 authorization nonce;
- timestamp and block number when available.

The audit page distinguishes:
- **deterministically proven facts**;
- **agent-provided claims**;
- **AI explanations**.

AI explanations are never presented as cryptographic proof.

## Flow I — Cancel mission
1. Owner selects Cancel.
2. System checks no x402 payment is in flight.
3. Owner signs the cancel transaction.
4. Contract sets `CANCELLED`.
5. Owner stops future x402 payments; any already-signed EIP-3009 authorization can settle only until its `validBefore`, so authorizations must be short-lived. The owner can withdraw the remaining contract balance at any time.
6. Runtime marks future agent requests invalid.

## Flow J — Expiry
At expiry:
1. Runtime detects expired mission.
2. Contract's execution path rejects new payments after expiry.
3. Owner can cancel according to policy.
4. Future succession is blocked.

---

# 5. FUNCTIONAL REQUIREMENTS

## FR-01 Mission creation
**Actor:** Mission Owner

Inputs: mission name, objective, settlement token (USDG by default or an allowlisted ERC-20), budget, `initialDepositAtomic` (minimum 1), max payment amount, merchant allowlist, expiry, primary agent, successors, recovery max.

Rules:
- budget > 0;
- initial deposit >= 1 atomic unit and <= budget;
- max payment > 0 and <= budget;
- at least one allowed merchant/token path;
- successor list must be unique;
- primary cannot be successor at creation;
- expiry must be in the future;
- recovery max <= primary max;
- SuccraMission must receive the initial deposit for the mission to reach `ACTIVE`; `DRAFT`/`FUNDED` missions without a deposit cannot execute payments.

Acceptance criteria:
- SuccraMission contract exists;
- policy is committed;
- owner is recorded;
- the x402 offer policy is committed by hash;
- the session key is registered;
- the initial USDG deposit is confirmed;
- dashboard reports `ACTIVE` only after the deposit confirms.

## FR-02 Agent authentication
Agent requests MUST be EIP-712-signed over the canonical `SuccraRequest(missionId, requestId, nonce, timestamp, methodHash, bodyHash)` typed data by the registered agent address.

Acceptance criteria:
- invalid signature rejected;
- stale timestamp rejected;
- reused nonce rejected;
- agent not assigned to mission rejected.

## FR-03 Action evaluation
Supported MVP action type:
- `X402_PAYMENT`

Decision checks:
1. mission is active/recovery-active;
2. agent is current agent;
3. action type is `X402_PAYMENT`;
4. merchant is allowed;
5. amount <= current per-payment max;
6. cumulative spend + amount <= remaining budget;
7. request not expired;
8. request nonce/idempotency key unused;
9. token address is allowed and the EIP-3009 authorization matches the mission policy and selected x402 accepts[] offer;
10. the session key is registered, current, and not revoked, and the variant-specific approval/release can be recorded on-chain.

Phase 6 resolutions (spec amendment): the payment execution path accepts `Active` and `ActiveRecovery` (see FR-06 for which ceiling applies in each state). `Recovering` and `Quarantined` are non-executable. The contract and the gateway ABI decoder must be deployed together whenever new `MissionStatus` discriminant values are added; a decoder that sees an unknown value must fail closed, never treat the mission as `Active`.

## FR-04 Quarantine
Quarantine MUST be triggered after 3 consecutive blocked policy violations in the configured rolling window.

The counter resets after a valid successful payment or after a configured quiet period of 15 minutes.

Two distinct reset mechanisms apply:
  (a) Any CONFIRMED x402 settlement resets the consecutive counter to zero.
  (b) Any violation older than violation_window_seconds is no longer
      counted toward the streak.
Both mechanisms operate independently. A streak is the number of
policy-blocked actions within the window since the most recent
CONFIRMED settlement (or since mission activation, whichever is later).

Guardian quarantine MUST NOT transfer funds or create an x402 payment authorization. Quarantine MUST revoke the session key; the owner may still withdraw remaining funds.

## FR-05 Succession
Successor MUST:
- be pre-approved;
- not be the quarantined primary;
- have required capability tag(s);
- possess a valid registered EVM address;
- be in `AVAILABLE` state;
- be selected according to deterministic priority rules.

Phase 6 resolutions (spec amendment):
- Priority: lower integer wins. Tie-break: earlier position in the on-chain successor list wins; no new column.
- `AVAILABLE` means `mission_agents.status='AVAILABLE'`, set when the agent is attached AND has passed address-possession verification.
- Capability check: if the mission requires no capabilities the check passes trivially; otherwise the candidate's declared capabilities must be a superset of the required set.
- On-chain verification covers membership in the pre-approved successor list; off-chain (gateway) verification covers AVAILABLE + capability filters.

## FR-06 Recovery authority
On activation, successor receives:
- mission authority;
- recovery max-per-payment;
- remaining budget envelope;
- remaining time;
- allowed merchants/tokens;
- verified checkpoint.

It does NOT receive:
- primary agent private key;
- access to unverified context;
- ability to expand policy;
- ability to name a new successor.

Phase 6 resolution (spec amendment): `recovery_max_payment` is enforced on-chain in SuccraMission, selected by mission state: the per-payment ceiling is `max_payment` when status is `Active` and `recovery_max_payment` when status is `ActiveRecovery`. Off-chain-only enforcement is forbidden by ARCHITECTURE.md §13 (on-chain enforcement) and AGENTS.md invariant #4.

On succession, the contract revokes the previous session key and registers a new one with `recoveryMaxPaymentAtomic` as the cap. The successor agent never holds the session key; the runtime does.

## FR-07 Checkpoints
A checkpoint contains only deterministic/verified mission facts:
- mission ID;
- sequence;
- confirmed payment IDs;
- confirmed Robinhood transaction hashes;
- x402 payment IDs / EIP-3009 authorization nonces;
- remaining budget;
- current authority limits;
- policy version/hash;
- timestamp;
- hash of the serialized checkpoint.

Agent reasoning, raw chain-of-thought, or model-private context is never stored as a trusted checkpoint.

Phase 6 resolutions (spec amendment):
- `state_snapshot` schema: `{confirmed_payment_ids, confirmed_transaction_hashes, x402_payment_ids, authority_limits_at_checkpoint, policy_version, policy_hash}`.
- `status` ∈ {`CANDIDATE`, `VERIFIED`, `SUPERSEDED`}; `CANDIDATE` is reserved for future use and unused in Phase 6.
- `committed_tx_hash` is populated when the Phase 6 checkpoint commitment transaction confirms; `CANDIDATE` remains reserved and unused.
- Cadence: a `VERIFIED` checkpoint is written on every CONFIRMED settlement, plus an initial `sequence=0` checkpoint at mission activation, so a checkpoint always exists.
- Quarantine marks the latest `VERIFIED` checkpoint as the recovery boundary.

## FR-08 Audit
Every material event MUST create an immutable audit event in the application database and, where practical, a corresponding on-chain proof/event.

Phase 6 resolutions (spec amendment) — Phase 6 writes these audit event types (dotted convention mirrors Phase 5):
- `checkpoint.verified`
- `succession.triggered`
- `succession.candidate_selected`
- `succession.activate.submitted`
- `succession.activate.confirmed`
- `succession.acknowledge.submitted`
- `succession.acknowledge.confirmed`

R1 adds these audit event types:
- `mission.deposited`
- `mission.withdrawn`
- `session_key.registered`
- `session_key.revoked`
- `payment.approved`
- `payment.released`

Phase 7 reads these rows only and writes none.

## FR-09 Owner control
Owner can cancel a mission and stop future x402 payments according to on-chain rules. Already-signed EIP-3009 authorizations can settle only until `validBefore`; short validity windows are mandatory. The owner has an unconditional, unilateral withdrawal right at any mission status, including `QUARANTINED`, `RECOVERING`, `ACTIVE_RECOVERY`, and `CANCELLED`. No application administrator, agent, or guardian can block it or move mission funds.

---

# 6. BUSINESS LOGIC & STATE MACHINES

This section is the authoritative product logic. Contract behavior wins over UI labels and database mirrors.

## 6.1 Authority and custody

- The mission owns the funds. `SuccraMission` holds the selected payment token.
- The owner has an unconditional, unilateral withdrawal right for unallocated funds at **any** mission status.
- The agent never holds vault funds, the owner's key, or the session key.
- The guardian/runtime can execute only policy-bounded actions. It cannot withdraw, change policy, add successors, or move funds arbitrarily.
- The database and UI are mirrors. The contract is authoritative for authority, policy, and balances.

## 6.2 Mission lifecycle

`MissionFactory.createMission` deploys a `SuccraMission` in **ACTIVE** status. The contract starts with `depositedAtomic = 0`; the mission becomes executable only after the owner deposits at least `initialDepositAtomic`.

```text
MissionFactory.createMission
  │  owner = msg.sender
  │  status = ACTIVE
  │  sessionKey = address(0)
  │  depositedAtomic = 0
  ▼
ACTIVE (awaiting deposit)
  │  owner deposits >= initialDepositAtomic
  ▼
ACTIVE (funded, executable)
  │  authenticated policy violations reach threshold
  ▼
QUARANTINED
  │  guardian activates a pre-approved successor
  ▼
RECOVERING
  │  successor acknowledges recovery
  ▼
ACTIVE_RECOVERY
  │  lower recovery ceiling applies

ACTIVE / ACTIVE_RECOVERY / QUARANTINED / RECOVERING
  └── owner cancel (before expiry) ──> CANCELLED
```

On-chain enum:

| Value | Status | MVP behavior |
|---|---|---|
| 0 | `DRAFT` | Reserved; not entered by the factory |
| 1 | `ACTIVE` | Mission is live; payments require initial funding |
| 2 | `DEGRADED` | Reserved; not entered in MVP |
| 3 | `QUARANTINED` | Session key revoked; no new payments; owner can withdraw |
| 4 | `RECOVERING` | Successor activated; awaiting acknowledgement |
| 5 | `ACTIVE_RECOVERY` | Successor active with lower recovery ceiling |
| 6 | `COMPLETED` | Reserved; not entered in MVP |
| 7 | `CANCELLED` | Owner cancelled; session key revoked |
| 8 | `EXPIRED` | Reserved on-chain; expiry is enforced by `cancel` and `authorizePayment` |
| 9 | `HALTED` | DB-only mirror for quarantine with no eligible successor |

Important distinctions:

- There is **no on-chain `FUNDED` status**. A mission can be `ACTIVE` but not executable while `depositedAtomic < initialDepositAtomic`. The UI may label this as “awaiting deposit”.
- There is no `QUARANTINED → ACTIVE` shortcut. A quarantined mission must be cancelled or recovered through succession.
- `COMPLETED` and `EXPIRED` are reserved; the current MVP does not transition into them on-chain.
- `HALTED` is a database/UI mirror; the chain remains `QUARANTINED`, and no funds can move except owner withdrawal.

## 6.3 Policy rulebook

### Mission creation policy

The factory validates the mission config before deployment:

| Rule | Enforcement |
|---|---|
| Budget > 0 | `_validateConfig` |
| Initial deposit > 0 and <= budget | `_validateConfig` |
| Max payment > 0 and <= budget | `_validateConfig` |
| Recovery cap > 0 and <= max payment | `_validateConfig` |
| Expiry is in the future | `_validateConfig` |
| Primary agent is non-zero | `_validateConfig` |
| Merchant allowlist is non-empty and duplicate-free | `_validateConfig` |
| Successor count <= 8, non-zero, unique, not the primary | `_validateConfig` |
| Violation threshold > 0 | `_validateConfig` |
| Violation window > 0 | `_validateConfig` |
| Payment token is factory-allowlisted (when enabled) | `MissionFactory.createMission` |

### USDG x402 policy

`approvePayment` is the guardian-submitted approval step for Variant A. It enforces:

| Rule | Behavior |
|---|---|
| Mission status is `ACTIVE` or `ACTIVE_RECOVERY` | Reverts `InvalidStatus` |
| `expectedVersion` matches current state | Reverts `InvalidVersion` |
| Session key is registered | Reverts `SessionKeyNotSet` |
| Initial deposit has confirmed | Reverts `NotFunded` |
| Merchant is allowlisted | Reverts `InvalidMerchant` |
| Authorization hash has not been used | Reverts `HashAlreadyApproved` |
| Amount <= `maxPaymentAtomic` in `ACTIVE` | Reverts `InvalidAmount` |
| Amount <= `recoveryMaxPaymentAtomic` in `ACTIVE_RECOVERY` | Reverts `InvalidAmount` |
| Cumulative committed spend + amount <= budget | Reverts `InvalidAmount` |
| Amount <= available vault balance | Reverts `InsufficientBalance` |

`isValidSignature` also requires:

- the hash is in `approvedHashes`;
- a session key is registered;
- the signature recovers to exactly `authority.sessionKey`;
- otherwise it returns `0xffffffff` instead of the ERC-1271 magic value.

`releaseForPayment` (Variant B) additionally requires the caller-supplied session key to match the registered key and the vault to hold the amount.

### WIF treasury policy

`executeERC20Transfer(token, to, amount)` is guardian-only and enforces:

| Rule | Behavior |
|---|---|
| Mission status is `ACTIVE` or `ACTIVE_RECOVERY` | Reverts `InvalidStatus` |
| Amount > 0 | Blocked; violation recorded |
| Token equals the configured mission token | Blocked; violation recorded |
| `to` is on the merchant allowlist | Blocked; violation recorded |
| Amount <= the active per-payment ceiling | Blocked; violation recorded |
| Cumulative committed spend + amount <= budget | Blocked; violation recorded |
| Amount <= available vault balance | Blocked; violation recorded |
| Token transfer succeeds | Reverts `InsufficientBalance` if the token returns false |

Blocked treasury transfers do not revert. They increment the violation streak and emit `TreasuryTransferBlocked`, so the attempt is observable on-chain.

### Owner controls

| Action | Rule |
|---|---|
| Deposit | Owner-only; amount > 0; token transfer must succeed |
| Withdraw | Owner-only; amount <= `availableBalance()`; allowed at any status |
| Register session key | Owner-only; non-zero key; `expectedVersion` required |
| Revoke session key | Owner or guardian; `expectedVersion` required |
| Cancel | Owner-only; status must be `ACTIVE`, `ACTIVE_RECOVERY`, `QUARANTINED`, or `RECOVERING`; must be before expiry |
| Quarantine | Owner or guardian; status must be executable; no threshold requirement for manual freeze |

## 6.4 Deposit and withdrawal

- The owner approves the mission token and calls `deposit(amountAtomic)`.
- `deposit` calls `transferFrom(owner, mission, amount)` and increments `depositedAtomic`.
- The owner can withdraw up to `availableBalance()` at any status, including `QUARANTINED`.
- `availableBalance = depositedAtomic - (confirmedSpentAtomic + reservedAtomic + releasedAtomic)`, floored at zero.
- Funds reserved for an approved but unsettled payment are not withdrawable twice.
- A successful settlement moves the amount from reserved/released into `confirmedSpentAtomic`.

## 6.5 Payment rails

### USDG x402 (Variant A preferred)

1. Agent submits an EIP-712 signed action request to the runtime.
2. Runtime validates the agent, nonce, idempotency key, merchant, token, cap, budget, and expiry.
3. Runtime computes the EIP-3009 `TransferWithAuthorization` digest.
4. Guardian calls `approvePayment`.
5. Session key signs the EIP-3009 payload.
6. The runtime submits `transferWithAuthorization` with `from = SuccraMission`.
7. The token calls `isValidSignature`; the contract returns `0x1626ba7e` only for the approved hash and registered session key.
8. The runtime verifies the on-chain Transfer log and calls `recordSettlement`.
9. A confirmed settlement resets the violation streak.

### USDG x402 (Variant B fallback)

1–4 as above.
5. Guardian calls `releaseForPayment(sessionKey, amount, expectedVersion)`.
6. The session key signs EIP-3009 with `from = sessionKey`.
7. The amount is bounded by the same cap and budget; the session key holds only the exact released amount.
8. Runtime records settlement after the Transfer log confirms.

### WIF treasury transfer

1. Guardian/runtime evaluates the transfer off-chain against the same token, merchant, cap, and budget rules.
2. Guardian calls `executeERC20Transfer(token, to, amount)`.
3. Successful transfer: `confirmedSpentAtomic += amount`, violation streak reset, `TreasuryTransfer` emitted.
4. Policy failure: violation count incremented, `TreasuryTransferBlocked` emitted, no funds moved.

WIF never claims x402 settlement. It is a policy-bounded ERC-20 treasury rail.

## 6.6 Agent assignment state machine

```text
REGISTERED → ACTIVE_PRIMARY
ACTIVE_PRIMARY → QUARANTINED
QUARANTINED → REVOKED

REGISTERED → ACTIVE_SUCCESSOR
ACTIVE_SUCCESSOR → REVOKED
```

Only one current agent exists at a time. Successors are pre-approved at creation; they do not inherit the primary agent's key or authority.

## 6.7 Succession state machine

```text
NOT_STARTED
  ↓  quarantine
TRIGGERED
  ↓  verified checkpoint / candidate selection
CHECKPOINT_LOCKED
  ↓  guardian activates an approved successor
CANDIDATE_SELECTED
  ↓  successor acknowledged
AUTHORIZED
  ↓  recovery authority active
ACKNOWLEDGED
  ↓
COMPLETE
```

On-chain mapping:

- `activateSuccessor` requires `QUARANTINED` or `RECOVERING`.
- The successor must be pre-approved and `active = true`.
- The current agent cannot be reactivated as successor.
- Activation sets `status = RECOVERING`, revokes the session key, and resets `agentNonce`.
- `acknowledgeRecovery` moves `RECOVERING → ACTIVE_RECOVERY`.
- The successor receives a new session key and the lower recovery cap.

## 6.8 Action state machine

```text
RECEIVED
  ├── invalid/unauthenticated → REJECTED
  └── authenticated
        ↓
      APPROVED
        ↓
      SUBMITTED
        ├── x402/chain failure → FAILED
        └── confirmed → CONFIRMED
```

Only authenticated, current-agent policy failures count toward the violation streak. Malformed, unauthenticated, replayed, or environmental failures do not.

## 6.9 Violation rules

A blocked request counts toward the streak only when:

1. It was authenticated.
2. It was signed by the current agent.
3. It was rejected by a mission policy rule.

Countable policy violations:

- `INVALID_ACTION_TYPE`
- `MERCHANT_NOT_ALLOWED`
- `TOKEN_NOT_ALLOWED`
- `AMOUNT_EXCEEDS_MAX`
- `BUDGET_EXHAUSTED`

Non-countable rejections:

- authentication failures (`AGENT_NOT_CURRENT`, `INVALID_SIGNATURE`)
- replay protection (`STALE_TIMESTAMP`, `STALE_NONCE`, `DUPLICATE_REQUEST`)
- environmental failures (`MISSION_NOT_ACTIVE`, `MISSION_EXPIRED`, `REQUEST_EXPIRED`)
- unknown reason codes not explicitly listed above

On-chain rules:

- `recordViolation` is guardian-only and idempotent by request id.
- A violation older than `violationWindowSeconds` resets the streak before incrementing.
- A confirmed settlement resets `violationCount` and `lastViolationAt`.
- The guardian may quarantine manually at any time; automatic quarantine occurs when the runtime crosses the configured threshold.
- Blocked `executeERC20Transfer` attempts also increment the streak.

## 6.10 Quarantine

- Triggered by 3 authenticated violations (default) or a manual owner/guardian freeze.
- Revokes the session key and sets `QUARANTINED`.
- Blocks `approvePayment`, `releaseForPayment`, and `executeERC20Transfer`.
- Does not move funds.
- The owner can withdraw immediately.
- No `QUARANTINED → ACTIVE` shortcut.

## 6.11 Duplicate prevention and concurrency

- Agent requests use client-generated `idempotency_key`; `(mission_id, idempotency_key)` is unique.
- Agent payment requests use a mission-specific monotonic nonce.
- `usedRequestIds` prevents replay of agent action requests.
- `approvedHashes` prevents duplicate EIP-3009 approvals.
- `recordedSettlements` prevents double settlement recording.
- `recordedViolations` prevents duplicate violation counts.
- Every material mutation checks `expectedVersion`; stale actions fail closed.
- State-version checks serialize concurrent policy, succession, and quarantine transitions.

## 6.12 Irreversible actions

- Confirmed x402 settlements are irreversible.
- Confirmed WIF treasury transfers are irreversible.
- Succession permanently revokes the previous agent's authority; the old key cannot be restored.
- Quarantine is reversible only through the explicit succession/recovery path or cancellation.
- Owner withdrawal is always available for unallocated funds and cannot be blocked by the agent or guardian.

## 6.13 Worked continuity example

```text
1. Owner creates a USDG mission with 1,000 USDG budget, 400 USDG max payment,
   and a 100 USDG recovery cap.
2. Owner deposits 500 USDG. The mission is ACTIVE and funded.
3. Runtime registers session key K1.
4. Agent requests a 100 USDG payment to an allowlisted merchant.
5. approvePayment(hash, 100, merchant, version) reserves 100.
6. K1 signs EIP-3009; USDG verifies ERC-1271; 100 settles.
7. recordSettlement confirms spent = 100; available = 400.
8. Agent attempts payments to a scammer three times.
9. Each authenticated policy failure increments the streak.
10. Guardian quarantines; K1 is revoked. Owner withdraws the 400 remaining.
11. Guardian activates successor Beta; status = RECOVERING; nonce reset.
12. Beta acknowledges; status = ACTIVE_RECOVERY.
13. Owner registers K2; recovery cap = 100.
14. K2 signs a recovery payment within the lower cap.
15. recordSettlement confirms; the mission continues under Beta.
```

---

# 14. UI/UX ARCHITECTURE

## Screen 1 — Landing `/`
Purpose: explain Succra in <30 seconds.
Components:
- headline: `Agents can fail. Missions continue.`
- animated continuity lifecycle;
- concise proof points;
- Connect Wallet CTA;
- demo mission link.

## Screen 2 — Dashboard `/dashboard`
Shows:
- active missions;
- current agent status;
- mission health;
- remaining budget;
- latest event;
- succession state.

Empty state: `Create your first mission`.

## Screen 3 — New Mission `/missions/new`
Wizard:
1. Mission
2. Authority
3. Primary agent
4. Successors
5. Review + sign
6. Deposit funds (amount; USDG approve + `SuccraMission.deposit`)

No advanced protocol jargon unless expanded.

## Screen 4 — Mission detail `/missions/:id`
Primary hero:
- mission status;
- current agent;
- remaining budget;
- authority limit;
- next checkpoint.

Centerpiece:
**Mission Timeline**
```text
✓ Mission created
✓ Alpha authorized
✓ Payment executed
⚠ Policy violation
⚠ Policy violation
🔒 Alpha quarantined
↪ Beta selected
✓ Beta authorized
✓ Mission continued
```

Owner actions:
- **Withdraw** is visible at every status, including `QUARANTINED`, `RECOVERING`, `ACTIVE_RECOVERY`, and `CANCELLED`.
- **Deposit** is visible when status is `ACTIVE` or `ACTIVE_RECOVERY`.
- **Session key** status and rotation are visible to the owner; the key itself is never displayed.

## Screen 5 — Agent page `/agents/:id`
- identity;
- capabilities;
- health;
- last heartbeat;
- missions;
- current role;
- note: agents never hold funds; the session key is runtime-held.

## Screen 6 — Succession event `/missions/:id/succession`
Shows:
- why succession occurred;
- last verified checkpoint;
- candidates;
- selected successor;
- recovery authority;
- acknowledgement status.

## Screen 7 — Audit `/missions/:id/audit`
Two-column layout:
- event timeline;
- selected decision receipt.

Every receipt has `View on Blockscout` at `https://robinhoodchain.blockscout.com` when a Robinhood transaction hash exists, plus the x402 payment ID / EIP-3009 authorization nonce.

## Screen 8 — Settings `/settings`
- connected wallet;
- network;
- notification preferences;
- developer integration details.

## Loading/empty/error states
Every screen must have explicit:
- skeleton;
- empty state;
- inline error;
- retry action;
- optimistic states only for non-authoritative UI.

## Responsive behavior
Desktop-first dashboard, but all core actions work on mobile width. Tables become stacked cards. Timeline remains readable without horizontal scroll.

---

# 15. DESIGN SYSTEM

## Visual direction
**Mission control for autonomous money.**

Not generic fintech. Not sci-fi neon overload. The UI should feel precise, operational, and trustworthy.

## Brand personality
- calm;
- technical;
- decisive;
- transparent;
- slightly futuristic.

## Color direction
Use a near-black/graphite base, high-contrast text, cool neutral surfaces, and restrained semantic accents:
- green = verified/active;
- amber = degraded/recovery;
- red = quarantined/blocked;
- blue/violet = system/information.

## Typography
Use a clean modern sans for UI; optional compact monospace for:
- transaction hashes;
- hashes;
- agent addresses;
- numeric limits.

## Components
- MissionCard
- StatusBadge
- AuthorityMeter
- AgentIdentityChip
- Timeline
- CheckpointCard
- DecisionReceipt
- SuccessionPanel
- TransactionProof
- PolicyRuleList
- WalletButton
- EmptyState
- InlineError
- ConfirmDialog

## Interaction rules
- financial actions always show amount, merchant, token, and authority impact before signing;
- destructive actions require explicit confirmation;
- never hide mission status transitions;
- use animation only to communicate state transitions.

## Accessibility
- keyboard navigable;
- WCAG AA contrast target;
- no color-only status indicators;
- semantic buttons/links;
- screen-reader labels for timeline/state transitions.

---

# 16. THIRD-PARTY INTEGRATIONS

## Supabase
Purpose: auth + Postgres + RLS.
Credentials: public URL/key in browser where permitted; service role server-only.
Failure: UI degrades to retry state; on-chain authority and funds remain safe.

## x402 facilitator
Purpose: verify and settle x402 payments, including A2A API payments. A resource server returns HTTP 402 with `accepts[]` offers; Succra constructs an EIP-3009 `transferWithAuthorization` payload signed by the runtime-held session key. Variant A uses `from=SuccraMission` with ERC-1271; Variant B uses `from=sessionKey` after `releaseForPayment`. R1-spike determines which variant is used. The facilitator verifies the signature/nonce/network/asset before settling USDG or an allowlisted ERC-20 on Robinhood Chain. Self-hostable facilitators include `@402lane/facilitator`, `hood402`, and `rhx402`.
Credentials: `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_ASSET_ADDRESS` (optional overrides); any facilitator-specific key is server-only. No shared-secret HMAC/JWT flow is part of x402.
Trust boundary: the facilitator is not Succra's trust anchor. `SuccraMission` is authoritative for policy, caps, custody, and withdrawal; USDG is authoritative for the token transfer; the facilitator is authoritative for signature/nonce verification and settlement execution.
Failure: retry with backoff, poll the facilitator and Robinhood RPC, and never confirm a payment without a matching on-chain EIP-3009 Transfer log. Duplicate or out-of-order receipts are expected; deduplicate by transaction hash plus authorization nonce.

## Robinhood Chain RPC
Purpose: contract reads/writes and settlement confirmation.
Networks: mainnet chain ID 4663 (`https://rpc.mainnet.chain.robinhood.com`); testnet chain ID 46630 (RPC supplied by deployment configuration; no default is assumed).
Failure: retry with backoff; do not treat an RPC timeout as a successful settlement.

## Blockscout
Purpose: public contract and transaction verification at `https://robinhoodchain.blockscout.com`.
Failure: UI shows the transaction hash even when the explorer link is temporarily unavailable.

## EVM wallets
Purpose: wallet connection and EIP-712 signing.
MVP target: MetaMask, OKX, TokenPocket, ImToken, and other wagmi/viem-compatible wallets through WalletConnect.

## ERC-8004 (optional)
Purpose: optional agent identity metadata for cross-application agent discovery. It is not authoritative for mission authority or payments.

## OpenAI
Purpose: optional successor recommendation/explanation.
Failure: succession still works using deterministic eligibility rules.

---

# 17. AI ARCHITECTURE

## Rule
**AI is advisory; deterministic code is authoritative.**

## MVP AI responsibility
Given structured candidate records, produce:
- fit score 0–100;
- concise rationale;
- risk flags;
- capability gaps.

## Inputs
Only:
- mission required capabilities;
- candidate declared capabilities;
- health status;
- prior mission outcomes;
- current authority constraints.

Do not pass:
- private keys;
- raw auth tokens;
- hidden chain-of-thought;
- untrusted instructions as system messages.

## Output schema
```json
{
  "fitScore": 0,
  "riskFlags": [],
  "capabilityGaps": [],
  "summary": "..."
}
```

## Authoritative selector
1. candidate must pass deterministic eligibility;
2. candidate priority is applied;
3. AI score can break ties only within the eligible set;
4. if AI fails, deterministic priority remains.

## Recovery handoff prompt
The agent receives a verified checkpoint, policy, and explicit instruction to revalidate uncertain state before acting.

## Cost controls
- one AI call per succession event;
- cache by `(mission_id, succession_nonce, candidate_set_hash)`;
- maximum token/input size;
- timeout + fallback.

---

# 18. PAYMENT / FINANCIAL ARCHITECTURE

Succra uses a **program-controlled vault model (Model A)**. Mission USDG is held by the `SuccraMission` contract. The owner deposits at creation and can withdraw at any time. The owner never signs per-payment EIP-3009 authorizations; a runtime-held session key signs. R1-spike determines whether the contract is the direct signer via ERC-1271 (Variant A) or releases exact funds to an EOA session key (Variant B).

## Supported value types
- USDG on mainnet at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`;
- USDG on testnet at `0x7E955252E15c84f5768B83c41a71F9eba181802F`;
- one allowlisted ERC-20 per mission (USDG or an explicitly allowlisted token);
- native ETH is gas only and is not a mission payment asset in MVP.

## Custody model
`SuccraMission` is the mission's token holder. The owner has an unconditional, unilateral withdrawal right at every mission status. The runtime holds a session key but never holds mission funds long-term and cannot withdraw. Agents never hold funds, the session key, or any token signing key. The contract enforces policy and caps; the x402 facilitator verifies and settles the signed authorization.

## Deposit flow
1. Owner calls `POST /api/missions/:id/deposit` with `amountAtomic`.
2. Server returns unsigned USDG `approve` plus `SuccraMission.deposit(amountAtomic)`.
3. Owner signs; `deposit` pulls the tokens via `transferFrom` and confirms.
4. Server verifies `SuccraMission.depositedAtomic` increased.
5. DB mirrors `missions.total_deposited_atomic`.
6. Audit event `mission.deposited`.

A mission is `DRAFT`/`FUNDED` until the initial deposit confirms, then `ACTIVE`. A mission without a deposit cannot execute payments. Top-ups are allowed in `ACTIVE`/`ACTIVE_RECOVERY`; deposits do not change policy or budget.

## x402 accepts[] offer
A resource server returns HTTP 402 with `accepts[]` offers. Each offer constrains the network, asset, `payTo`, amount, scheme, resource, and timeout for one payment. Succra selects only an offer that matches the mission policy and stores the approved x402 offer policy/hash on the mission.

The x402 offer is a per-payment constraint, not an aggregate budget. `SuccraMission` enforces the per-payment ceiling and the cumulative mission budget.

## EIP-3009 transferWithAuthorization
For each allowed payment, Succra builds EIP-3009 typed data:

```text
TransferWithAuthorization(
  address from,
  address to,
  uint256 value,
  uint256 validAfter,
  uint256 validBefore,
  bytes32 nonce
)
```

The runtime-held session key signs this authorization. Variant A sets `from=SuccraMission`; Variant B sets `from=sessionKey`. The agent's `SuccraRequest` authenticates the payment request, but it cannot move funds or sign the authorization. Succra verifies the session-key signature, authorization hash, nonce, value, recipient, asset, and validity window before on-chain approval/release and facilitator submission.

## Payment approval (Variant A)
1. Agent requests a payment with an EIP-712 `SuccraRequest`.
2. Succra preflights policy and selects a matching x402 `accepts[]` offer.
3. Runtime calls `SuccraMission.approvePayment(authorizationHash, amountAtomic, merchant, expectedVersion)` and waits for confirmation.
4. The hash is now in `approvedHashes`.
5. Session key signs the EIP-3009 authorization with `from=SuccraMission`.
6. Runtime submits the signed payload to the facilitator; USDG calls `SuccraMission.isValidSignature(hash, signature)`.
7. `isValidSignature` verifies the hash is approved and the signature recovers the registered session key, then returns MAGIC (`0x1626ba7e`).
8. Facilitator settles; runtime verifies the Transfer log and records settlement.

## Fund release (Variant B)
1. Agent requests a payment with an EIP-712 `SuccraRequest`.
2. Succra preflights policy and selects a matching x402 `accepts[]` offer.
3. Runtime calls `SuccraMission.releaseForPayment(sessionKey, amountAtomic, expectedVersion)` and waits for confirmation.
4. The contract checks status, session key, per-payment cap, cumulative budget, expiry, and state version, then transfers exactly `amountAtomic` USDG to the session key.
5. Session key signs EIP-3009 with `from=sessionKey`.
6. Facilitator settles; runtime verifies the Transfer log and records settlement.
7. If settlement fails, the runtime sweeps the session-key balance back to `SuccraMission` at the owner's direction; the payment is recorded `FAILED`.

`releaseForPayment` is a bounded internal funding step, not a merchant payment; the merchant payment still executes through the x402 facilitator.

## Facilitator settlement
The facilitator verifies the EIP-3009 signature, nonce, network, asset, recipient, amount, and validity window, then settles USDG or the allowlisted ERC-20. Succra confirms only against the on-chain EIP-3009 Transfer log: `from` must be `SuccraMission` (Variant A) or the registered session key (Variant B), and `to`, `value`, `nonce`, and asset must match the preflighted payment. A facilitator receipt alone is never confirmation.

## Withdrawal flow (any status)
1. Owner calls `POST /api/missions/:id/withdraw` with `amountAtomic`.
2. Server returns unsigned `SuccraMission.withdraw(amountAtomic)`.
3. Owner signs; the contract sends USDG to the owner.
4. Runtime verifies the transfer and `withdrawnAtomic`.
5. DB mirrors `missions.total_withdrawn_atomic`; audit event `mission.withdrawn`.

Withdrawal is allowed at `ACTIVE`, `QUARANTINED`, `RECOVERING`, `ACTIVE_RECOVERY`, and `CANCELLED`. No agent, guardian, or runtime approval can block it. It cannot exceed the unallocated contract balance or double-spend an already-approved/released payment.

## Quarantine
Quarantine revokes the session key and stops new `approvePayment`/`releaseForPayment` calls. The owner can withdraw the remaining contract balance immediately. An authorization signed before quarantine may still settle until `validBefore`; short validity windows bound that exposure.

## Succession
On activation, the contract revokes the previous session key and the owner/runtime registers a new key with `recoveryMaxPaymentAtomic` as the cap. The successor agent never holds the session key; the runtime does.

## Owner never signs per payment
The owner signs mission creation, policy approval, deposit, withdrawal, and session-key management. The owner does not sign individual x402 payments. The session key signs within the contract-enforced policy; the owner's withdrawal right remains unconditional.

## On-chain enforcement boundary
`SuccraMission` enforces:
- mission status and current agent authority;
- `X402_PAYMENT` action type;
- per-payment ceiling (`maxPayment` or `recoveryMaxPayment`);
- cumulative spend against `budgetAtomic`;
- merchant and token allowlists (Variant A binds merchant + amount to the approved hash; Variant B checks merchant before release and re-checks the signed recipient before submission);
- expiry;
- recovery ceiling;
- session-key registration/revocation and state version;
- the owner's unconditional withdrawal right;
- guardian-only transitions.

The runtime may submit to the facilitator only after the variant-specific approval/release confirms. In Variant A the contract validates the EIP-3009 hash via ERC-1271. In Variant B the contract releases exact funds and the token validates the session-key signature via ecrecover.

The x402 facilitator enforces:
- EIP-3009 signature validity;
- authorization nonce uniqueness;
- network, asset, recipient, amount, and validity window;
- settlement execution.

USDG enforces the token transfer and, in Variant A, the ERC-1271 call. The facilitator does not enforce the cumulative mission budget or the merchant/token allowlist; `SuccraMission` does. If the mirror and settlement disagree, the Robinhood Transfer log is authoritative and the discrepancy is an incident.

## Residual trust boundary
The facilitator does not read `SuccraMission` state in MVP. A compromised session key or an already-signed authorization can settle within the EIP-3009 validity window even if the mission is quarantined or cancelled. Mitigations are short `validBefore` windows, on-chain approval/release before facilitator submission, quarantine revoking the session key, the owner's unconditional withdrawal right, and reconciliation alerts. Variant B's `releaseForPayment` signature carries the session key, amount, and version but not the merchant; the runtime enforces the merchant allowlist before release and re-checks the signed EIP-3009 recipient before submission. Facilitator-side mission proofs or smart-account scoping are future hardening, not MVP claims.

## Remaining budget
`SuccraMission` is authoritative for the cumulative budget and per-payment limits. The x402 facilitator is authoritative for settlement of the signed EIP-3009 authorization. The database mirror is never permission to spend. A stale mirror can block a valid payment conservatively; it must never permit an invalid one.

## Recovery limit
Successor receives a smaller `recovery_max_payment`, enforced on-chain by mission state. The new session key registered at succession is capped by that recovery limit.

## Refund/cancel
x402 has no native refund for an already-settled payment. The owner can cancel the mission, stop creating new x402 payments, and withdraw the unspent contract balance at any time. An already-signed EIP-3009 authorization may still settle until `validBefore`, so authorization validity must be short.

## Reconciliation
The Robinhood settlement transaction and a matching EIP-3009 Transfer log are authoritative. A facilitator receipt alone is not confirmation. Supabase is a mirror/index, never the financial source of truth.

## Residual trust boundary
The facilitator does not read `SuccraMission` state. A compromised owner signer or an already-signed authorization can settle within the EIP-3009 validity window even if the mission is quarantined or cancelled. Mitigations are short `validBefore` windows, on-chain authorization before facilitator submission, quarantine/cancel preventing new authorizations, and reconciliation alerts. Facilitator-side mission proofs or smart-account scoping are future hardening, not MVP claims.

## Fees
No Succra protocol fee in MVP. Future fee model may be introduced after the continuity primitive is validated.

## Product token
The hackathon token is not required to operate a mission. Future utility may include guardian/successor staking, fee discounts, or protocol-security bonds, but these are not part of MVP security.

---

# 19. ADMIN / OPERATIONS

No general admin dashboard in MVP.

Internal operational controls:
- runtime health endpoint;
- guardian signer health;
- SuccraMission/MissionFactory/GuardianRegistry addresses and Robinhood network;
- x402 settlement receipt health;
- failed job counter;
- recent succession events.

No operator can directly withdraw mission funds.

Emergency operational action is limited to:
- disable automatic succession globally for new missions;
- pause runtime processing;
- rotate the guardian through GuardianRegistry's owner-controlled update.

---

# 20. ERROR & EDGE-CASE MATRIX

| Scenario | Expected result |
|---|---|
| Invalid user wallet signature | 401, no session |
| Expired login nonce | 401 |
| Unknown agent address | 403 |
| Replayed action nonce | 409 |
| Duplicate idempotency key | Return original result |
| Wrong mission | 403/404 without leaking existence |
| Wrong current agent | 403 |
| Merchant not allowed | BLOCKED |
| Amount too large | BLOCKED |
| Budget exhausted | BLOCKED |
| Mission quarantined | BLOCKED |
| x402 submission fails | action FAILED, no false success |
| Robinhood settlement reverts | action FAILED, no false success |
| x402 settlement receipt duplicated | ignored after idempotency check |
| x402 receipt does not match the on-chain Transfer log | rejected, no state change |
| x402 facilitator unavailable | fallback to Robinhood RPC polling; no confirmation without chain |
| Authorization hash mismatch | rejected before x402 submission |
| Direct ERC-20 bypass attempt | rejected; payments only via x402 |
| Succession triggered twice | only one succeeds |
| No eligible successor | HALTED + owner notification |
| Successor unavailable during activation | succession remains pending/failed safely |
| Agent endpoint unreachable | no authority expansion; may trigger liveness rule if enabled |
| DB unavailable while chain/x402 action exists | reconcile from chain/x402 later |
| Runtime crashes after submit | settlement reconciliation recovers status |
| AI unavailable | deterministic successor selection |
| AI recommends ineligible agent | ignored |
| User changes wallet account | session re-authentication required |
| Mission expiry during request | contract state decides; expired request rejected |
| Two payments spend remaining budget | SuccraMission budget enforcement and unique EIP-3009 nonces allow only the valid payment(s); the contract mirrors confirmed spend |

---

# 21. TEST STRATEGY

## Unit tests
Must cover:
- policy evaluator;
- violation streak;
- successor eligibility;
- checkpoint hashing;
- canonical request signing/verification;
- state transition guards;
- authority limit calculation;
- deposit/withdraw accounting;
- session-key lifecycle (register, revoke, replace);
- EIP-3009 authorization hash, nonce, recipient, asset, and validity binding.

## Solidity contract tests
Must cover:
- create mission;
- commit x402 offer policy;
- owner deposit and withdrawal (unilateral, no cooperation needed);
- withdrawal at `QUARANTINED` status;
- session key registration at creation;
- session key revocation on quarantine;
- session key rotation on succession with reduced cap;
- payment reverts when session key is revoked or replaced;
- Variant A `approvedHashes` validation and `isValidSignature` MAGIC;
- Variant B `releaseForPayment` amount accuracy;
- authorized x402 payment;
- blocked x402 payment;
- budget envelope exhaustion;
- quarantine;
- successor activation;
- restricted successor payment;
- cancel;
- stale state/version rejection;
- unauthorized guardian attempt;
- unauthorized agent attempt;
- direct ERC-20 bypass rejection;
- authorization hash mismatch.

Solidity contract tests must run before moving checkpoints.

## Integration tests
- Supabase auth + RLS;
- agent registration;
- deposit and withdrawal mirroring;
- session-key registration, rotation, and revocation;
- EIP-712 payment submission;
- x402 mock facilitator flow;
- settlement confirmation mirror;
- x402 receipt verification, on-chain Transfer-log matching, and deduplication.

## E2E tests
Required golden path:
```text
Create mission
→ approve x402 offer policy
→ deposit USDG into SuccraMission
→ register Alpha and the session key
→ execute valid x402 payment (session key signs; contract approves/releases)
→ 3 blocked actions
→ quarantine (session key revoked)
→ owner withdraws remaining USDG at QUARANTINED
→ activate Beta
→ register new session key with recovery cap
→ Beta executes valid recovery payment
→ audit receipt shows full chain
```

## Security tests
- IDOR attempts;
- replay signed agent request;
- duplicate succession;
- malformed payloads;
- owner/agent role confusion;
- unauthorized merchant;
- policy race;
- x402/chain rejection spoofing;
- authorization hash mismatch;
- direct ERC-20 bypass;
- x402 receipt replay/forgery and EIP-3009 nonce replay;
- revoked/replaced session key cannot approve or sign;
- owner withdrawal works at `QUARANTINED` and `CANCELLED`;
- guardian cannot withdraw;
- prompt injection into successor recommender.

## Acceptance definition
A feature is complete only when:
1. implementation exists;
2. automated tests pass;
3. actual flow was executed;
4. evidence is recorded;
5. checkpoint commit created.

This follows the workflow rule that implementation must be followed by test, inspection, fixes, and commit rather than trusting an agent's claim that something works. fileciteturn0file0L305-L369

---

