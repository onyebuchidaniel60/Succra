# SUCCRA — ARCHITECTURE.md

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

`audit_events` is created by the Phase 5 migration. Every material mission event writes an immutable audit event. Public audit reads (via GET /api/missions/:id/audit) are added in a later phase.

## `agent_challenges`
- `id` UUID PK
- `agent_id` UUID FK agents.id
- `challenge` TEXT NOT NULL UNIQUE
- `expires_at` TIMESTAMPTZ NOT NULL
- `consumed_at` TIMESTAMPTZ NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
RLS enabled, no policies (service-role only). Single-use enforced via UPDATE … WHERE `consumed_at` IS NULL AND `expires_at` > now() RETURNING.

## `agent_request_nonces`
- `id` UUID PK
- `agent_id` UUID FK agents.id
- `nonce` TEXT NOT NULL
- `expires_at` TIMESTAMPTZ NOT NULL
- `consumed_at` TIMESTAMPTZ NULL
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()
- unique `(agent_id, nonce)`
RLS enabled, no policies (service-role only).

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
Auth: owner session.
Purpose: issue registration challenge.
Request: `{}` (empty).
Response:
```json
{
  "challenge": "<hex, 32 random bytes>",
  "expiresAt": "<iso8601, 5 minutes from issue>"
}
```

## `POST /api/agents/:id/verify`
Auth: owner session.
Purpose: prove agent key possession.
Request:
```json
{
  "challenge": "<hex>",
  "signature": "<base64 Ed25519 signature over the raw challenge bytes>"
}
```
Response:
```json
{
  "agentId": "<uuid>",
  "status": "VERIFIED"
}
```
Errors: `CHALLENGE_EXPIRED`, `CHALLENGE_UNKNOWN`, `INVALID_SIGNATURE`.

## `POST /api/agents/:id/heartbeat`
Auth: agent signature.
Purpose: liveness signal.
Heartbeat minimum interval: 30 seconds. The gateway rejects heartbeats received less than 30s after the previous accepted heartbeat for the same agent. This value is a named constant in code, not an env var.

Headers:
- `x-succra-agent-id`
- `x-succra-timestamp`
- `x-succra-nonce`
- `x-succra-signature`

## `POST /api/missions/:id/actions`
Auth: registered current agent signature (§12).
Purpose: pre-flight policy evaluation + unsigned transaction construction. Gateway partially signs as fee payer. Does NOT touch the chain.
Request body (unchanged):
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
Response (ALLOW):
```json
{
  "decision": "ALLOW",
  "requestId": "<action_requests.id uuid>",
  "unsignedTransaction": "<base64 serialized message>",
  "expiresAt": "<iso8601>"
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
Errors (with §10 envelope): `DUPLICATE_REQUEST`, `INVALID_BODY`, `AGENT_NOT_CURRENT`, `MISSION_NOT_ACTIVE`.

## `POST /api/missions/:id/actions/:requestId/submit`
Auth: registered current agent signature.
Purpose: submit the agent-signed transaction, confirm on-chain, mirror result to DB.
Request body:
```json
{
  "signedTransaction": "<base64 serialized transaction>"
}
```
Response (CONFIRMED):
```json
{
  "decision": "ALLOW",
  "requestId": "<uuid>",
  "signature": "<base58>",
  "slot": "<number>",
  "status": "CONFIRMED"
}
```
Response (FAILED):
```json
{
  "decision": "ALLOW",
  "requestId": "<uuid>",
  "signature": "<base58 or null>",
  "status": "FAILED",
  "error": { "code": "...", "message": "..." }
}
```
Errors (with §10 envelope): `TRANSACTION_MISMATCH`, `TRANSACTION_EXPIRED`, `ALREADY_SUBMITTED`, `CHAIN_REJECTION`.

The gateway acts as Solana fee payer. It holds a single operational Ed25519 keypair whose public key is the fee payer of every constructed transaction. This key never signs as the agent (agent signature is required by the program's execute_action); never signs for the mission vault (vault is a program PDA); never custodies mission funds; co-signs only as fee payer.

The fee-payer secret is server-only. It is not shipped to the browser and is not used outside the gateway's submit path.

### Wire format
Transactions are serialized using @solana/kit's canonical wire serialization. `unsignedTransaction` is the base64 encoding of the serialized message (the unsigned transaction, not the versioned transaction). The agent SDK deserializes, verifies, signs, and returns a fully signed transaction as base64 in `signedTransaction`.

Hashing: `unsigned_tx_hash` stored on action_requests is SHA-256 of the decoded message bytes, hex-encoded. On submit, the gateway recomputes the message hash from the submitted transaction's message and compares to `unsigned_tx_hash`. Mismatch → `TRANSACTION_MISMATCH`.

The gateway uses SUCCRA_RPC_URL for chain reads, transaction submission, and confirmation polling. In Phase 4 this is a direct Solana RPC endpoint. Helius webhooks are deferred (see §16).

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
Response:
```json
{
  "agentId": "<uuid>",
  "publicKey": "<base58>",
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

`{nonce}` in the signing string is a request-level replay-protection value, stored single-use in agent_request_nonces. It never advances on-chain state. `agentNonce` in the §10 request body is a distinct value passed to the program's monotonic on-chain counter and enforced by execute_action. The two values MUST NOT be the same variable.

## Resource authorization
Every API request performs both:
1. session authentication;
2. ownership/resource authorization.

Supabase RLS is the database backstop. The service-role key is server-only and never shipped to the browser. citeturn564420search2

## Guardian authorization
A dedicated guardian public key is registered in program configuration. The guardian is a single global keypair shared across missions, held server-side by the Succra runtime. It is not per-mission. Rotation is performed via the program upgrade authority. A decentralized guardian set (multisig or keeper network) is explicitly out of MVP scope and noted as a future direction. The guardian can only perform:
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

Phase 4 uses direct RPC polling for transaction confirmation via SUCCRA_RPC_URL. Helius webhook integration is deferred to Phase 9. Do not add both mechanisms.

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
SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY=
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

