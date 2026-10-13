#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod attestation;
pub mod constants;
pub mod error;
pub mod state;

use constants::REGISTRY_CONFIG_SEED;
use error::MaivwError;
use state::RegistryConfig;

declare_id!("8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9");

#[program]
pub mod maivw_registry {
    use super::*;

    pub fn verify_attestation(ctx: Context<VerifyAttestation>, envelope: Vec<u8>) -> Result<()> {
        attestation::verify(
            &ctx.accounts.config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
        )
    }
}

#[derive(Accounts)]
pub struct VerifyAttestation<'info> {
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Account<'info, RegistryConfig>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(
        address = solana_instructions_sysvar::ID
            @ MaivwError::InvalidInstructionsSysvar
    )]
    pub instructions: UncheckedAccount<'info>,
}
