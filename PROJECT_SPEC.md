# SUCCRA — PROJECT_SPEC.md

# 1. PRODUCT DEFINITION

## Product name
**Succra**

## One-line description
**Succra is a Solana-native continuity layer that lets an autonomous economic mission survive agent failure by revoking unsafe authority, preserving verified state, and transferring constrained authority to a pre-approved successor.**

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
Developers and operators building autonomous agents that can control money or other consequential Solana resources.

### Secondary
- AI-agent application builders
- DeFi/treasury automation developers
- protocol teams operating autonomous agents
- businesses that want bounded autonomous payment agents
- future agent platforms that need portable continuity

## User roles
### Mission Owner
Human wallet owner who creates the mission, funds it, defines policy, approves successors, and retains ultimate control.

### Primary Agent
The autonomous agent currently authorized to execute mission actions.

### Successor Agent
A pre-approved agent eligible to receive authority when the primary loses mission authority.

### Succra Guardian
A constrained protocol/runtime role that can trigger quarantine and activate only pre-approved successor agents according to the mission policy. The guardian cannot spend mission funds directly.

### Succra Runtime
Off-chain orchestration/monitoring component. It does not become the custodian of mission assets.

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
A user funds a payment/rebalancing mission. Agent Alpha executes authorized transfers. Alpha makes repeated policy violations. Succra quarantines Alpha, preserves the last verified checkpoint, activates successor Beta with a lower emergency authority limit, and lets Beta continue the mission.

## Secondary use cases
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
- execute arbitrary Solana programs through an unrestricted instruction router;
- trust an LLM as the authoritative security decision-maker;
- support arbitrary chains in MVP;
- make $SUCCRA token ownership necessary for mission operation.

---

# 2. MVP SCOPE

## MUST HAVE
1. Solana wallet-based user authentication.
2. Mission creation.
3. Mission policy creation with:
   - total budget;
   - per-action limit;
   - allowed recipients;
   - allowed action types;
   - expiry;
   - primary agent;
   - ordered successor list.
4. Program-controlled mission vault.
5. Agent registration with Ed25519 public key.
6. Signed agent action requests.
7. Deterministic policy engine.
8. On-chain execution of only:
   - SOL transfer;
   - SPL token transfer.
9. Consecutive policy-violation tracking.
10. Automatic quarantine after 3 consecutive blocked actions within the mission's configured window.
11. Succra guardian quarantine authority that cannot spend mission funds.
12. Verified checkpoint creation based on deterministic mission facts.
13. Successor selection from pre-approved successors.
14. Restricted recovery authority for successor.
15. Successful successor execution.
16. Audit timeline for actions, failures, quarantine, succession, and execution.
17. Publicly verifiable Solana transaction signature for executed mission actions.
18. End-to-end demo path proving continuity.

## SHOULD HAVE
1. Heartbeat/liveness monitoring and quarantine after repeated missed heartbeats.
2. Successor suitability score based on deterministic capability/health signals.
3. AI-generated successor recommendation/explanation, never authoritative.
4. On-chain checkpoint hash commitment.
5. Mission continuity metrics: recovery time, capital preserved, number of violations.
6. Helius webhook-driven transaction monitoring.
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
- arbitrary CPI router;
- unrestricted wallet custody;
- automated trading strategy engine;
- generalized AI safety model;
- cross-chain bridges;
- token governance;
- mobile app;
- production-grade decentralized keeper network.

---

# 3. USER ROLES

| Role | Can do | Cannot do |
|---|---|---|
| Mission Owner | create/fund/update/cancel mission, define policy, approve successors, withdraw after cancel/completion | bypass immutable execution constraints without signing owner instruction |
| Primary Agent | submit action requests, heartbeat, submit candidate checkpoint | change policy, change successor set, access vault directly |
| Successor Agent | act only after activation and within recovery limits | activate itself, change mission policy, access old agent authority |
| Succra Guardian | quarantine mission, activate pre-approved successor within policy | spend funds, add unapproved successor, rewrite mission owner |
| Public Viewer | view public audit page and on-chain proofs | view private user metadata or internal agent credentials |

---

# 4. COMPLETE USER FLOWS

