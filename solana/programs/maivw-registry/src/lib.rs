#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

pub mod attestation;
pub mod constants;
pub mod economics;
pub mod error;
pub mod registration;
pub mod state;

use constants::{
    DOMAIN_RECORD_SEED, DOMAIN_SCHEMA_VERSION, FOUNDER_VAULT_AUTHORITY_SEED,
    ORIGIN_CLAIM_RECEIPT_SEED, RECEIPT_SCHEMA_VERSION, REGISTRY_CONFIG_SEED,
    REGISTRY_SCHEMA_VERSION, STAKE_VAULT_SCHEMA_VERSION, STAKE_VAULT_SEED,
    TREASURY_VAULT_AUTHORITY_SEED,
};
use economics::{split_standard_fee, transfer_tokens};
use error::MaivwError;
use registration::{
    InitializeRegistryArgs, RegisterDomainArgs, RegisterProviderArgs, domain_payload_hash,
    provider_payload_hash,
};
use state::{
    DomainRecord, DomainStatus, KeyAlgorithm, KeyDescriptor, NetworkFamily, NetworkReference,
    OriginClaimReceipt, ProviderTier, RecordKind, RegistryConfig, StakeVault, TransactionReference,
};

declare_id!("8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9");

#[program]
pub mod maivw_registry {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        args: InitializeRegistryArgs,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.schema_version = REGISTRY_SCHEMA_VERSION;
        config.bump = ctx.bumps.config;
        config.active = true;
        config.authority = ctx.accounts.authority.key();
        config.guardian = args.guardian;
        config.oracle_key = args.oracle_key;
        config.asset_mint = ctx.accounts.mint.key();
        config.token_program = ctx.accounts.token_program.key();
        config.asset_decimals = ctx.accounts.mint.decimals;
        config.treasury = args.treasury;
        config.founder = args.founder;
        config.network_hash = args.network_hash;
        config.standard_fee = args.standard_fee;
        config.provider_fee = args.provider_fee;
        config.mirror_fee = args.mirror_fee;
        config.slash_delay_seconds = args.slash_delay_seconds;
        config.recovery_delay_seconds = args.recovery_delay_seconds;
        config.tiers = args.tiers;
        config.created_at = Clock::get()?.unix_timestamp;
        config.validate()
    }

    pub fn verify_attestation(ctx: Context<VerifyAttestation>, envelope: Vec<u8>) -> Result<()> {
        attestation::verify(
            &ctx.accounts.config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
        )?;
        Ok(())
    }

    pub fn register_domain(
        ctx: Context<RegisterDomain>,
        args: RegisterDomainArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let split = split_standard_fee(config.standard_fee)?;
        let payload_hash = domain_payload_hash(
            &args,
            ctx.accounts.registrant.key(),
            ctx.accounts.mint.key(),
            config.standard_fee,
        );
        let claim = attestation::verify_origin_claim(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            payload_hash,
            args.claim_nonce,
        )?;
        let now = Clock::get()?.unix_timestamp;

        **ctx.accounts.domain_record = new_origin_record(
            ctx.bumps.domain_record,
            &args,
            config,
            Pubkey::default(),
            ProviderTier::None,
            config.standard_fee,
            split.stake,
            0,
            now,
        );
        ctx.accounts
            .domain_record
            .validate(config.network_hash, ID.to_bytes())?;

        write_receipt(
            &mut ctx.accounts.claim_receipt,
            ctx.bumps.claim_receipt,
            &claim,
            ctx.accounts.registrant.key(),
            now,
        )?;
        write_stake_vault(
            &mut ctx.accounts.stake_vault,
            ctx.bumps.stake_vault,
            args.domain_hash,
            ctx.accounts.mint.key(),
            ctx.accounts.stake_vault_token.key(),
            config.standard_fee,
            split.stake,
        );

        transfer_tokens(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.registrant_token.to_account_info(),
            ctx.accounts.founder_vault.to_account_info(),
            ctx.accounts.registrant.to_account_info(),
            split.founder,
            config.asset_decimals,
        )?;
        transfer_tokens(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.registrant_token.to_account_info(),
            ctx.accounts.treasury_vault.to_account_info(),
            ctx.accounts.registrant.to_account_info(),
            split.treasury,
            config.asset_decimals,
        )?;
        transfer_tokens(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.registrant_token.to_account_info(),
            ctx.accounts.stake_vault_token.to_account_info(),
            ctx.accounts.registrant.to_account_info(),
            split.stake,
            config.asset_decimals,
        )?;
        ctx.accounts.stake_vault_token.reload()?;
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)
    }

    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        args: RegisterProviderArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let tier = config.tiers[args.tier.config_index()?];
        let payload_hash = provider_payload_hash(
            &args,
            ctx.accounts.registrant.key(),
            ctx.accounts.mint.key(),
            tier.required_stake,
        );
        let claim = attestation::verify_origin_claim(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            payload_hash,
            args.claim_nonce,
        )?;
        let now = Clock::get()?.unix_timestamp;

        **ctx.accounts.domain_record = new_provider_record(
            ctx.bumps.domain_record,
            &args,
            config,
            ctx.accounts.registrant.key(),
            tier.required_stake,
            tier.daily_limit,
            now,
        );
        ctx.accounts
            .domain_record
            .validate(config.network_hash, ID.to_bytes())?;

        write_receipt(
            &mut ctx.accounts.claim_receipt,
            ctx.bumps.claim_receipt,
            &claim,
            ctx.accounts.registrant.key(),
            now,
        )?;
        write_stake_vault(
            &mut ctx.accounts.stake_vault,
            ctx.bumps.stake_vault,
            args.domain_hash,
            ctx.accounts.mint.key(),
            ctx.accounts.stake_vault_token.key(),
            tier.required_stake,
            tier.required_stake,
        );

        transfer_tokens(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.registrant_token.to_account_info(),
            ctx.accounts.stake_vault_token.to_account_info(),
            ctx.accounts.registrant.to_account_info(),
            tier.required_stake,
            config.asset_decimals,
        )?;
        ctx.accounts.stake_vault_token.reload()?;
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)
    }
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::SPACE,
        seeds = [REGISTRY_CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, RegistryConfig>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
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

#[derive(Accounts)]
#[instruction(args: RegisterDomainArgs)]
pub struct RegisterDomain<'info> {
    #[account(mut)]
    pub registrant: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        init,
        payer = registrant,
        space = DomainRecord::SPACE,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init,
        payer = registrant,
        space = OriginClaimReceipt::SPACE,
        seeds = [ORIGIN_CLAIM_RECEIPT_SEED, args.domain_hash.as_ref(), args.claim_nonce.as_ref()],
        bump
    )]
    pub claim_receipt: Box<Account<'info, OriginClaimReceipt>>,
    #[account(
        init,
        payer = registrant,
        space = StakeVault::SPACE,
        seeds = [STAKE_VAULT_SEED, args.domain_hash.as_ref()],
        bump
    )]
    pub stake_vault: Box<Account<'info, StakeVault>>,
    #[account(
        mut,
        constraint = registrant_token.mint == mint.key() @ MaivwError::InvalidAsset,
        constraint = registrant_token.owner == registrant.key() @ MaivwError::InvalidAsset
    )]
    pub registrant_token: Box<Account<'info, TokenAccount>>,
    #[account(
        address = config.asset_mint @ MaivwError::InvalidAsset,
        constraint = mint.decimals == config.asset_decimals @ MaivwError::InvalidAssetDecimals
    )]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA used only as the founder token-vault authority.
    #[account(seeds = [FOUNDER_VAULT_AUTHORITY_SEED], bump)]
    pub founder_vault_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = registrant,
        associated_token::mint = mint,
        associated_token::authority = founder_vault_authority,
        associated_token::token_program = token_program
    )]
    pub founder_vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA used only as the treasury token-vault authority.
    #[account(seeds = [TREASURY_VAULT_AUTHORITY_SEED], bump)]
    pub treasury_vault_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = registrant,
        associated_token::mint = mint,
        associated_token::authority = treasury_vault_authority,
        associated_token::token_program = token_program
    )]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = registrant,
        associated_token::mint = mint,
        associated_token::authority = stake_vault,
        associated_token::token_program = token_program
    )]
    pub stake_vault_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(address = solana_instructions_sysvar::ID @ MaivwError::InvalidInstructionsSysvar)]
    pub instructions: UncheckedAccount<'info>,
    #[account(address = config.token_program @ MaivwError::InvalidAsset)]
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: RegisterProviderArgs)]
pub struct RegisterProvider<'info> {
    #[account(mut)]
    pub registrant: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        init,
        payer = registrant,
        space = DomainRecord::SPACE,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init,
        payer = registrant,
        space = OriginClaimReceipt::SPACE,
        seeds = [ORIGIN_CLAIM_RECEIPT_SEED, args.domain_hash.as_ref(), args.claim_nonce.as_ref()],
        bump
    )]
    pub claim_receipt: Box<Account<'info, OriginClaimReceipt>>,
    #[account(
        init,
        payer = registrant,
        space = StakeVault::SPACE,
        seeds = [STAKE_VAULT_SEED, args.domain_hash.as_ref()],
        bump
    )]
    pub stake_vault: Box<Account<'info, StakeVault>>,
    #[account(
        mut,
        constraint = registrant_token.mint == mint.key() @ MaivwError::InvalidAsset,
        constraint = registrant_token.owner == registrant.key() @ MaivwError::InvalidAsset
    )]
    pub registrant_token: Box<Account<'info, TokenAccount>>,
    #[account(
        address = config.asset_mint @ MaivwError::InvalidAsset,
        constraint = mint.decimals == config.asset_decimals @ MaivwError::InvalidAssetDecimals
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = registrant,
        associated_token::mint = mint,
        associated_token::authority = stake_vault,
        associated_token::token_program = token_program
    )]
    pub stake_vault_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(address = solana_instructions_sysvar::ID @ MaivwError::InvalidInstructionsSysvar)]
    pub instructions: UncheckedAccount<'info>,
    #[account(address = config.token_program @ MaivwError::InvalidAsset)]
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
fn new_origin_record(
    bump: u8,
    args: &RegisterDomainArgs,
    config: &RegistryConfig,
    provider: Pubkey,
    provider_tier: ProviderTier,
    original_registration_amount: u64,
    current_stake: u64,
    daily_limit: u64,
    now: i64,
) -> DomainRecord {
    DomainRecord {
        schema_version: DOMAIN_SCHEMA_VERSION,
        bump,
        kind: RecordKind::Origin,
        domain_hash: args.domain_hash,
        domain: args.domain.clone(),
        origin: NetworkReference {
            family: NetworkFamily::Solana,
            network_hash: config.network_hash,
        },
        origin_registry: ID.to_bytes(),
        operational_key: KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: args.operational_key,
        },
        admin_key: KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: args.admin_key,
        },
        endpoint: args.endpoint.clone(),
        tls_fingerprint: args.tls_fingerprint,
        status: DomainStatus::Active,
        global_domain_epoch: 0,
        origin_sequence: 0,
        provider,
        provider_tier,
        strikes: 0,
        created_at: now,
        updated_at: now,
        attested_stake: current_stake,
        attested_daily_limit: daily_limit,
        original_registration_amount,
        current_stake,
        origin_transaction: TransactionReference {
            family: NetworkFamily::Solana,
            hash: [0; 32],
        },
    }
}

