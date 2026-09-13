use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("2DkVabKRQ3R8ZXtJkptAVvnWDm6DuhakhPqpvoVKsJeT");

pub mod errors;
pub mod state;
pub mod validation;

use errors::SuccraError;
use state::{ActionExecuted, ActionType, Mission, MissionStatus};
use validation::{
    validate_create_params, validate_execute_policy, ExecutePolicy,
    DEFAULT_VIOLATION_THRESHOLD, DEFAULT_VIOLATION_WINDOW_SECONDS,
};

/// SPL vault PDA seeds, shared by every instruction that touches the
/// token vault.
const SPL_VAULT_SEEDS_PREFIX: &[u8] = b"spl-vault";

/// Resolve and validate the mission SPL token vault from an unchecked
/// account.
///
/// Background: the TS client auto-derives PDA accounts, so a typed
/// `Option<Account<TokenAccount>>` would be auto-filled (and fail
/// deserialization) even on SOL missions that have no token vault. The
/// account is therefore taken unchecked and validated here: correct PDA
/// derivation first, then token-account shape.
fn load_spl_vault(spl_vault: &AccountInfo, mission_key: &Pubkey) -> Result<TokenAccount> {
    let (expected, _) =
        Pubkey::find_program_address(&[SPL_VAULT_SEEDS_PREFIX, mission_key.as_ref()], &crate::ID);
    require!(
        spl_vault.key() == expected,
        SuccraError::InvalidSplVault
    );
    let data = spl_vault
        .try_borrow_data()
        .map_err(|_| SuccraError::InvalidSplVault)?;
    TokenAccount::try_deserialize(&mut &data[..]).map_err(|_| SuccraError::InvalidSplVault.into())
}

#[program]
pub mod succra {
    use super::*;

    /// Create a mission PDA and its program-controlled vault PDA.
    ///
    /// Post-state is DRAFT with `remaining_budget == 0` and
    /// `agent_nonce == 0`. Funding is a separate step (`fund` for native
    /// SOL missions, `fund_spl` for SPL missions). Creation-time validation
    /// follows PROJECT_SPEC.md FR-01; successor-related FR-01 rules belong
    /// to Phase 6, when successors exist on-chain.
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
        current_agent: Pubkey,
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
        mission.vault_bump = ctx.bumps.vault;        mission.mint = mint;
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
        mission.current_agent = current_agent;
        mission.agent_nonce = 0;

