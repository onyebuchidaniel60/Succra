# SUCCRA — AGENTS.md

## Project
Succra is a Solana-native mission continuity layer for autonomous economic agents. Agents receive bounded execution authority over a mission; Succra can quarantine unsafe agents, preserve verified mission state, activate a pre-approved successor with restricted authority, and expose an audit trail.

## Source of truth
- `PROJECT_SPEC.md` controls product requirements.
- `ARCHITECTURE.md` controls architecture and technology decisions.
- `IMPLEMENTATION_PLAN.md` controls build sequence.
- `AI_HANDOFF.md` controls current session/task state.
- `SUCCRA_BLUEPRINT.md` is the complete design reference.

## Non-negotiable architecture invariants
1. Succra never modifies agent code.
2. Mission assets are controlled by the Succra Solana program, never an agent private key.
3. The backend/database is not the source of truth for funds.
4. The on-chain program is authoritative for mission status, limits, budget and execution.
5. Guardian may quarantine or activate only pre-approved successors; guardian cannot spend mission funds.
6. Successors never inherit unrestricted authority.
7. AI output is advisory and cannot authorize money movement.
8. MVP action adapters are limited to SOL and SPL token transfers to allowlisted recipients.
9. No arbitrary CPI/instruction router may be introduced without explicit human approval.
10. No new product feature may be added because it seems useful or impressive.

## Stack is fixed
- Next.js App Router + TypeScript + Tailwind
- `@solana/kit` + Solana React hooks
- Supabase Auth + Postgres + RLS
- Node.js 24 + TypeScript runtime
- Rust + Anchor 0.32.1 + Solana 2.3.0 for the program
- Helius RPC/Webhooks
- OpenAI only as a non-authoritative recommendation layer
- Vercel + Railway + Supabase

## Coding rules
- Follow the current phase only.
- Do not modify unrelated files.
- Prefer small, typed, testable functions.
- Reuse shared types and schemas.
- Validate all external input.
- Treat on-chain rejection as authoritative.
- Never fabricate successful transactions or test results.
- Never log secrets, private keys, auth tokens, or sensitive wallet material.
- Use idempotency for money-moving operations.
- Use explicit state machines for mission lifecycle.

## Security rules
- Agent requests must be Ed25519-signed with timestamp + nonce + mission ID + canonical payload.
- Reject replayed/stale requests.
- Scope every database query to the authenticated owner/resource.
- Keep Supabase service-role and guardian keys server-only.
- Never accept a client-provided `owner_id` as authorization.
- Never trust an LLM recommendation as authorization.
- Verify webhook authenticity and deduplicate events.
- Never expose arbitrary internal/private agent endpoint access.

## Testing rules
Every meaningful change must have appropriate unit/integration/program/E2E tests. Before claiming completion, run the exact relevant commands and report actual results. Financial logic requires tests for duplicate requests, race conditions, budget exhaustion, stale state, unauthorized agents, and unauthorized recipients.

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
