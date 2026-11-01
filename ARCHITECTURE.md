# SUCCRA — ARCHITECTURE.md

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
    address paymentToken;              // native HSK sentinel or ERC-20 address
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
    bytes32 cartMandateHash;           // owner-signed HSP Cart Mandate
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
    uint256 confirmedSpentAtomic;      // mirrored from confirmed HSP settlements
    bytes32 lastCheckpointHash;
    uint64 lastCheckpointSequence;
}
```

`DEGRADED` and `HALTED` are reserved values. No MVP transition enters `DEGRADED`; `HALTED` is written only to the off-chain mirror when no eligible successor exists, while the contract remains `QUARANTINED`. The reachable MVP state machine is defined in `PROJECT_SPEC.md` §6.

`DRAFT` is the off-chain pre-deployment state. A deployed mission with a committed policy and Cart Mandate hash starts `ACTIVE`; the mirror remains pending until HSP Cart Mandate registration is verified.

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
    uint64 paymentNonce;
    uint64 expiresAt;
    bytes32 mandateHash;               // HSP Payment Mandate EIP-712 digest
    bytes agentSignature;              // agent consent; required on-chain
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
- `PaymentAuthorized(bytes32 indexed requestId, address indexed merchant, uint256 amountAtomic, bytes32 mandateHash)`
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
- `authorizePayment(PaymentAuthorization calldata authorization, uint64 expectedVersion)` — requires the agent's EIP-712 signature over the Payment Mandate digest.

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

`SuccraMission` is **not** the custodian of funds and does not execute ERC-20 transfers. HSP is authoritative for settlement and for the aggregate Cart Mandate envelope. The contract's `confirmedSpentAtomic` is a mirrored value updated only from confirmed HSP settlements; it is used for checkpoints and race detection, never as permission to move funds.

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
- `cart_mandate_id` TEXT NULL
- `cart_mandate_hash` TEXT NOT NULL
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
- `allowed_action_types` JSONB (`["HSP_PAYMENT"]`)
- `allowed_merchants` JSONB
- `allowed_token_addresses` JSONB (MVP: one settlement token)
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
- `hsp_mandate_ids` JSONB
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
- `hsp_payment_id` UUID NULL
- `submitted_at`
- `created_at`
- unique `(mission_id, idempotency_key)`
- unique `(mission_id, agent_nonce)`

### `hsp_payments`
- `id` UUID PK
- `mission_id` UUID FK
- `action_request_id` UUID FK
- `hsp_payment_mandate_id` TEXT UNIQUE NOT NULL
- `mandate_hash` TEXT NOT NULL
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
- `hsp_payment_id` UUID NULL
- `tx_hash` TEXT UNIQUE
- `block_number` BIGINT NULL
- `status` TEXT
- `raw_error` JSONB NULL
- `confirmed_at` TIMESTAMPTZ NULL
- `created_at`

This table mirrors contract calls (create, quarantine, succession, checkpoint commitment) that are not HSP settlements.

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
- `hsp_webhook_events` — unique `event_id`, payment mandate ID, payload hash, signature-verified flag, processed timestamp; service-role only.

### Sensitive data

Never store:
- private keys or wallet seeds;
- HSP API secrets, HMAC secrets, or JWTs beyond their verification window;
- Supabase service-role keys in the browser;
- raw model chain-of-thought;
- user auth tokens in logs;
- agent bearer credentials.

Public data:
- mission contract address;
- public mission status;
- HashKey transaction hashes;
- HSP payment mandate IDs;
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
  "chainId": 177,
  "verifyingContract": "<SuccraMission address>"
}
```

Testnet uses chain ID `133`. Wallet login uses a separate `SuccraLogin` typed-data domain without a verifying contract. HSP Payment Mandates use the domain and types supplied by HSP; Succra binds the resulting mandate hash into its own request record.

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
   ┌─────────────────────┐       ┌──────────────────┐
   │ SUCCRA CONTRACTS    │       │  HSP GATEWAY     │
   │ SuccraMission       │       │ Cart/Payment     │
   │ MissionFactory      │       │ Mandates         │
   │ GuardianRegistry    │       │ HMAC + ES256K    │
   └──────────┬──────────┘       └────────┬─────────┘
              │                           │
              └─────────────┬─────────────┘
                            ▼
                 ┌─────────────────────┐
                 │   HASHKEY CHAIN     │
                 │  authority state    │
                 │  HSP settlement     │
                 └─────────────────────┘
