# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on HashKey Chain (EVM).

## Current status
**Phase 4 — Agent registration and liveness: complete on branch `phase-4-agents` (pending review/merge). Phase 3 is complete and merged to `main` @ `4bb1641`. Phase 2 is complete and merged @ `40abe03`; Phase 1 is complete and merged @ `fbce1c2`. Solana is archived as tag `solana-v1` at `a4e089a`; CI runs `web`, `supabase`, and `contracts`.**

Pivot context (2026-11-01): Succra is pivoting from Solana to HashKey Chain (EVM) for the HashKey Chain Horizon Hackathon 2026, Track 2 (Agent Payments & A2A Settlement). The product thesis is unchanged: Succra is the continuity and authority layer that keeps an economic mission alive when its autonomous agent fails. Agents can fail; missions continue.

Phase 1 delivery (merged @ `fbce1c2`):
- `GuardianRegistry` with global guardian and owner-only rotation;
- `MissionFactory` deploys missions directly to `ACTIVE` and indexes by owner;
- `SuccraMission` with policy enforcement, `authorizePayment`, `cancel`, and state-version guards;
- 36 contract tests passing; `contracts` CI job required.

Phase 2 delivery (merged @ `40abe03`):
- migration `20261101000000_phase2_preflight.sql` extends `action_requests` with request/on-chain/mandate fields and tightens RLS to owner SELECT + service-role writes;
- `agent_request_nonces` remains service-role only;
- `packages/shared` adds the EIP-712 domain, `SuccraRequest` typed data, canonical body hash, method/path hash, and request-id binding;
- `packages/hsp-client` adds PROVISIONAL HSP Cart/Payment Mandate types, HMAC-SHA256, ES256K JWT, deterministic mandate hashing, and a test-only mock server;
- JWT uses `@noble/curves` secp256k1 + SHA-256 because Node WebCrypto does not support secp256k1; the signature is compact r||s and verified against the same digest viem produces;
- `apps/web` adds the HSP policy evaluator, agent EIP-712 auth middleware, viem contract reader, preflight store, and `POST /api/missions/:id/actions` preflight endpoint;
- preflight constructs the unsigned mandate locally and never calls HSP; submission/settlement remains Phase 3;
- contract-reader uses `getMerchantAllowlist()` plus the on-chain config, so no contract change was needed;
- Phase 1 review notes folded in: AI_HANDOFF correction, running-budget TODO, and `contracts/README.md` test-config note;
- tests: **223 passing** workspace-wide (61 new Phase 2 tests), 2 skipped live tests; 36 contract tests still pass.

`cartMandateId` is provisionally the mission UUID until HSP merchant access exists. The HSP typed-data schema remains PROVISIONAL and must be reconciled in Phase 9. Solana dead-code residue remains in `apps/web`, `packages/*`, `supabase/`, and `tests/`; it will be replaced through Phase 7.

Open questions:
- HSP merchant access: sandbox vs mock.
- HashKey mainnet deployer wallet funding.
- Demo recording plan: testnet + mock vs live mainnet.
- `@tanstack/react-query` remains deferred to Phase 4 wallet UI.

Phase 3 delivery (merged @ `4bb1641`):
- mission schema migrated to HashKey columns (`contract_address`, `factory_address`, `owner_address`, `payment_token_address`, `current_agent_address`), with legacy Solana columns retained until Phase 7;
- `hsp_payments` and `hsp_webhook_events` tables added; owner SELECT / service-role writes;
- `SuccraMission.recordSettlement` added as guardian-only, guarded by `authorizedRequests`, `authorizedAmount`, and `recordedSettlements`;
- submit endpoint now authorizes on-chain via the runtime signer, submits to the mock HSP, waits for settlement, records settlement via the guardian, and returns CONFIRMED/FAILED (202 only on bounded timeout);
- HSP webhook receiver verifies HMAC, deduplicates events, verifies HashKey RPC before recording, and is idempotent against the submit wait;
- runtime settlement poller is the 30s fallback;
- old Solana submit route and its Solana-specific tests deleted;
- Phase 2 running-budget TODO replaced by non-zero-spend tests.

