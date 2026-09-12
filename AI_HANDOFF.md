# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on Solana.

## Current status
**Phase 1 — Solana program foundation: complete** (see Phase 1 checkpoint commit).

Mission/vault accounts with create/fund/cancel verify clean: `cargo build`,
`cargo test` (12/12), `anchor build` (SBF), validator integration suite
(13/13: create, fund, cancel/refund, FR-01 negatives, non-owner rejection).
No Phase 2+ logic implemented.
Note: fund is exact-match (== budget) and single-use in Phase 1; revisit if a later phase requires partial or multi-deposit funding.
Note: Anchor events for create/fund/cancel are not emitted in Phase 1; schedule with the phase that introduces on-chain audit anchoring.
Prior checkpoint: Phase 0 complete (`cc179916019484157c153f13ff825a0b2e4b83d9`).
Next assigned task: **Phase 2 — Secure action execution**, not yet authorized.

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
