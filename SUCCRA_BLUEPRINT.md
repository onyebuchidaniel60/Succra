# SUCCRA — Complete Implementation-Ready Project Blueprint

**Status:** Pivot in progress / architecture amended for Robinhood Chain (EVM, x402)
**Product:** Succra
**Primary principle:** Agents can fail. Missions continue.
**Target:** Robinhood Chain-native autonomous agent payment missions using x402

## Source methodology
This blueprint follows the supplied `PROPER_VIBE_CODING_WORKFLOW.md`: define the problem before code, freeze the MVP and architecture, create a source-of-truth specification, use small independently testable phases, require evidence-based verification, commit checkpoints, and keep product decisions with the human rather than the coding agent. fileciteturn0file0L13-L30 fileciteturn0file0L78-L100 fileciteturn0file0L170-L180

---


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

---

# 7. DATA MODEL

## On-chain contracts

Succra uses three Solidity contracts:

- `SuccraMission.sol` — one contract per mission. Holds mission authority, policy, status, violations, successors, state version, and checkpoint commitments. It never holds funds.
- `MissionFactory.sol` — deploys `SuccraMission` contracts and indexes them by owner.
- `GuardianRegistry.sol` — stores the global guardian address and allows the registry owner to rotate it.

### `Successor`

```solidity
struct Successor {
    address agent;
    uint16 priority;                   // lower wins
    bool active;
}
```

The on-chain list is bounded to 8 unique addresses and excludes the primary agent at creation. Capabilities and availability remain off-chain metadata in `mission_agents`. `MissionFactory` sets the mission owner to `msg.sender`; ownership is never taken from an unverified config field.

### `MissionConfig`

```solidity
struct MissionConfig {
    address paymentToken;              // USDG or allowlisted ERC-20
    uint256 budgetAtomic;              // budget envelope in token atomic units
    uint256 maxPaymentAtomic;
    uint256 recoveryMaxPaymentAtomic;
    address[] merchantAllowlist;
    uint64 expiresAt;
    bytes32 policyHash;
    address primaryAgent;
    Successor[] successors;            // bounded, unique, primary excluded
    uint16 violationThreshold;         // default 3
    uint64 violationWindowSeconds;     // default 900
    bytes32 x402OfferHash;             // hash of the approved x402 offer policy
}
```

### `AuthorityState`

```solidity
enum MissionStatus {
    DRAFT,
    ACTIVE,
    DEGRADED,          // reserved; no MVP transition
    QUARANTINED,
    RECOVERING,
    ACTIVE_RECOVERY,
    COMPLETED,
    CANCELLED,
    EXPIRED,
    HALTED             // off-chain mirror terminal; contract remains QUARANTINED
}

struct AuthorityState {
    address currentAgent;
    MissionStatus status;
    uint64 agentNonce;
    uint64 stateVersion;               // 0 at creation, bumped on every transition
    uint16 violationCount;
    uint64 lastViolationAt;
    uint256 confirmedSpentAtomic;      // mirrored from confirmed x402 settlements
    bytes32 lastCheckpointHash;
    uint64 lastCheckpointSequence;
}
```

`DEGRADED` and `HALTED` are reserved values. No MVP transition enters `DEGRADED`; `HALTED` is written only to the off-chain mirror when no eligible successor exists, while the contract remains `QUARANTINED`. The reachable MVP state machine is defined in `PROJECT_SPEC.md` §6.

`DRAFT` is the off-chain pre-deployment state. A deployed mission with a committed policy and x402 offer hash starts `ACTIVE`; the mirror follows the verified `MissionCreated` event.

### `Checkpoint`

```solidity
struct Checkpoint {
    uint64 sequence;
    bytes32 checkpointHash;
    uint64 committedAt;
}
```

The full deterministic snapshot lives off-chain in `mission_checkpoints`; the contract stores the sequence/hash commitment. This preserves the existing checkpoint boundary without putting agent reasoning on-chain.

### `PaymentAuthorization`

```solidity
struct PaymentAuthorization {
    bytes32 requestId;
    address agent;
    address merchant;
    address token;
    uint256 amountAtomic;
    uint64 paymentNonce;               // on-chain request nonce, distinct from the EIP-3009 nonce
    uint64 expiresAt;                  // request expiry; the EIP-3009 validBefore is bound in the hash
    bytes32 authorizationHash;         // EIP-3009 transferWithAuthorization typed-data digest
    bytes agentSignature;              // agent request consent; owner EIP-3009 signature is verified before settlement
}
```

### `SuccessionRecord`

```solidity
struct SuccessionRecord {
    uint64 nonce;
    address fromAgent;
    address toAgent;
    bytes32 checkpointHash;
    uint64 activatedAt;
    uint64 acknowledgedAt;
    bool acknowledged;
}
```

### Events

- `MissionCreated(address indexed owner, address indexed mission, bytes32 policyHash)`
- `PolicyUpdated(bytes32 indexed policyHash, uint64 stateVersion)`
- `AgentAuthorized(address indexed agent, uint8 role, uint64 stateVersion)`
- `AgentRevoked(address indexed agent, uint64 stateVersion)`
- `PaymentAuthorized(bytes32 indexed requestId, address indexed merchant, uint256 amountAtomic, bytes32 authorizationHash)`
- `PaymentSettlementRecorded(bytes32 indexed paymentId, uint256 amountAtomic, bytes32 transactionHash)`
- `ViolationRecorded(bytes32 indexed requestId, uint16 violationCount, uint64 stateVersion)`
- `MissionQuarantined(address indexed guardian, uint64 stateVersion)`
- `MissionStatusChanged(MissionStatus previous, MissionStatus next, uint64 stateVersion)`
- `SuccessorActivated(address indexed successor, bytes32 checkpointHash, uint64 stateVersion)`
- `RecoveryAcknowledged(address indexed successor, uint64 stateVersion)`
- `CheckpointCommitted(uint64 sequence, bytes32 checkpointHash)`
- `MissionCancelled(address indexed owner, uint64 stateVersion)`
- `GuardianRotated(address indexed previousGuardian, address indexed nextGuardian)`

Every state-changing function takes or checks an expected `stateVersion` so a stale owner/guardian transaction cannot overwrite a newer transition.

### Mutating functions

Owner-authorized:
- `MissionFactory.createMission(MissionConfig)` — deploys a mission; the owner is `msg.sender`;
- `updateDraftPolicy(...)` — `DRAFT` only;
- `quarantine(uint64 expectedVersion)` — owner-initiated quarantine;
- `cancel(expectedVersion)` — allowed non-terminal states;
- `activateSuccessor(address successor, uint64 expectedVersion)` — owner fallback when the guardian is unavailable, using the same eligibility checks.

Guardian-authorized:
- `recordViolation(bytes32 requestId, uint64 expectedVersion)`;
- `quarantine(uint64 expectedVersion)`;
- `activateSuccessor(address successor, uint64 expectedVersion)`;
- `acknowledgeRecovery(uint64 expectedVersion)`;
- `recordSettlement(bytes32 paymentId, uint256 amountAtomic, bytes32 txHash, uint64 expectedVersion)`;
- `commitCheckpoint(uint64 sequence, bytes32 checkpointHash, uint64 expectedVersion)`.

Runtime-submitted, agent-signed:
- `authorizePayment(PaymentAuthorization calldata authorization, uint64 expectedVersion)` — requires the agent's EIP-712 signature over the x402 authorization digest.

`authorizePayment` checks status, current agent, action type, merchant/token allowlist, per-payment ceiling, mirrored cumulative spend, expiry, payment nonce, state version, and the agent signature. It then emits `PaymentAuthorized` and advances `agentNonce`. It does not move funds. The guardian key may relay the call, but the guardian cannot authorize or spend alone.