## Flow A — Connect wallet and sign in
Entry: `/`

1. User connects a Wallet Standard-compatible Solana wallet.
2. UI requests a nonce/challenge from Succra.
3. Wallet signs a human-readable login message.
4. Backend verifies signature.
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
POST /api/missions/draft
  ↓
Server validates policy
  ↓
Unsigned on-chain create transaction
  ↓
Wallet signs
  ↓
Program creates Mission PDA + Vault
  ↓
Funding transaction signed
  ↓
Mission becomes ACTIVE
  ↓
Dashboard shows mission
```

Database changes: mission row, policy row, agent assignments, audit row.
On-chain changes: Mission PDA, vault authority, policy hash, primary/successor keys.

## Flow C — Connect/register an agent
Entry: Mission → Add Agent

1. User creates/chooses an agent keypair.
2. Agent public key is displayed/generated.
3. User registers the public key with Succra.
4. Agent proves possession by signing a challenge.
5. API stores only public key and metadata.
6. Agent gets a mission-scoped credential/config.

No private key ever enters Succra.

## Flow D — Agent requests action

```text
Agent
  ↓ signed action request
Succra Runtime/API
  ↓ authenticate agent
Load mission + current authority
  ↓
Validate nonce/idempotency
  ↓
Deterministic policy evaluation
  ↓
ALLOW / BLOCK
  ↓
If ALLOW → submit on-chain execution
  ↓
Confirm transaction
  ↓
Update authoritative off-chain mirror
  ↓
Checkpoint eligible
  ↓
