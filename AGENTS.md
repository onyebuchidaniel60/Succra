# SUCCRA — AGENTS.md

## Project
Succra is a HashKey Chain-native (EVM) continuity and authority layer for autonomous agent payment missions. Agents receive bounded execution authority over a mission; Succra can quarantine unsafe agents, preserve verified mission state, activate a pre-approved successor with restricted authority, and expose an audit trail. Funds remain in the owner's wallet; Succra controls authority, not custody.

## Source of truth
- `PROJECT_SPEC.md` controls product requirements.
- `ARCHITECTURE.md` controls architecture and technology decisions.
- `IMPLEMENTATION_PLAN.md` controls build sequence.
- `AI_HANDOFF.md` controls current session/task state.
- `SUCCRA_BLUEPRINT.md` is the complete design reference.

## Non-negotiable architecture invariants
1. Succra never modifies agent code.
2. Mission spending authority is controlled by the SuccraMission contract. Funds remain in the owner's wallet constrained by the HSP Cart Mandate. Succra does not custody.
3. The backend/database is not the source of truth for funds.
4. The SuccraMission contract is authoritative for mission authority and policy. The HSP Gateway is authoritative for payment execution and settlement. The database is never authoritative for either.
5. Guardian may quarantine or activate only pre-approved successors; guardian cannot spend mission funds.
6. Successors never inherit unrestricted authority.
7. AI output is advisory and cannot authorize money movement.
8. MVP payment adapters are limited to HSP Payment Mandate execution of native HSK or allowlisted ERC-20 transfers to allowlisted merchants.
9. No arbitrary ERC-20 transfers, no arbitrary contract calls, no direct ERC-20 path bypassing HSP. Payments only via HSP Gateway.
10. No new product feature may be added because it seems useful or impressive.

## Stack is fixed
- Next.js App Router + TypeScript + Tailwind
- wagmi + viem + WalletConnect for EVM wallets
- Supabase Auth + Postgres + RLS
- Node.js 24 + TypeScript runtime
- Solidity ^0.8.24 + Hardhat
- HashKey Chain mainnet (chain ID 177, RPC https://mainnet.hsk.xyz)
- HSP Merchant API (HMAC-SHA256, ES256K JWT, EIP-712 mandates, webhooks)
- Blockscout for verification
- OpenAI (advisory only)
- Vercel + Railway + Supabase

## Coding rules
- Follow the current phase only.
- Do not modify unrelated files.
- Prefer small, typed, testable functions.
- Reuse shared types and schemas.
- Validate all external input.
- Treat on-chain and HSP rejection as authoritative.
- Never fabricate successful transactions or test results.
- Never log secrets, private keys, auth tokens, or sensitive wallet material.
- Use idempotency for money-moving operations.
- Use explicit state machines for mission lifecycle.
- Every payment path must go through HSP Gateway. No direct contract-to-ERC20 transfers.
- EIP-712 typed data is the sole signing primitive; no home-rolled signature schemes.
- Contract state transitions must include expected-version checks for race protection.

## Security rules
- Agent requests must be EIP-712-signed over the canonical SuccraRequest typed data (missionId, requestId, nonce, timestamp, methodHash, bodyHash).
- Reject replayed/stale requests.
- Scope every database query to the authenticated owner/resource.
- Keep Supabase service-role and guardian keys server-only.
- Never accept a client-provided `owner_id` as authorization.
- Never trust an LLM recommendation as authorization.
- Verify webhook authenticity and deduplicate events.
- Never expose arbitrary internal/private agent endpoint access.
- HSP webhook HMAC-SHA256 must be verified before any state change.
- EIP-712 signature must be verified against the registered agent address before preflight response.
- Signed mandate hash must match the preflighted mandate hash before submission to HSP Gateway.

## Testing rules
Every meaningful change must have appropriate unit/integration/contract/E2E tests. Before claiming completion, run the exact relevant commands and report actual results. Financial logic requires tests for duplicate requests, race conditions, budget exhaustion, stale state, unauthorized agents, and unauthorized merchants. Contract tests must cover on-chain policy enforcement for all preflight rejection paths.

## Git rules
- One logical phase/task per commit where practical.
- Use descriptive Conventional Commit messages.
- Never rewrite or squash another phase without authorization.
- A checkpoint is not complete until tests pass and changed files are inspected.

## Stop rules
STOP and report instead of deciding independently when:
- the specification appears contradictory;
- a requested change requires architecture changes;
- a security boundary would be weakened;
- an external dependency is unavailable or materially different;
- a test fails for a reason that changes product behavior;
- the next phase has not been explicitly assigned.

Never automatically proceed to the next implementation phase.

## Required completion report
At the end of each assigned task, report:
1. what was implemented;
2. files changed;
3. tests/commands run;
4. actual results;
5. known issues;
6. Git commit hash;
7. exact next task, without implementing it.
