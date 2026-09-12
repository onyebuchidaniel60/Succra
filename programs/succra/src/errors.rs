use anchor_lang::prelude::*;

#[error_code]
pub enum SuccraError {
    #[msg("Mission budget must be greater than zero.")]
    InvalidBudget,
    #[msg("Max action must be greater than zero and at most the budget.")]
    InvalidMaxAction,
    #[msg("Recovery max action must not exceed the primary max action.")]
    InvalidRecoveryMaxAction,
    #[msg("At least one allowed action type is required.")]
    EmptyAllowedActionTypes,
    #[msg("Too many allowed action types for the Mission account size.")]
    TooManyAllowedActionTypes,
    #[msg("Too many allowed recipients for the Mission account size.")]
    TooManyAllowedRecipients,
    #[msg("Mission expiry must be in the future.")]
    ExpiryNotInFuture,
    #[msg("Mission is not in a state that permits this instruction.")]
    InvalidMissionStatus,
}
