# SUCCRA — PROJECT_SPEC.md

# 1. PRODUCT DEFINITION

## Product name
**Succra**

## One-line description
**Succra is a Robinhood Chain-native (EVM, x402 payments) continuity and authority layer that lets an autonomous agent payment mission survive agent failure by revoking unsafe authority, preserving verified state, and transferring constrained authority to a pre-approved successor.**

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
Developers and operators building autonomous agents that can control money or other consequential payment authority on Robinhood Chain.

### Secondary
- AI-agent application builders
- DeFi/treasury automation developers
- protocol teams operating autonomous agents
- businesses that want bounded autonomous payment agents
- future agent platforms that need portable continuity

## User roles
### Mission Owner
Human EVM wallet owner who creates the mission, approves the mission's x402 offer policy, signs EIP-3009 payment authorizations, defines policy, approves successors, and retains ultimate control.

### Primary Agent
The autonomous agent currently authorized to request x402 payments under the mission policy.

### Successor Agent
A pre-approved agent eligible to receive authority when the primary loses mission authority.

### Succra Guardian
A constrained protocol/runtime role that can trigger quarantine and activate only pre-approved successor agents according to the mission policy. The guardian cannot spend, move funds, change the owner, change policy, or add successors.

### Succra Runtime
Off-chain orchestration/monitoring component. It does not become the custodian of mission funds; funds remain in the owner's wallet.

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
A user creates a payment/rebalancing mission, including A2A API payments, and approves the mission's x402 offer policy. Agent Alpha requests authorized x402 payments; the owner wallet signs the EIP-3009 authorizations. Alpha makes repeated policy violations. Succra quarantines Alpha, preserves the last verified checkpoint, activates successor Beta with a lower emergency authority limit, and lets Beta continue the mission.

## Secondary use cases
- x402 agent-to-agent API payments;
- autonomous payment agents;
- recurring treasury operations;
- DeFi position management;
- autonomous procurement/payment workflows;
- agent-operated service accounts;
- long-running A2A workflows.

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
- use a custodial vault model;
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
4. x402 accepts[] offers constrain each payment (asset, network, payee, amount, expiry); SuccraMission enforces per-payment ceilings and cumulative budget; non-custodial funds in the owner's wallet.
5. Agent registration with EVM address and EIP-712 possession proof.
6. EIP-712-signed agent payment requests.
7. Deterministic policy engine.
8. Payment execution only through x402:
   - USDG (default) or allowlisted ERC-20; native ETH is gas only;
   - EIP-3009 transferWithAuthorization settlement.
9. Consecutive policy-violation tracking.
10. Automatic quarantine after 3 consecutive blocked actions within the mission's configured window.
11. Succra guardian quarantine authority that cannot spend mission funds.
12. Verified checkpoint creation based on deterministic mission facts.
13. Successor selection from pre-approved successors.
14. Restricted recovery authority for successor.
15. Successful successor execution.
16. Audit timeline for actions, failures, quarantine, succession, and execution.
17. Publicly verifiable Robinhood transaction hash and x402 payment ID / EIP-3009 authorization nonce for executed mission payments.
18. End-to-end demo path proving continuity.

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
- custodial vault model;
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
| Mission Owner | create/update/cancel mission, approve the x402 offer policy, sign EIP-3009 payment authorizations, define policy, approve successors, stop future payments after cancel/completion | bypass immutable policy without an owner-signed call |
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
Mission mirror becomes ACTIVE
  ↓
