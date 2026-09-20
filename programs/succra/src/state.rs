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
/// Agent identity (`current_agent`, `agent_nonce`) arrived in Phase 2;
/// successor/guardian fields arrive with Phases 5/6.
#[account]
pub struct Mission {
    /// Wallet that created the mission; sole authority for fund/cancel.
    pub owner: Pubkey,
    /// Client-chosen uniqueness scope for the mission PDA.
    pub mission_id: u64,
    /// Bump of the program-controlled vault PDA.
    pub vault_bump: u8,
    /// SPL mint for the mission (missions.mint_address). `Pubkey::default()`
    /// denotes a native-SOL mission; any other value denotes an SPL mission
    /// whose value lives in the `spl-vault` token account.
    pub mint: Pubkey,
    /// Total mission budget in lamports / base units.
    pub budget: u64,
    /// Spendable remainder. 0 in DRAFT; set to `budget` by funding.
    pub remaining_budget: u64,
    /// Per-action ceiling (mission_policies.max_action_atomic).
    pub max_action: u64,
    /// Successor per-action ceiling (recovery_max_action_atomic).
    /// Validated at creation (FR-01); enforced in Phase 6, not Phase 2.
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
    /// Lifecycle state. Draft/Active/Cancelled subset of the
    /// PROJECT_SPEC.md §6 machine; Quarantined arrives in Phase 5
    /// (ACTIVE → QUARANTINED only), later phases extend transitions.
    pub status: MissionStatus,
    /// Agent currently authorized to execute mission actions (FR-01
    /// "primary agent" input; ARCHITECTURE.md §7 `current_agent_public_key`).
    /// Set at creation. Only this key may sign `execute_action`.
    pub current_agent: Pubkey,
    /// Strictly increasing action counter (ARCHITECTURE.md §11: program
    /// rejects stale/non-sequential action nonces). Starts at 0; each
    /// `execute_action` must carry a strictly greater nonce, which becomes
    /// the new value. This is the on-chain replay/idempotency mechanism
    /// (DB idempotency keys arrive in Phase 4).
    pub agent_nonce: u64,
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
        + 1 // status
        + 32 // current_agent (Phase 2)
        + 8; // agent_nonce (Phase 2)
}

/// MVP action adapters (PROJECT_SPEC.md FR-03, AGENTS.md invariant #8).
/// Fixed set: no other action type is representable, so no arbitrary
/// instruction router can be expressed through mission policy.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ActionType {
    TransferSol,
    TransferSpl,
}

/// Draft/Active/Cancelled subset of the PROJECT_SPEC.md §6 mission state
/// machine, plus Quarantined (Phase 5: ACTIVE → QUARANTINED only).
/// Later phases extend this enum as their transitions land.
/// The Quarantined variant is appended last so existing discriminants
/// (Draft = 0, Active = 1, Cancelled = 2) never shift.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MissionStatus {
    /// Created, not yet funded. Only funding or `cancel` may follow.
    Draft,
    /// Funded and executable. `execute_action` and `cancel` may follow.
    Active,
    /// Terminal. Vault closed, assets returned to owner.
    Cancelled,
    /// Frozen by the guardian after the violation threshold.
    /// Non-executable: only succession (Phase 6) or cancel may follow.
    /// Set only by `quarantine`, which requires an ACTIVE mission and
    /// the registered guardian's signature.
    Quarantined,
}

/// Program-controlled vault PDA (ARCHITECTURE.md §8, §18). A native
/// system account with no data, so it can send SOL via the System Program.
/// Holds native SOL for SOL missions (and the rent reserve plus token
/// authority for SPL missions). No private key exists; only the program
/// can move funds, via `invoke_signed`.
///
/// NOTE: the vault is deliberately NOT an Anchor data account. The System
/// Program rejects transfers whose source carries data, so a
/// program-owned data account could never send SOL. Client code treats
/// the vault as a plain system PDA (`SystemAccount` on the client).
pub struct Vault {}

/// Emitted when the guardian freezes a mission. This is the Phase 5
/// on-chain proof of quarantine; the gateway mirrors it into the DB
/// and writes audit rows around submission and confirmation.
#[event]
pub struct MissionQuarantined {
    pub mission_id: u64,
    pub guardian: Pubkey,
}

/// Emitted after every successful `execute_action`. This is the Phase 2
/// on-chain proof of execution; richer audit anchoring arrives with the
/// phase that introduces on-chain audit events.
#[event]
pub struct ActionExecuted {
    pub mission_id: u64,
    pub agent: Pubkey,
    pub action_type: ActionType,
    pub recipient: Pubkey,
    pub amount: u64,
    pub new_nonce: u64,
    pub remaining_budget_after: u64,
}