`GuardianRegistry.rotateGuardian(address nextGuardian)` is owner-authorized by the registry owner (deployer/owner multisig).

The workflow names `activate_successor` and `acknowledge_recovery` map to the Solidity methods `activateSuccessor` and `acknowledgeRecovery`.

### Contract authority boundary

`SuccraMission` is authoritative for:
- mission existence, owner, current agent, status, and successor membership;
- policy configuration and per-payment eligibility;
- the recovery per-payment ceiling selected by status;
- guardian authorization and state-version checks;
- checkpoint hash commitments.

`SuccraMission` is **not** the custodian of funds and does not execute ERC-20 transfers. The x402 facilitator is authoritative for settlement. `SuccraMission` is authoritative for the cumulative budget and policy; the x402 offer constrains one payment, not the aggregate budget. The contract's `confirmedSpentAtomic` is a mirrored value updated only from confirmed x402 settlements; it is used for checkpoints and race detection, never as permission to move funds.

## Off-chain Supabase mirror

### `profiles`
- `id` UUID PK → auth.users.id
- `wallet_address` TEXT UNIQUE NOT NULL (EVM address)
- `display_name` TEXT NULL
- `created_at`
- `updated_at`

### `agents`
- `id` UUID PK
- `owner_id` UUID FK profiles.id
- `name` TEXT NOT NULL
- `address` TEXT UNIQUE NOT NULL (EVM address)
- `endpoint_url` TEXT NULL
- `capabilities` JSONB NOT NULL DEFAULT '[]'
- `status` TEXT NOT NULL
- `last_heartbeat_at` TIMESTAMPTZ NULL
- `created_at`
- `updated_at`

### `missions`
- `id` UUID PK
- `owner_id` UUID FK profiles.id
- `name` TEXT NOT NULL
- `objective` TEXT NOT NULL
- `contract_address` TEXT UNIQUE NOT NULL
- `factory_address` TEXT NOT NULL
- `owner_address` TEXT NOT NULL
- `payment_token_address` TEXT NOT NULL
- `budget_atomic` NUMERIC(78,0) NOT NULL
- `remaining_budget_atomic` NUMERIC(78,0) NOT NULL
- `status` TEXT NOT NULL
- `current_agent_id` UUID FK agents.id NULL
- `current_agent_address` TEXT NOT NULL
- `policy_version` INTEGER NOT NULL DEFAULT 1
- `policy_hash` TEXT NOT NULL
- `x402_offer_id` TEXT NULL
- `x402_offer_hash` TEXT NOT NULL
- `expires_at` TIMESTAMPTZ NOT NULL
- `created_at`
- `updated_at`

### `mission_agents`
- `id` UUID PK
- `mission_id` UUID FK
- `agent_id` UUID FK
- `role` TEXT (`PRIMARY`,`SUCCESSOR`)
- `priority` INTEGER
- `required_capabilities` JSONB
- `status` TEXT
- `activated_at` NULL
- `revoked_at` NULL
- unique `(mission_id, agent_id)`

### `mission_policies`
- `id` UUID PK
- `mission_id` UUID FK
- `version` INTEGER
- `max_payment_atomic` NUMERIC(78,0)
- `recovery_max_payment_atomic` NUMERIC(78,0)
- `allowed_action_types` JSONB (`["X402_PAYMENT"]`)
- `allowed_merchants` JSONB
- `allowed_token_addresses` JSONB (MVP: USDG default or one allowlisted ERC-20)
- `violation_threshold` INTEGER DEFAULT 3
- `violation_window_seconds` INTEGER DEFAULT 900
- `policy_json` JSONB NOT NULL
- `policy_hash` TEXT NOT NULL
- `created_at`

### `mission_checkpoints`
- `id` UUID PK
- `mission_id` UUID FK
- `sequence` BIGINT
- `status` TEXT (`CANDIDATE`,`VERIFIED`,`SUPERSEDED`)
- `checkpoint_hash` TEXT NOT NULL
- `confirmed_payment_ids` JSONB
- `confirmed_transaction_hashes` JSONB
- `authorization_nonces` JSONB
- `remaining_budget_atomic` NUMERIC(78,0)
- `state_snapshot` JSONB
- `committed_tx_hash` TEXT NULL
- `created_at`
- unique `(mission_id, sequence)`

### `action_requests`
- `id` UUID PK
- `mission_id` UUID FK
- `agent_id` UUID FK
- `idempotency_key` TEXT
- `agent_nonce` BIGINT
- `action_type` TEXT
- `payload` JSONB
- `request_hash` TEXT
- `signature` TEXT
- `decision` TEXT
- `decision_reason_code` TEXT
- `violation_count_after` INTEGER
- `x402_payment_id` UUID NULL
- `submitted_at`
- `created_at`
- unique `(mission_id, idempotency_key)`
- unique `(mission_id, agent_nonce)`

### `x402_payments`
- `id` UUID PK
- `mission_id` UUID FK
- `action_request_id` UUID FK
- `x402_payment_id` TEXT UNIQUE NOT NULL
- `authorization_hash` TEXT NOT NULL
- `authorization_nonce` TEXT UNIQUE NOT NULL
- `amount_atomic` NUMERIC(78,0) NOT NULL
- `token_address` TEXT NOT NULL
- `merchant_address` TEXT NOT NULL
- `status` TEXT (`PREFLIGHTED`,`SIGNED`,`AUTHORIZED`,`SUBMITTED`,`CONFIRMED`,`FAILED`)
- `authorization_tx_hash` TEXT NULL
- `settlement_tx_hash` TEXT UNIQUE NULL
- `block_number` BIGINT NULL
- `raw_error` JSONB NULL
- `submitted_at`
- `settled_at`
- `created_at`

### `onchain_transactions`
- `id` UUID PK
- `mission_id` UUID FK
- `action_request_id` UUID NULL
- `x402_payment_id` UUID NULL
- `tx_hash` TEXT UNIQUE
- `block_number` BIGINT NULL
- `status` TEXT
- `raw_error` JSONB NULL
- `confirmed_at` TIMESTAMPTZ NULL
- `created_at`

This table mirrors contract calls (create, quarantine, succession, checkpoint commitment) that are not x402 settlements.

### `succession_events`
- `id` UUID PK
- `mission_id` UUID FK
- `from_agent_id` UUID NULL
- `to_agent_id` UUID
- `trigger_type` TEXT
- `checkpoint_id` UUID NULL
- `recovery_limit_atomic` NUMERIC(78,0)
- `status` TEXT
- `onchain_tx_hash` TEXT NULL
- `created_at`

### `audit_events`
- `id` UUID PK
- `mission_id` UUID FK
- `event_type` TEXT
- `actor_type` TEXT
- `actor_id` UUID NULL
- `event_hash` TEXT
- `payload_public` JSONB
- `onchain_tx_hash` TEXT NULL
- `created_at`

Every material mission event writes an immutable audit event. Public audit reads are added in Phase 7.

### Supporting tables

- `agent_challenges` — single-use EIP-712 registration challenge; RLS enabled with no policies (service-role only).
- `agent_request_nonces` — single-use request nonces; unique `(agent_id, nonce)`; service-role only.
- `x402_settlement_receipts` — unique settlement transaction hash and EIP-3009 authorization nonce, facilitator receipt payload hash, Transfer-log-verified flag, processed timestamp; service-role only.

### Sensitive data

Never store:
- private keys or wallet seeds;
- x402 facilitator credentials if configured, beyond their verification window;
- Supabase service-role keys in the browser;
- raw model chain-of-thought;
- user auth tokens in logs;
- agent bearer credentials.

Public data:
- mission contract address;
- public mission status;
- Robinhood transaction hashes;
- x402 payment IDs and EIP-3009 authorization nonces;
- public audit events explicitly marked public.

Private data:
- endpoint URLs if the user chooses private;
- user metadata;
- internal runtime logs;
- agent operational metadata.

