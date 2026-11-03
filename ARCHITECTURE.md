# SUCCRA — ARCHITECTURE.md

# 7. DATA MODEL

## On-chain contracts

Succra uses three Solidity contracts:

- `SuccraMission.sol` — one contract per mission. Holds mission authority, policy, status, violations, successors, session key, mission USDG, state version, and checkpoint commitments. It is the mission's token holder and releases or withdraws funds only under its on-chain rules.
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
    uint256 initialDepositAtomic;      // minimum deposit required before ACTIVE
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
    address sessionKey;                // current runtime-held session key
    uint256 depositedAtomic;           // total USDG deposited into the contract
    uint256 withdrawnAtomic;           // total USDG withdrawn by the owner
    bytes32 lastCheckpointHash;
    uint64 lastCheckpointSequence;
}

mapping(bytes32 => bool) public approvedHashes;  // Variant A: EIP-3009 hashes approved by policy
```

`DEGRADED` and `HALTED` are reserved values. No MVP transition enters `DEGRADED`; `HALTED` is written only to the off-chain mirror when no eligible successor exists, while the contract remains `QUARANTINED`. The reachable MVP state machine is defined in `PROJECT_SPEC.md` §6.

`DRAFT` is the pre-deposit on-chain state. A deployed mission with a committed policy and x402 offer hash starts `DRAFT`; it reaches `ACTIVE` only after the initial USDG deposit confirms. The off-chain mirror shows `FUNDED` while the deposit is pending. A `DRAFT` mission cannot execute payments.

### `Checkpoint`

```solidity
struct Checkpoint {
    uint64 sequence;
    bytes32 checkpointHash;
    uint64 committedAt;
}
```

The full deterministic snapshot lives off-chain in `mission_checkpoints`; the contract stores the sequence/hash commitment. This preserves the existing checkpoint boundary without putting agent reasoning on-chain.

### `PaymentAuthorization` (legacy agent-request record)

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
    bytes agentSignature;              // agent request consent; the session-key EIP-3009 signature is verified before settlement
}
```

This struct records the agent's signed request for the off-chain mirror. It no longer authorizes a token transfer; the variant-specific `approvePayment`/`releaseForPayment` step is the on-chain authorization. R1 may remove or rename it in the contract ABI.

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
- `FundsDeposited(address indexed owner, uint256 amount)`
- `FundsWithdrawn(address indexed owner, uint256 amount)`
- `SessionKeyRegistered(address indexed sessionKey, uint64 stateVersion)`
- `SessionKeyRevoked(address indexed sessionKey, uint64 stateVersion)`
- `PaymentApproved(bytes32 indexed authorizationHash, uint256 amount, address merchant)`
- `PaymentReleased(address indexed sessionKey, uint256 amount)`
- `PaymentAuthorized(bytes32 indexed requestId, address indexed merchant, uint256 amountAtomic, bytes32 authorizationHash)` — legacy agent-request event; superseded by `PaymentApproved`/`PaymentReleased`
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
- `deposit(uint256 amountAtomic)` — pulls USDG via `transferFrom`, increments `depositedAtomic`, and moves `DRAFT` → `ACTIVE` when `initialDepositAtomic` is met; also callable in `ACTIVE`/`ACTIVE_RECOVERY` for top-ups;
- `withdraw(uint256 amountAtomic)` — sends USDG to the owner; callable at any status, including `QUARANTINED`, `RECOVERING`, `ACTIVE_RECOVERY`, and `CANCELLED`;
- `registerSessionKey(address sessionKey, uint64 expectedVersion)` — registers or replaces the runtime-held key; replacing invalidates pending approvals;
- `revokeSessionKey(uint64 expectedVersion)` — owner revocation; also callable by the guardian only as part of quarantine;
- `quarantine(uint64 expectedVersion)` — owner-initiated quarantine;
- `cancel(expectedVersion)` — allowed non-terminal states;
- `activateSuccessor(address successor, uint64 expectedVersion)` — owner fallback when the guardian is unavailable, using the same eligibility checks.

