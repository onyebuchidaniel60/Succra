# 24. PHASED IMPLEMENTATION PLAN

## Phase 0 — Repository foundation
Objective: create workspace, documentation files, lint/test commands, environment example.

Acceptance:
- monorepo boots;
- no feature logic;
- lint/test/build commands exist;
- checkpoint commit.

## Phase 1 — Solana program foundation
Tasks:
- mission account;
- vault account;
- policy fields;
- create/fund/cancel;
- basic program tests.

Acceptance: owner can create/fund/cancel mission on local validator/devnet test path.

## Phase 2 — Secure action execution
Tasks:
- agent identity;
- current agent field;
- action nonce;
- SOL/SPL transfer instruction;
- budget/max-action/recipient checks.

Acceptance: valid action succeeds; all policy violations fail on-chain.

## Phase 3 — Web auth + database
Tasks:
- Supabase auth;
- profiles;
- missions/policies/agents tables;
- RLS;
- dashboard read path.

Acceptance: user A cannot read/update user B's private mission data.

## Phase 4 — Succra SDK + agent gateway
Tasks:
- signed request format;
- agent registration;
- heartbeat;
- action submission;
- idempotency.

Acceptance: reference Alpha agent can request a transfer and receive authoritative decision/tx result.

## Phase 5 — Guardian + quarantine
Tasks:
- violation counter;
- 3-violation trigger;
- guardian signer;
- on-chain quarantine;
- timeline events: writes audit_events rows for quarantine-related events (violation counted, threshold reached, quarantine submitted, quarantine confirmed).

Acceptance: three authenticated policy violations cause one quarantine and prevent further actions.

## Phase 6 — Checkpoints + succession
Tasks:
- verified checkpoint schema (`state_snapshot` per the FR-07 amendment; `VERIFIED` on every CONFIRMED action plus `sequence=0` at activation);
- checkpoint hashing (canonical Borsh preimage per ARCHITECTURE.md §10; hex SHA-256);
- successor eligibility (priority lower-wins, on-chain-list tie-break, AVAILABLE + capability superset);
- activate_successor instruction (guardian-signed; membership + eligibility + state_version check; sets current_agent; bumps state_version; emits event);
- acknowledge_recovery instruction (guardian-signed; `RECOVERING` → `ACTIVE_RECOVERY`; bumps state_version; emits event);
- new MissionStatus variants Recovering and ActiveRecovery;
- state-dependent per-action ceiling in validate_execute_policy;
- state_version field (0 at creation, bumped on every status transition);
- successors list on the Mission account (Vec<Pubkey> ≤8, unique, primary excluded; create() extended — breaking change);
- cancel() extended to Draft, Active, Quarantined, Recovering, ActiveRecovery;
- gateway decoder + evaluatePolicy updates for the new states (deployed together with the program);
- new tables mission_checkpoints and succession_events with owner RLS;
- new endpoints POST /api/missions/:id/succession, POST /api/missions/:id/succession/:successionId/acknowledge, POST /api/missions/:id/checkpoints;
- Phase 6 audit writes (checkpoint.verified, succession.* per the FR-08 amendment).

Acceptance: Beta becomes current agent with lower authority and can continue (`ActiveRecovery` ceiling = `recovery_max_action`, enforced on-chain).

Phase 9 defers: on-chain checkpoint hash commitment (SHOULD-HAVE #4; `committed_signature` stays NULL) and the pre-Phase-6 `GUARDIAN_PUBKEY` coverage gap.

## Phase 7 — Audit + polished UX
Tasks:
- timeline: displays audit_events as the mission timeline UI (reads only; no writes to audit_events);
- decision receipt;
- Solana proof links;
- succession visualization;
- error/empty/loading states.

Acceptance: full lifecycle can be understood without developer terminology.

Note: the timeline reads the Phase 6 audit events (checkpoint.verified, succession.*) alongside Phase 5 events; Phase 7 writes no audit rows.

## Phase 8 — AI advisory layer
Tasks:
- candidate explanation;
- structured output;
- deterministic eligibility gate;
- fallback.

Acceptance: AI cannot authorize an ineligible successor.

## Phase 9 — E2E/security hardening
Tasks:
- full golden-path E2E;
- race tests;
- replay tests;
- IDOR/security review;
- webhook replay tests;
- deployment.

Acceptance: all required tests pass and production checklist is complete.

## Phase 10 — Hackathon deployment/demo
Tasks:
- devnet rehearsal;
- mainnet readiness review;
- small-capital live demo if approved;
- tokenization; public site; demo recording.

The AnsemHack Clawrena requires registration and tokenization by **20 September 2026 at 23:59 UTC**; the official page also emphasizes on-chain volume, attention, and deploying early. citeturn179862search0turn179862search1

Every phase follows the supplied workflow: implement one phase, test, inspect, fix, commit, record checkpoint, and stop before proceeding. fileciteturn0file0L216-L237

---

