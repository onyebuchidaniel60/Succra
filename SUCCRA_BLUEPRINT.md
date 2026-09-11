# SUCCRA — Complete Implementation-Ready Project Blueprint

**Status:** Pre-implementation / architecture frozen
**Product:** Succra
**Primary principle:** Agents can fail. Missions continue.
**Target:** Solana-native autonomous mission continuity for economic agents

## Source methodology
This blueprint follows the supplied `PROPER_VIBE_CODING_WORKFLOW.md`: define the problem before code, freeze the MVP and architecture, create a source-of-truth specification, use small independently testable phases, require evidence-based verification, commit checkpoints, and keep product decisions with the human rather than the coding agent. fileciteturn0file0L13-L30 fileciteturn0file0L78-L100 fileciteturn0file0L170-L180

---

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

# 7. DATA MODEL

## `profiles`
- `id` UUID PK → auth.users.id
- `wallet_address` TEXT UNIQUE NOT NULL
- `display_name` TEXT NULL
- `created_at`
- `updated_at`

## `agents`
- `id` UUID PK
- `owner_id` UUID FK profiles.id
- `name` TEXT NOT NULL
- `public_key` TEXT UNIQUE NOT NULL
- `endpoint_url` TEXT NULL
- `capabilities` JSONB NOT NULL DEFAULT '[]'
- `status` TEXT NOT NULL
- `last_heartbeat_at` TIMESTAMPTZ NULL
- `created_at`
- `updated_at`

## `missions`
- `id` UUID PK
- `owner_id` UUID FK profiles.id
- `name` TEXT NOT NULL
- `objective` TEXT NOT NULL
- `pda_address` TEXT UNIQUE NOT NULL
- `vault_address` TEXT UNIQUE NOT NULL
- `mint_address` TEXT NOT NULL
- `budget_atomic` NUMERIC(78,0) NOT NULL
- `remaining_budget_atomic` NUMERIC(78,0) NOT NULL
- `status` TEXT NOT NULL
- `current_agent_id` UUID FK agents.id NULL
- `current_agent_public_key` TEXT NOT NULL
- `policy_version` INTEGER NOT NULL DEFAULT 1
- `policy_hash` TEXT NOT NULL
- `expires_at` TIMESTAMPTZ NOT NULL
- `created_at`
- `updated_at`

## `mission_agents`
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

## `mission_policies`
- `id` UUID PK
- `mission_id` UUID FK
- `version` INTEGER
- `max_action_atomic` NUMERIC(78,0)
- `recovery_max_action_atomic` NUMERIC(78,0)
- `allowed_action_types` JSONB
- `allowed_recipients` JSONB
- `violation_threshold` INTEGER DEFAULT 3
- `violation_window_seconds` INTEGER DEFAULT 900
- `policy_json` JSONB NOT NULL
- `policy_hash` TEXT NOT NULL
- `created_at`

## `mission_checkpoints`
- `id` UUID PK
- `mission_id` UUID FK
- `sequence` BIGINT
- `status` TEXT (`CANDIDATE`,`VERIFIED`,`SUPERSEDED`)
- `checkpoint_hash` TEXT NOT NULL
- `confirmed_action_ids` JSONB
- `remaining_budget_atomic` NUMERIC(78,0)
- `state_snapshot` JSONB
- `committed_signature` TEXT NULL
- `created_at`
- unique `(mission_id, sequence)`

## `action_requests`
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
- `submitted_at`
- `created_at`
- unique `(mission_id, idempotency_key)`
- unique `(mission_id, agent_nonce)`

## `onchain_transactions`
- `id` UUID PK
- `mission_id` UUID FK
- `action_request_id` UUID NULL
- `signature` TEXT UNIQUE
- `slot` BIGINT NULL
- `status` TEXT
- `raw_error` JSONB NULL
- `confirmed_at` TIMESTAMPTZ NULL
- `created_at`

## `succession_events`
- `id` UUID PK
- `mission_id` UUID FK
- `from_agent_id` UUID NULL
- `to_agent_id` UUID
- `trigger_type` TEXT
- `checkpoint_id` UUID NULL
- `recovery_limit_atomic` NUMERIC(78,0)
- `status` TEXT
- `onchain_signature` TEXT NULL
- `created_at`

