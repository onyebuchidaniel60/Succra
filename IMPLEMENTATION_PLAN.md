# 24. PHASED IMPLEMENTATION PLAN

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
- implement mission creation, policy validation, owner/guardian access control, and status transitions for `DRAFT`, `ACTIVE`, `CANCELLED`, and `EXPIRED`;
- implement `authorizePayment` in `SuccraMission` (agent-signed, policy-enforcing, records `PaymentAuthorization`, advances `agentNonce`; does not move funds);
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

## Phase 7 — Audit and polished UX
Objective: make the full mission lifecycle understandable without developer terminology.

Tasks:
- build the mission timeline from `audit_events` (read-only);
- build the decision receipt with policy hash, request hash, decision, violation count, checkpoint hash, succession record, HashKey transaction hash, and HSP mandate ID;
- add Blockscout proof links;
- build succession visualization;
- add error, empty, loading, and retry states;
- verify responsive behavior and accessibility.

Acceptance:
- the full lifecycle can be understood from the UI;
- every receipt links to the correct HashKey proof and HSP mandate;
- no screen writes audit rows;
- accessibility and responsive checks pass.

## Phase 8 — AI advisory layer
Objective: add optional successor explanation without granting authority.

Tasks:
- implement structured candidate explanation;
- enforce deterministic eligibility before any AI call;
- cap input to structured mission and candidate metadata;
- add timeout, fallback, and caching;
- test prompt injection and ineligible-candidate recommendations.

Acceptance:
- AI cannot authorize an ineligible successor;
- AI failure leaves deterministic selection intact;
- no secret or raw reasoning is sent to the model;
- all AI-boundary tests pass.

## Phase 9 — E2E and security hardening
Objective: prove the golden path and close security gaps.

Tasks:
- run the full golden-path E2E on HashKey testnet with HSP sandbox or mock;
- add duplicate-submission, budget-exhaustion, quarantine-race, and double-succession tests;
- add replay, IDOR, malformed-payload, and role-confusion tests;
- add HSP webhook replay and signature-forgery tests;
- add direct-ERC-20-bypass and arbitrary-call rejection tests;
- review secrets, RLS, and deployment configuration;
- record evidence and residual risks.

Acceptance:
- the golden path completes end to end;
- all security tests pass;
- no unresolved critical or high finding remains;
- deployment checklist is complete.

## Phase 10 — Deployment and demo
Objective: deploy the hackathon demo and record evidence.

Tasks:
- rehearse on HashKey testnet (chain ID 133);
- complete mainnet readiness review for chain ID 177;
- fund the deployer wallet and verify contract addresses;
- configure HSP merchant credentials and webhook endpoint;
- deploy contracts and verify source on Blockscout;
- run a small-capital live demo only if explicitly approved;
- record the demo and publish the public site.

Acceptance:
- contracts are deployed and verified;
- the demo proves create → payment → violations → quarantine → succession → recovery;
- all deployment evidence is recorded;
- no secret is exposed.

---

Every phase follows the workflow: implement → test → inspect → fix → commit → record checkpoint → STOP. Do not proceed to the next phase without explicit authorization.