        // Create the native system vault PDA by funding its rent reserve.
        // Anchor cannot `init` a system-owned account, so the vault is
        // created here with an explicit transfer (a transfer to a new
        // address creates a data-less system account). The owner pays.
        let reserve = Rent::get()?.minimum_balance(0);
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            reserve,
        )?;
        Ok(())
    }

    /// Fund a DRAFT native-SOL mission with exactly `budget` lamports.
    ///
    /// Moves the mission DRAFT -> ACTIVE and sets `remaining_budget`.
    /// Only callable once: a second call fails with `InvalidMissionStatus`,
    /// which makes `fund` idempotent from the caller's perspective
    /// (retrying a confirmed funding is a safe no-op error, never a
    /// double-spend). Rejects SPL missions; they use `fund_spl`.
    pub fn fund(ctx: Context<Fund>) -> Result<()> {
        let mission = &ctx.accounts.mission;
        require!(
            mission.status == MissionStatus::Draft,
            SuccraError::InvalidMissionStatus
        );
        require!(
            mission.mint == Pubkey::default(),
            SuccraError::AssetMismatch
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

        let mission = &mut ctx.accounts.mission;
        mission.remaining_budget = mission.budget;
        mission.status = MissionStatus::Active;
        Ok(())
    }

    /// Fund a DRAFT SPL mission with exactly `budget` base units of the
    /// mission mint, creating its program-controlled token vault.
    ///
    /// Same single-use, exact-match semantics as `fund`. Rejects native
    /// SOL missions; they use `fund`.
    pub fn fund_spl(ctx: Context<FundSpl>) -> Result<()> {
        let mission = &ctx.accounts.mission;
        require!(
            mission.status == MissionStatus::Draft,
            SuccraError::InvalidMissionStatus
        );
        require!(
            mission.mint != Pubkey::default(),
            SuccraError::AssetMismatch
        );

        let amount = mission.budget;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.owner_token_account.to_account_info(),
                    to: ctx.accounts.spl_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
        )?;

        let mission = &mut ctx.accounts.mission;
        mission.remaining_budget = mission.budget;
        mission.status = MissionStatus::Active;
        Ok(())
    }

    /// Execute one authorized action from the mission vault.
    ///
    /// Implements the PROJECT_SPEC.md FR-03 decision checks on-chain; the
    /// program rejects violations instead of warning. On success it moves
    /// value via the System or Token program with the vault PDA signing
    /// through `invoke_signed`, decrements `remaining_budget`, advances
    /// `agent_nonce` to the submitted nonce, and emits `ActionExecuted`.
    /// Status remains ACTIVE. Only the current agent may sign.
    pub fn execute_action(
        ctx: Context<ExecuteAction>,
        action_type: ActionType,
        recipient: Pubkey,
        amount: u64,
        nonce: u64,
    ) -> Result<()> {
        let mission_key = ctx.accounts.mission.key();
        let vault_key = ctx.accounts.vault.key();
        let vault_bump = ctx.accounts.mission.vault_bump;
        let now = Clock::get()?.unix_timestamp;
        {
            let mission = &ctx.accounts.mission;
            let policy = ExecutePolicy {
                status: mission.status,
                now,
                expires_at: mission.expires_at,
                agent: ctx.accounts.agent.key(),
                current_agent: mission.current_agent,
                allowed_action_types: &mission.allowed_action_types,
                allowed_recipients: &mission.allowed_recipients,
                max_action: mission.max_action,
                remaining_budget: mission.remaining_budget,
                agent_nonce: mission.agent_nonce,
                mint: mission.mint,
                mission_key,
                vault_key,
            };
            validate_execute_policy(&policy, action_type, recipient, amount, nonce)?;
        }

        let vault_seeds: &[&[u8]] = &[b"vault", mission_key.as_ref(), &[vault_bump]];
        match action_type {
            ActionType::TransferSol => {
                anchor_lang::system_program::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.vault.to_account_info(),
                            to: ctx.accounts.recipient_account.to_account_info(),
                        },
                        &[vault_seeds],
                    ),
                    amount,
                )?;
            }
            ActionType::TransferSpl => {
                let spl_vault_info = ctx
                    .accounts
                    .spl_vault
                    .as_ref()
                    .ok_or(SuccraError::MissingSplVault)?;
                let spl_vault = load_spl_vault(spl_vault_info, &mission_key)?;
                let mission = &ctx.accounts.mission;
                require!(spl_vault.mint == mission.mint, SuccraError::InvalidMint);
                require!(
                    spl_vault.owner == vault_key,
                    SuccraError::InvalidSplVault
                );
                let destination = ctx
                    .accounts
                    .recipient_token_account
                    .as_ref()
                    .ok_or(SuccraError::MissingTokenAccount)?;
                require!(
                    destination.mint == mission.mint,
                    SuccraError::InvalidMint
                );
                require!(
                    destination.owner == recipient,
                    SuccraError::RecipientNotAllowed
                );
                require!(
                    destination.key() != spl_vault_info.key(),
                    SuccraError::RecipientNotAllowed
                );
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: spl_vault_info.to_account_info(),
                            to: destination.to_account_info(),
                            authority: ctx.accounts.vault.to_account_info(),
                        },
                        &[vault_seeds],
                    ),
                    amount,
                )?;
            }
        }

        let mission = &mut ctx.accounts.mission;
        mission.remaining_budget = mission
            .remaining_budget
            .checked_sub(amount)
            .ok_or(SuccraError::InsufficientBudget)?;
        mission.agent_nonce = nonce;
        emit!(ActionExecuted {
            mission_id: mission.mission_id,
            agent: ctx.accounts.agent.key(),
            action_type,
            recipient,
            amount,
            new_nonce: nonce,
            remaining_budget_after: mission.remaining_budget,
        });
        Ok(())
    }

    /// Cancel a DRAFT or ACTIVE mission and return all vault assets to
    /// the owner (native SOL by draining the vault to zero, which deletes
    /// it; mission SPL tokens via transfer plus token-vault close). Moves the mission to CANCELLED.
    /// Authority and transition rules are unchanged from Phase 1; only
    /// SPL asset coverage is added. Only callable once: a second call
    /// fails with `InvalidMissionStatus` (or account resolution, since
    /// the vaults are closed).
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let mission_key = ctx.accounts.mission.key();
        let vault_key = ctx.accounts.vault.key();
        let vault_bump = ctx.accounts.mission.vault_bump;
        let mission = &ctx.accounts.mission;
        require!(
            mission.status == MissionStatus::Draft || mission.status == MissionStatus::Active,
            SuccraError::InvalidMissionStatus
        );

        // SPL missions funded via `fund_spl` hold value in the token vault.
        // DRAFT missions never hold SPL tokens (funding flips to ACTIVE
        // atomically), so there is nothing to refund before activation.
        let vault_seeds: &[&[u8]] = &[b"vault", mission_key.as_ref(), &[vault_bump]];
        if mission.mint != Pubkey::default() && mission.status == MissionStatus::Active {
            let spl_vault_info = ctx
                .accounts
                .spl_vault
                .as_ref()
                .ok_or(SuccraError::MissingSplVault)?;
            let spl_vault = load_spl_vault(spl_vault_info, &mission_key)?;
            let owner_token = ctx
                .accounts
                .owner_token_account
                .as_ref()
                .ok_or(SuccraError::MissingTokenAccount)?;
            require!(spl_vault.mint == mission.mint, SuccraError::InvalidMint);
            require!(
                spl_vault.owner == vault_key,
                SuccraError::InvalidSplVault
            );
            require!(
                owner_token.mint == mission.mint,
                SuccraError::InvalidMint
            );
            require!(
                owner_token.owner == mission.owner,
                SuccraError::InvalidTokenAccountOwner
            );
            let refund = spl_vault.amount;
            if refund > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: spl_vault_info.to_account_info(),
                            to: owner_token.to_account_info(),
                            authority: ctx.accounts.vault.to_account_info(),
                        },
                        &[vault_seeds],
                    ),
                    refund,
                )?;
            }
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: spl_vault_info.to_account_info(),
                    destination: ctx.accounts.owner.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[vault_seeds],
            ))?;
        }

        // Return every lamport in the native vault to the owner. Draining
        // to zero deletes the account, which is the system-PDA equivalent
        // of closing it.
        let vault_balance = **ctx.accounts.vault.try_borrow_lamports()?;
        if vault_balance > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.owner.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                vault_balance,
            )?;
        }

        ctx.accounts.mission.status = MissionStatus::Cancelled;
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
        mut,
        seeds = [b"vault", mission.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
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
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundSpl<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner)]
    pub mission: Account<'info, Mission>,
    #[account(
        seeds = [b"vault", mission.key().as_ref()],
        bump = mission.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        init,
        payer = owner,
        seeds = [b"spl-vault", mission.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault,
    )]
    pub spl_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(address = mission.mint)]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteAction<'info> {
    pub agent: Signer<'info>,
    #[account(mut)]
    pub mission: Account<'info, Mission>,
    /// CHECK: transfer destination. Unused on the SPL path. Validated
    /// against the allowlist (and against the mission/vault addresses)
    /// in the handler; must be mutable to receive lamports on SOL path.
    #[account(mut)]
    pub recipient_account: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", mission.key().as_ref()],
        bump = mission.vault_bump,
    )]
    pub vault: SystemAccount<'info>,
    /// CHECK: mission SPL token vault. Taken unchecked (and only touched
    /// on the SPL path) because the client auto-derives PDA accounts: a
    /// typed token account here would fail deserialization on SOL missions
    /// that have no token vault. The handler verifies PDA derivation and
    /// token shape via `load_spl_vault`. Must be writable: the SPL path
    /// debits this account via token::transfer.
    #[account(mut)]
    pub spl_vault: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub recipient_token_account: Option<Account<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
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
    )]
    pub vault: SystemAccount<'info>,
    /// CHECK: mission SPL token vault (see `ExecuteAction::spl_vault`).
    /// Only touched on the SPL path of ACTIVE SPL missions.
    #[account(mut)]
    pub spl_vault: Option<UncheckedAccount<'info>>,
    #[account(mut)]
    pub owner_token_account: Option<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