## `audit_events`
- `id` UUID PK
- `mission_id` UUID FK
- `event_type` TEXT
- `actor_type` TEXT
- `actor_id` UUID NULL
- `event_hash` TEXT
- `payload_public` JSONB
- `onchain_signature` TEXT NULL
- `created_at`

Sensitive data:
- no private keys;
- no wallet seeds;
- no agent bearer credentials;
- no raw model chain-of-thought;
- no user auth tokens.

Public data:
- mission ID;
- public mission status;
- public on-chain transaction signatures;
- public audit events explicitly marked public.

Private data:
- endpoint URLs if user chooses private;
- user metadata;
- internal runtime logs;
- agent operational metadata.

---

# 8. SYSTEM ARCHITECTURE

```text
┌───────────────────────────────────────────┐
│                 USER                      │
│   Solana wallet + Succra web dashboard    │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│        NEXT.JS / TYPESCRIPT WEB APP       │
│ UI + Route Handlers + session-aware API   │
└───────────────┬───────────────────────────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│  SUPABASE    │  │ SUCCRA RUNTIME   │
│ Auth/Postgres│  │ Node/TypeScript  │
│ + RLS        │  │ Guardian/monitor │
└──────────────┘  └─────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ SUCCRA PROGRAM  │
                    │ Rust + Anchor   │
                    │ Solana          │
                    └────────┬────────┘
                             │
                   ┌─────────┴─────────┐
                   ▼                   ▼
             Mission PDA           Vault PDA
                   │                   │
                   └─────────┬─────────┘
                             ▼
                    Solana Token/System
                       Program actions
```

## Architectural principle
**On-chain = authority and money.**

**Off-chain = orchestration, monitoring, indexing, UI, agent communication.**

The runtime can detect and recommend, but the Solana program is the final authority over mission state and assets.

Solana PDAs are suitable for program-controlled mission/vault authorities because they have no private key and can only be program-signed through `invoke_signed`. citeturn321459search0

Solana token delegation provides a non-custodial precedent for bounded spending where the owner retains custody and may revoke delegation; for Succra, the preferred MVP design is stronger: the Mission Vault is program-controlled, and the agent never receives direct custody. citeturn321459search3turn564420search4

## Off-chain failure boundary
Succra Cloud is not a cryptographic root of trust. If Succra Cloud is offline, mission funds remain constrained by the program. Automatic succession pauses; the owner can still invoke owner-controlled recovery/cancel paths.

---

# 9. TECHNOLOGY STACK

## Frontend
**Next.js App Router + TypeScript + Tailwind CSS**

Why: current Next.js App Router supports server/client components and Route Handlers, keeping a small full-stack surface. citeturn564420search0turn564420search3

## Solana frontend/client
**`@solana/kit` + Solana React hooks**

Why: current Solana documentation positions Kit as the current low-level client, with wallet-standard support through the React stack. citeturn832169search0turn832169search7

Do not introduce `@solana/web3.js` into new code unless a required dependency forces compatibility; Solana's current frontend documentation marks it deprecated and recommends the Kit migration path. citeturn832169search2

## Wallet authentication
**Supabase Auth + Solana wallet signature login**

Why: Supabase supports JWT sessions and RLS, and Solana provides current guidance for Supabase wallet authentication. citeturn564420search8turn832169search4

## Backend API
**Next.js Route Handlers**

Why: eliminates an unnecessary second HTTP API service for ordinary request/response flows. citeturn564420search0

## Runtime/guardian
**Node.js 24 + TypeScript + `tsx`**

Responsibilities: agent gateway, heartbeat monitor, succession engine, blockchain event monitor, checkpoint verification.

## Database
**Supabase Postgres**

Use RLS for user-level resource isolation. Supabase explicitly recommends RLS on exposed tables and keeping service-role access server-side. citeturn564420search2

## Solana program
**Rust + Anchor 0.32.1 + Solana 2.3.0**

Anchor 0.32.1 is the current patch level in the retrieved release notes, with Solana 2.3.0 as the recommended Solana version. citeturn663417search2

## RPC/indexing
**Helius RPC + Webhooks**

