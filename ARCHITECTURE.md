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
- latest x402 settlement;
- succession state.

Empty state: `Create your first mission`.

## Screen 3 — New Mission `/missions/new`
Wizard:
1. Mission
2. Authority
3. Primary agent
4. Successors
5. Review + sign (mission create and x402 offer policy approval)

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
✓ x402 payment settled
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

Every receipt has `View on Blockscout` at `https://robinhoodchain.blockscout.com` when a Robinhood transaction hash exists, plus the x402 payment ID / EIP-3009 authorization nonce.

## Screen 8 — Settings `/settings`
- connected wallet;
- network (Robinhood mainnet/testnet);
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
- authorization hashes;
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
Purpose: verify and settle x402 payments. A resource server returns HTTP 402 with `accepts[]` offers; Succra constructs EIP-3009 `transferWithAuthorization` typed data, the owner/token holder signs it, and the facilitator verifies signature/nonce/network/asset before settling USDG or an allowlisted ERC-20 on Robinhood Chain. Self-hostable facilitators include `@402lane/facilitator`, `hood402`, and `rhx402`.
Credentials: `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_ASSET_ADDRESS` (optional overrides); any facilitator-specific key is server-only. No shared-secret HMAC/JWT flow is required by x402.
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
Purpose: optional agent identity metadata for cross-application discovery. It is not authoritative for mission authority or payments.

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
6. Succra calls `SuccraMission.authorizePayment` and waits for confirmation.
7. Succra submits the signed payload to the x402 facilitator.
8. The facilitator verifies the EIP-3009 signature/nonce and settles USDG or the allowlisted ERC-20 on Robinhood Chain.
9. Succra verifies the facilitator receipt and the on-chain Transfer log.
10. Succra mirrors the confirmed settlement and writes a checkpoint.

## On-chain enforcement boundary
`SuccraMission` enforces:
- mission status and current agent;
- `X402_PAYMENT` action type;
- per-payment ceiling (`maxPayment` or `recoveryMaxPayment`);
- mirrored cumulative spend against `budgetAtomic`;
- merchant and token allowlists;
- expiry;
- recovery ceiling;
- payment nonce and state version;
- guardian-only transitions.

The runtime may submit to the facilitator only after `authorizePayment` confirms. The contract verifies the agent's EIP-712 request signature, records the authorization hash, and advances `agentNonce`; it does not move funds.

The x402 facilitator enforces:
- EIP-3009 signature validity;
- authorization nonce uniqueness;
- network, asset, recipient, amount, and validity window;
- settlement execution.

The facilitator does not enforce the cumulative mission budget or the merchant/token allowlist; `SuccraMission` does. The contract's `confirmedSpentAtomic` is a mirror used for checkpoints and race detection. It never authorizes a transfer. If the mirror and settlement disagree, the Robinhood Transfer log is authoritative and the discrepancy is an incident.

## Residual trust boundary
The facilitator does not read `SuccraMission` state in MVP. A compromised owner signer or an already-signed authorization can settle within the EIP-3009 validity window even if the mission is quarantined or cancelled. Mitigations are short `validBefore` windows, on-chain authorization before facilitator submission, quarantine/cancel preventing new authorizations, and reconciliation alerts. Facilitator-side mission proofs or smart-account scoping are future hardening, not MVP claims.

## Remaining budget
`SuccraMission` is authoritative for the cumulative budget and per-payment limits. The runtime reconciles confirmed x402 settlements against the mirror and updates `remaining_budget_atomic`. A stale mirror can block a valid payment conservatively; it must never permit an invalid one.

## Recovery limit
Successor receives a smaller `recovery_max_payment`, enforced on-chain by mission state.

## Refund/cancel
x402 has no native refund primitive. The owner can cancel the mission and stop creating new x402 payments. An already-signed EIP-3009 authorization may still settle until `validBefore`, so authorization validity must be short. Funds remain in the owner's wallet; there is no vault refund.

## Reconciliation
The Robinhood settlement transaction and a matching EIP-3009 Transfer log are authoritative. A facilitator receipt alone is not confirmation. Supabase is a mirror/index, never the financial source of truth.

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
- `SuccraMission`/`MissionFactory`/`GuardianRegistry` addresses and Robinhood network;
- x402 settlement receipt health;
- failed job counter;
- recent succession events;
- contract/x402 mirror reconciliation alerts.

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
| Two payments spend remaining budget | `SuccraMission` budget enforcement and unique EIP-3009 nonces allow only the valid payment(s); the contract mirrors confirmed spend |

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
- authorization hash binding.

## Solidity contract tests
Must cover:
- create mission;
- commit x402 offer policy;
- authorized x402 payment;
- blocked x402 payment;
- budget exhaustion;
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
