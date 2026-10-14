use anchor_lang::prelude::*;

use crate::{
    constants::{
        DOMAIN_MIGRATION_RESERVED_LEN, DOMAIN_SCHEMA_VERSION, DOMAIN_SCHEMA_VERSION_V1,
    },
    error::MaivwError,
    state::{
        DomainRecord, DomainStatus, KeyDescriptor, NetworkReference, ProviderTier, RecordKind,
        TransactionReference,
    },
};

pub const DOMAIN_RECORD_V1_SPACE: usize = 1_115;

/// Exact Borsh layout used by DomainRecord before schema V2.
///
/// Keep this type immutable: it is the decoder for already deployed accounts.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct DomainRecordV1 {
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

pub fn migrate_domain_record_v1_to_v2(
    legacy: DomainRecordV1,
    migration_slot: u64,
) -> Result<DomainRecord> {
    require!(
        legacy.schema_version == DOMAIN_SCHEMA_VERSION_V1,
        MaivwError::UnsupportedAccountMigration
    );

    Ok(DomainRecord {
        schema_version: DOMAIN_SCHEMA_VERSION,
        bump: legacy.bump,
        kind: legacy.kind,
        domain_hash: legacy.domain_hash,
        domain: legacy.domain,
        origin: legacy.origin,
        origin_registry: legacy.origin_registry,
        operational_key: legacy.operational_key,
        admin_key: legacy.admin_key,
        endpoint: legacy.endpoint,
        tls_fingerprint: legacy.tls_fingerprint,
        status: legacy.status,
        global_domain_epoch: legacy.global_domain_epoch,
        origin_sequence: legacy.origin_sequence,
        provider: legacy.provider,
        provider_tier: legacy.provider_tier,
        strikes: legacy.strikes,
        created_at: legacy.created_at,
        updated_at: legacy.updated_at,
        attested_stake: legacy.attested_stake,
        attested_daily_limit: legacy.attested_daily_limit,
        original_registration_amount: legacy.original_registration_amount,
        current_stake: legacy.current_stake,
        origin_transaction: legacy.origin_transaction,
        last_migrated_slot: migration_slot,
        migration_reserved: [0; DOMAIN_MIGRATION_RESERVED_LEN],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{KeyAlgorithm, NetworkFamily};

    fn legacy_record(schema_version: u16) -> DomainRecordV1 {
        DomainRecordV1 {
            schema_version,
            bump: 254,
            kind: RecordKind::Mirror,
            domain_hash: [1; 32],
            domain: "mail.example".to_owned(),
            origin: NetworkReference {
                family: NetworkFamily::Evm,
                network_hash: [2; 32],
            },
            origin_registry: [3; 32],
            operational_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Secp256k1EvmAddress,
                value: [4; 32],
            },
            admin_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Secp256k1EvmAddress,
                value: [5; 32],
            },
            endpoint: "https://mail.example".to_owned(),
            tls_fingerprint: [6; 32],
            status: DomainStatus::Suspended,
            global_domain_epoch: 7,
            origin_sequence: 8,
            provider: Pubkey::default(),
            provider_tier: ProviderTier::Trusted,
            strikes: 9,
            created_at: 10,
            updated_at: 11,
            attested_stake: 12,
            attested_daily_limit: 13,
            original_registration_amount: 0,
            current_stake: 0,
            origin_transaction: TransactionReference {
                family: NetworkFamily::Evm,
                hash: [14; 32],
            },
        }
    }

    #[test]
    fn explicit_v1_to_v2_migration_preserves_canonical_state() {
        let legacy = legacy_record(DOMAIN_SCHEMA_VERSION_V1);
        let migrated = migrate_domain_record_v1_to_v2(legacy.clone(), 42).unwrap();

        assert_eq!(migrated.schema_version, DOMAIN_SCHEMA_VERSION);
        assert_eq!(migrated.domain_hash, legacy.domain_hash);
        assert_eq!(migrated.domain, legacy.domain);
        assert_eq!(migrated.origin, legacy.origin);
        assert_eq!(migrated.origin_registry, legacy.origin_registry);
        assert_eq!(migrated.global_domain_epoch, legacy.global_domain_epoch);
        assert_eq!(migrated.origin_sequence, legacy.origin_sequence);
        assert_eq!(migrated.origin_transaction, legacy.origin_transaction);
        assert_eq!(migrated.last_migrated_slot, 42);
        assert_eq!(migrated.migration_reserved, [0; DOMAIN_MIGRATION_RESERVED_LEN]);
    }

    #[test]
    fn migration_rejects_replay_and_unknown_source_versions() {
        assert!(migrate_domain_record_v1_to_v2(legacy_record(DOMAIN_SCHEMA_VERSION), 1).is_err());
        assert!(migrate_domain_record_v1_to_v2(legacy_record(0), 1).is_err());
        assert!(migrate_domain_record_v1_to_v2(legacy_record(u16::MAX), 1).is_err());
    }

    #[test]
    fn v2_layout_is_an_explicit_incompatible_expansion() {
        let mut legacy = legacy_record(DOMAIN_SCHEMA_VERSION_V1);
        legacy.domain = "a".repeat(crate::constants::MAX_DOMAIN_LEN);
        legacy.endpoint = "e".repeat(crate::constants::MAX_ENDPOINT_LEN);

        let mut legacy_bytes = Vec::new();
        legacy.serialize(&mut legacy_bytes).unwrap();
        let legacy_len = legacy_bytes.len();
        let mut migrated_bytes = Vec::new();
        migrate_domain_record_v1_to_v2(legacy, 1)
            .unwrap()
            .serialize(&mut migrated_bytes)
            .unwrap();
        let migrated_len = migrated_bytes.len();

        assert_eq!(
            migrated_len - legacy_len,
            8 + DOMAIN_MIGRATION_RESERVED_LEN
        );
        assert_eq!(migrated_len + 8, DomainRecord::SPACE);
        assert_eq!(legacy_len + 8, DOMAIN_RECORD_V1_SPACE);
    }
}