Dashboard shows mission
```

Database changes: mission row, policy row, agent assignments, audit row.
On-chain changes: SuccraMission address, owner, settlement token, policy hash, primary/successor addresses, x402 offer hash.

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
Return unsigned EIP-3009 authorization + typed data
  ↓
Owner wallet signs EIP-3009 (token holder; the agent never holds funds)
  ↓
Succra verifies the agent request and owner authorization, then records on-chain payment authorization in SuccraMission
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
8. No new x402 payment is authorized for the quarantined agent.
9. Last verified checkpoint is marked the recovery boundary.
10. Succession engine begins.

Failure protection: quarantine is allowed to happen even if the agent is still offline because the guardian is separate from the agent.

## Flow F — Successor activation
1. Succra reads ordered pre-approved successors.
2. Eligibility filters are applied.
3. Highest-priority eligible successor is selected.
4. Guardian submits `activate_successor` to SuccraMission.
5. Contract verifies the successor is pre-approved and eligible.
6. Contract moves mission to `RECOVERING`.
7. Successor receives the verified checkpoint and restricted authority.
8. Successor sends an authenticated off-chain acknowledgement (`POST /api/missions/:id/succession/:successionId/acknowledge`).
9. Runtime submits a second guardian-signed call (`acknowledge_recovery`), moving the mission `RECOVERING` → `ACTIVE_RECOVERY`.

Phase 6 resolution (spec amendment): activation is two guardian-signed calls, not one (`activate_successor`: `QUARANTINED` → `RECOVERING`; `acknowledge_recovery`: `RECOVERING` → `ACTIVE_RECOVERY`). Collapsing `RECOVERING` into the activation step is a Phase 9 simplification candidate, not a Phase 6 change. The guardian is the normal activator; if the runtime/guardian is unavailable, the owner may trigger the same pre-approved successor path with the same eligibility and state-version checks.

## Flow G — Recovery execution
1. Successor proposes an x402 payment.
2. Policy engine uses recovery limits, not primary limits.
3. If valid, Succra constructs the EIP-3009 authorization; the owner wallet signs it; Succra records on-chain authorization; the x402 facilitator settles it.
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
5. Owner stops future x402 payments; any already-signed EIP-3009 authorization can settle only until its `validBefore`, so authorizations must be short-lived. Funds remain in the owner's wallet.
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

Inputs: mission name, objective, settlement token (USDG by default or an allowlisted ERC-20), budget, max payment amount, merchant allowlist, expiry, primary agent, successors, recovery max.

Rules:
- budget > 0;
- max payment > 0 and <= budget;
- at least one allowed merchant/token path;
- successor list must be unique;
- primary cannot be successor at creation;
- expiry must be in the future;
- recovery max <= primary max.

Acceptance criteria:
- SuccraMission contract exists;
- policy is committed;
- owner is recorded;
- the x402 offer policy is committed by hash;
- dashboard reports `ACTIVE` after `MissionCreated` confirms.

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
9. token address is allowed and the EIP-3009 authorization matches the mission policy and selected x402 accepts[] offer.

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

Guardian quarantine MUST NOT transfer funds or create an x402 payment authorization.

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
Phase 7 reads these rows only and writes none.

## FR-09 Owner control
Owner can cancel a mission and stop future x402 payments according to on-chain rules. Already-signed EIP-3009 authorizations can settle only until `validBefore`; short validity windows are mandatory. Funds remain in the owner's wallet. No application administrator can move mission funds.

---

# 6. BUSINESS LOGIC & STATE MACHINES

## Mission state machine
```text
DRAFT
  │ create + x402 offer
  ▼
ACTIVE
  │ 3 violations / authorized liveness trigger
  ▼
QUARANTINED
  │ successor selected
  ▼
RECOVERING
  │ successor acknowledges
  ▼
ACTIVE_RECOVERY
  │ completion
  ▼
COMPLETED

ACTIVE ── expiry ──> EXPIRED
ACTIVE ── owner cancel ──> CANCELLED
QUARANTINED ── no eligible successor ──> HALTED
```

From QUARANTINED, two transitions exist in MVP:
  QUARANTINED → CANCELLED   (owner cancel)
  QUARANTINED → RECOVERING  (succession, Phase 6)
There is no QUARANTINED → ACTIVE shortcut. A quarantined mission
cannot resume without either succession or cancellation.

The on-chain enum reserves `DEGRADED` for future liveness degradation.
No MVP transition enters or leaves it; the state machine above remains
the complete MVP behavior.

Phase 6 resolution (spec amendment) — explicit cancel edges: `cancel()` accepts `Draft`, `Active`, `Quarantined`, `Recovering`, `ActiveRecovery`. Terminal states (`Completed`, `Expired`, `Cancelled`, `Halted`) are excluded. `HALTED` is a DB-only mirror state: the chain remains `QUARANTINED`; no fund movement is possible in either representation; owner notification beyond the audit row and dashboard status is out of scope for MVP.

## Agent assignment state machine
```text
REGISTERED → ACTIVE_PRIMARY
ACTIVE_PRIMARY → QUARANTINED
QUARANTINED → REVOKED
REGISTERED → ACTIVE_SUCCESSOR
ACTIVE_SUCCESSOR → REVOKED
```

## Succession state machine
```text
NOT_STARTED
  ↓
TRIGGERED
  ↓
CHECKPOINT_LOCKED
  ↓
CANDIDATE_SELECTED
  ↓
AUTHORIZED
  ↓
ACKNOWLEDGED
  ↓
COMPLETE
```

## Action state machine
```text
RECEIVED
  ├── invalid → REJECTED
  └── valid
        ↓
      APPROVED
        ↓
      SUBMITTED
        ├── x402/chain fail → FAILED
        └── confirmed → CONFIRMED