Guardian-authorized:
- `recordViolation(bytes32 requestId, uint64 expectedVersion)`;
- `quarantine(uint64 expectedVersion)`;
- `activateSuccessor(address successor, uint64 expectedVersion)`;
- `acknowledgeRecovery(uint64 expectedVersion)`;
- `recordSettlement(bytes32 paymentId, uint256 amountAtomic, bytes32 txHash, uint64 expectedVersion)`;
- `commitCheckpoint(uint64 sequence, bytes32 checkpointHash, uint64 expectedVersion)`;
- `revokeSessionKey(uint64 expectedVersion)` — quarantine path only.

Runtime-submitted (guardian-authorized):
- `approvePayment(bytes32 authorizationHash, uint256 amountAtomic, address merchant, uint64 expectedVersion)` — Variant A; checks status, session key, per-payment ceiling, cumulative budget, merchant/token allowlist, expiry, and state version; stores `approvedHashes[authorizationHash] = true`; emits `PaymentApproved`;
- `releaseForPayment(address sessionKey, uint256 amountAtomic, uint64 expectedVersion)` — Variant B; checks status, session key, per-payment ceiling, cumulative budget, expiry, and state version; transfers exactly `amountAtomic` USDG to the session key; emits `PaymentReleased`;
- `isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4)` — Variant A ERC-1271 entry point; returns `0x1626ba7e` only when `approvedHashes[hash]` is true and `signature` recovers the registered session key.

`authorizePayment` is replaced by the variant-specific approval/release step in R1. The runtime verifies the agent's `SuccraRequest` and current-agent assignment before calling; the contract enforces status, session-key state, caps, expiry, and state version. Variant A additionally binds the approved hash to the merchant and amount. Variant B's release signature carries the session key, amount, and version; the runtime checks the merchant allowlist before release and re-checks the signed EIP-3009 recipient before facilitator submission. The guardian key may relay the call, but the guardian cannot withdraw or spend alone.

`GuardianRegistry.rotateGuardian(address nextGuardian)` is owner-authorized by the registry owner (deployer/owner multisig).

The workflow names `activate_successor` and `acknowledge_recovery` map to the Solidity methods `activateSuccessor` and `acknowledgeRecovery`.

### Contract authority boundary

`SuccraMission` is authoritative for:
- mission existence, owner, current agent, status, and successor membership;
- policy configuration and per-payment eligibility;
- custody of mission USDG and the owner's unconditional withdrawal right;
- the recovery per-payment ceiling selected by status;
- session-key registration, rotation, revocation, and Variant A approved hashes;
- guardian authorization and state-version checks;
- checkpoint hash commitments.

`SuccraMission` is the mission's token holder. It enforces the cumulative budget, per-payment ceiling, merchant/token allowlist where supplied, expiry, status, and session-key state. The x402 facilitator is authoritative for signature/nonce verification and settlement. The x402 offer constrains one payment, not the aggregate budget. The contract's `confirmedSpentAtomic` is a mirrored value updated only from confirmed x402 settlements; it is used for checkpoints and race detection, never as permission to move funds. The owner's `withdraw` right is unconditional and cannot be blocked by the guardian, agent, or runtime.

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
- `initial_deposit_atomic` NUMERIC(78,0) NOT NULL
- `total_deposited_atomic` NUMERIC(78,0) NOT NULL DEFAULT 0
- `total_withdrawn_atomic` NUMERIC(78,0) NOT NULL DEFAULT 0
- `remaining_budget_atomic` NUMERIC(78,0) NOT NULL
- `status` TEXT NOT NULL
- `session_key_address` TEXT NULL
- `session_key_status` TEXT (`NONE`,`ACTIVE`,`REVOKED`,`REPLACED`)
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

Testnet uses chain ID `46630`. Wallet login uses a separate `SuccraLogin` typed-data domain without a verifying contract. EIP-3009 settlement uses the USDG/ERC-20 `TransferWithAuthorization` typed data. In Variant A the contract is `from`, the session key signs, and `SuccraMission.isValidSignature` validates the approved hash; in Variant B the session key is `from` and signs an authorization for funds released on demand by `SuccraMission`. Succra binds the resulting authorization hash and nonce into its own request record.

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

Funds and signing paths:

```text
Owner ── deposit USDG ──────────────────────────────▶ SuccraMission (holds USDG)
Owner ◀─ withdraw USDG at any status ─────────────── SuccraMission
Owner ── register/revoke session key ───────────────▶ SuccraMission
Runtime-held session key ── signs EIP-3009 ─────────▶ X402 facilitator
Variant A: USDG sees from=SuccraMission ── ERC-1271 ─▶ SuccraMission.isValidSignature
Variant B: SuccraMission ── releaseForPayment ──────▶ session key (from=sessionKey) ──▶ USDG
```

## Architectural principle

**On-chain = authority and policy.**

**x402 facilitator = payment verification and settlement.**

**Off-chain = orchestration, monitoring, indexing, UI, and agent communication.**

The runtime can detect, preflight, and recommend, but it cannot override `SuccraMission` policy or facilitator settlement. x402 receipt verification against the Robinhood EIP-3009 Transfer log is the settlement-confirmation primitive. The database is a mirror and index, never the financial source of truth.

## Program-controlled vault model (Model A)

Funds are held by the `SuccraMission` contract. The owner deposits mission funds at creation and can withdraw at any time. The contract is the token holder; the owner holds an unconditional withdrawal right that no other party (agent, guardian, runtime) can block.

A session key (EOA) is registered by the owner at mission creation. The Succra runtime holds the session key server-side. The agent triggers payments via Succra's preflight API; the runtime submits the signed EIP-3009 authorization using the session key.

Two variants satisfy the EIP-3009 signature requirement. R1-spike determines which is used:

### Variant A (preferred — contract-signer via ERC-1271)

`SuccraMission` implements `IERC1271.isValidSignature`. When the agent preflights a payment, the runtime computes the EIP-712 digest and the contract stores it in an `approvedHashes` mapping (single transaction, runtime-initiated). The session key signs the EIP-3009 authorization. When USDG calls `transferWithAuthorization` with `from=SuccraMission`, USDG code-routes to `SuccraMission.isValidSignature`, which:
- verifies the hash is in `approvedHashes`;
- recovers the signer and verifies it matches the registered session key;
- returns MAGIC (`0x1626ba7e`).

If USDG does not code-route (raw ecrecover), Variant A fails and Variant B is used.

### Variant B (fallback — funder-then-EOA-signer)

`SuccraMission` holds USDG but does not sign. On an approved payment, the runtime calls `SuccraMission.releaseForPayment(sessionKey, amount, expectedVersion)`, which transfers exactly `amount` USDG from `SuccraMission` to the session key's EOA. The session key then signs EIP-3009 with `from=sessionKey` and submits to the facilitator. The session key holds near-zero balance between payments. The contract's per-payment cap and cumulative budget are enforced at release time. Quarantine stops `releaseForPayment`; the session key's remaining balance is swept back by the runtime at the owner's direction and is recoverable by the owner.

Both variants preserve: the owner never signs per payment; the owner can withdraw at any time; the session key cannot spend outside policy.

### Invariant that survives both variants

Succra never holds private keys to mission funds in a way the owner cannot override. The owner's withdrawal right is unconditional and unilateral.

This is the core positioning: Succra is the safety and continuity layer around x402, not a replacement for it.

## Off-chain failure boundary

Succra Cloud is not a cryptographic root of trust. If the runtime is offline:
- no new x402 payment can be preflighted or submitted by Succra;
- previously signed EIP-3009 authorizations may still settle until their `validBefore`, so validity windows must be short;
- automatic succession pauses;
- the owner can still withdraw mission USDG directly from `SuccraMission` at any status;
- the owner can still call `cancel` directly on the contract;
- the owner can still use the pre-approved successor path when the guardian is unavailable, subject to the same eligibility and state-version checks;
- existing on-chain authority remains intact.

