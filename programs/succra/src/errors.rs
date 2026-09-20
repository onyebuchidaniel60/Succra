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
    // Phase 2: execute_action policy errors (PROJECT_SPEC.md FR-03).
    #[msg("Signer is not the mission's current agent.")]
    NotCurrentAgent,
    #[msg("Mission has expired.")]
    MissionExpired,
    #[msg("Action type is not in the mission allowlist.")]
    ActionTypeNotAllowed,
    #[msg("Recipient is not in the mission allowlist.")]
    RecipientNotAllowed,
    #[msg("Amount exceeds the mission per-action maximum.")]
    AmountExceedsMaxAction,
    #[msg("Amount exceeds the mission remaining budget.")]
    InsufficientBudget,
    #[msg("Action nonce is not strictly greater than the mission nonce.")]
    StaleNonce,
    #[msg("Asset type does not match the mission mint (SOL vs SPL).")]
    AssetMismatch,
    #[msg("SPL mission vault token account was not provided.")]
    MissingSplVault,
    #[msg("Required counterpart token account was not provided.")]
    MissingTokenAccount,
    #[msg("SPL vault token account does not belong to this mission.")]
    InvalidSplVault,
    #[msg("Token account mint does not match the mission mint.")]
    InvalidMint,
    #[msg("Token account owner is not the expected party.")]
    InvalidTokenAccountOwner,
    // Phase 5: quarantine errors (PROJECT_SPEC.md FR-04).
    #[msg("Signer is not the registered guardian.")]
    UnauthorizedGuardian,
}
