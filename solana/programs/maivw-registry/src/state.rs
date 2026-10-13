use anchor_lang::prelude::*;

use crate::{
    ID,
    constants::{
        DOMAIN_RECORD_SEED, DOMAIN_SCHEMA_VERSION, MAX_DOMAIN_LEN, MAX_ENDPOINT_LEN,
        PROVIDER_TIER_COUNT, REGISTRY_CONFIG_SEED, REGISTRY_SCHEMA_VERSION,
    },
    error::MaivwError,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum NetworkFamily {
    Evm,
    Solana,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyAlgorithm {
    None,
    Secp256k1EvmAddress,
    Ed25519SolanaPubkey,
    Ed25519Raw,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordKind {
    Origin,
    Mirror,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainStatus {
    Active,
    Suspended,
    Revoked,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderTier {
    None,
    Basic,
    Trusted,
    Institutional,
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
    pub const DATA_LEN: usize = 348;
    pub const SPACE: usize = 8 + Self::DATA_LEN;

    pub fn pda() -> (Pubkey, u8) {
        Pubkey::find_program_address(&[REGISTRY_CONFIG_SEED], &ID)
    }

    pub fn validate(&self) -> Result<()> {
        require!(
            self.schema_version == REGISTRY_SCHEMA_VERSION,
            MaivwError::InvalidRegistryConfig
        );
        let roles = [
            self.authority,
            self.guardian,
            self.asset_mint,
            self.treasury,
            self.founder,
        ];
        require!(
            roles.iter().all(|key| *key != Pubkey::default()),
            MaivwError::InvalidRegistryConfig
        );
        require!(
            self.authority != self.guardian
                && self.treasury != self.founder
                && self.oracle_key != [0; 32]
                && self.network_hash != [0; 32]
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
                    && tier.penalty_per_strike <= tier.required_stake,
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
            self.endpoint.len() <= MAX_ENDPOINT_LEN
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
            RecordKind::Origin => require!(
                matches!(self.origin.family, NetworkFamily::Solana)
                    && self.origin.network_hash == local_network_hash
                    && self.origin_registry == local_registry
                    && matches!(
                        self.operational_key.algorithm,
                        KeyAlgorithm::Ed25519SolanaPubkey
                    )
                    && matches!(self.admin_key.algorithm, KeyAlgorithm::Ed25519SolanaPubkey),
                MaivwError::InvalidOriginReference
            ),
            RecordKind::Mirror => require!(
                self.origin.network_hash != local_network_hash
                    || self.origin_registry != local_registry,
                MaivwError::InvalidMirrorReference
            ),
        }
        Ok(())
    }
}

fn is_canonical_domain(domain: &str) -> bool {
    !domain.is_empty()
        && domain.len() <= MAX_DOMAIN_LEN
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains("..")
        && domain.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'.'
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
        assert!(Rent::default().minimum_balance(DomainRecord::SPACE) > 0);
        assert!(Rent::default().minimum_balance(RegistryConfig::SPACE) > 0);
    }

    #[test]
    fn canonical_domain_rules_are_strict() {
        assert!(is_canonical_domain("mail.example"));
        assert!(!is_canonical_domain("Mail.example"));
        assert!(!is_canonical_domain("mail..example"));
    }

    #[test]
    fn validates_config_and_rejects_non_monotonic_tiers() {
        let valid = config();
        assert!(valid.validate().is_ok());
        let mut invalid = valid;
        invalid.tiers[1].required_stake = invalid.tiers[0].required_stake;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn origin_and_mirror_invariants_are_distinct() {
        let local_network = [2; 32];
        let local_registry = ID.to_bytes();
        assert!(
            record(RecordKind::Origin, local_network, local_registry)
                .validate(local_network, local_registry)
                .is_ok()
        );
        assert!(
            record(RecordKind::Mirror, local_network, local_registry)
                .validate(local_network, local_registry)
                .is_err()
        );
        assert!(
            record(RecordKind::Mirror, [9; 32], [8; 32])
                .validate(local_network, local_registry)
                .is_ok()
        );

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
    }
}