Why: webhooks can deliver real-time Solana transaction/account notifications, including both raw and enhanced formats, and support duplicate-delivery retries. citeturn663417search1turn663417search3turn663417search4

## AI
**OpenAI API as non-authoritative recommendation layer**

Only used for successor explanation/recommendation. Deterministic rules remain authoritative.

## Deployment
- Web: Vercel
- Runtime: Railway
- Database/Auth: Supabase
- Solana program: devnet first; production/mainnet deployment only after explicit security verification
- RPC: Helius

## Rejected alternatives
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
Purpose: create wallet login nonce.
Auth: none.
Request: `{ "walletAddress": "..." }`
Success: `{ "nonce": "...", "message": "...", "expiresAt": "..." }`

## `POST /api/auth/verify`
Purpose: verify wallet signature and establish Supabase session.
Request: `{ walletAddress, nonce, signature }`

## `POST /api/missions`
Auth: user session.
Purpose: create mission draft + prepare on-chain instructions.
Request: mission metadata + policy.
Validation: all mission creation rules.
Success: draft ID, PDA, unsigned transaction payload.

## `GET /api/missions`
Auth: user session.
Purpose: list owned missions.

## `GET /api/missions/:id`
Auth: owner or public audit mode.
Purpose: mission detail.

## `POST /api/missions/:id/agents`
Auth: owner.
Purpose: attach primary/successor.

## `POST /api/agents/:id/challenge`
Auth: user session.
Purpose: issue registration challenge.

## `POST /api/agents/:id/verify`
Auth: user session.
Request: signed challenge.
Purpose: prove agent key possession.

## `POST /api/agents/:id/heartbeat`
Auth: agent signature.
Purpose: liveness signal.

Headers:
- `x-succra-agent-id`
- `x-succra-timestamp`
- `x-succra-nonce`
- `x-succra-signature`

## `POST /api/missions/:id/actions`
Auth: registered current agent signature.
Request:
```json
{
  "idempotencyKey": "...",
  "agentNonce": 14,
  "actionType": "TRANSFER_SOL",
  "payload": {
    "recipient": "...",
    "amountAtomic": "1000000"
  },
  "expiresAt": "..."
}
```
Success: decision + transaction signature when executed.
Errors: `AGENT_NOT_CURRENT`, `POLICY_BLOCKED`, `DUPLICATE_REQUEST`, `MISSION_QUARANTINED`.

## `POST /api/missions/:id/quarantine`
Auth: runtime guardian credential OR owner.
Purpose: request quarantine.
Business rule: guardian can only quarantine; cannot spend.

## `POST /api/missions/:id/succession`
Auth: runtime guardian.
Purpose: activate an eligible pre-approved successor.
Idempotency: succession nonce unique.

## `POST /api/missions/:id/checkpoints`
Auth: runtime internal.
Purpose: persist verified checkpoint and optionally commit its hash on-chain.

## `GET /api/missions/:id/audit`
Auth: owner or public audit mode for public events.
Purpose: audit timeline.

## `POST /api/missions/:id/cancel`
Auth: owner wallet signature.
Purpose: cancel/close mission and reclaim funds according to program rules.

## `GET /api/agents/:id/status`
Auth: owner or mission-scoped agent.
Purpose: status/health.

### Rate limiting
- auth endpoints: strict edge/API rate limit;
- agent endpoints: mission + agent scoped limits;
- heartbeat: fixed minimum interval;
- action requests: policy and per-agent frequency limit.

### Idempotency
Required for:
- mission creation finalization;
- action execution;
- quarantine;
- succession;
- checkpoint commit.

---

# 11. DATABASE BEHAVIOR

## Create mission
Transaction:
1. validate owner;
2. insert mission draft;
3. insert policy version 1;
4. insert agent assignments;
5. after on-chain confirmation, atomically update mission to `ACTIVE` and create audit event.

## Action approval
Database transaction:
1. insert request using unique idempotency key;
2. lock/read mission state;
3. evaluate policy;
4. update violation streak;
5. record decision;
6. only after approval submit chain transaction.

Do not hold a DB transaction open while waiting for blockchain confirmation. Use an explicit `SUBMITTED → CONFIRMED/FAILED` transition.

