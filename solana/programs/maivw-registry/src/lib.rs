#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

pub mod admin_rotation;
pub mod attestation;
pub mod constants;
pub mod domain_updates;
pub mod economics;
pub mod error;
pub mod governance;
pub mod intent_batch;
pub mod mirror;
pub mod provider;
pub mod reclaim;
pub mod recovery;
pub mod registration;
pub mod slashing;
pub mod state;

use admin_rotation::{
    authorize_pending_acceptance, validate_new_admin, AcceptDomainAdminArgs, ProposeDomainAdminArgs,
};
use constants::{
    DOMAIN_RECORD_SEED, DOMAIN_SCHEMA_VERSION, FOUNDER_VAULT_AUTHORITY_SEED,
    INTENT_BATCH_SCHEMA_VERSION, INTENT_BATCH_SEED, ORIGIN_CLAIM_RECEIPT_SEED,
    MIRROR_ATTESTATION_RECEIPT_SCHEMA_VERSION, MIRROR_ATTESTATION_RECEIPT_SEED,
    PENDING_ADMIN_SCHEMA_VERSION, PENDING_ADMIN_SEED, RECEIPT_SCHEMA_VERSION,
    RECOVERY_CASE_SCHEMA_VERSION, RECOVERY_CASE_SEED, RECOVERY_RECEIPT_SCHEMA_VERSION,
    RECOVERY_RECEIPT_SEED, REGISTRY_CONFIG_SEED, REGISTRY_SCHEMA_VERSION,
    REPORTER_CLAIM_SCHEMA_VERSION, REPORTER_CLAIM_SEED, REPORTER_POOL_SCHEMA_VERSION,
    REPORTER_POOL_SEED, SLASH_CASE_SCHEMA_VERSION, SLASH_CASE_SEED, STAKE_VAULT_SCHEMA_VERSION,
    STAKE_VAULT_SEED, SUB_IDENTITY_STRIKE_SCHEMA_VERSION, SUB_IDENTITY_STRIKE_SEED,
    TREASURY_VAULT_AUTHORITY_SEED,
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
use governance::{authorize_pause, authorize_unpause};
use intent_batch::{authorize_intent_batch, validate_intent_batch, RegisterIntentBatchArgs};
use mirror::{
    mirror_state_payload_hash, revoke_mirror_payload_hash, sync_mirror_payload_hash,
    validate_register_mirror, validate_revoke_mirror, validate_sync_mirror,
    validate_sync_version, RegisterMirrorArgs, RevokeMirrorArgs, SyncMirrorArgs,
};
use provider::{top_up_transition, warning_transition, IssueWarningArgs, TopUpStakeArgs};
use reclaim::{close_pending_processes, reclaim_payload_hash, ReclaimDomainArgs};
use recovery::{
    authorize_recovery_cancellation, authorize_recovery_execution, next_recovery_epoch,
    recovery_execute_after, recovery_payload_hash, validate_recovery_keys, RecoveryCaseArgs,
    RequestRecoveryArgs,
};
use registration::{
    domain_payload_hash, provider_payload_hash, InitializeRegistryArgs, RegisterDomainArgs,
    RegisterProviderArgs,
};
use slashing::{
    reporter_leaf, validate_reporter_set, verify_reporter_proof, ClaimReporterRewardArgs,
    ProposeSlashArgs, SlashCaseArgs,
};
use state::{
    DomainRecord, DomainStatus, IntentBatch, KeyAlgorithm, KeyDescriptor,
    MirrorAttestationReceipt, NetworkFamily, NetworkReference, OriginClaimReceipt, PendingAdmin,
    PendingAdminStatus, ProviderTier, RecordKind, RecoveryCase, RecoveryReceipt, RecoveryStatus,
    RegistryConfig, ReporterClaim, ReporterPool, SlashCase, SlashCaseStatus, StakeVault,
    SubIdentityStrike, TransactionReference,
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

    pub fn pause_registry(ctx: Context<ManageRegistryPause>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.validate()?;
        authorize_pause(
            config.authority,
            config.guardian,
            ctx.accounts.governance.key(),
            config.active,
        )?;
        config.active = false;
        let now = Clock::get()?.unix_timestamp;
        emit!(RegistryPaused {
            paused_by: ctx.accounts.governance.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn unpause_registry(ctx: Context<ManageRegistryPause>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.validate()?;
        authorize_unpause(
            config.authority,
            ctx.accounts.governance.key(),
            config.active,
        )?;
        config.active = true;
        let now = Clock::get()?.unix_timestamp;
        emit!(RegistryUnpaused {
            unpaused_by: ctx.accounts.governance.key(),
            timestamp: now,
        });
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

    pub fn register_mirror(
        ctx: Context<RegisterMirror>,
        args: RegisterMirrorArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        validate_register_mirror(&args)?;
        let config = &ctx.accounts.config;
        let payload_hash = mirror_state_payload_hash(&args);
        let attestation = attestation::verify_register_mirror(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            payload_hash,
            args.attestation_nonce,
        )?;
        let registration_time = i64::try_from(args.registration_time)
            .map_err(|_| error!(MaivwError::InvalidMirrorState))?;
        let now = Clock::get()?.unix_timestamp;

        **ctx.accounts.domain_record = DomainRecord {
            schema_version: DOMAIN_SCHEMA_VERSION,
            bump: ctx.bumps.domain_record,
            kind: RecordKind::Mirror,
            domain_hash: args.domain_hash,
            domain: args.domain.clone(),
            origin: NetworkReference {
                family: args.origin_family,
                network_hash: attestation.origin_network_hash,
            },
            origin_registry: attestation.origin_registry,
            operational_key: args.operational_key,
            admin_key: args.admin_key,
            endpoint: args.endpoint.clone(),
            tls_fingerprint: args.tls_fingerprint,
            status: args.status,
            global_domain_epoch: attestation.global_domain_epoch,
            origin_sequence: attestation.origin_sequence,
            provider: Pubkey::default(),
            provider_tier: args.provider_tier,
            strikes: args.strikes,
            created_at: registration_time,
            updated_at: now,
            attested_stake: args.attested_stake,
            attested_daily_limit: args.attested_daily_limit,
            original_registration_amount: 0,
            current_stake: 0,
            origin_transaction: TransactionReference {
                family: args.origin_family,
                hash: attestation.evidence_hash,
            },
        };
        ctx.accounts
            .domain_record
            .validate(config.network_hash, ID.to_bytes())?;

        write_mirror_receipt(
            &mut ctx.accounts.attestation_receipt,
            ctx.bumps.attestation_receipt,
            &attestation,
            ctx.accounts.relayer.key(),
            now,
        )?;

        emit!(MirrorRegistered {
            domain_hash: args.domain_hash,
            origin_family: args.origin_family,
            origin_network_hash: attestation.origin_network_hash,
            origin_registry: attestation.origin_registry,
            global_domain_epoch: attestation.global_domain_epoch,
            origin_sequence: attestation.origin_sequence,
            operational_key: args.operational_key,
            admin_key: args.admin_key,
            status: args.status,
            is_provider: args.is_provider,
            provider_tier: args.provider_tier,
            attested_stake: args.attested_stake,
            attested_daily_limit: args.attested_daily_limit,
            origin_transaction: attestation.evidence_hash,
            attestation_nonce: args.attestation_nonce,
            relayer: ctx.accounts.relayer.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn sync_mirror(
        ctx: Context<SyncMirror>,
        args: SyncMirrorArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        validate_sync_mirror(&args)?;
        let config = &ctx.accounts.config;
        let domain = &ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Mirror),
            MaivwError::InvalidMirrorState
        );
        require!(
            domain.domain == args.domain && domain.origin.family == args.origin_family,
            MaivwError::MirrorOriginMismatch
        );

        let payload_hash = sync_mirror_payload_hash(&args);
        let attestation = attestation::verify_sync_mirror(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            domain.origin.network_hash,
            domain.origin_registry,
            payload_hash,
            args.attestation_nonce,
        )?;
        validate_sync_version(
            domain.global_domain_epoch,
            domain.origin_sequence,
            attestation.global_domain_epoch,
            attestation.origin_sequence,
        )?;
        let previous_global_domain_epoch = domain.global_domain_epoch;
        let previous_origin_sequence = domain.origin_sequence;
        let registration_time = i64::try_from(args.registration_time)
            .map_err(|_| error!(MaivwError::InvalidMirrorState))?;
        let now = Clock::get()?.unix_timestamp;

        write_mirror_receipt(
            &mut ctx.accounts.attestation_receipt,
            ctx.bumps.attestation_receipt,
            &attestation,
            ctx.accounts.relayer.key(),
            now,
        )?;

        let domain = &mut ctx.accounts.domain_record;
        domain.operational_key = args.operational_key;
        domain.admin_key = args.admin_key;
        domain.endpoint = args.endpoint.clone();
        domain.tls_fingerprint = args.tls_fingerprint;
        domain.status = args.status;
        domain.global_domain_epoch = attestation.global_domain_epoch;
        domain.origin_sequence = attestation.origin_sequence;
        domain.provider = Pubkey::default();
        domain.provider_tier = args.provider_tier;
        domain.strikes = args.strikes;
        domain.created_at = registration_time;
        domain.updated_at = now;
        domain.attested_stake = args.attested_stake;
        domain.attested_daily_limit = args.attested_daily_limit;
        domain.original_registration_amount = 0;
        domain.current_stake = 0;
        domain.origin_transaction = TransactionReference {
            family: args.origin_family,
            hash: attestation.evidence_hash,
        };
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(MirrorSynchronized {
            domain_hash: args.domain_hash,
            origin_family: args.origin_family,
            origin_network_hash: attestation.origin_network_hash,
            origin_registry: attestation.origin_registry,
            previous_global_domain_epoch,
            previous_origin_sequence,
            global_domain_epoch: attestation.global_domain_epoch,
            origin_sequence: attestation.origin_sequence,
            status: args.status,
            is_provider: args.is_provider,
            provider_tier: args.provider_tier,
            attested_stake: args.attested_stake,
            attested_daily_limit: args.attested_daily_limit,
            origin_transaction: attestation.evidence_hash,
            attestation_nonce: args.attestation_nonce,
            relayer: ctx.accounts.relayer.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn revoke_mirror(
        ctx: Context<RevokeMirror>,
        args: RevokeMirrorArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        validate_revoke_mirror(&args)?;
        let config = &ctx.accounts.config;
        let domain = &ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Mirror),
            MaivwError::InvalidMirrorState
        );
        require!(
            domain.domain == args.domain && domain.origin.family == args.origin_family,
            MaivwError::MirrorOriginMismatch
        );

        let payload_hash = revoke_mirror_payload_hash(&args);
        let attestation = attestation::verify_revoke_mirror(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            domain.origin.network_hash,
            domain.origin_registry,
            payload_hash,
            args.attestation_nonce,
        )?;
        validate_sync_version(
            domain.global_domain_epoch,
            domain.origin_sequence,
            attestation.global_domain_epoch,
            attestation.origin_sequence,
        )?;
        let previous_global_domain_epoch = domain.global_domain_epoch;
        let previous_origin_sequence = domain.origin_sequence;
        let registration_time = i64::try_from(args.registration_time)
            .map_err(|_| error!(MaivwError::InvalidMirrorState))?;
        let now = Clock::get()?.unix_timestamp;

        write_mirror_receipt(
            &mut ctx.accounts.attestation_receipt,
            ctx.bumps.attestation_receipt,
            &attestation,
            ctx.accounts.relayer.key(),
            now,
        )?;

        let domain = &mut ctx.accounts.domain_record;
        domain.operational_key = args.operational_key;
        domain.admin_key = args.admin_key;
        domain.endpoint = args.endpoint.clone();
        domain.tls_fingerprint = args.tls_fingerprint;
        domain.status = DomainStatus::Revoked;
        domain.global_domain_epoch = attestation.global_domain_epoch;
        domain.origin_sequence = attestation.origin_sequence;
        domain.provider = Pubkey::default();
        domain.provider_tier = args.provider_tier;
        domain.strikes = args.strikes;
        domain.created_at = registration_time;
        domain.updated_at = now;
        domain.attested_stake = args.attested_stake;
        domain.attested_daily_limit = args.attested_daily_limit;
        domain.original_registration_amount = 0;
        domain.current_stake = 0;
        domain.origin_transaction = TransactionReference {
            family: args.origin_family,
            hash: attestation.evidence_hash,
        };
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(MirrorRevoked {
            domain_hash: args.domain_hash,
            origin_family: args.origin_family,
            origin_network_hash: attestation.origin_network_hash,
            origin_registry: attestation.origin_registry,
            previous_global_domain_epoch,
            previous_origin_sequence,
            global_domain_epoch: attestation.global_domain_epoch,
            origin_sequence: attestation.origin_sequence,
            origin_transaction: attestation.evidence_hash,
            attestation_nonce: args.attestation_nonce,
            relayer: ctx.accounts.relayer.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn reclaim_domain(
        ctx: Context<ReclaimDomain>,
        args: ReclaimDomainArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Origin),
            MaivwError::MirrorReadOnly
        );
        require!(
            !matches!(domain.status, DomainStatus::Active),
            MaivwError::InvalidReclaimState
        );
        require!(
            domain.domain == args.domain
                && domain.domain_hash == args.domain_hash
                && domain.global_domain_epoch == args.current_global_domain_epoch,
            MaivwError::InvalidReclaimState
        );
        require!(
            matches!(domain.admin_key.algorithm, KeyAlgorithm::Ed25519SolanaPubkey),
            MaivwError::InvalidOriginReference
        );
        validate_endpoint(&args.endpoint)?;
        validate_mail_key(args.operational_key)?;
        require!(args.admin_key != [0; 32], MaivwError::InvalidNewDomainAdmin);

        let (payment, new_stake, daily_limit) = if matches!(args.tier, ProviderTier::None) {
            let split = split_standard_fee(config.standard_fee)?;
            (config.standard_fee, split.stake, 0)
        } else {
            let tier = config.tiers[args.tier.config_index()?];
            (tier.required_stake, tier.required_stake, tier.daily_limit)
        };
        let payload_hash = reclaim_payload_hash(
            &args,
            ctx.accounts.registrant.key(),
            ctx.accounts.mint.key(),
            domain.origin_sequence,
            payment,
        );
        let claim = attestation::verify_reclaim_claim(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            args.current_global_domain_epoch,
            domain.origin_sequence,
            payload_hash,
            args.claim_nonce,
        )?;

        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        require!(
            ctx.accounts.stake_vault.current_stake == domain.current_stake,
            MaivwError::InvalidStakeVault
        );
        let previous_admin = Pubkey::new_from_array(domain.admin_key.value);
        let residual_stake = domain.current_stake;
        let expected_vault_amount = ctx
            .accounts
            .stake_vault_token
            .amount
            .checked_sub(residual_stake)
            .and_then(|amount| amount.checked_add(new_stake))
            .ok_or_else(|| error!(MaivwError::InvalidStakeVault))?;

        if residual_stake > 0 {
            let previous_balance = ctx.accounts.previous_admin_token.amount;
            let bump = [ctx.accounts.stake_vault.bump];
            let vault_seeds: &[&[u8]] = &[STAKE_VAULT_SEED, args.domain_hash.as_ref(), &bump];
            transfer_tokens_signed(
                ctx.accounts.token_program.key(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.stake_vault_token.to_account_info(),
                ctx.accounts.previous_admin_token.to_account_info(),
                ctx.accounts.stake_vault.to_account_info(),
                residual_stake,
                config.asset_decimals,
                &[vault_seeds],
            )?;
            ctx.accounts.previous_admin_token.reload()?;
            require!(
                ctx.accounts.previous_admin_token.amount
                    == previous_balance
                        .checked_add(residual_stake)
                        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?,
                MaivwError::InvalidStakeVault
            );
        }

        if matches!(args.tier, ProviderTier::None) {
            let split = split_standard_fee(payment)?;
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
        }
        transfer_tokens(
            ctx.accounts.token_program.key(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.registrant_token.to_account_info(),
            ctx.accounts.stake_vault_token.to_account_info(),
            ctx.accounts.registrant.to_account_info(),
            new_stake,
            config.asset_decimals,
        )?;

        let now = Clock::get()?.unix_timestamp;
        write_receipt(
            &mut ctx.accounts.claim_receipt,
            ctx.bumps.claim_receipt,
            &claim,
            ctx.accounts.registrant.key(),
            now,
        )?;
        close_pending_processes(
            args.domain_hash,
            args.current_global_domain_epoch,
            &ctx.accounts.pending_admin.to_account_info(),
            &ctx.accounts.recovery_case.to_account_info(),
            &ctx.accounts.slash_case.to_account_info(),
            &ctx.accounts.registrant.to_account_info(),
        )?;

        let new_epoch = next_recovery_epoch(args.current_global_domain_epoch)?;
        let domain = &mut ctx.accounts.domain_record;
        domain.endpoint = args.endpoint.clone();
        domain.operational_key = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: args.operational_key,
        };
        domain.admin_key = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: args.admin_key,
        };
        domain.tls_fingerprint = args.tls_fingerprint;
        domain.status = DomainStatus::Active;
        domain.global_domain_epoch = new_epoch;
        domain.origin_sequence = 1;
        domain.provider = if args.is_provider() {
            ctx.accounts.registrant.key()
        } else {
            Pubkey::default()
        };
        domain.provider_tier = args.tier;
        domain.strikes = 0;
        domain.updated_at = now;
        domain.attested_stake = new_stake;
        domain.attested_daily_limit = daily_limit;
        domain.original_registration_amount = payment;
        domain.current_stake = new_stake;

        let stake_vault_bump = ctx.accounts.stake_vault.bump;
        write_stake_vault(
            &mut ctx.accounts.stake_vault,
            stake_vault_bump,
            args.domain_hash,
            ctx.accounts.mint.key(),
            ctx.accounts.stake_vault_token.key(),
            payment,
            new_stake,
        );
        ctx.accounts.stake_vault_token.reload()?;
        require!(
            ctx.accounts.stake_vault_token.amount == expected_vault_amount,
            MaivwError::InvalidStakeVault
        );
        ctx.accounts
            .stake_vault
            .validate(ctx.accounts.stake_vault_token.amount)?;
        domain.validate(config.network_hash, ID.to_bytes())?;

        emit!(DomainReclaimed {
            domain_hash: args.domain_hash,
            previous_global_domain_epoch: args.current_global_domain_epoch,
            global_domain_epoch: new_epoch,
            origin_sequence: domain.origin_sequence,
            previous_admin,
            new_admin: Pubkey::new_from_array(args.admin_key),
            registrant: ctx.accounts.registrant.key(),
            provider_tier: args.tier,
            residual_stake_released: residual_stake,
            payment,
            current_stake: new_stake,
            timestamp: now,
        });
        Ok(())
    }

    pub fn register_intent_batch(
        ctx: Context<RegisterIntentBatch>,
        args: RegisterIntentBatchArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        validate_intent_batch(
            &args,
            domain.kind,
            domain.status,
            domain.global_domain_epoch,
        )?;
        authorize_intent_batch(
            domain.operational_key,
            domain.admin_key,
            config.oracle_key,
            ctx.accounts.publisher.key(),
        )?;

        let now = Clock::get()?.unix_timestamp;
        domain.origin_sequence = next_origin_sequence(domain.origin_sequence)?;
        domain.updated_at = now;
        domain.validate(config.network_hash, ID.to_bytes())?;

        let batch = &mut ctx.accounts.intent_batch;
        ***batch = IntentBatch {
            schema_version: INTENT_BATCH_SCHEMA_VERSION,
            bump: ctx.bumps.intent_batch,
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            batch_nonce: args.batch_nonce,
            message_class_hash: maivw_attestation::keccak256(args.message_class.as_bytes()),
            message_class: args.message_class.clone(),
            merkle_root: args.merkle_root,
            registered_by: ctx.accounts.publisher.key(),
            registered_at: now,
            origin_sequence: domain.origin_sequence,
        };
        batch.validate()?;

        emit!(IntentBatchRegistered {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            batch_nonce: args.batch_nonce,
            message_class: args.message_class,
            message_class_hash: batch.message_class_hash,
            merkle_root: args.merkle_root,
            registered_by: ctx.accounts.publisher.key(),
            timestamp: now,
        });
        Ok(())
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
            sub_identity.global_domain_epoch = domain.global_domain_epoch;
            sub_identity.sub_identity_hash = args.sub_identity_hash;
        }
        require!(
            sub_identity.domain_hash == args.domain_hash
                && sub_identity.global_domain_epoch == domain.global_domain_epoch
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

    pub fn propose_domain_admin(
        ctx: Context<ProposeDomainAdmin>,
        args: ProposeDomainAdminArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        authorize_domain_admin(
            domain.kind,
            domain.status,
            domain.admin_key,
            ctx.accounts.current_admin.key(),
        )?;
        require!(
            domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidPendingAdmin
        );
        validate_new_admin(domain.admin_key, args.new_admin)?;

        let pending = &mut ctx.accounts.pending_admin;
        if pending.schema_version != 0 {
            pending.validate_identity(args.domain_hash, args.global_domain_epoch)?;
        }
        let now = Clock::get()?.unix_timestamp;
        ***pending = PendingAdmin {
            schema_version: PENDING_ADMIN_SCHEMA_VERSION,
            bump: ctx.bumps.pending_admin,
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            proposed_by: ctx.accounts.current_admin.key(),
            new_admin: args.new_admin,
            proposed_at: now,
            proposed_sequence: domain.origin_sequence,
            status: PendingAdminStatus::Pending,
            accepted_at: 0,
            accepted_sequence: 0,
        };
        pending.validate_identity(args.domain_hash, args.global_domain_epoch)?;

        emit!(DomainAdminProposed {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            current_admin: ctx.accounts.current_admin.key(),
            new_admin: args.new_admin,
            timestamp: now,
        });
        Ok(())
    }

    pub fn accept_domain_admin(
        ctx: Context<AcceptDomainAdmin>,
        args: AcceptDomainAdminArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Origin),
            MaivwError::MirrorReadOnly
        );
        require!(
            matches!(domain.status, DomainStatus::Active),
            MaivwError::InvalidDomainStatus
        );
        require!(
            domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidPendingAdmin
        );
        let pending = &mut ctx.accounts.pending_admin;
        pending.validate_identity(args.domain_hash, args.global_domain_epoch)?;
        authorize_pending_acceptance(pending, domain.admin_key, ctx.accounts.new_admin.key())?;

        let old_admin = Pubkey::new_from_array(domain.admin_key.value);
        let now = Clock::get()?.unix_timestamp;
        domain.admin_key = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: ctx.accounts.new_admin.key().to_bytes(),
        };
        domain.origin_sequence = next_origin_sequence(domain.origin_sequence)?;
        domain.updated_at = now;
        domain.validate(config.network_hash, ID.to_bytes())?;

        pending.status = PendingAdminStatus::Accepted;
        pending.accepted_at = now;
        pending.accepted_sequence = domain.origin_sequence;

        emit!(DomainAdminUpdated {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            old_admin,
            new_admin: ctx.accounts.new_admin.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn request_recovery(
        ctx: Context<RequestRecovery>,
        args: RequestRecoveryArgs,
        envelope: Vec<u8>,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Origin),
            MaivwError::MirrorReadOnly
        );
        require!(
            matches!(domain.status, DomainStatus::Active),
            MaivwError::InvalidDomainStatus
        );
        require!(
            domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidRecoveryCase
        );
        validate_recovery_keys(args.new_admin, args.new_operational_key)?;

        let payload_hash = recovery_payload_hash(&args, domain.origin_sequence);
        let authorization = attestation::verify_recovery(
            config,
            &ctx.accounts.instructions.to_account_info(),
            &envelope,
            args.domain_hash,
            args.global_domain_epoch,
            domain.origin_sequence,
            payload_hash,
            args.nonce,
        )?;
        let digest = authorization
            .digest()
            .map_err(|_| error!(MaivwError::InvalidAttestation))?;
        let now = Clock::get()?.unix_timestamp;
        let execute_after = recovery_execute_after(now, config.recovery_delay_seconds)?;

        let recovery = &mut ctx.accounts.recovery_case;
        if recovery.schema_version != 0 {
            require!(
                recovery.schema_version == RECOVERY_CASE_SCHEMA_VERSION
                    && recovery.domain_hash == args.domain_hash
                    && recovery.global_domain_epoch == args.global_domain_epoch
                    && !matches!(recovery.status, RecoveryStatus::Executed),
                MaivwError::InvalidRecoveryCase
            );
        }
        ***recovery = RecoveryCase {
            schema_version: RECOVERY_CASE_SCHEMA_VERSION,
            bump: ctx.bumps.recovery_case,
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            nonce: args.nonce,
            attestation_digest: digest,
            new_admin: args.new_admin,
            new_operational_key: args.new_operational_key,
            requested_by: ctx.accounts.requester.key(),
            requested_at: now,
            execute_after,
            status: RecoveryStatus::Pending,
            cancelled_by: Pubkey::default(),
            cancelled_at: 0,
            executed_by: Pubkey::default(),
            executed_at: 0,
            executed_epoch: 0,
            executed_sequence: 0,
        };
        recovery.validate_identity(args.domain_hash, args.global_domain_epoch, args.nonce)?;

        **ctx.accounts.recovery_receipt = RecoveryReceipt {
            schema_version: RECOVERY_RECEIPT_SCHEMA_VERSION,
            bump: ctx.bumps.recovery_receipt,
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            nonce: args.nonce,
            attestation_digest: digest,
            recovery_case: recovery.key(),
            consumed_by: ctx.accounts.requester.key(),
            consumed_at: now,
        };
        ctx.accounts.recovery_receipt.validate()?;

        emit!(RecoveryRequested {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            nonce: args.nonce,
            new_admin: args.new_admin,
            new_operational_key: args.new_operational_key,
            requested_by: ctx.accounts.requester.key(),
            requested_at: now,
            execute_after,
        });
        Ok(())
    }

    pub fn cancel_recovery(
        ctx: Context<CancelRecovery>,
        args: RecoveryCaseArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Origin),
            MaivwError::MirrorReadOnly
        );
        require!(
            domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidRecoveryCase
        );
        let recovery = &mut ctx.accounts.recovery_case;
        recovery.validate_identity(args.domain_hash, args.global_domain_epoch, args.nonce)?;
        authorize_recovery_cancellation(
            recovery,
            domain.admin_key,
            ctx.accounts.current_admin.key(),
        )?;

        let now = Clock::get()?.unix_timestamp;
        recovery.status = RecoveryStatus::Cancelled;
        recovery.cancelled_by = ctx.accounts.current_admin.key();
        recovery.cancelled_at = now;

        emit!(RecoveryCancelled {
            domain_hash: args.domain_hash,
            global_domain_epoch: args.global_domain_epoch,
            nonce: args.nonce,
            cancelled_by: ctx.accounts.current_admin.key(),
            timestamp: now,
        });
        Ok(())
    }

    pub fn execute_recovery(
        ctx: Context<ExecuteRecovery>,
        args: RecoveryCaseArgs,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        let domain = &mut ctx.accounts.domain_record;
        domain.validate(config.network_hash, ID.to_bytes())?;
        require!(
            matches!(domain.kind, RecordKind::Origin),
            MaivwError::MirrorReadOnly
        );
        require!(
            matches!(domain.status, DomainStatus::Active),
            MaivwError::InvalidDomainStatus
        );
        require!(
            domain.global_domain_epoch == args.global_domain_epoch,
            MaivwError::InvalidRecoveryCase
        );
        let recovery = &mut ctx.accounts.recovery_case;
        recovery.validate_identity(args.domain_hash, args.global_domain_epoch, args.nonce)?;
        let now = Clock::get()?.unix_timestamp;
        authorize_recovery_execution(recovery, now)?;

        let old_admin = Pubkey::new_from_array(domain.admin_key.value);
        let old_operational_key = domain.operational_key.value;
        let new_epoch = next_recovery_epoch(domain.global_domain_epoch)?;
        domain.admin_key = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: recovery.new_admin.to_bytes(),
        };
        domain.operational_key = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: recovery.new_operational_key,
        };
        domain.global_domain_epoch = new_epoch;
        domain.origin_sequence = 1;
        domain.updated_at = now;
        domain.validate(config.network_hash, ID.to_bytes())?;

        recovery.status = RecoveryStatus::Executed;
        recovery.executed_by = ctx.accounts.executor.key();
        recovery.executed_at = now;
        recovery.executed_epoch = new_epoch;
        recovery.executed_sequence = domain.origin_sequence;

        emit!(RecoveryExecuted {
            domain_hash: args.domain_hash,
            previous_global_domain_epoch: args.global_domain_epoch,
            global_domain_epoch: new_epoch,
            origin_sequence: domain.origin_sequence,
            nonce: args.nonce,
            old_admin,
            new_admin: recovery.new_admin,
            old_operational_key,
            new_operational_key: recovery.new_operational_key,
            executed_by: ctx.accounts.executor.key(),
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
pub struct ManageRegistryPause<'info> {
    pub governance: Signer<'info>,
    #[account(
        mut,
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
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
#[instruction(args: RegisterMirrorArgs)]
pub struct RegisterMirror<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        init,
        payer = relayer,
        space = DomainRecord::SPACE,
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init,
        payer = relayer,
        space = MirrorAttestationReceipt::SPACE,
        seeds = [
            MIRROR_ATTESTATION_RECEIPT_SEED,
            args.domain_hash.as_ref(),
            args.attestation_nonce.as_ref()
        ],
        bump
    )]
    pub attestation_receipt: Box<Account<'info, MirrorAttestationReceipt>>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(address = solana_instructions_sysvar::ID @ MaivwError::InvalidInstructionsSysvar)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: SyncMirrorArgs)]
pub struct SyncMirror<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
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
    #[account(
        init,
        payer = relayer,
        space = MirrorAttestationReceipt::SPACE,
        seeds = [
            MIRROR_ATTESTATION_RECEIPT_SEED,
            args.domain_hash.as_ref(),
            args.attestation_nonce.as_ref()
        ],
        bump
    )]
    pub attestation_receipt: Box<Account<'info, MirrorAttestationReceipt>>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(address = solana_instructions_sysvar::ID @ MaivwError::InvalidInstructionsSysvar)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: RevokeMirrorArgs)]
pub struct RevokeMirror<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
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
    #[account(
        init,
        payer = relayer,
        space = MirrorAttestationReceipt::SPACE,
        seeds = [
            MIRROR_ATTESTATION_RECEIPT_SEED,
            args.domain_hash.as_ref(),
            args.attestation_nonce.as_ref()
        ],
        bump
    )]
    pub attestation_receipt: Box<Account<'info, MirrorAttestationReceipt>>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(address = solana_instructions_sysvar::ID @ MaivwError::InvalidInstructionsSysvar)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ReclaimDomainArgs)]
pub struct ReclaimDomain<'info> {
    #[account(mut)]
    pub registrant: Signer<'info>,
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
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.current_global_domain_epoch
            @ MaivwError::InvalidReclaimState
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
        mut,
        seeds = [STAKE_VAULT_SEED, args.domain_hash.as_ref()],
        bump = stake_vault.bump,
        constraint = stake_vault.domain_hash == args.domain_hash @ MaivwError::InvalidStakeVault,
        constraint = stake_vault.mint == mint.key() @ MaivwError::InvalidAsset
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
    /// CHECK: previous Ed25519 admin owns the ATA that receives residual stake.
    #[account(
        address = Pubkey::new_from_array(domain_record.admin_key.value)
            @ MaivwError::UnauthorizedDomainAdmin
    )]
    pub previous_admin: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = registrant,
        associated_token::mint = mint,
        associated_token::authority = previous_admin,
        associated_token::token_program = token_program
    )]
    pub previous_admin_token: Box<Account<'info, TokenAccount>>,
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
        mut,
        associated_token::mint = mint,
        associated_token::authority = stake_vault,
        associated_token::token_program = token_program,
        constraint = stake_vault.token_account == stake_vault_token.key()
            @ MaivwError::InvalidStakeVault
    )]
    pub stake_vault_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: canonical optional PDA; handler closes it only when it contains a pending proposal.
    #[account(
        mut,
        seeds = [
            PENDING_ADMIN_SEED,
            args.domain_hash.as_ref(),
            args.current_global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_admin: UncheckedAccount<'info>,
    /// CHECK: canonical optional PDA; handler closes it only when recovery is pending.
    #[account(
        mut,
        seeds = [
            RECOVERY_CASE_SEED,
            args.domain_hash.as_ref(),
            args.current_global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub recovery_case: UncheckedAccount<'info>,
    /// CHECK: canonical optional PDA; handler closes it only when slash is pending.
    #[account(
        mut,
        seeds = [
            SLASH_CASE_SEED,
            args.domain_hash.as_ref(),
            args.current_global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub slash_case: UncheckedAccount<'info>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(address = solana_instructions_sysvar::ID @ MaivwError::InvalidInstructionsSysvar)]
    pub instructions: UncheckedAccount<'info>,
    #[account(address = config.token_program @ MaivwError::InvalidAsset)]
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: RegisterIntentBatchArgs)]
pub struct RegisterIntentBatch<'info> {
    #[account(mut)]
    pub publisher: Signer<'info>,
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
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.global_domain_epoch
            @ MaivwError::InvalidIntentBatch
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init,
        payer = publisher,
        space = IntentBatch::SPACE,
        seeds = [
            INTENT_BATCH_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref(),
            args.batch_nonce.as_ref()
        ],
        bump
    )]
    pub intent_batch: Box<Account<'info, IntentBatch>>,
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
            domain_record.global_domain_epoch.to_le_bytes().as_ref(),
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

