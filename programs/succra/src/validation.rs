use crate::errors::SuccraError;
use crate::state::{ActionType, MissionStatus, MAX_ACTION_TYPES, MAX_ALLOWED_RECIPIENTS};
use anchor_lang::prelude::*;

/// DB defaults from ARCHITECTURE.md §7 `mission_policies`
/// (violation_threshold DEFAULT 3, violation_window_seconds DEFAULT 900).
/// Fixed at creation in Phase 1; counting/ enforcement arrive in Phase 5.
pub const DEFAULT_VIOLATION_THRESHOLD: u8 = 3;
pub const DEFAULT_VIOLATION_WINDOW_SECONDS: u64 = 900;

/// Creation-time validation for the Phase 1 field set, following
/// PROJECT_SPEC.md FR-01. Pure function so it is unit-testable on the
/// host target without a validator.
pub fn validate_create_params(
    budget: u64,
    max_action: u64,
    recovery_max_action: u64,
    action_types_len: usize,
    recipients_len: usize,
    expires_at: i64,
    now: i64,
) -> Result<()> {
    require!(budget > 0, SuccraError::InvalidBudget);
    require!(
        max_action > 0 && max_action <= budget,
        SuccraError::InvalidMaxAction
    );
    require!(
        recovery_max_action <= max_action,
        SuccraError::InvalidRecoveryMaxAction
    );
    require!(
        action_types_len > 0,
        SuccraError::EmptyAllowedActionTypes
    );
    require!(
        action_types_len <= MAX_ACTION_TYPES,
        SuccraError::TooManyAllowedActionTypes
    );
    require!(
        recipients_len <= MAX_ALLOWED_RECIPIENTS,
        SuccraError::TooManyAllowedRecipients
    );
    require!(expires_at > now, SuccraError::ExpiryNotInFuture);
    Ok(())
}

/// On-chain mission state needed for the FR-03 execution decision.
/// Passed by reference so the check stays a pure function, unit-testable
/// on the host target without a validator.
pub struct ExecutePolicy<'a> {
    pub status: MissionStatus,
    pub now: i64,
    pub expires_at: i64,
    pub agent: Pubkey,
    pub current_agent: Pubkey,
    pub allowed_action_types: &'a [ActionType],
    pub allowed_recipients: &'a [Pubkey],
    pub max_action: u64,
    pub remaining_budget: u64,
    pub agent_nonce: u64,
    /// Mission mint. `Pubkey::default()` denotes a native-SOL mission;
    /// any other value denotes an SPL mission (SPL vault interpretation
    /// documented on `Mission::mint`).
    pub mint: Pubkey,
    pub mission_key: Pubkey,
    pub vault_key: Pubkey,
}