## Quarantine
Use compare-and-set semantics:
`UPDATE missions SET status='QUARANTINED' WHERE id=? AND status='ACTIVE'`.
If affected rows = 0, quarantine was already handled or mission state changed.

## Succession
Use database lock/transaction on the mission row to prevent two successor jobs from activating simultaneously. On-chain state/version remains the ultimate arbiter.

## Race scenarios
### Double action submission
Unique `(mission_id, idempotency_key)` prevents duplicate execution.

### Two actions consume last budget
Database must not be the sole source of truth. Program enforces remaining budget atomically on-chain; backend treats chain rejection as authoritative failure.

### Quarantine races with action
Program checks mission status during execution, so action after quarantine fails even if it was approved in the UI immediately before quarantine.

### Double succession
On-chain mission state includes a `succession_nonce`/state version so the same transition cannot execute twice.

### Stale successor activation
Program rejects activation if mission current agent/status does not match expected values.

---

# 12. AUTHENTICATION & AUTHORIZATION

## User authentication
Wallet signature → Supabase Web3/JWT session.

## Agent authentication
Registered Ed25519 key signs canonical request payloads.

Canonical signing string:
```text
SUCCRA-V1\n{timestamp}\n{nonce}\n{missionId}\n{method}\n{path}\n{sha256(body)}
```

## Resource authorization
Every API request performs both:
1. session authentication;
2. ownership/resource authorization.

Supabase RLS is the database backstop. The service-role key is server-only and never shipped to the browser. citeturn564420search2

## Guardian authorization
A dedicated guardian public key is registered in program configuration. The guardian can only perform:
- quarantine;
- activate one of the pre-approved successors;
- commit approved recovery state.

Guardian cannot:
- withdraw;
- change owner;
- add recipients;
- change max budget;
- add successor outside pre-approved list.

## Owner authority
Owner can:
- create mission;
- update future policy subject to program rules;
- add successors;
- cancel/close;
- reclaim assets after allowed terminal states.

Owner does not have a hidden API shortcut; owner authority is backed by wallet signatures/on-chain checks.

---

# 13. SECURITY ARCHITECTURE

## Threat model
Assume:
- primary agent can become malicious;
- primary agent key can be compromised;
- runtime can be buggy or temporarily unavailable;
- attacker can replay signed requests;
- attacker can modify API inputs;
- webhook deliveries can duplicate or arrive out of order;
- user can be phished into signing malicious data;
- LLM output can be manipulated;
- clients can attempt cross-user resource access.

## Security controls
### Authority isolation
Agents never hold the mission vault private key. Mission assets are controlled by the program.

### Least privilege
Successors start with lower recovery limits. Allowed recipients and action types are explicit.

### Replay protection
Signed requests include timestamp + nonce + unique idempotency key.

### On-chain enforcement
The backend cannot override program policy.

### IDOR protection
Every resource lookup is ownership-scoped; never load a resource solely by UUID before authorization. Database RLS reinforces this. Supabase recommends RLS on exposed tables and tests for allow/deny behavior. citeturn564420search2

### Injection
- parameterized SQL via Supabase SDK;
- validated JSON schemas;
- no shell execution from agent input.

### XSS
Use React escaping; do not render agent-supplied HTML; sanitize any future markdown/HTML rendering.

### CSRF
Mutating browser operations require authenticated session plus wallet-signature confirmation where financial authority changes.

### SSRF
Agent endpoint URLs are not fetched arbitrarily by the browser. Server-side endpoint fetching must use HTTPS, restrict private-network destinations, enforce timeouts, and cap redirects.

### Webhooks
Helius webhook signatures/secret headers must be verified; duplicates are expected and processed idempotently. Helius documents that webhook delivery can retry and duplicate events can occur. citeturn663417search3turn663417search4

### Prompt injection
AI successor recommendation receives structured mission metadata only. It MUST NOT receive arbitrary agent-originated instructions as trusted system instructions.

### AI authority boundary
LLM can recommend or explain; only deterministic policy and on-chain program can authorize money movement.

### Secrets
Store:
- Supabase service key;
- Helius API key;
- guardian key;
- OpenAI key
only in server/runtime secret stores. Never in browser variables unless explicitly public.

### Race conditions
On-chain state transitions and DB row locks/compare-and-set prevent duplicate succession and inconsistent status.