#[derive(Accounts)]
#[instruction(args: ProposeDomainAdminArgs)]
pub struct ProposeDomainAdmin<'info> {
    #[account(mut)]
    pub current_admin: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.global_domain_epoch
            @ MaivwError::InvalidPendingAdmin
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init_if_needed,
        payer = current_admin,
        space = PendingAdmin::SPACE,
        seeds = [
            PENDING_ADMIN_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub pending_admin: Box<Account<'info, PendingAdmin>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: AcceptDomainAdminArgs)]
pub struct AcceptDomainAdmin<'info> {
    pub new_admin: Signer<'info>,
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
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.global_domain_epoch
            @ MaivwError::InvalidPendingAdmin
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        mut,
        seeds = [
            PENDING_ADMIN_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump = pending_admin.bump
    )]
    pub pending_admin: Box<Account<'info, PendingAdmin>>,
}

#[derive(Accounts)]
#[instruction(args: RequestRecoveryArgs)]
pub struct RequestRecovery<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        seeds = [REGISTRY_CONFIG_SEED],
        bump = config.bump,
        constraint = config.active @ MaivwError::RegistryPaused
    )]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.global_domain_epoch
            @ MaivwError::InvalidRecoveryCase
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        init_if_needed,
        payer = requester,
        space = RecoveryCase::SPACE,
        seeds = [
            RECOVERY_CASE_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub recovery_case: Box<Account<'info, RecoveryCase>>,
    #[account(
        init,
        payer = requester,
        space = RecoveryReceipt::SPACE,
        seeds = [
            RECOVERY_RECEIPT_SEED,
            args.domain_hash.as_ref(),
            args.nonce.as_ref()
        ],
        bump
    )]
    pub recovery_receipt: Box<Account<'info, RecoveryReceipt>>,
    /// CHECK: constrained to Solana's instructions sysvar address.
    #[account(
        address = solana_instructions_sysvar::ID
            @ MaivwError::InvalidInstructionsSysvar
    )]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: RecoveryCaseArgs)]
