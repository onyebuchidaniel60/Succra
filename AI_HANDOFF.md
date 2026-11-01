# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on HashKey Chain (EVM).

## Current status
**Pivot notice (2026-11-01): Succra is pivoting from Solana to HashKey Chain (EVM) for the HashKey Chain Horizon Hackathon 2026, Track 2 (Agent Payments & A2A Settlement). The product thesis is unchanged: Succra is the continuity and authority layer that keeps an economic mission alive when its autonomous agent fails. Agents can fail; missions continue. Succra transfers mission authority, not blind trust.**

The Solana implementation is preserved at `phase-6-succession` @ `a4e089a` (Phase 6 implemented, unverified; Phases 0–5 merged into main at `64bb16c`). The `solana-v1` archive tag is planned for the next archive task and does not exist yet.

New direction: `SuccraMission` Solidity contract for on-chain mission authority and policy, HSP for payment execution, and a non-custodial authority layer. Funds remain in the owner's wallet constrained by the HSP Cart Mandate; Succra controls which agent may sign and what limits apply. Succra does not custody funds.

What survived conceptually:
- mission as the primary object, not the agent;
- bounded authority (budget, per-payment cap, merchant allowlist, expiry, allowed token and merchant lists);
- FR-03 policy checks, adapted so the action type is `HSP_PAYMENT`;
- mission state machine and FR-04 violation-streak semantics;
- guardian constraints (quarantine and activate only; no spending or policy changes);
- verified checkpoints versus unverified agent reasoning;
- succession with reduced recovery authority and progressive re-authorization;
- `audit_events` schema and timeline UX;
- dashboard structure (screens 1–8);
- design system and error/edge-case matrix;
- test-strategy structure.

What was discarded:
- Solana program, Anchor configuration, PDAs, `invoke_signed`, System Program, Token Program, SPL tokens, and fund/fund_spl instructions;
- `@solana/kit`, `@solana/web3.js`, `@coral-xyz/anchor`, and Wallet Standard;
- Ed25519 canonical signing strings;
- Helius webhooks (replaced by HSP webhooks);
- the Solana validator, `solana-test-validator`, and `anchor build/test/deploy`;
- Solana CI jobs (`solana-cargo`, `solana-e2e`);
- `SUCCRA_PROGRAM_ID`, `SUCCRA_GUARDIAN_PUBLIC_KEY`, and `NEXT_PUBLIC_SOLANA_CLUSTER`.

Open questions to resolve before Phase 2:
- HSP merchant access: sandbox vs mock.
- HashKey mainnet deployer wallet funding.
- Demo recording plan: testnet + mock vs live mainnet.

Previous checkpoint: `phase-6-succession` @ `a4e089a` (preserved for archive, unverified).

Next assigned task: **Phase 0 — Repository pivot per the new `IMPLEMENTATION_PLAN.md`; not yet authorized.**

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
