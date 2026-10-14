#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

pub mod attestation;
pub mod constants;
pub mod domain_updates;
pub mod economics;
pub mod error;
pub mod provider;
pub mod registration;
pub mod slashing;
pub mod state;

use constants::{
    DOMAIN_RECORD_SEED, DOMAIN_SCHEMA_VERSION, FOUNDER_VAULT_AUTHORITY_SEED,
    ORIGIN_CLAIM_RECEIPT_SEED, RECEIPT_SCHEMA_VERSION, REGISTRY_CONFIG_SEED,
    REGISTRY_SCHEMA_VERSION, REPORTER_CLAIM_SCHEMA_VERSION, REPORTER_CLAIM_SEED,
    REPORTER_POOL_SCHEMA_VERSION, REPORTER_POOL_SEED, SLASH_CASE_SCHEMA_VERSION, SLASH_CASE_SEED,
    STAKE_VAULT_SCHEMA_VERSION, STAKE_VAULT_SEED, SUB_IDENTITY_STRIKE_SCHEMA_VERSION,
    SUB_IDENTITY_STRIKE_SEED, TREASURY_VAULT_AUTHORITY_SEED,
};
use domain_updates::{
    authorize_domain_admin, next_origin_sequence, validate_endpoint, validate_mail_key,
    UpdateEndpointArgs, UpdateMailKeyArgs, UpdateTlsFingerprintArgs,
};
use economics::{
    burn_tokens_signed, slash_distribution, split_standard_fee, transfer_tokens,
    transfer_tokens_signed,
};
use error::MaivwError;
use provider::{top_up_transition, warning_transition, IssueWarningArgs, TopUpStakeArgs};
use registration::{
    domain_payload_hash, provider_payload_hash, InitializeRegistryArgs, RegisterDomainArgs,
    RegisterProviderArgs,
};
use slashing::{
    reporter_leaf, validate_reporter_set, verify_reporter_proof, ClaimReporterRewardArgs,
    ProposeSlashArgs, SlashCaseArgs,
};
use state::{
    DomainRecord, DomainStatus, KeyAlgorithm, KeyDescriptor, NetworkFamily, NetworkReference,
    OriginClaimReceipt, ProviderTier, RecordKind, RegistryConfig, ReporterClaim, ReporterPool,
    SlashCase, SlashCaseStatus, StakeVault, SubIdentityStrike, TransactionReference,
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

    pub fn top_up_stake(ctx: Context<TopUpStake>, args: TopUpStakeArgs) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        require!(
            matches!(domain.kind, RecordKind::Origin)
                && !matches!(domain.provider_tier, ProviderTier::None),
            MaivwError::NotProvider
        );
        let tier = config.tiers[domain.provider_tier.config_index()?];
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        require!(
            ctx.accounts.stake_vault.current_stake == domain.current_stake,
            MaivwError::InvalidStakeVault
        );
        let transition = top_up_transition(
            domain.current_stake,
            args.amount,
            tier.required_stake,
            domain.status,
        )?;
        let stake_token_after = ctx
            .accounts
            .stake_vault_token
            .amount
            .checked_add(args.amount)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;

        transfer_tokens(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.funder_token.to_account_info(),
            ctx.accounts.stake_vault_token.to_account_info(),
            ctx.accounts.funder.to_account_info(),
            args.amount,
            config.asset_decimals,
        )?;
        ctx.accounts.stake_vault_token.reload()?;
        require!(
            ctx.accounts.stake_vault_token.amount == stake_token_after
                && stake_token_after >= transition.current_stake,
            MaivwError::InvalidStakeVault
        );

        let now = Clock::get()?.unix_timestamp;
        domain.current_stake = transition.current_stake;
        domain.attested_stake = transition.current_stake;
        domain.status = transition.status;
        domain.updated_at = now;
        domain.origin_sequence = domain
            .origin_sequence
            .checked_add(1)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
        ctx.accounts.stake_vault.current_stake = transition.current_stake;
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(StakeToppedUp {
            domain_hash: args.domain_hash,
            funder: ctx.accounts.funder.key(),
            amount: args.amount,
            current_stake: transition.current_stake,
            reactivated: transition.reactivated,
            origin_sequence: domain.origin_sequence,
            timestamp: now,
        });
        Ok(())
    }

    pub fn issue_warning(ctx: Context<IssueWarning>, args: IssueWarningArgs) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        require!(
            matches!(domain.kind, RecordKind::Origin)
                && !matches!(domain.provider_tier, ProviderTier::None),
            MaivwError::NotProvider
        );
        require!(
            args.sub_identity_hash != [0; 32],
            MaivwError::InvalidSubIdentity
        );
        let tier = config.tiers[domain.provider_tier.config_index()?];
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        require!(
            ctx.accounts.stake_vault.current_stake == domain.current_stake,
            MaivwError::InvalidStakeVault
        );
        let transition = warning_transition(
            domain.current_stake,
            tier.penalty_per_strike,
            tier.required_stake,
            domain.status,
        )?;

        let stake_token_after = ctx
            .accounts
            .stake_vault_token
            .amount
            .checked_sub(transition.penalty_charged)
            .ok_or_else(|| error!(MaivwError::InvalidStakeVault))?;
        let treasury_before = ctx.accounts.treasury_vault.amount;
        if transition.penalty_charged > 0 {
            let bump = [ctx.accounts.stake_vault.bump];
            let vault_seeds: &[&[u8]] = &[STAKE_VAULT_SEED, args.domain_hash.as_ref(), &bump];
            let signer_seeds = &[vault_seeds];
            transfer_tokens_signed(
                ctx.accounts.token_program.key(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.stake_vault_token.to_account_info(),
                ctx.accounts.treasury_vault.to_account_info(),
                ctx.accounts.stake_vault.to_account_info(),
                transition.penalty_charged,
                config.asset_decimals,
                signer_seeds,
            )?;
            ctx.accounts.stake_vault_token.reload()?;
            ctx.accounts.treasury_vault.reload()?;
            require!(
                ctx.accounts.stake_vault_token.amount == stake_token_after
                    && ctx.accounts.treasury_vault.amount
                        == treasury_before
                            .checked_add(transition.penalty_charged)
                            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?,
                MaivwError::InvalidStakeVault
            );
        }

        let now = Clock::get()?.unix_timestamp;
        domain.strikes = domain
            .strikes
            .checked_add(1)
            .ok_or_else(|| error!(MaivwError::StrikeOverflow))?;
        domain.current_stake = transition.current_stake;
        domain.attested_stake = transition.current_stake;
        domain.status = transition.status;
        domain.updated_at = now;
        domain.origin_sequence = domain
            .origin_sequence
            .checked_add(1)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;

        let sub_identity = &mut ctx.accounts.sub_identity_strike;
        if sub_identity.schema_version == 0 {
            sub_identity.schema_version = SUB_IDENTITY_STRIKE_SCHEMA_VERSION;
            sub_identity.bump = ctx.bumps.sub_identity_strike;
            sub_identity.domain_hash = args.domain_hash;
            sub_identity.sub_identity_hash = args.sub_identity_hash;
        }
        require!(
            sub_identity.domain_hash == args.domain_hash
                && sub_identity.sub_identity_hash == args.sub_identity_hash,
            MaivwError::InvalidSubIdentity
        );
        sub_identity.strikes = sub_identity
            .strikes
            .checked_add(1)
            .ok_or_else(|| error!(MaivwError::StrikeOverflow))?;
        sub_identity.last_warned_at = now;
        sub_identity.validate()?;

        ctx.accounts.stake_vault.current_stake = transition.current_stake;
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(WarningIssued {
            domain_hash: args.domain_hash,
            sub_identity_hash: args.sub_identity_hash,
            oracle: ctx.accounts.oracle.key(),
            provider_strikes: domain.strikes,
            sub_identity_strikes: sub_identity.strikes,
            penalty_charged: transition.penalty_charged,
            current_stake: transition.current_stake,
            suspended: transition.suspended,
            origin_sequence: domain.origin_sequence,
            timestamp: now,
        });
        Ok(())
    }

    pub fn propose_slash(ctx: Context<ProposeSlash>, args: ProposeSlashArgs) -> Result<()> {
        require!(args.case_nonce != [0; 32], MaivwError::ZeroNonce);
        validate_reporter_set(args.reporter_root, args.reporter_count)?;
        let domain = &ctx.accounts.domain_record;
        require!(
            matches!(domain.kind, RecordKind::Origin)
                && matches!(
                    domain.status,
                    DomainStatus::Active | DomainStatus::Suspended
                )
                && domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidDomainStatus
        );
        domain.validate(ctx.accounts.config.network_hash, ID.to_bytes())?;

        let slash_case = &mut ctx.accounts.slash_case;
        if slash_case.schema_version != 0 {
            require!(
                slash_case.schema_version == SLASH_CASE_SCHEMA_VERSION
                    && slash_case.domain_hash == args.domain_hash
                    && slash_case.global_domain_epoch == args.global_domain_epoch,
                MaivwError::InvalidSlashCase
            );
            require!(
                matches!(slash_case.status, SlashCaseStatus::Vetoed),
                MaivwError::SlashCaseUnavailable
            );
        }

        let now = Clock::get()?.unix_timestamp;
        let delay = i64::try_from(ctx.accounts.config.slash_delay_seconds)
            .map_err(|_| error!(MaivwError::ArithmeticOverflow))?;
        let execute_after = now
            .checked_add(delay)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
        ***slash_case = SlashCase {
            schema_version: SLASH_CASE_SCHEMA_VERSION,
            bump: ctx.bumps.slash_case,
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            case_nonce: args.case_nonce,
            reporter_root: args.reporter_root,
            reporter_count: args.reporter_count,
            proposed_by: ctx.accounts.oracle.key(),
            proposed_at: now,
            execute_after,
            status: SlashCaseStatus::Pending,
            vetoed_by: Pubkey::default(),
            vetoed_at: 0,
            executed_at: 0,
            stake_slashed: 0,
            reporter_pool_amount: 0,
            burned_amount: 0,
            origin_sequence: domain.origin_sequence,
        };
        slash_case.validate_identity(
            args.domain_hash,
            args.global_domain_epoch,
            args.case_nonce,
        )?;

        emit!(SlashProposed {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            case_nonce: args.case_nonce,
            reporter_root: args.reporter_root,
            reporter_count: args.reporter_count,
            oracle: ctx.accounts.oracle.key(),
            proposed_at: now,
            execute_after,
        });
        Ok(())
    }

    pub fn veto_slash(ctx: Context<VetoSlash>, args: SlashCaseArgs) -> Result<()> {
        require!(
            ctx.accounts.veto_authority.key() == ctx.accounts.config.guardian
                || ctx.accounts.veto_authority.key() == ctx.accounts.config.authority,
            MaivwError::UnauthorizedVeto
        );
        let slash_case = &mut ctx.accounts.slash_case;
        slash_case.validate_identity(
            args.domain_hash,
            args.global_domain_epoch,
            args.case_nonce,
        )?;
        require!(
            matches!(slash_case.status, SlashCaseStatus::Pending),
            MaivwError::SlashCaseUnavailable
        );
        let now = Clock::get()?.unix_timestamp;
        slash_case.status = SlashCaseStatus::Vetoed;
        slash_case.vetoed_by = ctx.accounts.veto_authority.key();
        slash_case.vetoed_at = now;

        emit!(SlashVetoed {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            case_nonce: args.case_nonce,
            vetoed_by: ctx.accounts.veto_authority.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn execute_slash(ctx: Context<ExecuteSlash>, args: SlashCaseArgs) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        require!(
            matches!(domain.kind, RecordKind::Origin)
                && matches!(
                    domain.status,
                    DomainStatus::Active | DomainStatus::Suspended
                )
                && domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidDomainStatus
        );
        ctx.accounts.slash_case.validate_identity(
            args.domain_hash,
            args.global_domain_epoch,
            args.case_nonce,
        )?;
        require!(
            matches!(ctx.accounts.slash_case.status, SlashCaseStatus::Pending),
            MaivwError::SlashCaseUnavailable
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.slash_case.execute_after,
            MaivwError::SlashNotReady
        );
        validate_reporter_set(
            ctx.accounts.slash_case.reporter_root,
            ctx.accounts.slash_case.reporter_count,
        )?;
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        require!(
            ctx.accounts.stake_vault.current_stake == domain.current_stake
                && ctx.accounts.stake_vault.original_registration_amount
                    == domain.original_registration_amount,
            MaivwError::InvalidStakeVault
        );

        let stake_slashed = domain.current_stake;
        let distribution = slash_distribution(
            domain.original_registration_amount,
            stake_slashed,
            ctx.accounts.slash_case.reporter_count,
        )?;
        let stake_before = ctx.accounts.stake_vault_token.amount;
        let pool_before = ctx.accounts.reporter_pool_token.amount;
        let bump = [ctx.accounts.stake_vault.bump];
        let vault_seeds: &[&[u8]] = &[STAKE_VAULT_SEED, args.domain_hash.as_ref(), &bump];
        let signer_seeds = &[vault_seeds];

        transfer_tokens_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.stake_vault_token.to_account_info(),
            ctx.accounts.reporter_pool_token.to_account_info(),
            ctx.accounts.stake_vault.to_account_info(),
            distribution.reporter_pool,
            config.asset_decimals,
            signer_seeds,
        )?;
        burn_tokens_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.stake_vault_token.to_account_info(),
            ctx.accounts.stake_vault.to_account_info(),
            distribution.burned,
            config.asset_decimals,
            signer_seeds,
        )?;
        ctx.accounts.stake_vault_token.reload()?;
        ctx.accounts.reporter_pool_token.reload()?;
        require!(
            ctx.accounts.stake_vault_token.amount
                == stake_before
                    .checked_sub(stake_slashed)
                    .ok_or_else(|| error!(MaivwError::InvalidStakeVault))?
                && ctx.accounts.reporter_pool_token.amount
                    == pool_before
                        .checked_add(distribution.reporter_pool)
                        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?,
            MaivwError::InvalidStakeVault
        );

        domain.current_stake = 0;
        domain.attested_stake = 0;
        domain.status = DomainStatus::Revoked;
        domain.updated_at = now;
        domain.origin_sequence = domain
            .origin_sequence
            .checked_add(1)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
        ctx.accounts.stake_vault.current_stake = 0;
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        domain.validate(config.network_hash, ID.to_bytes())?;

        let pool = &mut ctx.accounts.reporter_pool;
        ***pool = ReporterPool {
            schema_version: REPORTER_POOL_SCHEMA_VERSION,
            bump: ctx.bumps.reporter_pool,
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            case_nonce: args.case_nonce,
            mint: ctx.accounts.mint.key(),
            token_account: ctx.accounts.reporter_pool_token.key(),
            reporter_root: ctx.accounts.slash_case.reporter_root,
            reporter_count: ctx.accounts.slash_case.reporter_count,
            per_reporter: distribution.per_reporter,
            total_allocated: distribution.reporter_pool,
            claimed_amount: 0,
            claimed_count: 0,
            created_at: now,
        };
        pool.validate(ctx.accounts.reporter_pool_token.amount)?;

        let slash_case = &mut ctx.accounts.slash_case;
        slash_case.status = SlashCaseStatus::Executed;
        slash_case.executed_at = now;
        slash_case.stake_slashed = stake_slashed;
        slash_case.reporter_pool_amount = distribution.reporter_pool;
        slash_case.burned_amount = distribution.burned;
        slash_case.origin_sequence = domain.origin_sequence;

        emit!(SlashExecuted {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            case_nonce: args.case_nonce,
            stake_slashed,
            reporter_pool_amount: distribution.reporter_pool,
            burned_amount: distribution.burned,
            reporter_root: slash_case.reporter_root,
            reporter_count: slash_case.reporter_count,
            origin_sequence: domain.origin_sequence,
            timestamp: now,
        });
        Ok(())
    }

    pub fn claim_reporter_reward(
        ctx: Context<ClaimReporterReward>,
        args: ClaimReporterRewardArgs,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.reporter_pool;
        require!(
            pool.domain_hash == args.domain_hash
                && pool.global_domain_epoch == args.global_domain_epoch
                && pool.case_nonce == args.case_nonce,
            MaivwError::InvalidReporterPool
        );
        pool.validate(ctx.accounts.reporter_pool_token.amount)?;
        require!(pool.per_reporter > 0, MaivwError::NothingToClaim);
        require!(
            pool.claimed_count < pool.reporter_count,
            MaivwError::NothingToClaim
        );
        let leaf = reporter_leaf(
            args.domain_hash,
            args.global_domain_epoch,
            args.case_nonce,
            ctx.accounts.reporter.key(),
        );
        verify_reporter_proof(pool.reporter_root, leaf, &args.proof)?;

        let amount = pool.per_reporter;
        let pool_before = ctx.accounts.reporter_pool_token.amount;
        let reporter_before = ctx.accounts.reporter_token.amount;
        let epoch_seed = args.global_domain_epoch.to_le_bytes();
        let bump = [pool.bump];
        let pool_seeds: &[&[u8]] = &[
            REPORTER_POOL_SEED,
            args.domain_hash.as_ref(),
            epoch_seed.as_ref(),
            &bump,
        ];
        transfer_tokens_signed(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.reporter_pool_token.to_account_info(),
            ctx.accounts.reporter_token.to_account_info(),
            pool.to_account_info(),
            amount,
            ctx.accounts.mint.decimals,
            &[pool_seeds],
        )?;
        ctx.accounts.reporter_pool_token.reload()?;
        ctx.accounts.reporter_token.reload()?;
        require!(
            ctx.accounts.reporter_pool_token.amount
                == pool_before
                    .checked_sub(amount)
                    .ok_or_else(|| error!(MaivwError::InvalidReporterPool))?
                && ctx.accounts.reporter_token.amount
                    == reporter_before
                        .checked_add(amount)
                        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?,
            MaivwError::InvalidReporterPool
        );

        pool.claimed_amount = pool
            .claimed_amount
            .checked_add(amount)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
        pool.claimed_count = pool
            .claimed_count
            .checked_add(1)
            .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
        pool.validate(ctx.accounts.reporter_pool_token.amount)?;
        let now = Clock::get()?.unix_timestamp;
        let claim = &mut ctx.accounts.reporter_claim;
        ***claim = ReporterClaim {
            schema_version: REPORTER_CLAIM_SCHEMA_VERSION,
            bump: ctx.bumps.reporter_claim,
            reporter_pool: pool.key(),
            reporter: ctx.accounts.reporter.key(),
            leaf,
            amount,
            claimed_at: now,
        };
        claim.validate()?;

        emit!(ReporterRewardClaimed {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            case_nonce: args.case_nonce,
            reporter: ctx.accounts.reporter.key(),
            amount,
            claimed_count: pool.claimed_count,
            timestamp: now,
        });
        Ok(())
    }

    pub fn update_mail_key(ctx: Context<UpdateMailKey>, args: UpdateMailKeyArgs) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        authorize_domain_admin(
            domain.kind,
            domain.status,
            domain.admin_key,
            ctx.accounts.domain_admin.key(),
        )?;
        validate_mail_key(args.new_mail_key)?;

        let old_mail_key = domain.operational_key.value;
        let now = Clock::get()?.unix_timestamp;
        domain.operational_key = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: args.new_mail_key,
        };
        domain.origin_sequence = next_origin_sequence(domain.origin_sequence)?;
        domain.updated_at = now;
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(MailKeyUpdated {
            domain_hash: args.domain_hash,
            global_domain_epoch: domain.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            domain_admin: ctx.accounts.domain_admin.key(),
            old_mail_key,
            new_mail_key: args.new_mail_key,
            timestamp: now,
        });
        Ok(())
    }

    pub fn update_endpoint(ctx: Context<UpdateEndpoint>, args: UpdateEndpointArgs) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        authorize_domain_admin(
            domain.kind,
            domain.status,
            domain.admin_key,
            ctx.accounts.domain_admin.key(),
        )?;
        validate_endpoint(&args.new_endpoint)?;

        let old_endpoint_hash = maivw_attestation::keccak256(domain.endpoint.as_bytes());
        let now = Clock::get()?.unix_timestamp;
        domain.endpoint = args.new_endpoint.clone();
        domain.origin_sequence = next_origin_sequence(domain.origin_sequence)?;
        domain.updated_at = now;
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(EndpointUpdated {
            domain_hash: args.domain_hash,
            global_domain_epoch: domain.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            domain_admin: ctx.accounts.domain_admin.key(),
            old_endpoint_hash,
            new_endpoint: args.new_endpoint,
            timestamp: now,
        });
        Ok(())
    }

    pub fn update_tls_fingerprint(
        ctx: Context<UpdateTlsFingerprint>,
        args: UpdateTlsFingerprintArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        authorize_domain_admin(
            domain.kind,
            domain.status,
            domain.admin_key,
            ctx.accounts.domain_admin.key(),
        )?;

        let old_tls_fingerprint = domain.tls_fingerprint;
        let now = Clock::get()?.unix_timestamp;
        domain.tls_fingerprint = args.new_tls_fingerprint;
        domain.origin_sequence = next_origin_sequence(domain.origin_sequence)?;
        domain.updated_at = now;
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(TlsFingerprintUpdated {
            domain_hash: args.domain_hash,
            global_domain_epoch: domain.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            domain_admin: ctx.accounts.domain_admin.key(),
            old_tls_fingerprint,
            new_tls_fingerprint: args.new_tls_fingerprint,
            timestamp: now,
        });
        Ok(())
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

#[derive(Accounts)]
#[instruction(args: TopUpStakeArgs)]
pub struct TopUpStake<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED, args.domain_hash.as_ref()],
        bump = stake_vault.bump,
        constraint = stake_vault.domain_hash == args.domain_hash @ MaivwError::InvalidStakeVault,
        constraint = stake_vault.mint == mint.key() @ MaivwError::InvalidAsset
    )]
    pub stake_vault: Box<Account<'info, StakeVault>>,
    #[account(
        mut,
        constraint = funder_token.mint == mint.key() @ MaivwError::InvalidAsset,
        constraint = funder_token.owner == funder.key() @ MaivwError::InvalidAsset
    )]
    pub funder_token: Box<Account<'info, TokenAccount>>,
    #[account(
        address = config.asset_mint @ MaivwError::InvalidAsset,
        constraint = mint.decimals == config.asset_decimals @ MaivwError::InvalidAssetDecimals
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = stake_vault,
        associated_token::token_program = token_program,
        constraint = stake_vault.token_account == stake_vault_token.key()
            @ MaivwError::InvalidStakeVault
    )]
    pub stake_vault_token: Box<Account<'info, TokenAccount>>,
    #[account(address = config.token_program @ MaivwError::InvalidAsset)]
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(args: IssueWarningArgs)]
pub struct IssueWarning<'info> {
    #[account(
        mut,
        constraint = oracle.key().to_bytes() == config.oracle_key @ MaivwError::UnauthorizedOracle
    )]
    pub oracle: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init_if_needed,
        payer = oracle,
        space = SubIdentityStrike::SPACE,
        seeds = [
            SUB_IDENTITY_STRIKE_SEED,
            args.domain_hash.as_ref(),
            args.sub_identity_hash.as_ref()
        ],
        bump
    )]
    pub sub_identity_strike: Box<Account<'info, SubIdentityStrike>>,
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED, args.domain_hash.as_ref()],
        bump = stake_vault.bump,
        constraint = stake_vault.domain_hash == args.domain_hash @ MaivwError::InvalidStakeVault,
        constraint = stake_vault.mint == mint.key() @ MaivwError::InvalidAsset
    )]
    pub stake_vault: Box<Account<'info, StakeVault>>,
    #[account(
        address = config.asset_mint @ MaivwError::InvalidAsset,
        constraint = mint.decimals == config.asset_decimals @ MaivwError::InvalidAssetDecimals
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = stake_vault,
        associated_token::token_program = token_program,
        constraint = stake_vault.token_account == stake_vault_token.key()
            @ MaivwError::InvalidStakeVault
    )]
    pub stake_vault_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: PDA used only as the treasury token-vault authority.
    #[account(seeds = [TREASURY_VAULT_AUTHORITY_SEED], bump)]
    pub treasury_vault_authority: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = oracle,
        associated_token::mint = mint,
        associated_token::authority = treasury_vault_authority,
        associated_token::token_program = token_program
    )]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.token_program @ MaivwError::InvalidAsset)]
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ProposeSlashArgs)]
pub struct ProposeSlash<'info> {
    #[account(
        mut,
        constraint = oracle.key().to_bytes() == config.oracle_key @ MaivwError::UnauthorizedOracle
    )]
    pub oracle: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init_if_needed,
        payer = oracle,
        space = SlashCase::SPACE,
        seeds = [
            SLASH_CASE_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub slash_case: Box<Account<'info, SlashCase>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: SlashCaseArgs)]
pub struct VetoSlash<'info> {
    pub veto_authority: Signer<'info>,
    #[account(seeds = [REGISTRY_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [
            SLASH_CASE_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump = slash_case.bump
    )]
    pub slash_case: Box<Account<'info, SlashCase>>,
}