pub struct CancelRecovery<'info> {
    pub current_admin: Signer<'info>,
    #[account(seeds = [REGISTRY_CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RegistryConfig>>,
    #[account(
        seeds = [DOMAIN_RECORD_SEED, args.domain_hash.as_ref()],
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.global_domain_epoch
            @ MaivwError::InvalidRecoveryCase
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        mut,
        seeds = [
            RECOVERY_CASE_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump = recovery_case.bump
    )]
    pub recovery_case: Box<Account<'info, RecoveryCase>>,
}

#[derive(Accounts)]
#[instruction(args: RecoveryCaseArgs)]
pub struct ExecuteRecovery<'info> {
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
        bump = domain_record.bump,
        constraint = domain_record.domain_hash == args.domain_hash @ MaivwError::InvalidDomainHash,
        constraint = domain_record.global_domain_epoch == args.global_domain_epoch
            @ MaivwError::InvalidRecoveryCase
    )]
    pub domain_record: Box<Account<'info, DomainRecord>>,
    #[account(
        mut,
        seeds = [
            RECOVERY_CASE_SEED,
            args.domain_hash.as_ref(),
            args.global_domain_epoch.to_le_bytes().as_ref()
        ],
        bump = recovery_case.bump
    )]
    pub recovery_case: Box<Account<'info, RecoveryCase>>,
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
pub struct RegistryPaused {
    pub paused_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RegistryUnpaused {
    pub unpaused_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MirrorRegistered {
    pub domain_hash: [u8; 32],
    pub origin_family: NetworkFamily,
    pub origin_network_hash: [u8; 32],
    pub origin_registry: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub operational_key: KeyDescriptor,
    pub admin_key: KeyDescriptor,
    pub status: DomainStatus,
    pub is_provider: bool,
    pub provider_tier: ProviderTier,
    pub attested_stake: u64,
    pub attested_daily_limit: u64,
    pub origin_transaction: [u8; 32],
    pub attestation_nonce: [u8; 32],
    pub relayer: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MirrorSynchronized {
    pub domain_hash: [u8; 32],
    pub origin_family: NetworkFamily,
    pub origin_network_hash: [u8; 32],
    pub origin_registry: [u8; 32],
    pub previous_global_domain_epoch: u64,
    pub previous_origin_sequence: u64,
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub status: DomainStatus,
    pub is_provider: bool,
    pub provider_tier: ProviderTier,
    pub attested_stake: u64,
    pub attested_daily_limit: u64,
    pub origin_transaction: [u8; 32],
    pub attestation_nonce: [u8; 32],
    pub relayer: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MirrorRevoked {
    pub domain_hash: [u8; 32],
    pub origin_family: NetworkFamily,
    pub origin_network_hash: [u8; 32],
    pub origin_registry: [u8; 32],
    pub previous_global_domain_epoch: u64,
    pub previous_origin_sequence: u64,
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub origin_transaction: [u8; 32],
    pub attestation_nonce: [u8; 32],
    pub relayer: Pubkey,
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

#[event]
pub struct DomainAdminProposed {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub current_admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DomainAdminUpdated {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RecoveryRequested {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub nonce: [u8; 32],
    pub new_admin: Pubkey,
    pub new_operational_key: [u8; 32],
    pub requested_by: Pubkey,
    pub requested_at: i64,
    pub execute_after: i64,
}

#[event]
pub struct RecoveryCancelled {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub nonce: [u8; 32],
    pub cancelled_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RecoveryExecuted {
    pub domain_hash: [u8; 32],
    pub previous_global_domain_epoch: u64,
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub nonce: [u8; 32],
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub old_operational_key: [u8; 32],
    pub new_operational_key: [u8; 32],
    pub executed_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DomainReclaimed {
    pub domain_hash: [u8; 32],
    pub previous_global_domain_epoch: u64,
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
    pub registrant: Pubkey,
    pub provider_tier: ProviderTier,
    pub residual_stake_released: u64,
    pub payment: u64,
    pub current_stake: u64,
    pub timestamp: i64,
}

#[event]
pub struct IntentBatchRegistered {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub batch_nonce: [u8; 32],
    pub message_class: String,
    pub message_class_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub registered_by: Pubkey,
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

fn write_mirror_receipt(
    receipt: &mut MirrorAttestationReceipt,
    bump: u8,
    attestation: &maivw_attestation::AttestationV1,
    relayer: Pubkey,
    now: i64,
) -> Result<()> {
    *receipt = MirrorAttestationReceipt {
        schema_version: MIRROR_ATTESTATION_RECEIPT_SCHEMA_VERSION,
        bump,
        domain_hash: attestation.domain_hash,
        origin_network_hash: attestation.origin_network_hash,
        origin_registry: attestation.origin_registry,
        global_domain_epoch: attestation.global_domain_epoch,
        origin_sequence: attestation.origin_sequence,
        nonce: attestation.nonce,
        attestation_digest: attestation
            .digest()
            .map_err(|_| error!(MaivwError::InvalidAttestation))?,
        action: attestation.action as u8,
        consumed_by: relayer,
        consumed_at: now,
    };
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