Audit UI
```

## Flow E — Three violations → quarantine
1. Agent submits blocked action.
2. Action is recorded as `BLOCKED`.
3. Consecutive violation counter increments atomically.
4. Counter reaches 3.
5. Runtime submits guardian quarantine instruction.
6. Program verifies guardian and sets mission `QUARANTINED`.
7. Current agent authority is invalidated.
8. Last verified checkpoint is marked the recovery boundary.
9. Succession engine begins.

Failure protection: quarantine transaction is allowed to happen even if the agent is still offline because the guardian is separate from the agent.

## Flow F — Successor activation
1. Succra reads ordered pre-approved successors.
2. Eligibility filters are applied.
3. Highest-priority eligible successor is selected.
4. On-chain activation instruction is submitted by guardian.
5. Program verifies successor is pre-approved.
6. Program moves mission to `RECOVERING`.
7. Successor receives the verified checkpoint and restricted authority.
8. Successor must acknowledge the handoff.
9. Mission becomes `ACTIVE_RECOVERY`.

## Flow G — Recovery execution
1. Successor proposes action.
2. Policy engine uses recovery limits, not primary limits.
3. If valid, program executes action.
4. On-chain transaction confirms.
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
- Solana transaction signature;
- timestamp and block/slot when available.

The audit page distinguishes:
- **deterministically proven facts**;
- **agent-provided claims**;
- **AI explanations**.

AI explanations are never presented as cryptographic proof.

## Flow I — Cancel mission
1. Owner selects Cancel.
2. System checks no active action is executing.
3. Owner signs cancel transaction.
4. Program sets `CANCELLED`.
5. Program returns vault assets to owner.
6. Runtime marks future agent requests invalid.

## Flow J — Expiry
At expiry:
1. Runtime detects expired mission.
2. Program's execution path rejects new actions after expiry.
3. Owner can close/cancel according to policy.
4. Future succession is blocked.

---

# 5. FUNCTIONAL REQUIREMENTS

## FR-01 Mission creation
**Actor:** Mission Owner

Inputs: mission name, objective, mint, budget, max action amount, allowed recipients, expiry, primary agent, successors, recovery max.

Rules:
- budget > 0;
- max action > 0 and <= budget;
- at least one allowed action type;
- successor list must be unique;
- primary cannot be successor at creation;
- expiry must be in the future;
- recovery max <= primary max.

Acceptance criteria:
- mission PDA exists;
- policy is committed;
- owner is recorded;
- vault exists;
- dashboard reports `ACTIVE` after funding.

## FR-02 Agent authentication
Agent requests MUST be signed by the registered agent public key with a timestamp, nonce, mission ID and canonical payload hash.

Acceptance criteria:
- invalid signature rejected;
- stale timestamp rejected;
- reused nonce rejected;
- agent not assigned to mission rejected.

## FR-03 Action evaluation
Supported MVP action types:
- `TRANSFER_SOL`
- `TRANSFER_SPL`

Decision checks:
1. mission is active/recovery-active;
2. agent is current agent;
3. action type allowed;
4. recipient allowed;
5. amount <= current per-action max;
6. cumulative spend + amount <= remaining budget;
7. request not expired;
8. request nonce/idempotency key unused;
9. token mint matches mission mint for SPL transfers.

## FR-04 Quarantine
Quarantine MUST be triggered after 3 consecutive blocked policy violations in the configured rolling window.

The counter resets after a valid successful action or after a configured quiet period of 15 minutes.

Two distinct reset mechanisms apply:
  (a) Any CONFIRMED action resets the consecutive counter to zero.
  (b) Any violation older than violation_window_seconds is no longer
      counted toward the streak.
Both mechanisms operate independently. A streak is the number of
policy-blocked actions within the window since the most recent
CONFIRMED action (or since mission activation, whichever is later).

Guardian quarantine MUST NOT transfer funds.

## FR-05 Succession
Successor MUST:
- be pre-approved;
- not be the quarantined primary;
- have required capability tag(s);
- possess a valid registered public key;
- be in `AVAILABLE` state;
- be selected according to deterministic priority rules.

## FR-06 Recovery authority
On activation, successor receives:
- mission authority;
- recovery max-per-action;
- remaining budget;
- remaining time;
- allowed action types/recipients;
- verified checkpoint.

It does NOT receive:
- primary agent private key;
- access to unverified context;
- ability to expand policy;
- ability to name a new successor.

## FR-07 Checkpoints
A checkpoint contains only deterministic/verified mission facts:
- mission ID;
- sequence;
- confirmed action IDs;
- confirmed Solana signatures;
- remaining budget;
- current authority limits;
- policy version/hash;
- timestamp;
- hash of the serialized checkpoint.

Agent reasoning, raw chain-of-thought, or model-private context is never stored as a trusted checkpoint.

## FR-08 Audit
Every material event MUST create an immutable audit event in the application database and, where practical, a corresponding on-chain proof/event.

## FR-09 Owner control
Owner can cancel a mission and reclaim assets according to on-chain rules. No application administrator can move mission funds.

---

# 6. BUSINESS LOGIC & STATE MACHINES

## Mission state machine
```text
DRAFT
  │ fund + activate
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
        ├── chain fail → FAILED
        └── confirmed → CONFIRMED