#[derive(Accounts)]
#[instruction(args: SlashCaseArgs)]
pub struct ExecuteSlash<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        mut,
        seeds = [
            SLASH_CASE_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump = slash_case.bump
    )]
    pub slash_case: Box<Account<'info, SlashCase>>,
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED, args.domain_hash.as_ref()],
        bump = stake_vault.bump,
        constraint = stake_vault.domain_hash == args.domain_hash @ MaivwError::InvalidStakeVault,
        constraint = stake_vault.mint == mint.key() @ MaivwError::InvalidAsset
    )]
    pub stake_vault: Box<Account<'info, StakeVault>>,
    #[account(
        init,
        payer = executor,
        space = ReporterPool::SPACE,
        seeds = [
            REPORTER_POOL_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub reporter_pool: Box<Account<'info, ReporterPool>>,
    #[account(
        mut,
        address = config.asset_mint @ MaivwError::InvalidAsset,
        constraint = mint.decimals == config.asset_decimals @ MaivwError::InvalidAssetDecimals
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = stake_vault,
        associated_token::token_program = token_program,
        constraint = stake_vault.token_account == stake_vault_token.key()
            @ MaivwError::InvalidStakeVault
    )]
    pub stake_vault_token: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = executor,
        associated_token::mint = mint,
        associated_token::authority = reporter_pool,
        associated_token::token_program = token_program
    )]
    pub reporter_pool_token: Box<Account<'info, TokenAccount>>,
    #[account(address = config.token_program @ MaivwError::InvalidAsset)]
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ClaimReporterRewardArgs)]
pub struct ClaimReporterReward<'info> {
    #[account(mut)]
    pub reporter: Signer<'info>,
    #[account(
        mut,
        seeds = [
            REPORTER_POOL_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump = reporter_pool.bump
    )]
    pub reporter_pool: Box<Account<'info, ReporterPool>>,
    #[account(
        init,
        payer = reporter,
        space = ReporterClaim::SPACE,
        seeds = [
            REPORTER_CLAIM_SEED,
            reporter_pool.key().as_ref(),
            reporter.key().as_ref()
        ],
        bump
    )]
    pub reporter_claim: Box<Account<'info, ReporterClaim>>,
    #[account(address = reporter_pool.mint @ MaivwError::InvalidAsset)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = reporter_pool,
        associated_token::token_program = token_program,
        constraint = reporter_pool.token_account == reporter_pool_token.key()
            @ MaivwError::InvalidReporterPool
    )]
    pub reporter_pool_token: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = reporter,
        associated_token::mint = mint,
        associated_token::authority = reporter,
        associated_token::token_program = token_program
    )]
    pub reporter_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: UpdateMailKeyArgs)]