## EIP-712 canonical data

Agent requests use:

```text
SuccraRequest(
  address missionId,
  bytes32 requestId,
  uint256 nonce,
  uint256 timestamp,
  bytes32 methodHash,
  bytes32 bodyHash
)
```

- `missionId` is the `SuccraMission` contract address.
- `requestId` is the client-generated action request UUID (also the idempotency scope) hashed to `bytes32`.
- `nonce` is the single-use request nonce (distinct from the on-chain `agentNonce`).
- `timestamp` is Unix seconds; stale requests are rejected.
- `methodHash = keccak256(UTF8(method + " " + path))`.
- `bodyHash = keccak256(raw request body bytes)`.

The EIP-712 domain is:

```json
{
  "name": "Succra",
  "version": "1",
  "chainId": 4663,
  "verifyingContract": "<SuccraMission address>"
}
```

Testnet uses chain ID `46630`. Wallet login uses a separate `SuccraLogin` typed-data domain without a verifying contract. EIP-3009 settlement uses the USDG/ERC-20 `TransferWithAuthorization` typed data; the owner/token holder signs it and Succra binds the resulting authorization hash and nonce into its own request record.

---

# 8. SYSTEM ARCHITECTURE

```text
┌───────────────────────────────────────────────┐
│                    USER                       │
│   EVM wallet + Succra web dashboard           │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│         NEXT.JS / TYPESCRIPT WEB APP          │
│ UI + Route Handlers + session-aware API       │
└───────────────┬───────────────────────────────┘
                │
       ┌────────┴─────────┐
       ▼                  ▼
┌──────────────┐   ┌────────────────────┐
│  SUPABASE    │   │  SUCCRA RUNTIME    │
│ Auth/Postgres│   │ Node/TypeScript    │
│ + RLS        │   │ Guardian/monitor   │
└──────────────┘   └─────────┬──────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   ┌─────────────────────┐       ┌──────────────────────┐
   │ SUCCRA CONTRACTS    │       │  X402 FACILITATOR    │
   │ SuccraMission       │       │ HTTP 402 accepts[]   │
   │ MissionFactory      │       │ EIP-3009 verify      │
   │ GuardianRegistry    │       │ receipt / settlement │
   └──────────┬──────────┘       └──────────┬───────────┘
              │                             │
              └──────────────┬──────────────┘
                             ▼
                  ┌──────────────────────┐
                  │   ROBINHOOD CHAIN    │
                  │  authority state     │
                  │  USDG / ERC-20       │
                  └──────────────────────┘
```

## Architectural principle

**On-chain = authority and policy.**

**x402 facilitator = payment verification and settlement.**

**Off-chain = orchestration, monitoring, indexing, UI, and agent communication.**

The runtime can detect, preflight, and recommend, but it cannot override `SuccraMission` policy or facilitator settlement. x402 receipt verification against the Robinhood EIP-3009 Transfer log is the settlement-confirmation primitive. The database is a mirror and index, never the financial source of truth.

## Non-custodial model (Model B)

- Funds remain in the owner's wallet.
- The owner approves the mission's x402 offer policy (network, asset, payee, amount, expiry).
- The agent submits an EIP-712 `SuccraRequest`; the owner wallet signs the per-payment EIP-3009 `transferWithAuthorization`.
- Succra controls **which agent may request** and **what limits apply**; it never holds or moves funds.
- The x402 facilitator verifies and settles; `SuccraMission` records authority, policy, and the on-chain authorization.

This is the core positioning: Succra is the safety and continuity layer around x402, not a replacement for it.

## Off-chain failure boundary

Succra Cloud is not a cryptographic root of trust. If the runtime is offline:
- no new x402 payment can be preflighted or submitted by Succra;
- previously signed EIP-3009 authorizations may still settle until their `validBefore`, so validity windows must be short;
- automatic succession pauses;
- the owner can still call `cancel` directly on the contract;
- the owner can still use the pre-approved successor path when the guardian is unavailable, subject to the same eligibility and state-version checks;
- existing on-chain authority remains intact.

The owner cannot use the fallback to bypass policy, change successors, or move funds directly.

---

# 9. TECHNOLOGY STACK

## Frontend
**Next.js App Router + TypeScript + Tailwind CSS**

Why: server/client components and Route Handlers keep a small full-stack surface.

## EVM frontend/client
**wagmi + viem + WalletConnect**

Why: wagmi provides React wallet hooks, viem provides typed EVM primitives, and WalletConnect covers mobile wallets. MVP target wallets: MetaMask, OKX, TokenPocket, ImToken.

## Wallet authentication
**Supabase Auth + EIP-712 wallet signature login**

Why: Supabase supplies JWT sessions and RLS; EIP-712 gives typed, human-readable signing for login and agent requests.

## Backend API
**Next.js Route Handlers**

Why: eliminates an unnecessary second HTTP API service for ordinary request/response flows.

## Runtime/guardian
**Node.js 24 + TypeScript + `tsx`**

Responsibilities: agent gateway, heartbeat monitor, x402 client, succession engine, Robinhood event monitor, checkpoint verification, facilitator receipt verification.

## Database
**Supabase Postgres**

Use RLS for user-level resource isolation. The service-role key stays server-side.

## Contracts
**Solidity ^0.8.24 + Hardhat**

`SuccraMission`, `MissionFactory`, and `GuardianRegistry`. Contracts are tested locally, deployed to Robinhood testnet first, and verified on Blockscout.

## Chain
**Robinhood Chain**

- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`, native gas token ETH.
- Testnet: chain ID `46630`; RPC supplied by `NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL` (no default assumed).
- Explorer: `https://robinhoodchain.blockscout.com`.

## Payments
**x402 facilitator (self-hostable: `@402lane/facilitator`, `hood402`, `rhx402`)**

