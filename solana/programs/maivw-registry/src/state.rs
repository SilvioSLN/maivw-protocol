use anchor_lang::prelude::*;

use crate::{
    constants::{
        DOMAIN_RECORD_SEED, DOMAIN_SCHEMA_VERSION, MAX_DOMAIN_LEN, MAX_ENDPOINT_LEN,
        MIN_STRIKES_TO_DRAIN, ORIGIN_CLAIM_RECEIPT_SEED, PROVIDER_TIER_COUNT,
        RECEIPT_SCHEMA_VERSION, REGISTRY_CONFIG_SEED, REGISTRY_SCHEMA_VERSION,
        REPORTER_CLAIM_SCHEMA_VERSION, REPORTER_CLAIM_SEED, REPORTER_POOL_SCHEMA_VERSION,
        REPORTER_POOL_SEED, SLASH_CASE_SCHEMA_VERSION, SLASH_CASE_SEED, STAKE_VAULT_SCHEMA_VERSION,
        STAKE_VAULT_SEED, SUB_IDENTITY_STRIKE_SCHEMA_VERSION, SUB_IDENTITY_STRIKE_SEED,
    },
    error::MaivwError,
    ID,
};

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkFamily {
    Evm,
    Solana,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyAlgorithm {
    None,
    Secp256k1EvmAddress,
    Ed25519SolanaPubkey,
    Ed25519Raw,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordKind {
    Origin,
    Mirror,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainStatus {
    Active,
    Suspended,
    Revoked,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum SlashCaseStatus {
    Pending,
    Vetoed,
    Executed,
}

#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderTier {
    None,
    Basic,
    Trusted,
    Institutional,
}

impl ProviderTier {
    pub fn config_index(self) -> Result<usize> {
        match self {
            Self::Basic => Ok(0),
            Self::Trusted => Ok(1),
            Self::Institutional => Ok(2),
            Self::None => err!(MaivwError::InvalidProviderTier),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct NetworkReference {
    pub family: NetworkFamily,
    pub network_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct KeyDescriptor {
    pub algorithm: KeyAlgorithm,
    pub value: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransactionReference {
    pub family: NetworkFamily,
    pub hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderTierConfig {
    pub required_stake: u64,
    pub daily_limit: u64,
    pub penalty_per_strike: u64,
}

#[account]
#[derive(Debug)]
pub struct RegistryConfig {
    pub schema_version: u16,
    pub bump: u8,
    pub active: bool,
    pub authority: Pubkey,
    pub guardian: Pubkey,
    pub oracle_key: [u8; 32],
    pub asset_mint: Pubkey,
    pub token_program: Pubkey,
    pub asset_decimals: u8,
    pub treasury: Pubkey,
    pub founder: Pubkey,
    pub network_hash: [u8; 32],
    pub standard_fee: u64,
    pub provider_fee: u64,
    pub mirror_fee: u64,
    pub slash_delay_seconds: u64,
    pub recovery_delay_seconds: u64,
    pub tiers: [ProviderTierConfig; PROVIDER_TIER_COUNT],
    pub created_at: i64,
}

impl RegistryConfig {
    pub const DATA_LEN: usize = 381;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[REGISTRY_CONFIG_SEED], &ID)
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.schema_version == REGISTRY_SCHEMA_VERSION,
            MaivwError::InvalidRegistryConfig
        );
        let roles = [self.authority, self.guardian, self.treasury, self.founder];
        require!(
            roles.iter().all(|key| *key != Pubkey::default())
                && roles
                    .iter()
                    .enumerate()
                    .all(|(index, key)| !roles[index + 1..].contains(key))
                && self.asset_mint != Pubkey::default(),
            MaivwError::InvalidRegistryConfig
        );
        require!(
            self.authority != self.guardian
                && self.treasury != self.founder
                && self.oracle_key != [0; 32]
                && self.network_hash != [0; 32]
                && self.token_program == anchor_spl::token::ID
                && self.standard_fee > 0
                && self.provider_fee > 0
                && self.mirror_fee > 0
                && self.slash_delay_seconds > 0
                && self.recovery_delay_seconds > 0,
            MaivwError::InvalidRegistryConfig
        );

        for tier in self.tiers {
            require!(
                tier.required_stake > 0
                    && tier.daily_limit > 0
                    && tier.penalty_per_strike > 0
                    && tier
                        .penalty_per_strike
                        .checked_mul(MIN_STRIKES_TO_DRAIN)
                        .is_some_and(|maximum| maximum <= tier.required_stake),
                MaivwError::InvalidRegistryConfig
            );
        }
        require!(
            self.tiers.windows(2).all(|pair| {
                pair[0].required_stake < pair[1].required_stake
                    && pair[0].daily_limit < pair[1].daily_limit
            }),
            MaivwError::InvalidRegistryConfig
        );
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct DomainRecord {
    pub schema_version: u16,
    pub bump: u8,
    pub kind: RecordKind,
    pub domain_hash: [u8; 32],
    pub domain: String,
    pub origin: NetworkReference,
    pub origin_registry: [u8; 32],
    pub operational_key: KeyDescriptor,
    pub admin_key: KeyDescriptor,
    pub endpoint: String,
    pub tls_fingerprint: [u8; 32],
    pub status: DomainStatus,
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub provider: Pubkey,
    pub provider_tier: ProviderTier,
    pub strikes: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub attested_stake: u64,
    pub attested_daily_limit: u64,
    pub original_registration_amount: u64,
    pub current_stake: u64,
    pub origin_transaction: TransactionReference,
}

impl DomainRecord {
    pub const DATA_LEN: usize = 2
        + 1
        + 1
        + 32
        + 4
        + MAX_DOMAIN_LEN
        + 33
        + 32
        + 33
        + 33
        + 4
        + MAX_ENDPOINT_LEN
        + 32
        + 1
        + 8
        + 8
        + 32
        + 1
        + 4
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 33;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(domain_hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[DOMAIN_RECORD_SEED, domain_hash], &ID)
    }

    pub fn validate(&self, local_network_hash: [u8; 32], local_registry: [u8; 32]) -> Result<()> {
        require!(
            self.schema_version == DOMAIN_SCHEMA_VERSION,
            MaivwError::InvalidDomainRecord
        );
        require!(is_canonical_domain(&self.domain), MaivwError::InvalidDomain);
        require!(
            self.domain_hash == maivw_attestation::keccak256(self.domain.as_bytes()),
            MaivwError::InvalidDomainHash
        );
        require!(
            !self.endpoint.is_empty()
                && self.endpoint.len() <= MAX_ENDPOINT_LEN
                && self.operational_key.value != [0; 32]
                && self.admin_key.value != [0; 32],
            MaivwError::InvalidDomainRecord
        );
        require!(
            !matches!(self.operational_key.algorithm, KeyAlgorithm::None)
                && !matches!(self.admin_key.algorithm, KeyAlgorithm::None),
            MaivwError::InvalidDomainRecord
        );

        match self.kind {
            RecordKind::Origin => {
                require!(
                    matches!(self.origin.family, NetworkFamily::Solana)
                        && self.origin.network_hash == local_network_hash
                        && self.origin_registry == local_registry
                        && matches!(
                            self.operational_key.algorithm,
                            KeyAlgorithm::Ed25519SolanaPubkey
                        )
                        && matches!(self.admin_key.algorithm, KeyAlgorithm::Ed25519SolanaPubkey),
                    MaivwError::InvalidOriginReference
                );
                require!(
                    self.original_registration_amount > 0
                        && self.attested_stake == self.current_stake
                        && (!matches!(self.status, DomainStatus::Active) || self.current_stake > 0),
                    MaivwError::InvalidDomainRecord
                );
                match self.provider_tier {
                    ProviderTier::None => require!(
                        self.provider == Pubkey::default()
                            && self.attested_daily_limit == 0
                            && self.current_stake <= self.original_registration_amount,
                        MaivwError::InvalidDomainRecord
                    ),
                    _ => require!(
                        self.provider != Pubkey::default() && self.attested_daily_limit > 0,
                        MaivwError::InvalidDomainRecord
                    ),
                }
            }
            RecordKind::Mirror => require!(
                self.origin.network_hash != local_network_hash
                    || self.origin_registry != local_registry,
                MaivwError::InvalidMirrorReference
            ),
        }
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct OriginClaimReceipt {
    pub schema_version: u16,
    pub bump: u8,
    pub domain_hash: [u8; 32],
    pub origin_network_hash: [u8; 32],
    pub origin_registry: [u8; 32],
    pub nonce: [u8; 32],
    pub attestation_digest: [u8; 32],
    pub consumed_by: Pubkey,
    pub consumed_at: i64,
}

impl OriginClaimReceipt {
    pub const DATA_LEN: usize = 203;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(domain_hash: &[u8; 32], nonce: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[ORIGIN_CLAIM_RECEIPT_SEED, domain_hash, nonce], &ID)
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.schema_version == RECEIPT_SCHEMA_VERSION
                && self.domain_hash != [0; 32]
                && self.origin_network_hash != [0; 32]
                && self.origin_registry != [0; 32]
                && self.nonce != [0; 32]
                && self.attestation_digest != [0; 32]
                && self.consumed_by != Pubkey::default(),
            MaivwError::InvalidOriginClaim
        );
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct StakeVault {
    pub schema_version: u16,
    pub bump: u8,
    pub domain_hash: [u8; 32],
    pub mint: Pubkey,
    pub token_account: Pubkey,
    pub original_registration_amount: u64,
    pub current_stake: u64,
}

impl StakeVault {
    pub const DATA_LEN: usize = 115;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(domain_hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[STAKE_VAULT_SEED, domain_hash], &ID)
    }

    pub fn validate(&self, token_amount: u64) -> Result<()> {
        require!(
            self.schema_version == STAKE_VAULT_SCHEMA_VERSION
                && self.domain_hash != [0; 32]
                && self.mint != Pubkey::default()
                && self.token_account != Pubkey::default()
                && self.original_registration_amount > 0
                && token_amount >= self.current_stake,
            MaivwError::InvalidStakeVault
        );
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct SubIdentityStrike {
    pub schema_version: u16,
    pub bump: u8,
    pub domain_hash: [u8; 32],
    pub sub_identity_hash: [u8; 32],
    pub strikes: u32,
    pub last_warned_at: i64,
}

impl SubIdentityStrike {
    pub const DATA_LEN: usize = 79;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(domain_hash: &[u8; 32], sub_identity_hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[SUB_IDENTITY_STRIKE_SEED, domain_hash, sub_identity_hash],
            &ID,
        )
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.schema_version == SUB_IDENTITY_STRIKE_SCHEMA_VERSION
                && self.domain_hash != [0; 32]
                && self.sub_identity_hash != [0; 32]
                && self.strikes > 0,
            MaivwError::InvalidSubIdentity
        );
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct SlashCase {
    pub schema_version: u16,
    pub bump: u8,
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub reporter_root: [u8; 32],
    pub reporter_count: u32,
    pub proposed_by: Pubkey,
    pub proposed_at: i64,
    pub execute_after: i64,
    pub status: SlashCaseStatus,
    pub vetoed_by: Pubkey,
    pub vetoed_at: i64,
    pub executed_at: i64,
    pub stake_slashed: u64,
    pub reporter_pool_amount: u64,
    pub burned_amount: u64,
    pub origin_sequence: u64,
}

impl SlashCase {
    pub const DATA_LEN: usize = 240;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(domain_hash: &[u8; 32], global_domain_epoch: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                SLASH_CASE_SEED,
                domain_hash,
                global_domain_epoch.to_le_bytes().as_ref(),
            ],
            &ID,
        )
    }

    pub fn validate_identity(
        &self,
        domain_hash: [u8; 32],
        global_domain_epoch: u64,
        case_nonce: [u8; 32],
    ) -> Result<()> {
        require!(
            self.schema_version == SLASH_CASE_SCHEMA_VERSION
                && self.domain_hash == domain_hash
                && self.global_domain_epoch == global_domain_epoch
                && self.case_nonce == case_nonce
                && self.case_nonce != [0; 32]
                && self.proposed_by != Pubkey::default()
                && self.execute_after >= self.proposed_at,
            MaivwError::InvalidSlashCase
        );
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct ReporterPool {
    pub schema_version: u16,
    pub bump: u8,
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub mint: Pubkey,
    pub token_account: Pubkey,
    pub reporter_root: [u8; 32],
    pub reporter_count: u32,
    pub per_reporter: u64,
    pub total_allocated: u64,
    pub claimed_amount: u64,
    pub claimed_count: u32,
    pub created_at: i64,
}

impl ReporterPool {
    pub const DATA_LEN: usize = 211;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(domain_hash: &[u8; 32], global_domain_epoch: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                REPORTER_POOL_SEED,
                domain_hash,
                global_domain_epoch.to_le_bytes().as_ref(),
            ],
            &ID,
        )
    }

    pub fn validate(&self, token_amount: u64) -> Result<()> {
        let unclaimed = self
            .total_allocated
            .checked_sub(self.claimed_amount)
            .ok_or_else(|| error!(MaivwError::InvalidReporterPool))?;
        require!(
            self.schema_version == REPORTER_POOL_SCHEMA_VERSION
                && self.domain_hash != [0; 32]
                && self.case_nonce != [0; 32]
                && self.mint != Pubkey::default()
                && self.token_account != Pubkey::default()
                && self.claimed_count <= self.reporter_count
                && self
                    .per_reporter
                    .checked_mul(u64::from(self.reporter_count))
                    == Some(self.total_allocated)
                && token_amount >= unclaimed
                && ((self.reporter_count == 0
                    && self.reporter_root == [0; 32]
                    && self.total_allocated == 0)
                    || (self.reporter_count > 0 && self.reporter_root != [0; 32])),
            MaivwError::InvalidReporterPool
        );
        Ok(())
    }
}

#[account]
#[derive(Debug)]
pub struct ReporterClaim {
    pub schema_version: u16,
    pub bump: u8,
    pub reporter_pool: Pubkey,
    pub reporter: Pubkey,
    pub leaf: [u8; 32],
    pub amount: u64,
    pub claimed_at: i64,
}

impl ReporterClaim {
    pub const DATA_LEN: usize = 115;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda(reporter_pool: &Pubkey, reporter: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                REPORTER_CLAIM_SEED,
                reporter_pool.as_ref(),
                reporter.as_ref(),
            ],
            &ID,
        )
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.schema_version == REPORTER_CLAIM_SCHEMA_VERSION
                && self.reporter_pool != Pubkey::default()
                && self.reporter != Pubkey::default()
                && self.leaf != [0; 32]
                && self.amount > 0,
            MaivwError::InvalidReporterClaim
        );
        Ok(())
    }
}

fn is_canonical_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= MAX_DOMAIN_LEN
        && domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .as_bytes()
                    .last()
                    .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::AccountSerialize;

    fn record(kind: RecordKind, local_network: [u8; 32], local_registry: [u8; 32]) -> DomainRecord {
        let domain = "mail.example".to_owned();
        DomainRecord {
            schema_version: 1,
            bump: 255,
            kind,
            domain_hash: maivw_attestation::keccak256(domain.as_bytes()),
            domain,
            origin: NetworkReference {
                family: NetworkFamily::Solana,
                network_hash: local_network,
            },
            origin_registry: local_registry,
            operational_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
                value: [4; 32],
            },
            admin_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
                value: [5; 32],
            },
            endpoint: "https://mail.example".to_owned(),
            tls_fingerprint: [6; 32],
            status: DomainStatus::Active,
            global_domain_epoch: u64::MAX,
            origin_sequence: u64::MAX,
            provider: Pubkey::new_unique(),
            provider_tier: ProviderTier::Institutional,
            strikes: u32::MAX,
            created_at: i64::MAX,
            updated_at: i64::MAX,
            attested_stake: u64::MAX,
            attested_daily_limit: u64::MAX,
            original_registration_amount: u64::MAX,
            current_stake: u64::MAX,
            origin_transaction: TransactionReference {
                family: NetworkFamily::Evm,
                hash: [7; 32],
            },
        }
    }

    fn config() -> RegistryConfig {
        RegistryConfig {
            schema_version: 1,
            bump: RegistryConfig::pda().1,
            active: true,
            authority: Pubkey::new_unique(),
            guardian: Pubkey::new_unique(),
            oracle_key: [1; 32],
            asset_mint: Pubkey::new_unique(),
            token_program: anchor_spl::token::ID,
            asset_decimals: 9,
            treasury: Pubkey::new_unique(),
            founder: Pubkey::new_unique(),
            network_hash: [2; 32],
            standard_fee: 1,
            provider_fee: 2,
            mirror_fee: 1,
            slash_delay_seconds: 60,
            recovery_delay_seconds: 60,
            tiers: [
                ProviderTierConfig {
                    required_stake: 10,
                    daily_limit: 100,
                    penalty_per_strike: 1,
                },
                ProviderTierConfig {
                    required_stake: 20,
                    daily_limit: 200,
                    penalty_per_strike: 2,
                },
                ProviderTierConfig {
                    required_stake: 30,
                    daily_limit: 300,
                    penalty_per_strike: 3,
                },
            ],
            created_at: 1,
        }
    }

    #[test]
    fn declared_spaces_cover_maximum_serialized_accounts() {
        let mut record = record(RecordKind::Mirror, [2; 32], [3; 32]);
        record.domain = "a".repeat(MAX_DOMAIN_LEN);
        record.endpoint = "e".repeat(MAX_ENDPOINT_LEN);
        let mut bytes = Vec::new();
        record.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), DomainRecord::SPACE);

        let mut config_bytes = Vec::new();
        config().try_serialize(&mut config_bytes).unwrap();
        assert_eq!(config_bytes.len(), RegistryConfig::SPACE);

        let receipt = OriginClaimReceipt {
            schema_version: RECEIPT_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            origin_network_hash: [2; 32],
            origin_registry: [3; 32],
            nonce: [4; 32],
            attestation_digest: [5; 32],
            consumed_by: Pubkey::new_unique(),
            consumed_at: 1,
        };
        let mut receipt_bytes = Vec::new();
        receipt.try_serialize(&mut receipt_bytes).unwrap();
        assert_eq!(receipt_bytes.len(), OriginClaimReceipt::SPACE);
        assert!(receipt.validate().is_ok());

        let vault = StakeVault {
            schema_version: STAKE_VAULT_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            mint: Pubkey::new_unique(),
            token_account: Pubkey::new_unique(),
            original_registration_amount: 100,
            current_stake: 65,
        };
        let mut vault_bytes = Vec::new();
        vault.try_serialize(&mut vault_bytes).unwrap();
        assert_eq!(vault_bytes.len(), StakeVault::SPACE);
        assert!(vault.validate(65).is_ok());
        assert!(vault.validate(66).is_ok());
        assert!(vault.validate(64).is_err());

        let strike = SubIdentityStrike {
            schema_version: SUB_IDENTITY_STRIKE_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            sub_identity_hash: [2; 32],
            strikes: 1,
            last_warned_at: 1,
        };
        let mut strike_bytes = Vec::new();
        strike.try_serialize(&mut strike_bytes).unwrap();
        assert_eq!(strike_bytes.len(), SubIdentityStrike::SPACE);
        assert!(strike.validate().is_ok());

        let slash_case = SlashCase {
            schema_version: SLASH_CASE_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            global_domain_epoch: 2,
            case_nonce: [3; 32],
            reporter_root: [4; 32],
            reporter_count: 5,
            proposed_by: Pubkey::new_unique(),
            proposed_at: 6,
            execute_after: 7,
            status: SlashCaseStatus::Pending,
            vetoed_by: Pubkey::default(),
            vetoed_at: 0,
            executed_at: 0,
            stake_slashed: 0,
            reporter_pool_amount: 0,
            burned_amount: 0,
            origin_sequence: 0,
        };
        let mut slash_case_bytes = Vec::new();
        slash_case.try_serialize(&mut slash_case_bytes).unwrap();
        assert_eq!(slash_case_bytes.len(), SlashCase::SPACE);
        assert!(slash_case.validate_identity([1; 32], 2, [3; 32]).is_ok());

        let pool = ReporterPool {
            schema_version: REPORTER_POOL_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            global_domain_epoch: 2,
            case_nonce: [3; 32],
            mint: Pubkey::new_unique(),
            token_account: Pubkey::new_unique(),
            reporter_root: [4; 32],
            reporter_count: 5,
            per_reporter: 10,
            total_allocated: 50,
            claimed_amount: 20,
            claimed_count: 2,
            created_at: 8,
        };
        let mut pool_bytes = Vec::new();
        pool.try_serialize(&mut pool_bytes).unwrap();
        assert_eq!(pool_bytes.len(), ReporterPool::SPACE);
        assert!(pool.validate(30).is_ok());

        let claim = ReporterClaim {
            schema_version: REPORTER_CLAIM_SCHEMA_VERSION,
            bump: 1,
            reporter_pool: Pubkey::new_unique(),
            reporter: Pubkey::new_unique(),
            leaf: [5; 32],
            amount: 10,
            claimed_at: 9,
        };
        let mut claim_bytes = Vec::new();
        claim.try_serialize(&mut claim_bytes).unwrap();
        assert_eq!(claim_bytes.len(), ReporterClaim::SPACE);
        assert!(claim.validate().is_ok());

        assert!(Rent::default().minimum_balance(DomainRecord::SPACE) > 0);
        assert!(Rent::default().minimum_balance(RegistryConfig::SPACE) > 0);
        assert!(Rent::default().minimum_balance(OriginClaimReceipt::SPACE) > 0);
        assert!(Rent::default().minimum_balance(StakeVault::SPACE) > 0);
        assert!(Rent::default().minimum_balance(SubIdentityStrike::SPACE) > 0);
        assert!(Rent::default().minimum_balance(SlashCase::SPACE) > 0);
        assert!(Rent::default().minimum_balance(ReporterPool::SPACE) > 0);
        assert!(Rent::default().minimum_balance(ReporterClaim::SPACE) > 0);
    }

    #[test]
    fn canonical_domain_rules_are_strict() {
        assert!(is_canonical_domain("mail.example"));
        assert!(!is_canonical_domain("Mail.example"));
        assert!(!is_canonical_domain("mail..example"));
        assert!(!is_canonical_domain("-mail.example"));
        assert!(!is_canonical_domain("mail-.example"));
    }

    #[test]
    fn validates_config_and_rejects_non_monotonic_tiers() {
        let valid = config();
        assert!(valid.validate().is_ok());
        let mut invalid = valid;
        invalid.tiers[1].required_stake = invalid.tiers[0].required_stake;
        assert!(invalid.validate().is_err());

        let mut zero_penalty = config();
        zero_penalty.tiers[0].penalty_per_strike = 0;
        assert!(zero_penalty.validate().is_err());

        let mut drains_too_fast = config();
        drains_too_fast.tiers[0].penalty_per_strike = 2;
        assert!(drains_too_fast.validate().is_err());
    }

    #[test]
    fn origin_and_mirror_invariants_are_distinct() {
        let local_network = [2; 32];
        let local_registry = ID.to_bytes();
        assert!(record(RecordKind::Origin, local_network, local_registry)
            .validate(local_network, local_registry)
            .is_ok());
        assert!(record(RecordKind::Mirror, local_network, local_registry)
            .validate(local_network, local_registry)
            .is_err());
        assert!(record(RecordKind::Mirror, [9; 32], [8; 32])
            .validate(local_network, local_registry)
            .is_ok());

        let mut suspended_provider = record(RecordKind::Origin, local_network, local_registry);
        suspended_provider.status = DomainStatus::Suspended;
        suspended_provider.current_stake = 0;
        suspended_provider.attested_stake = 0;
        assert!(suspended_provider
            .validate(local_network, local_registry)
            .is_ok());

        let mut topped_up_provider = record(RecordKind::Origin, local_network, local_registry);
        topped_up_provider.current_stake = u64::MAX;
        topped_up_provider.attested_stake = u64::MAX;
        topped_up_provider.original_registration_amount = 1;
        assert!(topped_up_provider
            .validate(local_network, local_registry)
            .is_ok());

        let mut evm_mirror = record(RecordKind::Mirror, [9; 32], [8; 32]);
        evm_mirror.origin.family = NetworkFamily::Evm;
        evm_mirror.operational_key.algorithm = KeyAlgorithm::Secp256k1EvmAddress;
        evm_mirror.admin_key.algorithm = KeyAlgorithm::Secp256k1EvmAddress;
        assert!(evm_mirror.validate(local_network, local_registry).is_ok());
    }

    #[test]
    fn pda_derivation_is_deterministic_and_domain_scoped() {
        assert_eq!(RegistryConfig::pda(), RegistryConfig::pda());
        assert_ne!(DomainRecord::pda(&[1; 32]), DomainRecord::pda(&[2; 32]));
        assert_ne!(
            OriginClaimReceipt::pda(&[1; 32], &[3; 32]),
            OriginClaimReceipt::pda(&[1; 32], &[4; 32])
        );
        assert_ne!(StakeVault::pda(&[1; 32]), StakeVault::pda(&[2; 32]));
        assert_ne!(
            SubIdentityStrike::pda(&[1; 32], &[3; 32]),
            SubIdentityStrike::pda(&[1; 32], &[4; 32])
        );
        assert_ne!(SlashCase::pda(&[1; 32], 0), SlashCase::pda(&[1; 32], 1));
        assert_ne!(
            ReporterPool::pda(&[1; 32], 0),
            ReporterPool::pda(&[2; 32], 0)
        );
        let pool = ReporterPool::pda(&[1; 32], 0).0;
        assert_ne!(
            ReporterClaim::pda(&pool, &Pubkey::new_unique()),
            ReporterClaim::pda(&pool, &Pubkey::new_unique())
        );
    }
}
