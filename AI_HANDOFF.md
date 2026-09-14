# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on Solana.

## Current status
**Phase 3 — Web auth + database: complete. Phase 3.1: complete. Phase 3.2: complete (CI split; required jobs await green on phase-3-ci).**

Phase 2 complete (`979e6d4`): mission/vault accounts with create/fund/cancel; `current_agent: Pubkey` + `agent_nonce: u64`; `execute_action` (TRANSFER_SOL via System, TRANSFER_SPL via Token, vault-PDA-signed); `fund_spl` (exact-match, single-use); SPL-aware `cancel`; `ActionExecuted` event; FR-03 checks in pure `validation.rs`. Verified locally: `cargo test` (25/25), validator integration suite 27/27 runnable (2 expiry E2E skipped on the Windows sandbox — bank-clock lag — unit coverage for expiry rejection passes).

Phase 3 complete: Supabase schema (`profiles`, `agents`, `missions`, `mission_agents`, `mission_policies`) per ARCHITECTURE.md §7 with owner RLS on all tables; wallet-auth flow (POST /api/auth/nonce → wallet signs message → POST /api/auth/verify → Supabase session); dashboard read path; DRAFT mission creation. Verified on CI (web + supabase jobs green on phase-3-ci).

Phase 3.1 complete: nonce storage migrated from in-memory Map to the `auth_nonces` table (single-use enforced atomically via UPDATE … WHERE `consumed_at` IS NULL … RETURNING; RLS enabled with no policies, service-role only); GitHub Actions CI added (web, supabase with live RLS/auth suite, solana); Phase 2's 2 expiry E2E tests un-skipped for Linux CI.

Phase 3.2: `solana` CI job split into `solana-cargo` (required: Rust stable, `cargo build` + `cargo test` only, no Anchor/Solana CLI/platform-tools) and `solana-e2e` (non-blocking via job-level `continue-on-error`: full Solana 2.3.0 + Anchor 0.32.1 toolchain, `anchor build`, IDL, validator, deploy, mocha). No 11th Anchor-install fix attempted; the install steps are left as-is.

Design decisions recorded:
- Next 15 pinned (not 16) for stable middleware conventions.
- zod v3 pinned.
- `@solana/kit` codecs throw internally in this toolchain; the auth path uses local Ed25519 decode with fixture tests, and kit only for `address()` validation.
- Rate limiting (ARCHITECTURE.md §10) still deferred, not in Phase 3 scope.

Known open items:
- `solana-e2e` not green; a pinned Docker image shipping Rust + Solana 2.3.0 + Anchor 0.32.1 is the fix path, scheduled before Phase 5.
- Phase 2 expiry E2E tests still unverified on Linux CI until `solana-e2e` goes green (not claimed as passing).

Previous checkpoint: Phase 2 (`979e6d4`).
Next assigned task: **Phase 4 — not yet authorized.**
CI: verified on phase-3-ci run 12 (https://github.com/onyebuchidaniel60/Succra/actions/runs/34805905117 — web + supabase + solana-cargo green, solana-e2e non-blocking red) and on main run 13 (https://github.com/onyebuchidaniel60/Succra/actions/runs/34806623212 — same). Phase 3 merged to main as `b3cfd8e`; phase-3-ci fully merged, no commits ahead.

Spec amendment (2026-09-14, v2): ARCHITECTURE.md and SUCCRA_BLUEPRINT amended for two-step action signing (§10), gateway fee-payer role and key (§10, §23), transaction wire format and hash preimage (§10), challenge/verify shapes and agent_challenges table (§10, §7), heartbeat minimum interval 30s (§10), gateway RPC via SUCCRA_RPC_URL and RPC polling as Phase 4 confirmation path (§10, §16), agent_request_nonces table and request-nonce vs agentNonce distinction (§7, §12), status endpoint envelope (§10). Rationale: prior single-endpoint spec contradicted the Phase 2 program's requirement that execute_action is signed by the current agent; two-step signing preserves non-custody.

## Frozen product statement
Succra allows an economic mission to survive primary-agent failure by maintaining mission authority outside the agent, quarantining unsafe authority, preserving verified mission state, activating a pre-approved successor, and granting constrained recovery authority.

## Frozen architecture
User wallet → Next.js web → Supabase / Succra runtime → Succra Solana program → mission/vault PDAs. Agents communicate through signed requests and never custody mission funds.

## Frozen MVP
- Solana only
- SOL + one SPL mint per mission
- allowlisted recipients
- deterministic policy engine
- 3 consecutive blocked policy violations → quarantine
- pre-approved successors
- restricted recovery authority
- verified checkpoints
- audit timeline
- optional AI successor explanation, never authoritative

## Not in MVP
- arbitrary CPI router
- generic agent marketplace
- insurance
- cross-chain
- global agent reputation
- unrestricted agent wallets
- production decentralized keeper network

## First phase
**Phase 0 — Repository Foundation.**

The coding agent must build only the workspace/repository foundation and verification commands. It must not implement product functionality.

## Required first-task wording
> Implement Phase 0 — Repository Foundation only, exactly as defined in `IMPLEMENTATION_PLAN.md`. Do not implement Solana instructions, database schema, authentication, UI screens, agent runtime logic, or any product feature. Create the approved repository structure, workspace configuration, documentation placeholders, lint/test/build commands, and `.env.example`. Run the required verification commands, report actual results, show changed files, create the Phase 0 Git checkpoint, and STOP.

## Known design assumptions
- Succra Cloud can go offline; on-chain safety remains intact, but automatic succession pauses until the runtime/owner can act.
- Guardian is constrained and cannot spend. Production should eventually move toward a stronger decentralized guardian/keeper design.
- Mission checkpoint stores deterministic facts, not agent private reasoning.
- The database mirrors on-chain state; it does not authorize money movement.

## Verification rule
Evidence > agent claim. Do not accept “works” without tests or direct flow verification.