```

## Violation rules
A blocked request counts toward the streak only when:
- it was authenticated;
- the current agent signed it;
- it was rejected by a mission policy rule.

Malformed/unauthenticated requests do not increase the agent's policy violation count because they may be network abuse rather than agent behavior.

## Duplicate prevention
- Every action has client-generated `idempotency_key`.
- `(mission_id, idempotency_key)` unique.
- Every blockchain action includes a mission-specific monotonic nonce.
- Program rejects stale/non-sequential action nonces where required.

## Conflict rules
- Only one current agent at a time.
- Only one active succession at a time.
- Only one mission transition may be committed for a given succession nonce.
- Owner policy update and guardian succession cannot race past each other because program state version is checked.

## Irreversible actions
- Actual on-chain transfers are irreversible once confirmed.
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

Every receipt has `View on Solscan` when a transaction signature exists.

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
- transaction signatures;
- hashes;
- agent keys;
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
- financial actions always show amount, recipient, token, and authority impact before signing;
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
Failure: UI degrades to retry state; on-chain funds remain safe.

## Helius
Purpose: RPC + webhook event monitoring.
Credential: `HELIUS_API_KEY` server-only.
Webhook secret: `HELIUS_WEBHOOK_SECRET`.
Failure: fall back to direct RPC polling for critical state; do not block on-chain action validity.

Helius webhooks can notify on transaction/account activity and may retry duplicate deliveries; the runtime must use event IDs/signatures for idempotent processing. citeturn663417search1turn663417search3

## Solana Wallet Standard
Purpose: wallet connection/signing.
MVP target: Phantom, Solflare, Backpack or any Wallet Standard wallet supported by the client stack. Solana's current React guidance uses Wallet Standard discovery. citeturn832169search1turn832169search7

## OpenAI
Purpose: optional successor recommendation/explanation.
Failure: succession still works using deterministic eligibility rules.

## A2A
MVP: compatibility-ready, not required for first integration.
The current A2A model defines Agent Cards, tasks and explicit authorization, which can later be used for Succra agent discovery and task continuation. citeturn321459search4turn321459search6

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

Succra MVP uses **on-chain mission assets**, not Stripe or custodial balances.

## Supported value types
- native SOL;
- one selected SPL token mint per mission.

## Vault model
The mission vault is controlled by the Succra program PDA, not the agent.

## Deposits
Owner transfers funds into mission vault.

## Execution
Current agent invokes Succra program with action details; program checks state/policy and performs transfer through Solana programs.

## Remaining budget
The program tracks remaining budget and rejects actions that would exceed it.

## Recovery limit
Successor receives a smaller `recovery_max_action`.

## Refund/cancel
Owner can cancel/close according to terminal-state rules and reclaim remaining assets.

## Reconciliation
On-chain state is authoritative. Supabase is a mirror/index, never the financial source of truth.

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
- Solana program ID/network;
- Helius webhook health;
- failed job counter;
- recent succession events.

No operator can directly withdraw mission funds.

Emergency operational action is limited to:
- disable automatic succession globally for new missions;
- pause runtime processing;
- revoke the guardian key through on-chain owner-controlled update once designed.

---

# 20. ERROR & EDGE-CASE MATRIX

| Scenario | Expected result |
|---|---|
| Invalid user wallet signature | 401, no session |
| Expired login nonce | 401 |
| Unknown agent key | 403 |
| Replayed action nonce | 409 |
| Duplicate idempotency key | Return original result |
| Wrong mission | 403/404 without leaking existence |
| Wrong current agent | 403 |
| Recipient not allowed | BLOCKED |
| Amount too large | BLOCKED |
| Budget insufficient | BLOCKED |
| Mission quarantined | BLOCKED |
| Chain transaction fails | action FAILED, no false success |
| Helius webhook duplicated | ignored after idempotency check |
| Helius unavailable | fallback to polling |
| Succession triggered twice | only one succeeds |
| No eligible successor | HALTED + owner notification |
| Successor unavailable during activation | succession remains pending/failed safely |
| Agent endpoint unreachable | no authority expansion; may trigger liveness rule if enabled |
| DB unavailable while chain action exists | reconcile from chain later |
| Runtime crashes after submit | transaction reconciliation recovers status |
| AI unavailable | deterministic successor selection |
| AI recommends ineligible agent | ignored |
| User changes wallet account | session re-authentication required |
| Mission expiry during request | chain state decides; expired request rejected |
| Two actions spend remaining budget | program atomically allows only valid one(s) |

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
- authority limit calculation.

## Solana program tests
Must cover:
- create mission;
- fund vault;
- authorized transfer;
- blocked transfer;
- budget exhaustion;
- quarantine;
- successor activation;
- restricted successor transfer;
- cancel/refund;
- stale state/version rejection;
- unauthorized guardian attempt;
- unauthorized agent attempt.

Anchor's current 0.32.1 toolchain supports standard program workflows; tests must be run before moving checkpoints. citeturn663417search2

## Integration tests
- Supabase auth + RLS;
- agent registration;
- signed action submission;
- blockchain confirmation mirror;
- webhook idempotency.

## E2E tests
Required golden path:
```text
Create mission
→ fund
→ register Alpha
→ execute valid action
→ 3 blocked actions
→ quarantine
→ activate Beta
→ Beta executes valid recovery action
→ audit receipt shows full chain
```

## Security tests
- IDOR attempts;
- replay signed agent request;
- duplicate succession;
- malformed payloads;
- owner/agent role confusion;
- unauthorized recipient;
- policy race;
- chain rejection spoofing;
- webhook replay;
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

