# `programs/succra` (Phase 1 — program foundation)

Mission/vault accounts with `create` / `fund` / `cancel` instructions
(Rust + Anchor 0.32.1 + Solana 2.3.0).

- `src/state.rs` — `Mission` account (owner, policy fields, status),
  `Vault` PDA account, `ActionType` (SOL/SPL only), `MissionStatus`
  (Draft/Active/Cancelled).
- `src/validation.rs` — pure FR-01 creation-time validation + host unit tests.
- `src/errors.rs` — explicit error codes.
- `src/lib.rs` — the three instructions with state-machine guards.
- `tests/succra.ts` — validator integration tests (create/fund/cancel,
  negative FR-01 cases, non-owner rejection, duplicate handling).

NOT in this phase (later phases per `IMPLEMENTATION_PLAN.md`): agent
identity, action execution/transfers, quarantine, succession, checkpoints,
guardian, SDK/runtime/DB/UI.

Toolchain pins (per `ARCHITECTURE.md` §9): Anchor 0.32.1, Solana 2.3.0.
Program ID `2DkVabKRQ3R8ZXtJkptAVvnWDm6DuhakhPqpvoVKsJeT` is the local
Phase-1 keypair (gitignored under `target/`); finalized at devnet deployment.