### Financial abuse
Hard caps:
- per-action limit;
- total mission budget;
- allowed recipients;
- allowed mints;
- expiry;
- recovery cap.

### Admin abuse
No admin funds access.

### Emergency stop
Owner can cancel/close the mission through the on-chain program when allowed.

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
│       │   ├── chain/
│       │   └── monitor/
│       └── tests/
├── packages/
│   ├── sdk/
│   ├── shared/
│   └── program-client/
├── programs/
│   └── succra/
│       ├── src/
│       ├── tests/
│       └── Cargo.toml
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

Directory rule: product UI stays in `apps/web`; persistent orchestration in `apps/runtime`; blockchain authority in `programs/succra`; shared contracts/types in packages.

---

# 23. ENVIRONMENT VARIABLES

## Web/server
```text
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
HELIUS_API_KEY=
HELIUS_WEBHOOK_SECRET=
SUCCRA_PROGRAM_ID=
SUCCRA_GUARDIAN_PUBLIC_KEY=
SUCCRA_GUARDIAN_SECRET_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
```

## Runtime-only
```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
HELIUS_API_KEY=
HELIUS_WEBHOOK_SECRET=
SUCCRA_PROGRAM_ID=
SUCCRA_RPC_URL=
SUCCRA_GUARDIAN_SECRET_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
```

Rules:
- `NEXT_PUBLIC_*` must never contain secrets;
- guardian secret is runtime-only;
- Supabase service role is server-only;
- agent private keys live with agents and never in Succra;
- `.env*` excluded from git except `.env.example`.

---

# 24. PHASED IMPLEMENTATION PLAN

## Phase 0 — Repository foundation
Objective: create workspace, documentation files, lint/test commands, environment example.

Acceptance:
- monorepo boots;
- no feature logic;
- lint/test/build commands exist;
- checkpoint commit.

## Phase 1 — Solana program foundation
Tasks:
- mission account;
- vault account;
- policy fields;
- create/fund/cancel;
- basic program tests.

Acceptance: owner can create/fund/cancel mission on local validator/devnet test path.

## Phase 2 — Secure action execution
Tasks:
- agent identity;
- current agent field;
- action nonce;
- SOL/SPL transfer instruction;
- budget/max-action/recipient checks.

Acceptance: valid action succeeds; all policy violations fail on-chain.

## Phase 3 — Web auth + database
Tasks:
- Supabase auth;
- profiles;
- missions/policies/agents tables;
- RLS;
- dashboard read path.

Acceptance: user A cannot read/update user B's private mission data.

## Phase 4 — Succra SDK + agent gateway
Tasks:
- signed request format;
- agent registration;
- heartbeat;
- action submission;
- idempotency.

Acceptance: reference Alpha agent can request a transfer and receive authoritative decision/tx result.

## Phase 5 — Guardian + quarantine
Tasks:
- violation counter;
- 3-violation trigger;
- guardian signer;
- on-chain quarantine;
- timeline events.

Acceptance: three authenticated policy violations cause one quarantine and prevent further actions.

## Phase 6 — Checkpoints + succession
Tasks:
- verified checkpoint schema;
- checkpoint hashing;
- successor eligibility;
- activation instruction;
- recovery limit.

Acceptance: Beta becomes current agent with lower authority and can continue.

## Phase 7 — Audit + polished UX
Tasks:
- timeline;
- decision receipt;
- Solana proof links;
- succession visualization;
- error/empty/loading states.

Acceptance: full lifecycle can be understood without developer terminology.

## Phase 8 — AI advisory layer
Tasks:
- candidate explanation;
- structured output;
- deterministic eligibility gate;
- fallback.

Acceptance: AI cannot authorize an ineligible successor.

## Phase 9 — E2E/security hardening
Tasks:
- full golden-path E2E;
- race tests;
- replay tests;
- IDOR/security review;
- webhook replay tests;
- deployment.

Acceptance: all required tests pass and production checklist is complete.

## Phase 10 — Hackathon deployment/demo
Tasks:
- devnet rehearsal;
- mainnet readiness review;
- small-capital live demo if approved;
- tokenization; public site; demo recording.

