# SUCCRA — AI_HANDOFF.md

## Project
Succra — autonomous mission continuity and authority succession on HashKey Chain (EVM).

## Current status
**Phase 0 — Repository pivot: in progress on branch `phase-0-pivot` (not merged to `main`). The Solana implementation is archived as tag `solana-v1` at `a4e089a` and removed from the mainline. CI now runs only the `web` and `supabase` jobs.**

Pivot context (2026-11-01): Succra is pivoting from Solana to HashKey Chain (EVM) for the HashKey Chain Horizon Hackathon 2026, Track 2 (Agent Payments & A2A Settlement). The product thesis is unchanged: Succra is the continuity and authority layer that keeps an economic mission alive when its autonomous agent fails. Agents can fail; missions continue.

Phase 0 changes on this branch:
- `programs/`, `Anchor.toml`, and `.github/docker/` removed; root Cargo files were absent;
- `solana-cargo` and `solana-e2e` CI jobs removed; the push trigger now includes `hashkey-*`;
- `.env.example` marks Solana-era variables deprecated and adds HashKey/HSP variables;
- `contracts/` Hardhat workspace scaffolded with empty `SuccraMission`, `MissionFactory`, and `GuardianRegistry` stubs;
- `packages/hsp-client/` scaffolded with a Phase 0 marker and foundation test;
- `wagmi`, `viem`, and `@walletconnect/ethereum-provider` added to `apps/web`;
- `IMPLEMENTATION_PLAN.md` Phase 1 amended with `authorizePayment` and `MissionCancelled` (two-line fix from docs review).

Dead-code residue still present in `apps/web`, `packages/*`, `supabase/`, and `tests/`; it will be replaced in Phases 2–3. No product logic was implemented in Phase 0.

Solana archive: tag `solana-v1` at `phase-6-succession` @ `a4e089a` (Phase 6 implemented, unverified; Phases 0–5 merged to main via `b94df5e`).

Open questions before Phase 2:
- HSP merchant access: sandbox vs mock.
- HashKey mainnet deployer wallet funding.
- Demo recording plan: testnet + mock vs live mainnet.

Phase 0 checkpoint: branch `phase-0-pivot` (pending review).

Next assigned task: **Phase 1 — SuccraMission contract foundation; not yet authorized.**

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