pub struct UpdateMailKey<'info> {
    pub domain_admin: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
}

#[derive(Accounts)]
#[instruction(args: UpdateEndpointArgs)]
pub struct UpdateEndpoint<'info> {
    pub domain_admin: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
}

#[derive(Accounts)]
#[instruction(args: UpdateTlsFingerprintArgs)]
pub struct UpdateTlsFingerprint<'info> {
    pub domain_admin: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        mut,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
}

#[event]
pub struct StakeToppedUp {
    pub domain_hash: [u8; 32],
    pub funder: Pubkey,
    pub amount: u64,
    pub current_stake: u64,
    pub reactivated: bool,
    pub origin_sequence: u64,
    pub timestamp: i64,
}

#[event]
pub struct WarningIssued {
    pub domain_hash: [u8; 32],
    pub sub_identity_hash: [u8; 32],
    pub oracle: Pubkey,
    pub provider_strikes: u32,
    pub sub_identity_strikes: u32,
    pub penalty_charged: u64,
    pub current_stake: u64,
    pub suspended: bool,
    pub origin_sequence: u64,
    pub timestamp: i64,
}

#[event]
pub struct SlashProposed {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub reporter_root: [u8; 32],
    pub reporter_count: u32,
    pub oracle: Pubkey,
    pub proposed_at: i64,
    pub execute_after: i64,
}

#[event]
pub struct SlashVetoed {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub vetoed_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SlashExecuted {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub stake_slashed: u64,
    pub reporter_pool_amount: u64,
    pub burned_amount: u64,
    pub reporter_root: [u8; 32],
    pub reporter_count: u32,
    pub origin_sequence: u64,
    pub timestamp: i64,
}

#[event]
pub struct ReporterRewardClaimed {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub reporter: Pubkey,
    pub amount: u64,
    pub claimed_count: u32,
    pub timestamp: i64,
}

#[event]
pub struct MailKeyUpdated {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub domain_admin: Pubkey,
    pub old_mail_key: [u8; 32],
    pub new_mail_key: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct EndpointUpdated {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub domain_admin: Pubkey,
    pub old_endpoint_hash: [u8; 32],
    pub new_endpoint: String,
    pub timestamp: i64,
}

#[event]
pub struct TlsFingerprintUpdated {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub domain_admin: Pubkey,
    pub old_tls_fingerprint: [u8; 32],
    pub new_tls_fingerprint: [u8; 32],
    pub timestamp: i64,
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
