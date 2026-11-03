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
