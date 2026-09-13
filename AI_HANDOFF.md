# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on Solana.

## Current status
**Phase 2 — Secure action execution: complete** (see Phase 2 checkpoint commit).

Mission/vault accounts with create/fund/cancel verify clean: `cargo build`,
`cargo test` (12/12), `anchor build` (SBF), validator integration suite
(13/13: create, fund, cancel/refund, FR-01 negatives, non-owner rejection).

Phase 2 delivered: `current_agent: Pubkey` + `agent_nonce: u64` on Mission;
`execute_action` instruction (TRANSFER_SOL via System, TRANSFER_SPL via
Token, vault-PDA-signed); `fund_spl` instruction (SPL deposit into the
program-owned spl-vault, exact-match, single-use); SPL-aware `cancel`;
`ActionExecuted` event; 13 new program errors (6008–6020); FR-03 checks in
pure `validation.rs` (`validate_execute_policy`). Verified: `cargo test`
(25/25), integration suite 27/27 runnable, `pnpm`
lint/typecheck/test/build/format all pass.
Amendment note: cancel semantics were extended to be SPL-aware as a
necessary consequence of Phase 2's SPL support (`fund_spl` creates an SPL
vault; cancel must be able to close it). Authority model unchanged.
Known environment-blocked verification: two expiry E2E tests are skipped
on this Windows sandbox (bank-clock lag with `--ticks-per-slot 1024`,
required because the sandbox lacks symlink privilege and the validator
dies packaging its slot-100 snapshot). Unit coverage for expiry rejection
passes. These should be run on a Linux host before mainnet.
Note: the `anchor deploy` IDL-write loop does not converge on slow
validators; `solana program deploy` is the working path. No test depends
on the on-chain IDL.
Prior checkpoint: Phase 1 complete (`d9811bb`).
Next assigned task: **Phase 3 — Web auth + database**, not yet authorized.

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
