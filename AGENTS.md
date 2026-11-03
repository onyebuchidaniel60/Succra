# SUCCRA — AGENTS.md

## Project
Succra is a Robinhood Chain-native (EVM, x402 payments) continuity and authority layer for autonomous economic missions. Agents receive bounded execution authority over a mission; Succra can quarantine unsafe agents, preserve verified mission state, activate a pre-approved successor with restricted authority, and expose an audit trail. Mission funds are held by the SuccraMission contract; the owner can withdraw them unilaterally at any time. Succra controls authority and policy, not owner signing keys.

## Source of truth
- `PROJECT_SPEC.md` controls product requirements.
- `ARCHITECTURE.md` controls architecture and technology decisions.
- `IMPLEMENTATION_PLAN.md` controls build sequence.
- `AI_HANDOFF.md` controls current session/task state.
- `SUCCRA_BLUEPRINT.md` is the complete design reference.

## Non-negotiable architecture invariants
1. Succra never modifies agent code.
2. Mission funds are held by the SuccraMission contract. The owner can withdraw all funds at any time without agent or guardian cooperation. Succra does not hold private keys to the mission contract; policy enforcement is on-chain. The contract acts as the EIP-3009 token holder (directly via ERC-1271 in Variant A, or by releasing exact amounts to a session key in Variant B — whichever R1-spike validates).
3. The backend/database is not the source of truth for funds.
4. The SuccraMission contract is authoritative for mission authority and policy. The x402 facilitator is authoritative for payment execution and settlement. The database is never authoritative for either.
5. Guardian may quarantine or activate only pre-approved successors; guardian cannot spend mission funds.
6. Successors never inherit unrestricted authority.
7. AI output is advisory and cannot authorize money movement.
8. MVP payment adapters are limited to x402 EIP-3009 transferWithAuthorization settlement of USDG (default) or an allowlisted ERC-20 to allowlisted merchants, with SuccraMission as the `from` (Variant A) or a session key funded on-demand by SuccraMission (Variant B). Native ETH is gas only.
9. No arbitrary ERC-20 transfers, no arbitrary contract calls, no direct ERC-20 path bypassing x402. Payments only via the x402 facilitator. Variant B's `releaseForPayment` is a bounded internal funding step for the session key, not a merchant payment path.
10. No new product feature may be added because it seems useful or impressive.

The runtime-held session key is a scoped EIP-3009 signer, not an owner/admin key to the contract; it cannot withdraw, change policy, or change successors.

## Stack is fixed
- Next.js App Router + TypeScript + Tailwind
- wagmi + viem + WalletConnect for EVM wallets
- Supabase Auth + Postgres + RLS
- Node.js 24 + TypeScript runtime
- Solidity ^0.8.24 + Hardhat
- Robinhood Chain mainnet (chain ID 4663, RPC https://rpc.mainnet.chain.robinhood.com)
- x402 facilitator (HTTP 402 challenge/response, EIP-3009 transferWithAuthorization, receipt verification)
- USDG default settlement token (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`), allowlisted ERC-20 supported
- SuccraMission holds mission USDG; ERC-20 deposit/withdraw
- Session key management (registration, rotation, revocation)
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
- EIP-3009 authorization is signed by a session key registered by the owner at mission creation and held server-side by the Succra runtime. The session key's signature is validated by the SuccraMission contract (Variant A: via ERC-1271 with an approved-hash mapping) or by the token's ecrecover (Variant B: session key is the direct EOA signer, funded on-demand). Agents never hold the session key or any private key to mission funds. The owner can withdraw remaining funds at any time, even if the session key is compromised.
- EIP-712 signature must be verified against the registered agent address before the preflight response.
- The signed EIP-3009 authorization hash and nonce must match the preflighted values before submission to the x402 facilitator.

## Testing rules
Every meaningful change must have appropriate unit/integration/contract/E2E tests. Before claiming completion, run the exact relevant commands and report actual results. Financial logic requires tests for duplicate requests, race conditions, budget exhaustion, stale state, unauthorized agents, and unauthorized merchants. Contract tests must cover on-chain policy enforcement for all preflight rejection paths. x402 integration tests must use a mock facilitator and verify EIP-3009 authorization binding, nonce replay, and settlement-receipt/Transfer-log matching.

Contract tests must cover:
- owner deposit and withdrawal (unilateral, no cooperation needed)
- session key registration at creation
- session key revocation on quarantine
- session key rotation on succession with reduced cap
- payment reverts when session key is revoked
- Variant A: approvedHashes validation
- Variant B: releaseForPayment amount accuracy

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