The owner cannot use the fallback to bypass policy, change successors, or move funds except through the unconditional withdrawal right.

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
- EIP-3009 `transferWithAuthorization` signed by the runtime-held session key; Variant A uses `from=SuccraMission` with ERC-1271, Variant B uses `from=sessionKey` after on-demand release.
- USDG default settlement asset (mainnet `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; testnet `0x7E955252E15c84f5768B83c41a71F9eba181802F`); allowlisted ERC-20 supported.
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
- Succra holding signing keys on behalf of the owner.
- Any design where the owner cannot unilaterally withdraw.
- Delegated authority that survives mission quarantine.
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
  "initialDepositAtomic": "1000000000000000000",
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
The runtime verifies the `MissionCreated` event and the committed `x402OfferHash`, then sets the mirror to `FUNDED`. The mission reaches `ACTIVE` only after the initial USDG deposit confirms. A `DRAFT`/`FUNDED` mission cannot execute payments.

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
Purpose: preflight policy evaluation, approve the on-chain payment authorization, and construct the unsigned EIP-3009 `transferWithAuthorization` typed data. The runtime, not the agent, submits `approvePayment` (Variant A) or `releaseForPayment` (Variant B). Does NOT submit to the facilitator or settle funds.
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
  "variant": "A",
  "authorizationHash": "0x...",
  "authorizationTxHash": "0x...",
  "authorizationNonce": "0x...",
  "eip3009TypedData": { "domain": {}, "types": {}, "primaryType": "TransferWithAuthorization", "message": {} },
  "expiresAt": "..."
}
```

After policy passes, the runtime:
- **Variant A:** calls `SuccraMission.approvePayment(authorizationHash, amountAtomic, merchant, expectedVersion)` and waits for confirmation; the hash is now in `approvedHashes`.
- **Variant B:** calls `SuccraMission.releaseForPayment(sessionKey, amountAtomic, expectedVersion)` and waits for confirmation; the session key now holds exactly the payment amount.

The response includes the approval/release transaction hash. The agent never submits the approval transaction and never holds the session key.

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
Purpose: verify the agent request and session-key EIP-3009 signature, verify the on-chain approval/release, submit the x402 payload to the facilitator, verify settlement, and mirror the result.
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
2. the session key's EIP-3009 signature recovers the registered session key and matches the signed authorization hash;
3. the signed authorization hash, nonce, asset, payee, amount, and validity window equal the preflighted values;
4. the request has not expired and its nonce/idempotency key is unused;
5. Variant A: `approvedHashes[authorizationHash]` is true and the mission/session key are current; Variant B: `releaseForPayment` confirmed and the session key holds exactly the released amount;
6. the facilitator settlement and the matching Robinhood Transfer log are authoritative.

## `POST /api/missions/:id/deposit`
Auth: owner session.
Purpose: return the unsigned USDG `approve` plus `SuccraMission.deposit(amountAtomic)` transactions. `deposit` pulls the tokens via `transferFrom`, increments `depositedAtomic`, and activates the mission when `initialDepositAtomic` is met. Top-ups are allowed in `ACTIVE`/`ACTIVE_RECOVERY`.
After confirmation: verify `depositedAtomic` increased, mirror `missions.total_deposited_atomic`, and write `mission.deposited`.

## `POST /api/missions/:id/withdraw`
Auth: owner session.
Purpose: return the unsigned `SuccraMission.withdraw(amountAtomic)` transaction. Callable at any mission status, including `QUARANTINED`, `RECOVERING`, `ACTIVE_RECOVERY`, and `CANCELLED`; no guardian or agent approval is required.
After confirmation: mirror `missions.total_withdrawn_atomic` and write `mission.withdrawn`.

## `POST /api/missions/:id/session-key`
Auth: owner session.
Purpose: register or replace the runtime-held session key. Returns an unsigned `SuccraMission.registerSessionKey(sessionKey, expectedVersion)` transaction. Replacing the key invalidates the old key's pending approvals.

## `DELETE /api/missions/:id/session-key`
Auth: owner session; runtime guardian on quarantine.
Purpose: revoke the session key. Returns an unsigned `SuccraMission.revokeSessionKey(expectedVersion)` transaction.

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
Purpose: cancel the mission and stop future x402 payments. Already-signed EIP-3009 authorizations may settle until `validBefore`. The owner can withdraw the remaining contract balance at any time, including after cancellation.

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
5. after the `MissionCreated` event confirms the committed x402 offer hash, atomically update the mission mirror to `FUNDED` and create an audit event. There is no external x402 offer registration step;
6. after the initial deposit confirms, verify `depositedAtomic` and update the mirror to `ACTIVE`.

## Deposit
1. owner calls `POST /api/missions/:id/deposit` with `amountAtomic`;
2. server returns unsigned USDG `approve` plus `SuccraMission.deposit(amountAtomic)`;
3. owner signs and the transaction confirms;
4. server verifies `SuccraMission.depositedAtomic` increased and the mission reached `ACTIVE`;
5. DB mirrors `missions.total_deposited_atomic`;
6. audit event `mission.deposited`.

## Withdrawal
1. owner calls `POST /api/missions/:id/withdraw` with `amountAtomic`;
2. server returns unsigned `SuccraMission.withdraw(amountAtomic)`;
3. owner signs and the transaction confirms;
4. server verifies `withdrawnAtomic` increased and the token transfer to the owner;
5. DB mirrors `missions.total_withdrawn_atomic`;
6. audit event `mission.withdrawn`.
No mission status, guardian, or agent approval can block this path.

## Preflight
Database transaction:
1. insert the request using the unique idempotency key;
2. lock/read the mission mirror and contract state;
3. evaluate policy;
4. update the violation streak only when the decision is `BLOCK`;
5. record the decision and authorization hash;
6. for an ALLOW, the runtime calls `approvePayment` (Variant A) or `releaseForPayment` (Variant B) and waits for confirmation;
7. return the approval/release transaction hash and the unsigned EIP-3009 typed data. Do not submit to the facilitator.

## Submit
1. verify the agent's EIP-712 request and the session key's EIP-3009 signature, authorization hash, and nonce;
2. verify the variant-specific on-chain approval/release is confirmed and current;
3. lock the approved request with a compare-and-set;
4. mark the request `SUBMITTED` only after approval/release confirms;
5. submit the x402 payload to the facilitator;
6. verify the facilitator receipt and the on-chain EIP-3009 Transfer log; poll Robinhood RPC when the receipt is delayed;
7. update `x402_payments` and the mission mirror only after authoritative confirmation;
8. write the checkpoint and audit event.

Do not hold a database transaction open while waiting for x402 or Robinhood confirmation. Use an explicit `SUBMITTED → CONFIRMED/FAILED` transition.

## Quarantine
Use compare-and-set semantics:
`UPDATE missions SET status='QUARANTINED' WHERE id=? AND status='ACTIVE'`.
Then submit the guardian contract call. If affected rows = 0, quarantine was already handled or mission state changed. The contract remains the ultimate arbiter. Quarantine also revokes the session key; no new payment can be approved or released.

## Succession
Use a database lock/transaction on the mission row to prevent two successor jobs from activating simultaneously. The contract `state_version` remains the ultimate arbiter. On activation, the contract revokes the previous session key and the owner/runtime registers a new key with `recoveryMaxPaymentAtomic` as the cap.

## Race scenarios

| Scenario | Handling |
|---|---|
| Double action submission | Unique `(mission_id, idempotency_key)` and single-use nonce. |
| Two payments consume last budget | `SuccraMission` enforces the cumulative budget and unique on-chain request nonces; the x402 offer constrains each payment; the contract mirrors confirmed spend. |
| Quarantine races with payment | Contract checks status during approval/release. Quarantine revokes the session key. An already-signed EIP-3009 authorization may still settle until `validBefore`; the runtime records the race explicitly and keeps authorization windows short. |
| Session key compromised | Quarantine revokes the key; owner withdraws the contract balance. Variant A damage is bounded by approved hashes and the per-payment cap; Variant B damage is bounded by released amounts and the per-payment cap. |
| Variant B settlement fails after release | Session key holds the released amount; runtime sweeps it back to SuccraMission at the owner's direction; the payment is recorded `FAILED`. |
| Owner withdraws during an in-flight payment | `withdraw` is allowed at any status; it can only withdraw the remaining contract balance, never an already-approved/released amount twice. |
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
Settlement uses EIP-3009 `TransferWithAuthorization` typed data signed by the runtime-held session key. The agent's `SuccraRequest` authenticates the request but never authorizes a token transfer. Succra verifies both signatures and records the authorization hash on-chain before facilitator submission. In Variant A the contract is `from` and validates the approved hash via ERC-1271; in Variant B the session key is `from` after an on-demand release from the contract.

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
- commit an approved checkpoint hash;
- revoke the session key as part of quarantine.

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
- deposit mission USDG;
- withdraw mission USDG at any status, unilaterally and unconditionally;
- register, replace, or revoke the session key;
- update future policy subject to contract rules and state version;
- add successors before activation;
- cancel;
- stop future x402 payments;
- use the pre-approved successor fallback when the guardian is unavailable.

Owner does not have a hidden API shortcut; owner authority is backed by wallet signatures and on-chain checks. The owner never signs per-payment EIP-3009 authorizations; the runtime-held session key does.

---

# 13. SECURITY ARCHITECTURE

## Threat model

Assume:
- primary agent can become malicious;
- primary agent key can be compromised;
- runtime can be buggy, malicious, or temporarily unavailable;
- session key can be compromised;
- attacker can replay signed requests;
- attacker can modify API inputs;
- facilitator receipts can duplicate or arrive out of order;
- user can be phished into signing malicious typed data;
- LLM output can be manipulated;
- clients can attempt cross-user resource access;
- x402 or Robinhood RPC can be unavailable or return inconsistent results.

## Security controls

### Authority isolation
Agents never hold mission funds, the session key, or any token signing key. Mission USDG is held by `SuccraMission`; the runtime holds the session key server-side and signs only within the contract-approved policy. The owner can withdraw the contract balance unilaterally at any status.

### Owner withdrawal right
The owner's withdrawal right is unilateral, unconditional, and callable at any mission status. No role (agent, guardian, runtime) can block it. A withdrawal can never exceed the contract's unallocated balance or double-spend an already-approved/released payment.

### Session key
The session key is single-purpose, revocable by the owner or by the guardian on quarantine, and never held by an agent. Variant B keeps it near-zero between payments; Variant A can sign only hashes already approved by the contract. A compromised session key is bounded by the per-payment cap and any in-flight approvals/releases; quarantine revokes it and the owner withdraws the remaining contract balance.

### Least privilege
Successors start with lower recovery limits. Merchant and token allowlists are explicit. Guardian powers are limited to quarantine, session-key revocation on quarantine, activation, acknowledgement, and checkpoint commitment.

### Replay protection
Signed requests include timestamp + single-use nonce + unique idempotency key. EIP-712 typed data binds the mission, request ID, method, and body hash.

### Authorization binding
The signed EIP-3009 `TransferWithAuthorization` hash must equal the preflighted authorization hash, and the signed from/to/value/validity/nonce fields must match the preflighted values. A mismatch is rejected before on-chain authorization or facilitator submission.

### On-chain enforcement
The backend cannot override `SuccraMission` policy. Variant A `approvePayment` checks status, session key, per-payment ceiling, cumulative budget, merchant/token allowlist, expiry, recovery ceiling, and state version, then stores the authorization hash. Variant B `releaseForPayment` checks status, session key, per-payment ceiling, cumulative budget, expiry, recovery ceiling, and state version, then transfers exactly the approved amount. In both variants the runtime verifies the agent's EIP-712 signature and current-agent assignment before the on-chain call. The session-key EIP-3009 signature is verified by the token/facilitator against the same authorization hash and nonce.

### x402 enforcement
The facilitator enforces the EIP-3009 signature, nonce, asset, recipient, amount, and validity window at settlement. It does not enforce the cumulative mission budget or the merchant allowlist; `SuccraMission` does (Variant A binds the approved hash to the merchant and amount; Variant B checks the merchant before release and re-checks the signed recipient before submission). A payment outside the selected x402 offer is rejected even if the Succra mirror is stale. In Variant A the token's `from` is `SuccraMission`; in Variant B it is the session key funded on demand.

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
An x402 facilitator receipt must be matched to the on-chain EIP-3009 Transfer log (from, to, value, nonce, asset) before any state change. `from` must be `SuccraMission` in Variant A or the registered session key in Variant B. Duplicates are expected and deduplicated by transaction hash plus authorization nonce. A receipt alone never confirms settlement; Robinhood state is checked.

### Prompt injection
AI successor recommendation receives structured mission metadata only. It MUST NOT receive arbitrary agent-originated instructions as trusted system instructions.

### AI authority boundary
LLM can recommend or explain; only deterministic policy, `SuccraMission`, the session key's EIP-3009 authorization, and the x402 facilitator can authorize or settle money movement.

### Secrets
Store:
- Supabase service key;
- x402 facilitator credentials, if configured;
- guardian private key;
- runtime-held session key;
- deployer private keys for testnet/mainnet deployment;
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
- released session-key balance bounded by the per-payment cap (Variant B);
- no direct ERC-20 path.

### Admin abuse
No admin funds access. No operator can withdraw, change the owner, or bypass policy. Only the owner can withdraw mission funds.

### Emergency stop
Owner can cancel directly through the contract when allowed and can withdraw the remaining contract balance at any status. The guardian can quarantine and revoke the session key. Neither the guardian nor the runtime can withdraw. Cancellation cannot revoke an already-signed EIP-3009 authorization; short `validBefore` windows bound that exposure.

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
6. Deposit funds (amount; USDG approve + `SuccraMission.deposit`)

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

Owner actions:
- **Withdraw** is visible at every status, including `QUARANTINED`, `RECOVERING`, `ACTIVE_RECOVERY`, and `CANCELLED`.
- **Deposit** is visible when status is `ACTIVE` or `ACTIVE_RECOVERY`.
- **Session key** status and rotation are visible to the owner; the key itself is never displayed.

## Screen 5 — Agent page `/agents/:id`
- identity (EVM address);
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
Purpose: verify and settle x402 payments. A resource server returns HTTP 402 with `accepts[]` offers; Succra constructs EIP-3009 `transferWithAuthorization` typed data, the runtime-held session key signs it, and the facilitator verifies signature/nonce/network/asset before settling USDG or an allowlisted ERC-20 on Robinhood Chain. Variant A uses `from=SuccraMission` with ERC-1271; Variant B uses `from=sessionKey` after `releaseForPayment`. R1-spike determines which variant is used. Self-hostable facilitators include `@402lane/facilitator`, `hood402`, and `rhx402`.
Credentials: `X402_FACILITATOR_URL`, `X402_NETWORK`, `X402_ASSET_ADDRESS` (optional overrides); any facilitator-specific key is server-only. No shared-secret HMAC/JWT flow is required by x402.
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
`SuccraMission` is authoritative for the cumulative budget and per-payment limits. The runtime reconciles confirmed x402 settlements against the mirror and updates `remaining_budget_atomic`. A stale mirror can block a valid payment conservatively; it must never permit an invalid one.

## Recovery limit
Successor receives a smaller `recovery_max_payment`, enforced on-chain by mission state. The new session key registered at succession is capped by that recovery limit.

## Refund/cancel
x402 has no native refund for an already-settled payment. The owner can cancel the mission, stop creating new x402 payments, and withdraw the unspent contract balance at any time. An already-signed EIP-3009 authorization may still settle until `validBefore`, so authorization validity must be short.

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

Directory rule: product UI stays in `apps/web`; persistent orchestration in `apps/runtime`; on-chain authority in `contracts/`; x402 integration and shared contracts/types in `packages/`. The vault is built into `contracts/src/SuccraMission.sol`; there is no separate `MissionVault.sol`. `packages/x402-client` and `apps/runtime/src/x402` carry the x402 client/runtime integration.

---

# 23. ENVIRONMENT VARIABLES

## Web/server
```text
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=4663
NEXT_PUBLIC_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL=
NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL=https://robinhoodchain.blockscout.com
NEXT_PUBLIC_TESTNET_USDG_ADDRESS=0x7E955252E15c84f5768B83c41a71F9eba181802F
NEXT_PUBLIC_MAINNET_USDG_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
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
ROBINHOOD_TESTNET_DEPLOYER_PRIVATE_KEY=
ROBINHOOD_MAINNET_DEPLOYER_PRIVATE_KEY=
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
- session key is runtime-only and never exposed to agents or the browser;
- deployer private keys are deployment/runtime-only;
- Supabase service role is server-only;
- x402 facilitator URL and any facilitator credentials are server-only;
- agent private keys live with agents and never in Succra;
- `.env*` excluded from git except `.env.example`.

---