The AnsemHack Clawrena requires registration and tokenization by **20 September 2026 at 23:59 UTC**; the official page also emphasizes on-chain volume, attention, and deploying early. citeturn179862search0turn179862search1

Every phase follows the supplied workflow: implement one phase, test, inspect, fix, commit, record checkpoint, and stop before proceeding. fileciteturn0file0L216-L237

---

# 25. PROJECT_SPEC.md

The full product source of truth is this blueprint's Sections 1–6 and 14–21. `PROJECT_SPEC.md` must be created by copying those sections without adding implementation choices that are not already decided here.

Required source-of-truth rules:
- this document outranks agent assumptions;
- new product features require explicit human approval;
- implementation may not silently broaden supported actions;
- financial policy logic is deterministic.

---

# 26. ARCHITECTURE.md

The full architecture source of truth is Sections 8–18 and 22–23.

Architecture invariants:
1. mission assets are program-controlled;
2. agent keys never custody mission assets;
3. backend is not financial authority;
4. DB is a mirror, not source of truth for funds;
5. guardian cannot spend;
6. successor must be pre-approved;
7. AI cannot authorize money movement;
8. no arbitrary program router in MVP.

---

# 27. IMPLEMENTATION_PLAN.md

Use Section 24 exactly as the phased plan. Each phase must be executed alone. Do not combine phases unless the human explicitly authorizes it.

Each phase ends with:
- tests;
- manual verification;
- changed-files review;
- security review appropriate to phase;
- Git commit;
- checkpoint update.

---

# 28. AGENTS.md

See the dedicated `AGENTS.md` artifact generated with this blueprint. It is normative for the coding agent and includes scope, architecture invariants, task discipline, testing, security, and stop rules.

---

# 29. AI_HANDOFF.md

See the dedicated `AI_HANDOFF.md` artifact generated with this blueprint. It contains the current state, frozen decisions, repository expectations, implementation entry point, and verification rules.

---

# 30. FINAL PRE-IMPLEMENTATION AUDIT

## Contradictions found and resolved
### "Succra modifies agents" vs "Succra controls authority"
Resolved: Succra never modifies agent code. It controls mission authority.

### "On-chain program vs cloud runtime"
Resolved: program is authoritative for funds and mission state; runtime is orchestrator.

### "AI decides successor"
Resolved: deterministic eligibility is mandatory; AI only recommends/explains.

### "Checkpoint contains agent memory"
Resolved: checkpoint contains only verified facts and hashes; agent reasoning is not authoritative.

### "Generic Solana execution"
Resolved: MVP only supports SOL/SPL transfers to allowlisted recipients. Generic DeFi execution is future scope.

### "Failure detection"
Resolved: MVP uses three authenticated policy violations as the automatic safety trigger. Heartbeat/liveness is a SHOULD feature rather than a dependency for the first working lifecycle.

### "Recovery authority"
Resolved: successor starts with a lower recovery limit and cannot expand its own authority.

### "Custody"
Resolved: Succra never receives the user's wallet seed/private key. Mission vault is program-controlled.

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
- supported action types;
- token utility requirements.

## Final readiness conclusion
The project is sufficiently specified for a coding agent to begin implementation without redesigning the product. The MVP is intentionally narrower than a general autonomous-agent platform: **one chain, one mission object, two transfer adapters, one deterministic policy engine, one quarantine trigger, pre-approved successors, constrained recovery, verified checkpoints, and a visible audit trail.**

---

# CODING AGENT START POINT

**Do not implement the whole application.**

The first assigned task is:

> **Implement Phase 0 — Repository Foundation only, exactly as defined in `IMPLEMENTATION_PLAN.md`. Do not implement Solana instructions, database schema, authentication, UI screens, agent runtime logic, or any product feature. Create the approved repository structure, workspace configuration, documentation placeholders, lint/test/build commands, and `.env.example`. Run the required verification commands, report the actual results, show the changed files, create the Phase 0 Git checkpoint, and STOP.**

This operating model follows the supplied workflow's central rule: the human controls direction, scope, product intent, architecture, security, acceptance criteria, and verification, while the coding agent primarily accelerates implementation, testing, debugging, refactoring, and documentation. fileciteturn0file0L472-L496 fileciteturn0file0L654-L689