```

## Architectural principle

**On-chain = authority and policy.**

**HSP = payment execution and settlement.**

**Off-chain = orchestration, monitoring, indexing, UI, and agent communication.**

The runtime can detect, preflight, and recommend, but it cannot override `SuccraMission` policy or HSP settlement. The database is a mirror and index, never the financial source of truth.

## Non-custodial model (Model B)

- Funds remain in the owner's wallet.
- The owner signs an HSP Multi-Pay Cart Mandate that constrains the budget envelope.
- The Payment Agent constructs per-payment HSP Payment Mandates inside that envelope.
- Succra controls **which agent may sign** and **what limits apply**; it never holds or moves funds.
- HSP executes settlement; `SuccraMission` records authority and policy.

This is the core positioning: Succra is the safety and continuity layer around HSP, not a replacement for it.

## Off-chain failure boundary

Succra Cloud is not a cryptographic root of trust. If the runtime is offline:
- no new Payment Mandate can be preflighted or submitted by Succra;
- automatic succession pauses;
- the owner can still call `cancel` directly on the contract;
- the owner can still use the pre-approved successor path when the guardian is unavailable, subject to the same eligibility and state-version checks;
- existing on-chain authority and HSP mandate constraints remain intact.

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

Responsibilities: agent gateway, heartbeat monitor, HSP client, succession engine, HashKey event monitor, checkpoint verification, webhook processing.

## Database
**Supabase Postgres**

Use RLS for user-level resource isolation. The service-role key stays server-side.

## Contracts
**Solidity ^0.8.24 + Hardhat**

`SuccraMission`, `MissionFactory`, and `GuardianRegistry`. Contracts are tested locally, deployed to HashKey testnet first, and verified on Blockscout.

## Chain
**HashKey Chain**

- Mainnet: chain ID `177`, RPC `https://mainnet.hsk.xyz`, native token HSK.
- Testnet: chain ID `133`.
- Explorer: Blockscout.

## Payments
**HSP Merchant API**

- HMAC-SHA256 request signing.
- ES256K JWT authentication.
- EIP-712 Cart Mandates and Payment Mandates.
- Signed settlement webhooks.
- HashKey RPC polling fallback.

## AI
**OpenAI API as a non-authoritative recommendation layer**

Only used for successor explanation/recommendation. Deterministic rules remain authoritative.

## Deployment
- Web: Vercel
- Runtime: Railway
- Database/Auth: Supabase
- Contracts: HashKey testnet first; mainnet only after explicit security verification
- Payments: HSP Merchant API