- HTTP 402 `accepts[]` challenge/response.
- EIP-3009 `transferWithAuthorization` signed by the owner/token holder.
- USDG default settlement asset (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`); allowlisted ERC-20 supported.
- Facilitator receipt plus on-chain Transfer-log verification.
- Facilitator polling and Robinhood RPC fallback.
- ERC-8004 optional agent identity metadata.

## AI
**OpenAI API as a non-authoritative recommendation layer**

Only used for successor explanation/recommendation. Deterministic rules remain authoritative.

## Deployment
- Web: Vercel
- Runtime: Railway
- Database/Auth: Supabase
- Contracts: Robinhood testnet first; mainnet only after explicit security verification
- Payments: x402 facilitator

## Rejected alternatives
- Custodial vault model: violates the non-custodial authority thesis.
- Direct ERC-20 transfers or arbitrary contract calls: bypasses x402 and expands the attack surface.
- Multi-chain support in MVP: dilutes the Robinhood/x402 focus.
- Redis: unnecessary for MVP.
- Kafka/queues: unnecessary for MVP.
- Microservices: unnecessary for MVP.
- Generic DeFi transaction router: too risky and large for MVP.
- Full A2A-only integration: should be a compatibility layer, not the core transport.

---

# 10. API SPECIFICATION

All JSON errors use:

```json
{
  "error": {
    "code": "MISSION_NOT_ACTIVE",
    "message": "Mission is not currently executable",
    "requestId": "..."
  }
}
```

## `POST /api/auth/nonce`
Purpose: create a wallet login nonce.
Auth: none.
Request: `{ "walletAddress": "0x..." }`
Success:
```json
{
  "nonce": "...",
  "typedData": { "domain": {}, "types": {}, "primaryType": "SuccraLogin", "message": {} },
  "expiresAt": "..."
}
```

## `POST /api/auth/verify`
Purpose: verify the EIP-712 wallet signature and establish a Supabase session.
Request: `{ walletAddress, nonce, signature }`
Success: `{ user, session }`

## `POST /api/missions`
Auth: user session.
Purpose: create a mission draft, commit the mission's x402 offer policy hash, and prepare the on-chain create call.
Request: mission metadata + policy:
```json
{
  "name": "...",
  "objective": "...",
  "paymentTokenAddress": "0x...",
  "budgetAtomic": "1000000000000000000",
  "maxPaymentAtomic": "100000000000000000",
  "recoveryMaxPaymentAtomic": "50000000000000000",
  "merchantAllowlist": ["0x..."],
  "expiresAt": "...",
  "primaryAgentAddress": "0x...",
  "successors": [{ "address": "0x...", "priority": 1 }],
  "violationThreshold": 3,
  "violationWindowSeconds": 900
}
```
Success:
```json
{
  "missionId": "<uuid>",
  "contractAddress": "<predicted address>",
  "policyHash": "0x...",
  "unsignedTransaction": { "chainId": 4663, "to": "<factory>", "data": "0x...", "value": "0" },
  "x402Offer": { "network": "eip155:4663", "asset": "0x...", "acceptedPayees": ["0x..."], "offerHash": "0x..." }
}
```
The runtime verifies the `MissionCreated` event and the committed `x402OfferHash` before setting the mirror to `ACTIVE`.

## `GET /api/missions`
Auth: user session.
Purpose: list owned missions.

## `GET /api/missions/:id`
Auth: owner or public audit mode.
Purpose: mission detail, contract state, policy, x402 offer status.

## `PATCH /api/missions/:id`
Auth: owner session + owner EIP-712 signature.
Purpose: update a `DRAFT` mission policy before activation. Returns an unsigned contract call. Activated policy changes require a new policy version and explicit owner transaction.

## `POST /api/missions/:id/agents`
Auth: owner.
Purpose: attach primary/successor agent addresses.

## `POST /api/agents/:id/challenge`
Auth: owner session.
Purpose: issue an EIP-712 registration challenge.
Response:
```json
{
  "challenge": "<hex, 32 random bytes>",
  "typedData": {},
  "expiresAt": "<iso8601, 5 minutes from issue>"
}
```

## `POST /api/agents/:id/verify`
Auth: owner session.
Purpose: prove agent address possession.
Request:
```json
{
  "challenge": "<hex>",
  "signature": "<0x-prefixed EIP-712 signature>"
}
```
Response:
```json
{
  "agentId": "<uuid>",
  "address": "0x...",
  "status": "VERIFIED"
}
```
Errors: `CHALLENGE_EXPIRED`, `CHALLENGE_UNKNOWN`, `INVALID_SIGNATURE`.

## `POST /api/agents/:id/heartbeat`
Auth: agent EIP-712 request.
Purpose: liveness signal.
Heartbeat minimum interval: 30 seconds. The gateway rejects heartbeats received less than 30s after the previous accepted heartbeat for the same agent. This is a named constant in code, not an env var.

Headers:
- `x-succra-agent-address`
- `x-succra-timestamp`
- `x-succra-nonce`
- `x-succra-signature`

## `POST /api/missions/:id/actions`
Auth: registered current agent EIP-712 signature.
Purpose: preflight policy evaluation and construct the unsigned EIP-3009 `transferWithAuthorization` typed data. Does NOT submit to the facilitator and does NOT move funds.
Request:
```json
{
  "requestId": "<client-generated UUID>",
  "idempotencyKey": "...",
  "agentNonce": 14,
  "actionType": "X402_PAYMENT",
  "payload": {
    "merchantAddress": "0x...",
    "tokenAddress": "0x...",
    "amountAtomic": "100000000000000000",
    "paymentReference": "...",
    "expiresAt": "..."
  }
}
```
`requestId` is the client-generated UUID used in the `SuccraRequest` typed data; it becomes the action request ID and must be unique per mission.

Response (ALLOW):
```json
{
  "decision": "ALLOW",
  "requestId": "<uuid>",
  "x402Payment": { "network": "eip155:4663", "asset": "0x...", "payTo": "0x...", "valueAtomic": "..." },
  "authorizationHash": "0x...",
  "authorizationNonce": "0x...",
  "eip3009TypedData": { "domain": {}, "types": {}, "primaryType": "TransferWithAuthorization", "message": {} },
  "expiresAt": "..."
}
```
Response (BLOCK):
```json
{
  "decision": "BLOCK",
  "requestId": "<uuid>",
  "reasonCode": "<POLICY_BLOCKED | AGENT_NOT_CURRENT | MISSION_QUARANTINED | ...>",
  "reason": "<human-readable>"
}
```
Errors: `DUPLICATE_REQUEST`, `INVALID_BODY`, `AGENT_NOT_CURRENT`, `MISSION_NOT_ACTIVE`.

## `POST /api/missions/:id/actions/:requestId/submit`
Auth: registered current agent EIP-712 signature.
Purpose: verify the agent request and owner EIP-3009 signature, record on-chain authorization, submit the x402 payload to the facilitator, verify settlement, and mirror the result.
Request:
```json
{
  "authorizationHash": "0x...",
  "signature": "0x..."
}
```
Response (CONFIRMED):
```json
{
  "decision": "ALLOW",
  "requestId": "<uuid>",
  "authorizationTxHash": "0x...",
  "x402PaymentId": "...",
  "transactionHash": "0x...",
  "blockNumber": 123,
  "status": "CONFIRMED"
}
```
Response (FAILED):
```json
{
  "decision": "ALLOW",
  "requestId": "<uuid>",
  "transactionHash": "0x... or null",
  "status": "FAILED",
  "error": { "code": "...", "message": "..." }
}
```
Errors: `AUTHORIZATION_MISMATCH`, `INVALID_SIGNATURE`, `ALREADY_SUBMITTED`, `REQUEST_EXPIRED`, `X402_REJECTION`, `X402_UNAVAILABLE`.

The runtime verifies:
1. the agent's EIP-712 `SuccraRequest` recovers the registered agent address;
2. the owner EIP-3009 signature recovers the token holder and matches the signed authorization hash;
3. the signed authorization hash, nonce, asset, payee, amount, and validity window equal the preflighted values;
4. the request has not expired and its nonce/idempotency key is unused;
5. `SuccraMission.authorizePayment` confirms before facilitator submission;
6. the facilitator settlement and the matching Robinhood Transfer log are authoritative.

## `POST /api/missions/:id/quarantine`
Auth: runtime guardian credential OR owner.
Purpose: request quarantine.
Business rule: guardian can only quarantine; cannot spend or create an x402 payment authorization.

## `POST /api/missions/:id/succession`
Auth: runtime guardian or owner fallback.
Purpose: activate an eligible pre-approved successor.
Idempotency: succession nonce unique.

## `POST /api/missions/:id/succession/:successionId/acknowledge`
Auth: successor agent signature.
Purpose: successor acknowledges the handoff; runtime then submits the guardian-signed `acknowledgeRecovery` call (workflow name `acknowledge_recovery`; `RECOVERING` → `ACTIVE_RECOVERY`).

## `POST /api/missions/:id/checkpoints`
Auth: runtime internal.
Purpose: persist a verified checkpoint and commit its hash on-chain. The full snapshot stays off-chain; the contract stores sequence/hash.

## `GET /api/missions/:id/audit`
Auth: owner or public audit mode for public events.
Purpose: audit timeline.

## `POST /api/missions/:id/cancel`
Auth: owner wallet signature.
Purpose: cancel the mission and stop future x402 payments. Already-signed EIP-3009 authorizations may settle until `validBefore`. Funds remain in the owner's wallet.

## `GET /api/agents/:id/status`
Auth: owner or mission-scoped agent.
Purpose: status/health.
Response:
```json
{
  "agentId": "<uuid>",
  "address": "0x...",
  "status": "<REGISTERED | ACTIVE_PRIMARY | ...>",
  "lastHeartbeatAt": "<iso8601 or null>",
  "missions": [{ "missionId": "<uuid>", "role": "PRIMARY | SUCCESSOR" }]
}
```

### Rate limiting
- auth endpoints: strict edge/API rate limit;
- agent endpoints: mission + agent scoped limits;
- heartbeat: fixed minimum interval;
- action requests: policy and per-agent frequency limit.

### Idempotency
Required for:
- mission creation finalization;
- payment preflight and submission;
- quarantine;
- succession;
- checkpoint commit;
- x402 settlement receipt processing.

### Canonical checkpoint serialization
The checkpoint preimage is:

```text
keccak256(abi.encode(
  missionId,
  sequence,
  keccak256(confirmedPaymentIds),
  keccak256(confirmedTransactionHashes),
  keccak256(authorizationNonces),
  remainingBudgetAtomic,
  maxPaymentAtCheckpoint,
  recoveryMaxPaymentAtCheckpoint,
  policyVersion,
  policyHash,
  createdAt
))
```

Field order is fixed. `checkpoint_hash` is the hex-encoded keccak256 over those bytes. JSON-stringify hashing is forbidden for checkpoint hashes.

---

# 11. DATABASE BEHAVIOR

## Create mission
1. validate the owner and policy;
2. insert the mission draft and policy version 1;
3. insert agent assignments;
4. return the unsigned `MissionFactory` create call and the committed x402 offer policy hash;
5. after the `MissionCreated` event confirms the committed x402 offer hash, atomically update the mission to `ACTIVE` and create an audit event. There is no external x402 offer registration step.

## Preflight
Database transaction:
1. insert the request using the unique idempotency key;
2. lock/read the mission mirror and contract state;
3. evaluate policy;
4. update the violation streak only when the decision is `BLOCK`;
5. record the decision and authorization hash;
6. return the unsigned EIP-3009 authorization typed data. Do not submit to the facilitator.

## Submit
1. verify the agent's EIP-712 request and the owner's EIP-3009 signature, authorization hash, and nonce;
2. lock the approved request with a compare-and-set;
3. call `SuccraMission.authorizePayment` and wait for confirmation;
4. mark the request `SUBMITTED` only after authorization confirms;
5. submit the x402 payload to the facilitator;
6. verify the facilitator receipt and the on-chain EIP-3009 Transfer log; poll Robinhood RPC when the receipt is delayed;
7. update `x402_payments` and the mission mirror only after authoritative confirmation;
8. write the checkpoint and audit event.

Do not hold a database transaction open while waiting for x402 or Robinhood confirmation. Use an explicit `SUBMITTED → CONFIRMED/FAILED` transition.

## Quarantine
Use compare-and-set semantics:
`UPDATE missions SET status='QUARANTINED' WHERE id=? AND status='ACTIVE'`.
Then submit the guardian contract call. If affected rows = 0, quarantine was already handled or mission state changed. The contract remains the ultimate arbiter.

## Succession
Use a database lock/transaction on the mission row to prevent two successor jobs from activating simultaneously. The contract `state_version` remains the ultimate arbiter.

## Race scenarios

| Scenario | Handling |
|---|---|
| Double action submission | Unique `(mission_id, idempotency_key)` and single-use nonce. |
| Two payments consume last budget | `SuccraMission` enforces the cumulative budget and unique on-chain request nonces; the x402 offer constrains each payment; the contract mirrors confirmed spend. |
| Quarantine races with payment | Contract checks status during authorization. An already-signed EIP-3009 authorization may still settle until `validBefore`; the runtime records the race explicitly and keeps authorization windows short. |
| Double succession | Contract `state_version` and succession nonce allow only one transition. |
| Stale successor activation | Contract rejects activation if status/current agent/version does not match expected values. |
| Duplicate x402 settlement receipt | Unique transaction hash plus authorization nonce; second delivery is a no-op. |
| Facilitator receipt arrives before RPC receipt | Store pending, poll Robinhood, then confirm only against the EIP-3009 Transfer log. |
| x402 rejects after owner signature | Record `FAILED`; do not retry with a different authorization silently. |

---

# 12. AUTHENTICATION & AUTHORIZATION

## User authentication
EIP-712 wallet signature → Supabase JWT session. The nonce is single-use and expires. A switched wallet requires re-authentication.

## Agent authentication
The registered agent EVM address signs the canonical `SuccraRequest` typed data:

```text
SuccraRequest(
  address missionId,
  bytes32 requestId,
  uint256 nonce,
  uint256 timestamp,
  bytes32 methodHash,
  bytes32 bodyHash
)
```

Headers:
- `x-succra-agent-address`
- `x-succra-timestamp`
- `x-succra-nonce`
- `x-succra-signature`

`{nonce}` is the request-level replay-protection value, stored single-use in `agent_request_nonces`. It never advances on-chain state. `agentNonce` in the action request body is a distinct value passed to the contract's monotonic counter. The two values MUST NOT be the same variable.

## Settlement authorization
Settlement uses EIP-3009 `TransferWithAuthorization` typed data signed by the owner/token holder. The agent's `SuccraRequest` authenticates the request but never authorizes a token transfer. Succra verifies both signatures and records the authorization hash on-chain before facilitator submission.

## Resource authorization
Every API request performs both:
1. session authentication;
2. ownership/resource authorization.

Supabase RLS is the database backstop. The service-role key is server-only and never shipped to the browser. Every query is scoped to the authenticated owner or mission membership; a UUID alone is never sufficient authorization.

## Guardian authorization
`GuardianRegistry` stores a single global guardian address. The guardian key is held server-side by the Succra runtime. The registry owner can rotate the guardian; rotation emits `GuardianRotated`. A decentralized guardian set (multisig or keeper network) is explicitly out of MVP scope.

The guardian can only:
- quarantine;
- report a policy violation for the on-chain counter;
- activate one of the pre-approved successors;
- acknowledge recovery;
- commit an approved checkpoint hash.

The guardian cannot:
- withdraw or move funds;
- change the owner;
- change policy or add merchants;
- change the budget;
- add a successor outside the pre-approved list;
- bypass the recovery ceiling.

## Owner authority
Owner can:
- create the mission;
- update future policy subject to contract rules and state version;
- add successors before activation;
- cancel;
- stop future x402 payments;
- sign EIP-3009 payment authorizations while the mission is executable;
- use the pre-approved successor fallback when the guardian is unavailable.

Owner does not have a hidden API shortcut; owner authority is backed by wallet signatures and on-chain checks.

---

# 13. SECURITY ARCHITECTURE

## Threat model

Assume:
- primary agent can become malicious;
- primary agent key can be compromised;
- runtime can be buggy or temporarily unavailable;
- attacker can replay signed requests;
- attacker can modify API inputs;
- facilitator receipts can duplicate or arrive out of order;
- user can be phished into signing malicious typed data;
- LLM output can be manipulated;
- clients can attempt cross-user resource access;
- x402 or Robinhood RPC can be unavailable or return inconsistent results.

## Security controls

### Authority isolation
Agents never hold owner funds or token signing keys. Funds remain in the owner's wallet constrained by the mission's x402 offer policy; the owner signs each EIP-3009 authorization. `SuccraMission` controls mission authority, not custody.

### Least privilege
Successors start with lower recovery limits. Merchant and token allowlists are explicit. Guardian powers are limited to quarantine, activation, acknowledgement, and checkpoint commitment.

### Replay protection
Signed requests include timestamp + single-use nonce + unique idempotency key. EIP-712 typed data binds the mission, request ID, method, and body hash.

### Authorization binding
The signed EIP-3009 `TransferWithAuthorization` hash must equal the preflighted authorization hash, and the signed from/to/value/validity/nonce fields must match the preflighted values. A mismatch is rejected before on-chain authorization or facilitator submission.

### On-chain enforcement
The backend cannot override `SuccraMission` policy. `authorizePayment` checks status, current agent, per-payment ceiling, merchant/token allowlist, expiry, recovery ceiling, state version, and the agent's EIP-712 signature before the runtime may submit to the facilitator. The owner's EIP-3009 signature is verified against the same authorization hash and nonce.

### x402 enforcement
The facilitator enforces the EIP-3009 signature, nonce, asset, recipient, amount, and validity window at settlement. It does not enforce the cumulative mission budget or the merchant allowlist; `SuccraMission` does. A payment outside the selected x402 offer is rejected even if the Succra mirror is stale.

### IDOR protection
Every resource lookup is ownership-scoped; never load a resource solely by UUID before authorization. Database RLS reinforces this.

### Injection
- parameterized SQL via Supabase SDK;
- validated JSON schemas;
- no shell execution from agent input;
- no agent-supplied calldata is executed directly.

### XSS
Use React escaping; do not render agent-supplied HTML; sanitize any future markdown/HTML rendering.

### CSRF
Mutating browser operations require an authenticated session plus wallet-signature confirmation where financial authority changes.

### SSRF
Agent endpoint URLs are not fetched arbitrarily by the browser. Server-side endpoint fetching must use HTTPS, restrict private-network destinations, enforce timeouts, and cap redirects.

### Settlement receipts
An x402 facilitator receipt must be matched to the on-chain EIP-3009 Transfer log (from, to, value, nonce, asset) before any state change. Duplicates are expected and deduplicated by transaction hash plus authorization nonce. A receipt alone never confirms settlement; Robinhood state is checked.

### Prompt injection
AI successor recommendation receives structured mission metadata only. It MUST NOT receive arbitrary agent-originated instructions as trusted system instructions.

### AI authority boundary
LLM can recommend or explain; only deterministic policy, `SuccraMission`, the owner's EIP-3009 authorization, and the x402 facilitator can authorize or settle money movement.

### Secrets
Store:
- Supabase service key;
- x402 facilitator credentials, if configured;
- guardian private key;
- OpenAI key
only in server/runtime secret stores. Never in browser variables unless explicitly public.

### Race conditions
Contract `state_version`, database row locks/compare-and-set, unique authorization hashes, and single-use nonces prevent duplicate succession, duplicate payments, and inconsistent status.

### Financial abuse
Hard caps:
- per-payment limit;
- total mission budget;
- merchant allowlist;
- token allowlist;
- expiry;
- recovery cap;
- no direct ERC-20 path.

### Admin abuse
No admin funds access. No operator can withdraw, change the owner, or bypass policy.

### Emergency stop
Owner can cancel directly through the contract when allowed. The guardian can quarantine. Neither can move funds. Cancellation cannot revoke an already-signed EIP-3009 authorization; short `validBefore` windows bound that exposure.

---

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

---

# 22. REPOSITORY STRUCTURE

```text
succra/
├── PROJECT_SPEC.md
├── ARCHITECTURE.md
├── IMPLEMENTATION_PLAN.md
├── AGENTS.md
├── AI_HANDOFF.md
├── SUCCRA_BLUEPRINT.md
├── pnpm-workspace.yaml
├── package.json
├── contracts/
│   ├── src/
│   │   ├── SuccraMission.sol
│   │   ├── MissionFactory.sol
│   │   └── GuardianRegistry.sol
│   ├── test/
│   └── hardhat.config.ts
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   ├── styles/
│   │   └── tests/
│   └── runtime/
│       ├── src/
│       │   ├── guardian/
│       │   ├── agents/
│       │   ├── succession/
│       │   ├── checkpoints/
│       │   ├── x402/
│       │   └── monitor/
│       └── tests/
├── packages/
│   ├── sdk/
│   ├── shared/
│   └── x402-client/
├── supabase/
│   ├── migrations/
│   └── seed/
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── security/
└── docs/
    ├── protocol/
    ├── decisions/
    └── runbooks/
```

Directory rule: product UI stays in `apps/web`; persistent orchestration in `apps/runtime`; on-chain authority in `contracts/`; x402 integration and shared contracts/types in `packages/`.

---

# 23. ENVIRONMENT VARIABLES

## Web/server
```text
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=4663
NEXT_PUBLIC_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL=
NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL=https://robinhoodchain.blockscout.com
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUCCRA_MISSION_FACTORY_ADDRESS=
SUCCRA_GUARDIAN_ADDRESS=
X402_FACILITATOR_URL=
X402_NETWORK=eip155:4663
X402_ASSET_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
OPENAI_API_KEY=
OPENAI_MODEL=
```

## Runtime-only
```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUCCRA_RPC_URL=
SUCCRA_MISSION_FACTORY_ADDRESS=
SUCCRA_GUARDIAN_ADDRESS=
ROBINHOOD_GUARDIAN_SECRET_KEY=
ROBINHOOD_GUARDIAN_CREDENTIAL=
SUCCRA_RUNTIME_SIGNER_SECRET_KEY=
X402_FACILITATOR_URL=
X402_NETWORK=eip155:4663
X402_ASSET_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
OPENAI_API_KEY=
OPENAI_MODEL=
```

Rules:
- `NEXT_PUBLIC_*` must never contain secrets;
- guardian secret is runtime-only;
- Supabase service role is server-only;
- x402 facilitator URL and any facilitator credentials are server-only;
- agent private keys live with agents and never in Succra;
- `.env*` excluded from git except `.env.example`.

---

---

# 24. PHASED IMPLEMENTATION PLAN

> **Historical note:** Phases 0–6 below were executed against HashKey Chain / HSP and are archived at tag `hashkey-v1`. They are retained as history. The active plan is Phase R0–R4 for Robinhood Chain / x402.

## Phase 0 — Repository pivot
Objective: preserve the prior chain implementation, remove it from the mainline, and establish the EVM/HSP workspace without implementing product behavior.

Tasks:
- create and push the annotated `solana-v1` archive tag at `phase-6-succession` `a4e089a` (separate archive task);
- continue on the `hashkey-pivot` branch created by the docs pivot task;
- remove the prior-chain program directory, root toolchain files, and the prior-chain Docker toolchain;
- remove the prior-chain CI jobs; keep the `web` and `supabase` jobs;
- add the `.env.example` deprecation notice, then replace prior-chain variables with the HashKey/HSP variables in the scaffold commit;
- scaffold the `contracts/` Hardhat workspace and the `packages/hsp-client/` package stub;
- add EVM wallet dependencies (`wagmi`, `viem`, WalletConnect) and workspace scripts;
- keep `apps/web`, `packages/sdk`, `packages/shared`, `supabase/`, `tests/`, and `docs/` in place for adaptation.

Acceptance:
- the archive tag exists locally and on the remote;
- the mainline contains no prior-chain program or program toolchain;
- CI runs only the `web` and `supabase` jobs;
- the workspace installs, lints, typechecks, tests, builds, and formats;
- no product feature is implemented in this phase.

## Phase 1 — SuccraMission contract foundation
Objective: establish on-chain mission authority, policy, status, and guardian control.

Tasks:
- create the Solidity `^0.8.24` + Hardhat workspace under `contracts/`;
- implement `SuccraMission.sol` with `MissionConfig`, `AuthorityState`, `Successor`, `MissionStatus`, and `Checkpoint` types;
- implement `MissionFactory.sol` to deploy one mission contract per mission and index missions by owner;
- implement `GuardianRegistry.sol` with a global guardian address rotatable by the registry owner;
- implement mission creation, policy validation, owner/guardian access control, and status transitions for `ACTIVE`, `CANCELLED`, and `EXPIRED` (DRAFT is a reserved off-chain mirror state only; policies are immutable at creation);
- implement `authorizePayment` in `SuccraMission` (agent-signed, policy-enforcing, records `PaymentAuthorization`, advances `agentNonce`; does not move funds);
- `authorizePayment` advances both `agentNonce` and `stateVersion`; only one payment per mission can be in-flight.
- emit `MissionCreated`, `MissionStatusChanged`, `PolicyUpdated`, `AgentAuthorized`, `AgentRevoked`, `MissionCancelled`, and `GuardianRotated` events;
- add `state_version` to every state-changing path;
- add contract unit tests for creation, validation, authorization, and state transitions.

Acceptance:
- an owner can create a mission with a valid policy;
- invalid policy inputs are rejected on-chain;
- non-owners cannot create or mutate a mission;
- the factory indexes missions by owner;
- guardian rotation is owner-controlled and emits an event;
- all contract unit tests pass.

## Phase 2 — HSP client and payment preflight
Objective: implement the non-custodial HSP preflight path without moving funds.

Tasks:
- implement the HSP client with HMAC-SHA256 request signing and ES256K JWT authentication;
- define Cart Mandate and Payment Mandate types aligned with HSP;
- define the EIP-712 domain and `SuccraRequest` typed data;
- implement the deterministic policy evaluator for `HSP_PAYMENT`;
- implement `POST /api/missions/:id/actions` as preflight only;
- validate mission status, current agent, action type, merchant allowlist, token allowlist, per-payment cap, remaining budget envelope, expiry, nonce, and idempotency;
- return the unsigned Payment Mandate and its typed-data payload;
- add an HSP mock server and preflight integration tests.

Acceptance:
- a valid preflight returns an unsigned mandate and typed data;
- every FR-03 rejection path returns the documented `BLOCK` or error response;
- preflight never submits a payment or calls the HSP settlement endpoint;
- no funds move and no transaction is fabricated;
- all preflight unit and integration tests pass.

## Phase 3 — Payment submission and settlement
Objective: submit signed payment mandates to HSP and mirror authoritative settlement.

Tasks:
- implement `POST /api/missions/:id/actions/:requestId/submit`;
- verify the agent EIP-712 signature against the registered agent address;
- verify the signed mandate hash matches the preflighted mandate hash;
- enforce idempotency and single-use request nonces;
- call `SuccraMission.authorizePayment` with the agent signature and wait for confirmation before any HSP submission;
- submit the signed mandate to the HSP Gateway;
- process HSP webhooks with HMAC-SHA256 verification and replay protection;
- add HashKey RPC polling as a fallback when webhooks are delayed;
- persist `hsp_payments`, settlement transaction hashes, block numbers, and raw errors;
- update the off-chain mission mirror only after authoritative confirmation;
- record confirmed settlement facts needed by the Phase 6 checkpoint writer.

Acceptance:
- a valid signed mandate settles through HSP and is mirrored with a HashKey transaction hash;
- HSP is not called unless `authorizePayment` confirms;
- duplicate submissions return the original result;
- a tampered or mismatched mandate is rejected before HSP submission;
- HSP rejection is recorded as failure and never reported as success;
- duplicated or out-of-order webhooks are idempotent;
- all submission, settlement, and webhook tests pass.

## Phase 4 — Agent registration and liveness
Objective: register EVM agent addresses and monitor liveness.

Tasks:
- implement agent registration with an EVM address and metadata;
- implement challenge issuance and EIP-712 possession verification;
- store only public addresses and metadata;
- implement heartbeat with a minimum 30-second interval;
- implement agent status and mission-scoped authorization;
- add single-use challenge and request-nonce tables;
- add integration tests for registration, replay, stale challenges, and unauthorized agents.

Acceptance:
- an agent proves address possession without sharing a private key;
- stale, replayed, or mismatched signatures are rejected;
- an agent not assigned to a mission cannot act;
- heartbeat status is visible to the owner;
- all registration and liveness tests pass.

## Phase 5 — Violations, quarantine, audit
Objective: enforce the violation threshold, quarantine, and audit trail.

Tasks:
- implement the FR-04 consecutive violation streak in the runtime/database flow;
- apply the configured window and reset on confirmed settlement;
- record only authenticated, current-agent, policy-blocked requests toward the streak;
- implement guardian-reported violation records and quarantine in `SuccraMission`;
- implement `POST /api/missions/:id/quarantine` for owner or guardian;
- invalidate current agent authority on quarantine;
- write immutable `audit_events` rows for violation counted, threshold reached, quarantine submitted, and quarantine confirmed;
- test duplicate quarantine, race conditions, and unauthorized guardian attempts.

Acceptance:
- three authenticated policy violations cause exactly one quarantine;
- a quarantined mission cannot authorize new payments;
- the guardian cannot spend, change the owner, change policy, or add a successor;
- audit rows are complete and immutable;
- all quarantine and audit tests pass.

## Phase 6 — Checkpoints and succession
Objective: preserve verified mission state and transfer reduced authority to a pre-approved successor.

Tasks:
- implement the deterministic checkpoint schema and canonical hash;
- store checkpoint sequence/hash on-chain and the full verified snapshot off-chain;
- mark the latest verified checkpoint as the quarantine recovery boundary;
- implement successor eligibility: pre-approved, not the quarantined primary, required capabilities, registered address, `AVAILABLE`, deterministic priority;
- implement `activate_successor` (`QUARANTINED` → `RECOVERING`);
- implement `acknowledge_recovery` (`RECOVERING` → `ACTIVE_RECOVERY`);
- enforce the recovery per-payment ceiling on-chain by mission status;
- add `mission_checkpoints` and `succession_events` tables with owner RLS;
- implement succession and acknowledgement endpoints;
- write the Phase 6 audit event list;
- test stale state, duplicate succession, unauthorized successors, and recovery ceilings.

Acceptance:
- a pre-approved successor becomes the current agent with reduced authority;
- the successor cannot expand policy or name a new successor;
- duplicate or stale succession attempts fail safely;
- the recovery ceiling is enforced on-chain;
- all checkpoint and succession tests pass.

## Current plan — Robinhood Chain / x402

Phase 7c UI work is complete on branch `phase-7-ux` at `cc0f90b` and is rail-agnostic. It may be merged or carried into `robinhood-pivot` after R0; it is not part of the R0–R4 implementation sequence below. No further Phase 7c work is authorized.

## Phase R0 — Archive HashKey, authorize Robinhood / x402

Objective: preserve the HashKey implementation and amend the source-of-truth docs before any code changes.

Tasks:
- create and push annotated tag `hashkey-v1` at the most complete HashKey-era commit (`phase-7-ux` @ `cc0f90b`, which includes 7a, 7b, and 7c);
- branch `robinhood-pivot` from the same commit;
- amend `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `AGENTS.md`, `AI_HANDOFF.md`, and `SUCCRA_BLUEPRINT.md` for Robinhood Chain / x402;
- keep contracts, HSP code, env files, and Hardhat config untouched;
- commit docs only and push the branch.

Acceptance:
- `hashkey-v1` exists locally and on the remote;
- `robinhood-pivot` starts at the archived commit;
- only the six source-of-truth docs changed;
- no code, contracts, env files, or Hardhat config changed;
- docs-only commit pushed and reported.

## Phase R1 — x402 client and chain swap

Objective: replace the HSP payment rail with x402 while preserving the three-contract authority model, policy engine, violation streak, quarantine, succession, checkpoints, recovery authority, audit events, and UI.

Tasks:
- add `packages/x402-client` for HTTP 402 `accepts[]` parsing, EIP-3009 `TransferWithAuthorization` typed data, facilitator verify/settle/receipt handling, and a mock facilitator;
- switch chain config to Robinhood mainnet 4663 and testnet 46630, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`, and USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`;
- rename `HASHKEY_*` to `ROBINHOOD_*` and `HSP_*` to `X402_*` in `.env.example`, runtime config, and deployment config;
- preserve the three-contract topology and policy semantics; adapt identifiers/ABI/field names only as required by the x402 authorization model;
- rewrite preflight to select an x402 offer and return EIP-3009 typed data for the owner/token holder;
- rewrite submit to verify the agent `SuccraRequest` and owner EIP-3009 signature, record on-chain authorization, submit to the facilitator, and verify the receipt against the Robinhood Transfer log;
- replace HSP persistence and webhook handling with x402 payment/receipt persistence and facilitator polling fallback;
- update UI copy, decision receipts, timeline event formatting, and proof links for x402 payment IDs / authorization nonces and Robinhood transaction hashes;
- add unit, integration, contract, and security tests for authorization binding, nonce replay, receipt forgery, facilitator failure, duplicate submission, budget exhaustion, stale state, unauthorized agents, and unauthorized merchants.

Acceptance:
- no HSP code path is required for the golden path;
- the owner wallet signs EIP-3009 authorizations; agents never hold funds;
- `SuccraMission` remains authoritative for policy and cumulative budget;
- the facilitator settles only after on-chain authorization;
- settlement is confirmed only from the Robinhood Transfer log;
- all relevant tests pass.

## Phase R2 — Robinhood testnet deployment and live flow

Objective: prove the full lifecycle on Robinhood Chain testnet (46630).

Tasks:
- deploy `GuardianRegistry`, `MissionFactory`, and `SuccraMission` to testnet;
- verify source on Blockscout;
- configure the x402 facilitator, USDG/allowlisted asset, and guardian runtime;
- run create → payment → violations → quarantine → succession → recovery on testnet;
- record transaction hashes, addresses, and evidence.

Acceptance:
- contracts verified on testnet Blockscout;
- full lifecycle completes end to end;
- evidence is recorded;
- no secret is exposed.

## Phase R3 — Robinhood mainnet deployment and verification

Objective: deploy and verify the hackathon build on Robinhood Chain mainnet (4663).

Tasks:
- complete mainnet readiness review;
- fund the deployer wallet;
- deploy and verify the three contracts on mainnet Blockscout;
- configure mainnet x402 facilitator and USDG asset;
- run a small-capital live demo only if explicitly approved;
- publish contract addresses and evidence.

Acceptance:
- contracts deployed and verified on mainnet;
- x402 configuration is live;
- demo evidence is recorded;
- no unresolved critical or high finding remains.

## Phase R4 — Demo smoke test, video, and submission

Objective: produce the World is Flat hackathon submission evidence.

Tasks:
- run the Playwright demo smoke test against the Robinhood build;
- record the full lifecycle video;
- publish the public site and evidence;
- verify accessibility, responsive behavior, and proof links;
- submit before 2026-11-12 17:30 UTC.

Acceptance:
- the demo proves create → payment → violations → quarantine → succession → recovery;
- the smoke test passes with evidence;
- video and public links are available;
- no secret is exposed.

---

Every phase follows the workflow: implement → test → inspect → fix → commit → record checkpoint → STOP. Do not proceed to the next phase without explicit authorization.

---

# 25. PROJECT_SPEC.md

The full product source of truth is this blueprint's Sections 1–6 and 14–21. `PROJECT_SPEC.md` mirrors those sections without adding implementation choices that are not already decided here.

Required source-of-truth rules:
- this document outranks agent assumptions;
- new product features require explicit human approval;
- implementation may not silently broaden supported payment paths;
- financial policy logic is deterministic;
- all payments go through x402.

---

# 26. ARCHITECTURE.md

The full architecture source of truth is Sections 7–13 and 22–23.

Architecture invariants:
1. funds remain in the owner's wallet; Succra does not custody;
2. SuccraMission controls mission authority and policy;
3. the x402 facilitator controls payment verification and settlement;
4. the backend/database is not the source of truth for funds;
5. guardian cannot spend or change owner/policy/successors;
6. successor must be pre-approved and starts with a lower recovery ceiling;
7. AI cannot authorize money movement;
8. no arbitrary contract calls or direct ERC-20 path in MVP; payments only via x402.

---

# 27. IMPLEMENTATION_PLAN.md

Use Section 24 exactly as the phased plan. Each phase must be executed alone. Do not combine phases unless the human explicitly authorizes it.

Each phase ends with:
- tests;
- manual verification;
- changed-files review;
- security review appropriate to phase;
- Git commit;
- checkpoint update;
- STOP before the next phase.

---

# 28. AGENTS.md

See the dedicated `AGENTS.md` artifact generated with this blueprint. It is normative for the coding agent and includes scope, architecture invariants, task discipline, testing, security, and stop rules.

---

# 29. AI_HANDOFF.md

See the dedicated `AI_HANDOFF.md` artifact generated with this blueprint. It contains the current state, pivot record, frozen decisions, repository expectations, implementation entry point, and verification rules.

---

# 30. FINAL PRE-IMPLEMENTATION AUDIT

## Contradictions found and resolved
### "Succra modifies agents" vs "Succra controls authority"
Resolved: Succra never modifies agent code. It controls mission authority.

### "On-chain contract vs x402 settlement"
Resolved: SuccraMission is authoritative for mission authority and policy; the x402 facilitator is authoritative for payment verification and settlement. The runtime records on-chain authorization before facilitator submission.

### "AI decides successor"
Resolved: deterministic eligibility is mandatory; AI only recommends/explains.

### "Checkpoint contains agent memory"
Resolved: checkpoint contains only verified facts and hashes; agent reasoning is not authoritative.

### "Generic payment execution"
Resolved: MVP supports only x402 EIP-3009 settlement of USDG or an allowlisted ERC-20 to allowlisted merchants. Native ETH is gas only. Arbitrary contract calls and direct ERC-20 paths are out of scope.

### "Failure detection"
Resolved: MVP uses three authenticated policy violations as the automatic safety trigger. Heartbeat/liveness is a SHOULD feature rather than a dependency for the first working lifecycle.

### "Recovery authority"
Resolved: successor starts with a lower recovery ceiling and cannot expand its own authority.

### "Custody"
Resolved: Succra never receives the user's wallet seed/private key and never holds funds. Funds remain in the owner's wallet; the owner/token holder signs EIP-3009 authorizations.

### "Admin override"
Resolved: there is no admin withdrawal path.

## Remaining explicit implementation details
The coding agent MAY decide only:
- exact component file names within approved structure;
- exact serialization library choice for JSON schemas;
- exact UI microcopy except for locked core positioning;
- test fixture values;
- exact RPC helper implementation;
- exact internal function names.

The coding agent MUST NOT decide:
- architecture changes;
- new product capabilities;
- new chain integrations;
- custody model;
- business rules;
- mission states;
- authority model;
- security boundaries;
- supported payment types;
- token utility requirements.

## Final readiness conclusion
The project is sufficiently specified for a coding agent to begin implementation without redesigning the product. The MVP is intentionally narrower than a general autonomous-agent platform: one chain, one purpose-built mission contract per mission, one x402 payment adapter, one deterministic policy engine, one quarantine trigger, pre-approved successors, constrained recovery, verified checkpoints, and a visible audit trail.

---

# CODING AGENT START POINT

**Do not implement the whole application.**

Phase R0 (archive HashKey and amend the docs for Robinhood Chain / x402) is complete. The next assigned task is **R1 — x402 client and chain config swap**, which is not authorized yet.

> Do not begin R1 without explicit approval. Do not modify contracts, delete HSP code, or change env files outside R1.

This operating model follows the supplied workflow's central rule: the human controls direction, scope, product intent, architecture, security, acceptance criteria, and verification, while the coding agent primarily accelerates implementation, testing, debugging, refactoring, and documentation. fileciteturn0file0L472-L496 fileciteturn0file0L654-L689
