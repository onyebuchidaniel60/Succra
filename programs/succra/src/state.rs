use anchor_lang::prelude::*;

/// Phase 1 account-sizing bounds. These cap dynamic fields so the Mission
/// account has a fixed size. They are technical bounds, not product policy:
/// allowlists beyond these lengths are rejected at creation with an
/// explicit error rather than failing silently.
pub const MAX_ACTION_TYPES: usize = 8;
pub const MAX_ALLOWED_RECIPIENTS: usize = 16;

/// Mission account: on-chain authority for status, limits, and budget
/// (AGENTS.md invariant #4). Derived from ARCHITECTURE.md §7 `missions`
/// + `mission_policies`, minus DB-side fields (UUIDs, owner_id FK,
/// timestamps, PDA/vault address strings, policy version/hash mirrors).
/// Agent-related fields (current agent, successor set) arrive in Phase 2+.
#[account]
pub struct Mission {
    /// Wallet that created the mission; sole authority for fund/cancel.
    pub owner: Pubkey,
    /// Client-chosen uniqueness scope for the mission PDA.
    pub mission_id: u64,
    /// Bump of the program-controlled vault PDA.
    pub vault_bump: u8,
    /// SPL mint for the mission (missions.mint_address). Recorded at
    /// creation; SPL movement arrives with transfer execution later.
    pub mint: Pubkey,
    /// Total mission budget in lamports / base units.
    pub budget: u64,
    /// Spendable remainder. 0 in DRAFT; set to `budget` by `fund`.
    pub remaining_budget: u64,
    /// Per-action ceiling (mission_policies.max_action_atomic).
    pub max_action: u64,
    /// Successor per-action ceiling (recovery_max_action_atomic).
    /// Enforced now (FR-01: recovery max <= primary max); applied in Phase 6.
    pub recovery_max_action: u64,
    /// MVP action types (mission_policies.allowed_action_types).
    pub allowed_action_types: Vec<ActionType>,
    /// Transfer allowlist (mission_policies.allowed_recipients).
    pub allowed_recipients: Vec<Pubkey>,
    /// Mission expiry as unix timestamp (missions.expires_at).
    pub expires_at: i64,
    /// Consecutive-violation trigger (DB default 3). Counted in Phase 5.
    pub violation_threshold: u8,
    /// Violation window in seconds (DB default 900). Applied in Phase 5.
    pub violation_window_seconds: u64,
    /// Lifecycle state. Phase 1 subset of the PROJECT_SPEC.md §6 machine.
    pub status: MissionStatus,
}

impl Mission {
    pub const LEN: usize = 8
        + 32 // owner
        + 8 // mission_id
        + 1 // vault_bump
        + 32 // mint
        + 8 // budget
        + 8 // remaining_budget
        + 8 // max_action
        + 8 // recovery_max_action
        + (4 + MAX_ACTION_TYPES) // allowed_action_types (unit enum = 1 byte)
        + (4 + 32 * MAX_ALLOWED_RECIPIENTS) // allowed_recipients
        + 8 // expires_at
        + 1 // violation_threshold
        + 8 // violation_window_seconds
        + 1; // status
}

/// MVP action adapters (PROJECT_SPEC.md FR-03, AGENTS.md invariant #8).
/// Fixed set: no other action type is representable, so no arbitrary
/// instruction router can be expressed through mission policy.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ActionType {
    TransferSol,
    TransferSpl,
}

/// Phase 1 subset of the PROJECT_SPEC.md §6 mission state machine.
/// Later phases extend this enum as their transitions land.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MissionStatus {
    /// Created, not yet funded. Only `fund` or `cancel` may follow.
    Draft,
    /// Funded. Only `cancel` may follow in Phase 1.
    Active,
    /// Terminal. Vault closed, assets returned to owner.
    Cancelled,
}

/// Program-controlled vault PDA (ARCHITECTURE.md §8, §18). Holds native
/// SOL in Phase 1. No private key exists; only the program can move
/// funds, via `close` on cancel (later: constrained transfers).
#[account]
pub struct Vault {}

impl Vault {
    pub const LEN: usize = 8;
}
