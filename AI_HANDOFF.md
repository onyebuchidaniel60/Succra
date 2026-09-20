# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on Solana.

## Current status
**Phase 5 — Guardian + quarantine: implemented on phase-5-guardian, CI green (run 34, all four jobs). Awaiting merge.**

Phase 2 complete (`979e6d4`): mission/vault accounts with create/fund/cancel; `current_agent: Pubkey` + `agent_nonce: u64`; `execute_action` (TRANSFER_SOL via System, TRANSFER_SPL via Token, vault-PDA-signed); `fund_spl` (exact-match, single-use); SPL-aware `cancel`; `ActionExecuted` event; FR-03 checks in pure `validation.rs`. Verified locally: `cargo test` (25/25), validator integration suite 27/27 runnable (2 expiry E2E skipped on the Windows sandbox — bank-clock lag — unit coverage for expiry rejection passes).

Phase 3 complete: Supabase schema (`profiles`, `agents`, `missions`, `mission_agents`, `mission_policies`) per ARCHITECTURE.md §7 with owner RLS on all tables; wallet-auth flow (POST /api/auth/nonce → wallet signs message → POST /api/auth/verify → Supabase session); dashboard read path; DRAFT mission creation. Verified on CI (web + supabase jobs green on phase-3-ci).

Phase 3.1 complete: nonce storage migrated from in-memory Map to the `auth_nonces` table (single-use enforced atomically via UPDATE … WHERE `consumed_at` IS NULL … RETURNING; RLS enabled with no policies, service-role only); GitHub Actions CI added (web, supabase with live RLS/auth suite, solana); Phase 2's 2 expiry E2E tests un-skipped for Linux CI.

Phase 3.2: `solana` CI job split into `solana-cargo` (required: Rust stable, `cargo build` + `cargo test` only, no Anchor/Solana CLI/platform-tools) and `solana-e2e` (non-blocking via job-level `continue-on-error`: full Solana 2.3.0 + Anchor 0.32.1 toolchain, `anchor build`, IDL, validator, deploy, mocha). No 11th Anchor-install fix attempted; the install steps are left as-is.

Phase 4 complete (SDK + agent gateway): `packages/sdk` (thin `SuccraAgentClient`, verify-before-sign, canonical signing via shared, `SdkError`/`SdkRefusal`, `tweetnacl` keys); `packages/shared` (base58/64 + sha256, §12 canonical string, execute-ix codec, legacy txmsg parse/assemble, signing); `apps/web/lib/gateway` (14 modules: auth, chain, handlers, heartbeat, mission-state, pdas, policy, preflight, registration, schemas, status, store, submit, supabase-store); 7 API routes (agents attach/challenge/verify/heartbeat/status; missions actions preflight/submit); migration `20260914000000_phase4_gateway.sql` (`action_requests`, `onchain_transactions`, `agent_request_nonces`, `agent_challenges`).

Two-step signing: preflight constructs the message and the gateway co-signs as fee payer at submit; the agent verifies-before-signs with the SDK and never shares its key; submit polls to CONFIRMED/FAILED and mirrors remaining budget (chain authoritative). Terminal-state short-circuit precedes hash comparison in `submit.ts` (documented state machine; the Alpha suite asserts both orderings in separate tests).

Alpha acceptance verified live on localnet: 6/6 (`phase4-alpha-live.test.ts`), submit signature `3pMoGWKVqyZMrSMseFpemEmxY6RdH1N9q6FKUvPAbquQQsHZQBWBLZSPt9TXY2DeJwXmagUL5pKkavXV1jjsYXJw`, program `2DkVabKRQ3R8ZXtJkptAVvnWDm6DuhakhPqpvoVKsJeT`. Fee-payer path: the test reads production `SUCCRA_GATEWAY_FEE_PAYER_SECRET_KEY` (repo `.env.local`, gitignored); the local faucet is unreliable on this box — transfer-from-genesis is the documented workaround.

Phase 5 implemented (Guardian + quarantine, on phase-5-gateway): `quarantine` instruction (guardian signer + ACTIVE only → QUARANTINED + `MissionQuarantined` event; hardcoded `GUARDIAN_PUBKEY` constant, rotation via program upgrade); DB-computed FR-04 streak (POLICY_BLOCKED rows per mission+agent since last CONFIRMED within window; on-chain threshold/window authoritative); auto-trigger in preflight on crossing edge + manual POST /api/missions/:id/quarantine (owner or guardian credential); `audit_events` migration with counted/threshold/submitted/confirmed rows; no GET audit endpoint (Phase 7). Design resolutions: (a) constant over Config PDA (no extra instruction allowed; rotation language matches redeploy); (b) DB-computed over on-chain counter (program cannot observe off-chain BLOCKs; §11 places streak in the DB flow). Guardian pubkey `H5rPWxyMANp1XbBqZwvvEKZUS4KYGYHLv3UujxEQDdQs` (devnet secret gitignored; devnet faucet rate-limited — external funding pending).

Design decisions recorded:
- Next 15 pinned (not 16) for stable middleware conventions.
- zod v3 pinned.
- `@solana/kit` codecs throw internally in this toolchain; the auth path uses local Ed25519 decode with fixture tests, and kit only for `address()` validation.
- Rate limiting (ARCHITECTURE.md §10) still deferred, not in Phase 4 scope.
- Vitest per-test timeouts use the options-object form (`it(name, { timeout }, fn)`; object-as-third-arg is deprecated in vitest 3.x).
- Helius webhooks deferred to Phase 9.

Known open items:
- Phase 2 expiry E2E: closed — verified on Linux CI via the required `solana-e2e` job (branch run 29, main run 31).

Previous checkpoint: Phase 4.9 merge (`085fc67`; `solana-e2e` required-green via pinned Docker toolchain).
Next assigned task: **Phase 5 — Guardian + quarantine, in progress on phase-5-guardian (implementation done, CI pending).**
CI: verified on main run 31 (https://github.com/onyebuchidaniel60/Succra/actions/runs/35474814702 — web + supabase + solana-cargo + solana-e2e all green, no continue-on-error anywhere). Phase 4 merged as `2e88b4c`; phase-4.9 merged as `085fc67`; both branches fully merged, no commits ahead.

Spec amendment (2026-09-14, v2): ARCHITECTURE.md and SUCCRA_BLUEPRINT amended for two-step action signing (§10), gateway fee-payer role and key (§10, §23), transaction wire format and hash preimage (§10), challenge/verify shapes and agent_challenges table (§10, §7), heartbeat minimum interval 30s (§10), gateway RPC via SUCCRA_RPC_URL and RPC polling as Phase 4 confirmation path (§10, §16), agent_request_nonces table and request-nonce vs agentNonce distinction (§7, §12), status endpoint envelope (§10). Rationale: prior single-endpoint spec contradicted the Phase 2 program's requirement that execute_action is signed by the current agent; two-step signing preserves non-custody.

Spec amendment (Phase 5 pre-work): clarified FR-04 counter reset semantics (success resets; window drops old violations), made QUARANTINED state transitions explicit (no ACTIVE shortcut), stated the guardian is a single global key rotated via program upgrade authority, noted audit_events is created by the Phase 5 migration, and split Phase 5 (write audit events) from Phase 7 (display timeline). Clarifications only; no new mechanisms.

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