fn new_provider_record(
    bump: u8,
    args: &RegisterProviderArgs,
    config: &RegistryConfig,
    provider: Pubkey,
    required_stake: u64,
    daily_limit: u64,
    now: i64,
) -> DomainRecord {
    let domain_args = RegisterDomainArgs {
        domain_hash: args.domain_hash,
        claim_nonce: args.claim_nonce,
        domain: args.domain.clone(),
        endpoint: args.endpoint.clone(),
        operational_key: args.operational_key,
        admin_key: args.admin_key,
        tls_fingerprint: args.tls_fingerprint,
    };
    new_origin_record(
        bump,
        &domain_args,
        config,
        provider,
        args.tier,
        required_stake,
        required_stake,
        daily_limit,
        now,
    )
}

fn write_receipt(
    receipt: &mut OriginClaimReceipt,
    bump: u8,
    claim: &maivw_attestation::AttestationV1,
    registrant: Pubkey,
    now: i64,
) -> Result<()> {
    receipt.schema_version = RECEIPT_SCHEMA_VERSION;
    receipt.bump = bump;
    receipt.domain_hash = claim.domain_hash;
    receipt.origin_network_hash = claim.origin_network_hash;
    receipt.origin_registry = claim.origin_registry;
    receipt.nonce = claim.nonce;
    receipt.attestation_digest = claim
        .digest()
        .map_err(|_| error!(MaivwError::InvalidAttestation))?;
    receipt.consumed_by = registrant;
    receipt.consumed_at = now;
    receipt.validate()
}

#[allow(clippy::too_many_arguments)]
fn write_stake_vault(
    vault: &mut StakeVault,
    bump: u8,
    domain_hash: [u8; 32],
    mint: Pubkey,
    token_account: Pubkey,
    original_registration_amount: u64,
    current_stake: u64,
) {
    vault.schema_version = STAKE_VAULT_SCHEMA_VERSION;
    vault.bump = bump;
    vault.domain_hash = domain_hash;
    vault.mint = mint;
    vault.token_account = token_account;
    vault.original_registration_amount = original_registration_amount;
    vault.current_stake = current_stake;
}
