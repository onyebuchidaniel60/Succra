# SUCCRA — AGENTS.md

## Project
Succra is a Robinhood Chain-native (EVM, x402 payments) continuity and authority layer for autonomous agent payment missions. Agents receive bounded execution authority over a mission; Succra can quarantine unsafe agents, preserve verified mission state, activate a pre-approved successor with restricted authority, and expose an audit trail. Funds remain in the owner's wallet; Succra controls authority, not custody.

## Source of truth
- `PROJECT_SPEC.md` controls product requirements.
- `ARCHITECTURE.md` controls architecture and technology decisions.
- `IMPLEMENTATION_PLAN.md` controls build sequence.
- `AI_HANDOFF.md` controls current session/task state.
- `SUCCRA_BLUEPRINT.md` is the complete design reference.

## Non-negotiable architecture invariants
1. Succra never modifies agent code.
2. Mission spending authority is controlled by the SuccraMission contract. Funds remain in the owner's wallet constrained by the mission's x402 offer policy. Succra does not custody.
3. The backend/database is not the source of truth for funds.
4. The SuccraMission contract is authoritative for mission authority and policy. The x402 facilitator is authoritative for payment execution and settlement. The database is never authoritative for either.
5. Guardian may quarantine or activate only pre-approved successors; guardian cannot spend mission funds.
6. Successors never inherit unrestricted authority.
7. AI output is advisory and cannot authorize money movement.
8. MVP payment adapters are limited to x402 EIP-3009 transferWithAuthorization settlement of USDG (default) or an allowlisted ERC-20 to allowlisted merchants. Native ETH is gas only.
9. No arbitrary ERC-20 transfers, no arbitrary contract calls, no direct ERC-20 path bypassing x402. Payments only via the x402 facilitator.
10. No new product feature may be added because it seems useful or impressive.

## Stack is fixed
- Next.js App Router + TypeScript + Tailwind
- wagmi + viem + WalletConnect for EVM wallets
- Supabase Auth + Postgres + RLS
- Node.js 24 + TypeScript runtime
- Solidity ^0.8.24 + Hardhat
- Robinhood Chain mainnet (chain ID 4663, RPC https://rpc.mainnet.chain.robinhood.com)
- x402 facilitator (HTTP 402 challenge/response, EIP-3009 transferWithAuthorization, receipt verification)
- USDG default settlement token (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`), allowlisted ERC-20 supported
- ERC-8004 optional agent identity
- Blockscout for verification (`https://robinhoodchain.blockscout.com`)
- OpenAI (advisory only)
- Vercel + Railway + Supabase

## Coding rules
- Follow the current phase only.
- Do not modify unrelated files.
- Prefer small, typed, testable functions.
- Reuse shared types and schemas.
- Validate all external input.
- Treat on-chain and x402 rejection as authoritative.
- Never fabricate successful transactions or test results.
- Never log secrets, private keys, auth tokens, or sensitive wallet material.
- Use idempotency for money-moving operations.
- Use explicit state machines for mission lifecycle.
- Every payment path must go through x402 facilitator. No direct contract-to-ERC20 transfers.
- EIP-712 typed data is the sole signing primitive; no home-rolled signature schemes.
- Contract state transitions must include expected-version checks for race protection.

## Security rules
- Agent requests must be EIP-712-signed over the canonical SuccraRequest typed data (missionId, requestId, nonce, timestamp, methodHash, bodyHash).
- Reject replayed/stale requests.
- Scope every database query to the authenticated owner/resource.
- Keep Supabase service-role and guardian keys server-only.
- Never accept a client-provided `owner_id` as authorization.
- Never trust an LLM recommendation as authorization.
- Verify x402 settlement receipts against the on-chain EIP-3009 Transfer log and deduplicate them. A receipt alone never confirms settlement.
- Never expose arbitrary internal/private agent endpoint access.
- The EIP-3009 authorization is signed by the owner/token holder; agents never hold mission funds or token signing keys.
- EIP-712 signature must be verified against the registered agent address before the preflight response.
- The signed EIP-3009 authorization hash and nonce must match the preflighted values before submission to the x402 facilitator.

## Testing rules
Every meaningful change must have appropriate unit/integration/contract/E2E tests. Before claiming completion, run the exact relevant commands and report actual results. Financial logic requires tests for duplicate requests, race conditions, budget exhaustion, stale state, unauthorized agents, and unauthorized merchants. Contract tests must cover on-chain policy enforcement for all preflight rejection paths. x402 integration tests must use a mock facilitator and verify EIP-3009 authorization binding, nonce replay, and settlement-receipt/Transfer-log matching.

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