```

## Violation rules
A blocked request counts toward the streak only when:
- it was authenticated;
- the current agent signed it;
- it was rejected by a mission policy rule.

Malformed/unauthenticated requests do not increase the agent's policy violation count because they may be network abuse rather than agent behavior.

Countable policy violations (streak increments) are:
- `INVALID_ACTION_TYPE`
- `MERCHANT_NOT_ALLOWED`
- `TOKEN_NOT_ALLOWED`
- `AMOUNT_EXCEEDS_MAX`
- `BUDGET_EXHAUSTED`

Non-countable rejections (streak does NOT increment):
- authentication failures (`AGENT_NOT_CURRENT`, `INVALID_SIGNATURE`)
- replay protection (`STALE_TIMESTAMP`, `STALE_NONCE`, `DUPLICATE_REQUEST`)
- environmental (`MISSION_NOT_ACTIVE`, `MISSION_EXPIRED`, `REQUEST_EXPIRED`)
- any future reason code not explicitly listed above

A violation counts only when it is (a) authenticated, (b) signed by the current agent, (c) rejected by one of the countable policy rules.

## Duplicate prevention
- Every action has client-generated `idempotency_key`.
- `(mission_id, idempotency_key)` unique.
- Every payment action includes a mission-specific monotonic nonce.
- SuccraMission rejects stale/non-sequential action nonces where required.

## Conflict rules
- Only one current agent at a time.
- Only one active succession at a time.
- Only one mission transition may be committed for a given succession nonce.
- Owner policy update and guardian succession cannot race past each other because contract state version is checked.

## Irreversible actions
- Actual x402 settlements are irreversible once confirmed.
- Quarantine is reversible only through explicit owner/recovery logic defined later; MVP keeps quarantined missions non-executable except succession/cancel.
- Succession revokes the previous agent and cannot silently restore old authority.

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

## Screen 5 — Agent page `/agents/:id`
- identity;
- capabilities;
- health;
- last heartbeat;
- missions;
- current role.

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
Purpose: verify and settle x402 payments, including A2A API payments. A resource server returns HTTP 402 with `accepts[]` offers; Succra constructs an EIP-3009 `transferWithAuthorization` payload and the facilitator verifies the signature/nonce/network/asset before settling USDG or an allowlisted ERC-20 on Robinhood Chain. Self-hostable facilitators include `@402lane/facilitator`, `hood402`, and `rhx402`.
Credentials: `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_ASSET_ADDRESS` (optional overrides); any facilitator-specific key is server-only. No shared-secret HMAC/JWT flow is part of x402.
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

Succra uses a **non-custodial authority model (Model B)**. Funds remain in the owner's wallet. Succra never holds, receives, or transfers mission funds.

## Supported value types
- USDG at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` by default;
- one allowlisted ERC-20 per mission (USDG or an explicitly allowlisted token);
- native ETH is gas only and is not a mission payment asset in MVP.

## Custody model
The owner retains custody at all times and is the token holder whose EIP-3009 signature authorizes each transfer. Agents never hold mission funds or token signing keys. `SuccraMission` constrains which agent may request a payment and what limits apply; the x402 facilitator verifies and settles the signed authorization.

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

The owner wallet signs this authorization. The agent's `SuccraRequest` authenticates the payment request, but it cannot move funds. Succra verifies the EIP-3009 signature, authorization hash, nonce, value, recipient, asset, and validity window before recording on-chain authorization in `SuccraMission` and submitting the x402 payload to the facilitator.

## Execution
1. Agent requests a payment with an EIP-712 `SuccraRequest`.
2. Succra preflights policy and selects a matching x402 `accepts[]` offer.
3. Succra returns unsigned EIP-3009 typed data.
4. The owner wallet signs the EIP-3009 authorization.
5. Succra verifies the signature, authorization hash, nonce, asset, recipient, amount, and expiry.
6. Succra records on-chain payment authorization in `SuccraMission`.
7. Succra submits the signed payload to the x402 facilitator.
8. The facilitator verifies the EIP-3009 signature/nonce and settles USDG or the allowlisted ERC-20 on Robinhood Chain.
9. Succra verifies the facilitator receipt and the on-chain Transfer log.
10. Succra mirrors the confirmed settlement and writes a checkpoint.

## Remaining budget
`SuccraMission` is authoritative for the cumulative budget and per-payment limits. The x402 facilitator is authoritative for settlement of the signed EIP-3009 authorization. The database mirror is never permission to spend. A stale mirror can block a valid payment conservatively; it must never permit an invalid one.

## Recovery limit
Successor receives a smaller `recovery_max_payment`, enforced on-chain by mission state.

## Refund/cancel
x402 has no native refund primitive. The owner can cancel the mission and stop creating new x402 payments. An already-signed EIP-3009 authorization may still settle until `validBefore`, so authorization validity must be short. Funds remain in the owner's wallet; there is no vault refund.

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
- EIP-3009 authorization hash, nonce, recipient, asset, and validity binding.

## Solidity contract tests
Must cover:
- create mission;
- commit x402 offer policy;
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
- EIP-712 payment submission;
- x402 mock facilitator flow;
- settlement confirmation mirror;
- x402 receipt verification, on-chain Transfer-log matching, and deduplication.

## E2E tests
Required golden path:
```text
Create mission
→ approve x402 offer policy and sign EIP-3009 authorizations
→ register Alpha
→ execute valid x402 payment
→ 3 blocked actions
→ quarantine
→ activate Beta
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