Phase 3 checkpoint: merged @ `4bb1641`.

Phase 4 delivery on this branch (complete, pending review/merge):
- `agents.address` added (backfilled from legacy `public_key`; compatibility trigger retained until Phase 7), with owner-readable/service-role-write status transitions;
- `mission_agents` role/status/required-capabilities tightened; `agent_challenges` indexed for EVM single-use challenges;
- `AgentChallenge` EIP-712 typed data with purpose binding and no verifying contract;
- owner-initiated challenge/verify flow (agent signs out-of-band; multi-tenant self-serve is post-MVP);
- heartbeat uses EIP-712 `SuccraRequest` agent-only auth, accepts non-current successor agents, and enforces the 30s server-side interval;
- agent status endpoint returns address, heartbeat, status, and mission assignments;
- Phase 3 review notes folded in: migration TODO(phase-7), mirror separation comment, HSP_API_SECRET provisional comment, Phase 3 e2e hashPaymentMandate finding;
- tests: **282 passing**, 1 skipped live Supabase suite; contracts unchanged at 51 passing.

Phase 4 checkpoint: branch `phase-4-agents` (pending review/merge).

Next assigned task: **Phase 5 — Violations, quarantine, audit; not yet authorized.**

## Frozen product statement
Succra allows an economic mission to survive primary-agent failure by maintaining mission authority outside the agent, quarantining unsafe authority, preserving verified mission state, activating a pre-approved successor, and granting constrained recovery authority.

## Frozen architecture
User wallet → Next.js web → Supabase / Succra runtime → SuccraMission contract + HSP Gateway → HashKey Chain settlement. Agents communicate through EIP-712-signed requests and never custody mission funds.

## Frozen MVP
- HashKey Chain (EVM) only
- native HSK + allowlisted ERC-20 via HSP
- allowlisted merchants
- deterministic policy engine
- 3 consecutive blocked policy violations → quarantine
- pre-approved successors
- restricted recovery authority
- verified checkpoints
- audit timeline
- optional AI successor explanation, never authoritative

## Not in MVP
- arbitrary contract calls
- generic agent marketplace
- insurance
- cross-chain
- global agent reputation
- unrestricted agent wallets
- production decentralized keeper network
- custodial vault model
- direct ERC-20 transfers bypassing HSP
- support for Solana

## First phase
**Phase 0 — Repository pivot.**

The coding agent must preserve the prior implementation as an archive, remove prior-chain code from the mainline, and establish the EVM/HSP workspace. It must not implement product functionality.

## Required first-task wording
> Implement Phase 0 — Repository pivot only, exactly as defined in `IMPLEMENTATION_PLAN.md`. Do not implement Solidity contracts, HSP integration, database schema, authentication, UI screens, agent runtime logic, or any product feature. Archive the prior implementation, remove prior-chain code and CI, establish the EVM/HSP workspace, update `.env.example`, run the required verification commands, report actual results, show changed files, create the Phase 0 Git checkpoint, and STOP.

## Known design assumptions
- Succra Cloud can go offline; on-chain mission authority remains intact, but new HSP payments cannot be authorized until the runtime/owner can act.
- HSP is the payment execution and settlement authority; Succra is the authority and policy layer around it.
- Guardian is constrained and cannot spend. Production should eventually move toward a stronger decentralized guardian/keeper design.
- Mission checkpoint stores deterministic facts, not agent private reasoning.
- The database mirrors on-chain and HSP state; it does not authorize money movement.
- Funds remain in the owner's wallet; Succra never takes custody.

## Verification rule
Evidence > agent claim. Do not accept “works” without tests or direct flow verification.