## Rejected alternatives
- Custodial vault model: violates the non-custodial authority thesis.
- Direct ERC-20 transfers or arbitrary contract calls: bypasses HSP and expands the attack surface.
- Multi-chain support in MVP: dilutes the HashKey/HSP focus.
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
Purpose: create a mission draft and prepare the on-chain create call plus the HSP Cart Mandate payload.
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
  "unsignedTransaction": { "chainId": 177, "to": "<factory>", "data": "0x...", "value": "0" },
  "cartMandate": { "typedData": {}, "mandateHash": "0x..." }
}
```
The runtime reconciles the `MissionCreated` event and the HSP Cart Mandate registration before setting the mirror to `ACTIVE`.

## `GET /api/missions`
Auth: user session.
Purpose: list owned missions.

## `GET /api/missions/:id`
Auth: owner or public audit mode.
Purpose: mission detail, contract state, policy, Cart Mandate status.

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
Purpose: preflight policy evaluation and construct the unsigned HSP Payment Mandate. Does NOT submit to HSP and does NOT move funds.
Request:
```json
{
  "requestId": "<client-generated UUID>",
  "idempotencyKey": "...",
  "agentNonce": 14,
  "actionType": "HSP_PAYMENT",
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
  "paymentMandate": {},
  "mandateHash": "0x...",
  "typedData": { "domain": {}, "types": {}, "primaryType": "...", "message": {} },
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
Purpose: verify the signed mandate, record on-chain authorization, submit it to HSP, wait for settlement, and mirror the result.
Request:
```json
{
  "mandateHash": "0x...",
  "signature": "0x..."
}
```
Response (CONFIRMED):
```json
{
  "decision": "ALLOW",
  "requestId": "<uuid>",
  "authorizationTxHash": "0x...",
  "hspPaymentMandateId": "...",
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
Errors: `MANDATE_MISMATCH`, `INVALID_SIGNATURE`, `ALREADY_SUBMITTED`, `REQUEST_EXPIRED`, `HSP_REJECTION`, `HSP_UNAVAILABLE`.

The runtime verifies:
1. the EIP-712 signature recovers the registered agent address;
2. the signed mandate hash equals the preflighted mandate hash;
3. the request has not expired and its nonce/idempotency key is unused;
4. `SuccraMission.authorizePayment` confirms before any HSP submission;
5. HSP and the resulting HashKey settlement are authoritative.

## `POST /api/missions/:id/quarantine`
Auth: runtime guardian credential OR owner.
Purpose: request quarantine.
Business rule: guardian can only quarantine; cannot spend or create a Payment Mandate.

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
Purpose: cancel the mission and revoke the HSP Cart Mandate. Funds remain in the owner's wallet.

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
- HSP webhook processing.

### Canonical checkpoint serialization
The checkpoint preimage is:

```text
keccak256(abi.encode(
  missionId,
  sequence,
  keccak256(confirmedPaymentIds),
  keccak256(confirmedTransactionHashes),
  keccak256(hspMandateIds),
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
4. return the unsigned `MissionFactory` create call and Cart Mandate typed data;
5. after the `MissionCreated` event confirms the committed Cart Mandate hash, verify HSP mandate registration, then atomically update the mission to `ACTIVE` and create an audit event.

## Preflight
Database transaction:
1. insert the request using the unique idempotency key;
2. lock/read the mission mirror and contract state;
3. evaluate policy;
4. update the violation streak only when the decision is `BLOCK`;
5. record the decision and mandate hash;
6. return the unsigned Payment Mandate. Do not submit to HSP.

## Submit
1. verify the EIP-712 signature and mandate hash;
2. lock the approved request with a compare-and-set;
3. call `SuccraMission.authorizePayment` and wait for confirmation;
4. mark the request `SUBMITTED` only after authorization confirms;
5. submit to HSP;
6. process the signed webhook or poll HashKey RPC;
7. update `hsp_payments` and the mission mirror only after authoritative confirmation;
8. write the checkpoint and audit event.

Do not hold a database transaction open while waiting for HSP or HashKey confirmation. Use an explicit `SUBMITTED → CONFIRMED/FAILED` transition.

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
| Two payments consume last budget | HSP Cart Mandate allows only the valid payment(s); the contract mirrors confirmed spend and treats rejection as authoritative failure. |
| Quarantine races with payment | Contract checks status during authorization; a payment authorized immediately before quarantine may still settle if already submitted, so the runtime records the race explicitly. |
| Double succession | Contract `state_version` and succession nonce allow only one transition. |
| Stale successor activation | Contract rejects activation if status/current agent/version does not match expected values. |
| Duplicate HSP webhook | Unique `event_id`; second delivery is a no-op. |
| Webhook arrives before RPC receipt | Store pending, poll HashKey, then confirm; never confirm from the webhook alone. |
| HSP rejects after wallet signature | Record `FAILED`; do not retry with a different mandate silently. |

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
- revoke the HSP Cart Mandate;
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
- webhook deliveries can duplicate or arrive out of order;
- user can be phished into signing malicious typed data;
- LLM output can be manipulated;
- clients can attempt cross-user resource access;
- HSP or HashKey RPC can be unavailable or return inconsistent results.

## Security controls

### Authority isolation
Agents never hold owner funds. Funds remain in the owner's wallet constrained by the HSP Cart Mandate. `SuccraMission` controls mission authority, not custody.

### Least privilege
Successors start with lower recovery limits. Merchant and token allowlists are explicit. Guardian powers are limited to quarantine, activation, acknowledgement, and checkpoint commitment.

### Replay protection
Signed requests include timestamp + single-use nonce + unique idempotency key. EIP-712 typed data binds the mission, request ID, method, and body hash.

### Mandate binding
The signed HSP Payment Mandate hash must equal the preflighted mandate hash, and the signed mandate fields must match the authorization fields. A mismatch is rejected before on-chain authorization or HSP submission.

### On-chain enforcement
The backend cannot override `SuccraMission` policy. `authorizePayment` checks status, current agent, per-payment ceiling, merchant/token allowlist, expiry, recovery ceiling, state version, and the agent's EIP-712 signature before the runtime may submit to HSP.

### HSP enforcement
HSP enforces the Cart Mandate envelope at settlement. A payment outside the envelope is rejected even if the Succra mirror is stale.

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

### Webhooks
HSP webhook HMAC-SHA256 signatures must be verified before any state change. Duplicates are expected and processed idempotently by event ID. A webhook alone never confirms settlement; HashKey state is checked.

### Prompt injection
AI successor recommendation receives structured mission metadata only. It MUST NOT receive arbitrary agent-originated instructions as trusted system instructions.

### AI authority boundary
LLM can recommend or explain; only deterministic policy, `SuccraMission`, and HSP can authorize or settle money movement.

### Secrets
Store:
- Supabase service key;
- HSP API secret, HMAC secret, and webhook secret;
- guardian private key;
- OpenAI key
only in server/runtime secret stores. Never in browser variables unless explicitly public.

### Race conditions
Contract `state_version`, database row locks/compare-and-set, unique mandate hashes, and single-use nonces prevent duplicate succession, duplicate payments, and inconsistent status.

### Financial abuse
Hard caps:
- per-payment limit;
- total Cart Mandate budget;
- merchant allowlist;
- token allowlist;
- expiry;
- recovery cap;
- no direct ERC-20 path.

### Admin abuse
No admin funds access. No operator can withdraw, change the owner, or bypass policy.

### Emergency stop
Owner can cancel directly through the contract when allowed. The guardian can quarantine. Neither can move funds.

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
- remaining budget envelope;
- latest HSP settlement;
- succession state.

Empty state: `Create your first mission`.

## Screen 3 — New Mission `/missions/new`
Wizard:
1. Mission
2. Authority
3. Primary agent
4. Successors
5. Review + sign (mission create and HSP Cart Mandate)

No advanced protocol jargon unless expanded.

## Screen 4 — Mission detail `/missions/:id`
Primary hero:
- mission status;
- current agent;
- remaining budget;
- per-payment authority limit;
- next checkpoint.

Centerpiece: **Mission Timeline**
```text
✓ Mission created
✓ Alpha authorized
✓ HSP payment settled
⚠ Policy violation
⚠ Policy violation
🔒 Alpha quarantined
↪ Beta selected
✓ Beta authorized
✓ Mission continued
```

## Screen 5 — Agent page `/agents/:id`
- identity (EVM address);
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

Every receipt has `View on Blockscout` when a HashKey transaction hash exists, plus the HSP payment mandate ID.

## Screen 8 — Settings `/settings`
- connected wallet;
- network (HashKey mainnet/testnet);
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
- mandate hashes;
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

## HSP
Purpose: payment execution and settlement. HSP accepts owner-signed Cart Mandates and agent-signed Payment Mandates, authenticates Succra with HMAC-SHA256 request signing and ES256K JWT, and sends signed settlement webhooks.
Credentials: `HSP_API_BASE_URL`, `HSP_MERCHANT_ID`, `HSP_API_SECRET`, `HSP_HMAC_SECRET`, `HSP_WEBHOOK_SECRET`; all server-only.
Failure: retry with backoff, fall back to HashKey RPC polling for settlement status, and never confirm a payment without an authoritative chain result. HSP webhook duplicate delivery is expected; use event/payment IDs for idempotency.

## HashKey Chain RPC
Purpose: contract reads/writes and settlement confirmation.
Networks: mainnet chain ID 177 (`https://mainnet.hsk.xyz`); testnet chain ID 133.
Failure: retry with backoff; do not treat an RPC timeout as a successful settlement.

## Blockscout
Purpose: public contract and transaction verification.
Failure: UI shows the transaction hash even when the explorer link is temporarily unavailable.

## EVM wallets
Purpose: wallet connection and EIP-712 signing.
MVP target: MetaMask, OKX, TokenPocket, ImToken, and other wagmi/viem-compatible wallets through WalletConnect.

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
- native HSK;
- one allowlisted ERC-20 settlement token per mission.

## Custody model
The owner retains custody at all times. The HSP Cart Mandate constrains the mission budget envelope; `SuccraMission` constrains which agent may request a payment and what policy applies.

## HSP Cart Mandate
The owner signs an HSP Multi-Pay Cart Mandate authorizing:
- total budget;
- per-payment limit;
- merchant allowlist;
- token address;
- expiry;
- mission reference.

Succra stores the Cart Mandate ID/hash and uses it as the budget envelope. HSP is authoritative for whether a settlement fits the mandate.

## HSP Payment Mandate
For each payment, the Payment Agent constructs an HSP Payment Mandate inside the Cart Mandate envelope. Succra preflights the mandate against `SuccraMission` policy and the mission mirror, returns it unsigned with EIP-712 typed data, the agent signs it, and Succra submits it to the HSP Gateway.

## Execution
1. Agent requests a payment.
2. Succra preflights policy and the Cart Mandate envelope.
3. Succra returns the unsigned Payment Mandate and EIP-712 typed data.
4. Agent signs the mandate.
5. Succra verifies the signature, the mandate hash, and that the mandate fields match the authorization fields.
6. Succra calls `SuccraMission.authorizePayment` and waits for confirmation.
7. Succra submits to HSP Gateway.
8. HSP executes settlement on HashKey Chain.
9. Succra verifies the webhook or polls the chain.
10. Succra mirrors the confirmed settlement and writes a checkpoint.

## On-chain enforcement boundary
`SuccraMission` enforces:
- mission status and current agent;
- `HSP_PAYMENT` action type;
- per-payment ceiling (`maxPayment` or `recoveryMaxPayment`);
- mirrored cumulative spend against `budgetAtomic`;
- merchant and token allowlists;
- expiry;
- recovery ceiling;
- payment nonce and state version;
- guardian-only transitions.

The runtime may submit to HSP only after `authorizePayment` confirms. The contract verifies the agent's EIP-712 signature, records the authorization, and advances `agentNonce`; it does not move funds.

HSP enforces:
- Cart Mandate total budget;
- Cart Mandate per-payment limit;
- Cart Mandate merchant/token allowlist;
- Cart Mandate expiry;
- settlement execution.

The contract's `confirmedSpentAtomic` is a mirror used for checkpoints and race detection. It never authorizes a transfer. If the mirror and HSP disagree, HSP/HashKey settlement is authoritative and the discrepancy is an incident.

## Residual trust boundary

HSP does not verify `SuccraMission` state in MVP. A compromised runtime could submit a signed Payment Mandate directly to HSP inside the Cart Mandate envelope. The Cart Mandate still caps total budget, merchants, token, and expiry; the audit trail and reconciliation alerts detect anomalies. Moving the authorization check into HSP, or requiring an HSP-verified Succra authorization proof, is a future hardening item and is not claimed for MVP.

## Remaining budget
The Cart Mandate is authoritative for the aggregate budget envelope. The runtime reconciles confirmed HSP settlements against the mirror and updates `remaining_budget_atomic`. A stale mirror can block a valid payment conservatively; it must never permit an invalid one.

## Recovery limit
Successor receives a smaller `recovery_max_payment`, enforced on-chain by mission state.

## Refund/cancel
Owner can cancel and revoke the Cart Mandate according to terminal-state rules. Funds remain in the owner's wallet; there is no vault refund.

## Reconciliation
HashKey settlement and HSP mandate state are authoritative. Supabase is a mirror/index, never the financial source of truth.

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
- `SuccraMission`/`MissionFactory`/`GuardianRegistry` addresses and HashKey network;
- HSP webhook health;
- failed job counter;
- recent succession events;
- contract/HSP mirror reconciliation alerts.

No operator can directly withdraw mission funds.

Emergency operational action is limited to:
- disable automatic succession globally for new missions;
- pause runtime processing;
- rotate the guardian through `GuardianRegistry`'s owner-controlled update.

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
| Budget envelope exhausted | BLOCKED |
| Mission quarantined | BLOCKED |
| HSP submission fails | action FAILED, no false success |
| HashKey settlement reverts | action FAILED, no false success |
| HSP webhook duplicated | ignored after idempotency check |
| HSP webhook signature invalid | rejected, no state change |
| HSP unavailable | fallback to HashKey RPC polling; no confirmation without chain |
| Mandate hash mismatch | rejected before HSP submission |
| Direct ERC-20 bypass attempt | rejected; payments only via HSP |
| Succession triggered twice | only one succeeds |
| No eligible successor | HALTED + owner notification |
| Successor unavailable during activation | succession remains pending/failed safely |
| Agent endpoint unreachable | no authority expansion; may trigger liveness rule if enabled |
| DB unavailable while chain/HSP action exists | reconcile from chain/HSP later |
| Runtime crashes after submit | settlement reconciliation recovers status |
| AI unavailable | deterministic successor selection |
| AI recommends ineligible agent | ignored |
| User changes wallet account | session re-authentication required |
| Mission expiry during request | contract state decides; expired request rejected |
| Two payments spend remaining budget | HSP Cart Mandate allows only the valid payment(s); the contract mirrors confirmed spend |

---

# 21. TEST STRATEGY

## Unit tests
Must cover:
- policy evaluator;
- violation streak;
- successor eligibility;
- checkpoint hashing;
- EIP-712 canonical signing/verification;
- state transition guards;
- authority limit calculation;
- mandate hash binding.

## Solidity contract tests
Must cover:
- create mission;
- activate Cart Mandate policy;
- authorized HSP payment;
- blocked HSP payment;
- budget envelope exhaustion;
- quarantine;
- successor activation;
- restricted successor payment;
- cancel;
- stale state/version rejection;
- unauthorized guardian attempt;
- unauthorized agent attempt;
- direct ERC-20 bypass rejection;
- mandate hash mismatch.

Solidity contract tests must run before moving checkpoints.

## Integration tests
- Supabase auth + RLS;
- agent registration;
- EIP-712 payment submission;
- HSP mock flow;
- settlement confirmation mirror;
- webhook idempotency and signature verification.

## E2E tests
Required golden path:
```text
Create mission
→ sign HSP Cart Mandate
→ register Alpha
→ execute valid HSP payment
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
- HSP/chain rejection spoofing;
- mandate hash mismatch;
- direct ERC-20 bypass;
- webhook replay and signature forgery;
- prompt injection into successor recommender.

## Acceptance definition
A feature is complete only when:
1. implementation exists;
2. automated tests pass;
3. actual flow was executed;
4. evidence is recorded;
5. checkpoint commit created.

A checkpoint is not complete until tests pass and changed files are inspected.

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
│       │   ├── hsp/
│       │   └── monitor/
│       └── tests/
├── packages/
│   ├── sdk/
│   ├── shared/
│   └── hsp-client/
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

Directory rule: product UI stays in `apps/web`; persistent orchestration in `apps/runtime`; on-chain authority in `contracts/`; HSP integration and shared contracts/types in `packages/`.

---

# 23. ENVIRONMENT VARIABLES

## Web/server
```text
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_HASHKEY_CHAIN_ID=177
NEXT_PUBLIC_HASHKEY_RPC_URL=https://mainnet.hsk.xyz
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUCCRA_MISSION_FACTORY_ADDRESS=
SUCCRA_GUARDIAN_ADDRESS=
HSP_API_BASE_URL=
HSP_MERCHANT_ID=
HSP_API_SECRET=
HSP_HMAC_SECRET=
HSP_WEBHOOK_SECRET=
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
SUCCRA_GUARDIAN_SECRET_KEY=
HSP_API_BASE_URL=
HSP_MERCHANT_ID=
HSP_API_SECRET=
HSP_HMAC_SECRET=
HSP_WEBHOOK_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=
```

Rules:
- `NEXT_PUBLIC_*` must never contain secrets;
- guardian secret is runtime-only;
- Supabase service role is server-only;
- HSP API, HMAC, and webhook secrets are server-only;
- agent private keys live with agents and never in Succra;
- `.env*` excluded from git except `.env.example`.

---