/// Execution-time validation implementing PROJECT_SPEC.md FR-03 checks
/// #1–#7 and #9 plus the asset-path consistency rule (SOL actions move
/// native SOL, SPL actions move the mission mint). FR-03 check #8's
/// idempotency key is DB-side (Phase 4); the on-chain equivalent enforced
/// here is the strictly increasing `agent_nonce`. SPL token-account
/// wiring (presence, mint, authority) is checked by the instruction
/// handler, which owns the account context.
pub fn validate_execute_policy(
    policy: &ExecutePolicy,
    action_type: ActionType,
    recipient: Pubkey,
    amount: u64,
    nonce: u64,
) -> Result<()> {
    // FR-03 #1: mission is ACTIVE (no recovery states exist yet).
    require!(
        policy.status == MissionStatus::Active,
        SuccraError::InvalidMissionStatus
    );
    // FR-03 #2: signer is the current agent.
    require!(
        policy.agent == policy.current_agent,
        SuccraError::NotCurrentAgent
    );
    // FR-03 #7: mission not expired.
    require!(policy.now < policy.expires_at, SuccraError::MissionExpired);
    // FR-03 #3: action type allowed.
    require!(
        policy.allowed_action_types.contains(&action_type),
        SuccraError::ActionTypeNotAllowed
    );
    // FR-03 #4: recipient allowed. Program-owned mission/vault addresses
    // can never be legitimate destinations: paying them would move value
    // out of the spendable set while decrementing the budget.
    require!(
        policy.allowed_recipients.contains(&recipient),
        SuccraError::RecipientNotAllowed
    );
    require!(
        recipient != policy.vault_key && recipient != policy.mission_key,
        SuccraError::RecipientNotAllowed
    );
    // FR-03 #5: per-action ceiling.
    require!(
        amount <= policy.max_action,
        SuccraError::AmountExceedsMaxAction
    );
    // FR-03 #6: remaining budget covers the amount.
    require!(
        amount <= policy.remaining_budget,
        SuccraError::InsufficientBudget
    );
    // FR-03 #9 + vault model: the action asset must match the mission mint.
    let is_native = policy.mint == Pubkey::default();
    require!(
        (action_type == ActionType::TransferSol) == is_native,
        SuccraError::AssetMismatch
    );
    // FR-03 #8 (on-chain equivalent): strictly increasing nonce.
    require!(nonce > policy.agent_nonce, SuccraError::StaleNonce);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000;

    fn valid() -> (u64, u64, u64, usize, usize, i64) {
        (1_000_000, 100_000, 50_000, 2, 3, NOW + 3_600)
    }

    #[test]
    fn accepts_valid_params() {
        let (b, m, r, a, p, e) = valid();
        assert!(validate_create_params(b, m, r, a, p, e, NOW).is_ok());
    }

    #[test]
    fn rejects_zero_budget() {
        let (_, m, r, a, p, e) = valid();
        assert!(validate_create_params(0, m, r, a, p, e, NOW).is_err());
    }

    #[test]
    fn rejects_zero_max_action() {
        let (b, _, _, a, p, e) = valid();
        assert!(validate_create_params(b, 0, 0, a, p, e, NOW).is_err());
    }

    #[test]
    fn rejects_max_action_above_budget() {
        let (b, _, _, a, p, e) = valid();
        assert!(validate_create_params(b, b + 1, b, a, p, e, NOW).is_err());
    }

    #[test]
    fn accepts_max_action_equal_to_budget() {
        let (b, _, _, a, p, e) = valid();
        assert!(validate_create_params(b, b, b, a, p, e, NOW).is_ok());
    }

    #[test]
    fn rejects_recovery_max_above_primary_max() {
        let (b, m, _, a, p, e) = valid();
        assert!(validate_create_params(b, m, m + 1, a, p, e, NOW).is_err());
    }

    #[test]
    fn rejects_empty_action_types() {
        let (b, m, r, _, p, e) = valid();
        assert!(validate_create_params(b, m, r, 0, p, e, NOW).is_err());
    }

    #[test]
    fn rejects_too_many_action_types() {
        let (b, m, r, _, p, e) = valid();
        assert!(validate_create_params(b, m, r, MAX_ACTION_TYPES + 1, p, e, NOW).is_err());
    }

    #[test]
    fn rejects_too_many_recipients() {
        let (b, m, r, a, _, e) = valid();
        assert!(validate_create_params(b, m, r, a, MAX_ALLOWED_RECIPIENTS + 1, e, NOW).is_err());
    }

    #[test]
    fn rejects_past_expiry() {
        let (b, m, r, a, p, _) = valid();
        assert!(validate_create_params(b, m, r, a, p, NOW - 1, NOW).is_err());
    }

    #[test]
    fn rejects_expiry_equal_to_now() {
        let (b, m, r, a, p, _) = valid();
        assert!(validate_create_params(b, m, r, a, p, NOW, NOW).is_err());
    }

    fn execute_fixture() -> (
        ExecutePolicy<'static>,
        ActionType,
        Pubkey,
        u64,
        u64,
    ) {
        // Leaked once per test process; keeps the pure-function fixture
        // free of lifetime plumbing.
        let action_types: &'static [ActionType] =
            Box::leak(Box::new([ActionType::TransferSol]));
        let agent = Pubkey::new_unique();
        let recipient = Pubkey::new_unique();
        let recipients: &'static [Pubkey] = Box::leak(Box::new([recipient]));
        let policy = ExecutePolicy {
            status: MissionStatus::Active,
            now: NOW,
            expires_at: NOW + 3_600,
            agent,
            current_agent: agent,
            allowed_action_types: action_types,
            allowed_recipients: recipients,
            max_action: 100_000,
            remaining_budget: 1_000_000,
            agent_nonce: 7,
            mint: Pubkey::default(),
            mission_key: Pubkey::new_unique(),
            vault_key: Pubkey::new_unique(),
        };
        (policy, ActionType::TransferSol, recipient, 10_000, 8)
    }

    #[test]
    fn execute_accepts_valid_action() {
        let (p, t, r, a, n) = execute_fixture();
        assert!(validate_execute_policy(&p, t, r, a, n).is_ok());
    }

    #[test]
    fn execute_rejects_non_active_status() {
        let (mut p, t, r, a, n) = execute_fixture();
        for status in [MissionStatus::Draft, MissionStatus::Cancelled, MissionStatus::Quarantined] {
            p.status = status;
            assert!(validate_execute_policy(&p, t, r, a, n).is_err());
        }
    }

    #[test]
    fn execute_rejects_wrong_agent() {
        let (mut p, t, r, a, n) = execute_fixture();
        p.agent = Pubkey::new_unique();
        assert!(validate_execute_policy(&p, t, r, a, n).is_err());
    }

    #[test]
    fn execute_rejects_expired_mission() {
        let (mut p, t, r, a, n) = execute_fixture();
        p.now = p.expires_at;
        assert!(validate_execute_policy(&p, t, r, a, n).is_err());
    }

    #[test]
    fn execute_rejects_disallowed_action_type() {
        let (p, _, r, a, n) = execute_fixture();
        assert!(validate_execute_policy(&p, ActionType::TransferSpl, r, a, n).is_err());
    }

    #[test]
    fn execute_rejects_disallowed_recipient() {
        let (p, t, _, a, n) = execute_fixture();
        assert!(validate_execute_policy(&p, t, Pubkey::new_unique(), a, n).is_err());
    }

    #[test]
    fn execute_rejects_vault_or_mission_as_recipient() {
        let (p, t, _, a, n) = execute_fixture();
        assert!(validate_execute_policy(&p, t, p.vault_key, a, n).is_err());
        assert!(validate_execute_policy(&p, t, p.mission_key, a, n).is_err());
    }

    #[test]
    fn execute_rejects_amount_above_max_action() {
        let (p, t, r, _, n) = execute_fixture();
        assert!(validate_execute_policy(&p, t, r, p.max_action + 1, n).is_err());
    }

    #[test]
    fn execute_accepts_amount_equal_to_max_action() {
        let (p, t, r, _, n) = execute_fixture();
        assert!(validate_execute_policy(&p, t, r, p.max_action, n).is_ok());
    }

    #[test]
    fn execute_rejects_amount_above_remaining_budget() {
        let (mut p, t, r, _, n) = execute_fixture();
        p.remaining_budget = 5_000;
        assert!(validate_execute_policy(&p, t, r, 5_001, n).is_err());
    }

    #[test]
    fn execute_rejects_stale_or_reused_nonce() {
        let (p, t, r, a, _) = execute_fixture();
        assert!(validate_execute_policy(&p, t, r, a, p.agent_nonce).is_err());
        assert!(validate_execute_policy(&p, t, r, a, p.agent_nonce - 1).is_err());
    }

    #[test]
    fn execute_rejects_asset_mismatch() {
        // SPL action on a native mission.
        let (p, _, r, a, n) = execute_fixture();
        assert!(validate_execute_policy(&p, ActionType::TransferSpl, r, a, n).is_err());
        // SOL action on an SPL mission.
        let (mut p, t, rr, aa, nn) = execute_fixture();
        p.mint = Pubkey::new_unique();
        p.allowed_action_types =
            Box::leak(Box::new([ActionType::TransferSol, ActionType::TransferSpl]));
        assert!(validate_execute_policy(&p, t, rr, aa, nn).is_err());
    }

    #[test]
    fn execute_accepts_spl_action_on_spl_mission() {
        let (mut p, _, r, a, n) = execute_fixture();
        p.mint = Pubkey::new_unique();
        p.allowed_action_types = Box::leak(Box::new([ActionType::TransferSpl]));
        assert!(validate_execute_policy(&p, ActionType::TransferSpl, r, a, n).is_ok());
    }
}
