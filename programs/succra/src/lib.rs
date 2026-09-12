use anchor_lang::prelude::*;

declare_id!("2DkVabKRQ3R8ZXtJkptAVvnWDm6DuhakhPqpvoVKsJeT");

pub mod errors;
pub mod state;
pub mod validation;

use errors::SuccraError;
use state::{ActionType, Mission, MissionStatus, Vault};
use validation::{
    validate_create_params, DEFAULT_VIOLATION_THRESHOLD, DEFAULT_VIOLATION_WINDOW_SECONDS,
};

#[program]
pub mod succra {
    use super::*;

    /// Create a mission PDA and its program-controlled vault PDA.
    ///
    /// Post-state is DRAFT with `remaining_budget == 0`. Funding is a
    /// separate step (`fund`). Creation-time validation follows
    /// PROJECT_SPEC.md FR-01 for the Phase 1 field set; agent-related
    /// FR-01 rules (unique successors, primary != successor) belong to
    /// Phase 2+, when agent identity exists on-chain.
    pub fn create(
        ctx: Context<Create>,
        mission_id: u64,
        budget: u64,
        max_action: u64,
        recovery_max_action: u64,
        allowed_action_types: Vec<ActionType>,
        allowed_recipients: Vec<Pubkey>,
        mint: Pubkey,
        expires_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        validate_create_params(
            budget,
            max_action,
            recovery_max_action,
            allowed_action_types.len(),
            allowed_recipients.len(),
            expires_at,
            now,
        )?;

        let mission = &mut ctx.accounts.mission;
        mission.owner = ctx.accounts.owner.key();
        mission.mission_id = mission_id;
        mission.vault_bump = ctx.bumps.vault;
        mission.mint = mint;
        mission.budget = budget;
        mission.remaining_budget = 0;
        mission.max_action = max_action;
        mission.recovery_max_action = recovery_max_action;
        mission.allowed_action_types = allowed_action_types;
        mission.allowed_recipients = allowed_recipients;
        mission.expires_at = expires_at;
        mission.violation_threshold = DEFAULT_VIOLATION_THRESHOLD;
        mission.violation_window_seconds = DEFAULT_VIOLATION_WINDOW_SECONDS;
        mission.status = MissionStatus::Draft;
        Ok(())
    }

    /// Fund a DRAFT mission with exactly `budget` lamports of native SOL.
    ///
    /// Moves the mission DRAFT -> ACTIVE and sets `remaining_budget`.
    /// Only callable once: a second call fails with `InvalidMissionStatus`,
    /// which makes `fund` idempotent from the caller's perspective
    /// (retrying a confirmed funding is a safe no-op error, never a
    /// double-spend). Phase 1 moves native SOL only; SPL funding arrives
    /// with transfer execution in a later phase.
    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            mission.status == MissionStatus::Draft,
            SuccraError::InvalidMissionStatus
        );

        let amount = mission.budget;
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        mission.remaining_budget = mission.budget;
        mission.status = MissionStatus::Active;
        Ok(())
    }

    /// Cancel a DRAFT or ACTIVE mission and return all vault assets to
    /// the owner. Moves the mission to CANCELLED. Only callable once:
    /// a second call fails with `InvalidMissionStatus`.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let mission = &mut ctx.accounts.mission;
        require!(
            mission.status == MissionStatus::Draft || mission.status == MissionStatus::Active,
            SuccraError::InvalidMissionStatus
        );

        mission.status = MissionStatus::Cancelled;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(mission_id: u64)]
pub struct Create<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = Mission::LEN,
        seeds = [b"mission", owner.key().as_ref(), mission_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub mission: Account<'info, Mission>,
    #[account(
        init,
        payer = owner,
        space = Vault::LEN,
        seeds = [b"vault", mission.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub mission: Account<'info, Mission>,
    #[account(
        mut,
        seeds = [b"vault", mission.key().as_ref()],
        bump = mission.vault_bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub mission: Account<'info, Mission>,
    #[account(
        mut,
        seeds = [b"vault", mission.key().as_ref()],
        bump = mission.vault_bump,
        close = owner,
    )]
    pub vault: Account<'info, Vault>,
}
