use crate::errors::SuccraError;
use crate::state::{MAX_ACTION_TYPES, MAX_ALLOWED_RECIPIENTS};
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
}
