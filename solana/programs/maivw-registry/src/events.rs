use anchor_lang::prelude::*;

use crate::state::{DomainRecord, DomainStatus, NetworkFamily, RecordKind};

/// Stable action taxonomy for the canonical domain-state event.
#[repr(u8)]
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Eq, PartialEq)]
pub enum DomainEventAction {
    Registered,
    MirrorSynchronized,
    MirrorRevoked,
    Reclaimed,
    IntentBatchRegistered,
    StakeToppedUp,
    WarningIssued,
    SlashExecuted,
    MailKeyUpdated,
    EndpointUpdated,
    TlsFingerprintUpdated,
    AdminUpdated,
    RecoveryExecuted,
    Migrated,
}

#[event]
pub struct RegistryInitialized {
    pub network_hash: [u8; 32],
    pub registry: Pubkey,
    pub authority: Pubkey,
    pub guardian: Pubkey,
    pub oracle_key: [u8; 32],
    pub asset_mint: Pubkey,
    pub schema_version: u16,
    pub timestamp: i64,
}

/// Canonical observer event emitted after every mutation of DomainRecord.
#[event]
pub struct DomainStateChanged {
    pub action: DomainEventAction,
    pub record_kind: RecordKind,
    pub domain_hash: [u8; 32],
    pub origin_family: NetworkFamily,
    pub origin_network_hash: [u8; 32],
    pub origin_registry: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub status: DomainStatus,
    pub origin_transaction: [u8; 32],
    pub schema_version: u16,
    pub actor: Pubkey,
    pub timestamp: i64,
}

impl DomainStateChanged {
    pub fn from_domain(
        domain: &DomainRecord,
        action: DomainEventAction,
        actor: Pubkey,
        timestamp: i64,
    ) -> Self {
        Self {
            action,
            record_kind: domain.kind,
            domain_hash: domain.domain_hash,
            origin_family: domain.origin.family,
            origin_network_hash: domain.origin.network_hash,
            origin_registry: domain.origin_registry,
            global_domain_epoch: domain.global_domain_epoch,
            origin_sequence: domain.origin_sequence,
            status: domain.status,
            origin_transaction: domain.origin_transaction.hash,
            schema_version: domain.schema_version,
            actor,
            timestamp,
        }
    }
}

pub fn emit_domain_state_changed(
    domain: &DomainRecord,
    action: DomainEventAction,
    actor: Pubkey,
    timestamp: i64,
) {
    emit!(DomainStateChanged::from_domain(
        domain, action, actor, timestamp
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        constants::{DOMAIN_MIGRATION_RESERVED_LEN, DOMAIN_SCHEMA_VERSION},
        state::{KeyAlgorithm, KeyDescriptor, NetworkReference, ProviderTier, TransactionReference},
    };

    fn record(kind: RecordKind, family: NetworkFamily) -> DomainRecord {
        DomainRecord {
            schema_version: DOMAIN_SCHEMA_VERSION,
            bump: 1,
            kind,
            domain_hash: [1; 32],
            domain: "mail.example".to_owned(),
            origin: NetworkReference {
                family,
                network_hash: [2; 32],
            },
            origin_registry: [3; 32],
            operational_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Ed25519Raw,
                value: [4; 32],
            },
            admin_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Ed25519Raw,
                value: [5; 32],
            },
            endpoint: "https://mail.example".to_owned(),
            tls_fingerprint: [6; 32],
            status: DomainStatus::Active,
            global_domain_epoch: 7,
            origin_sequence: 8,
            provider: Pubkey::default(),
            provider_tier: ProviderTier::None,
            strikes: 0,
            created_at: 9,
            updated_at: 10,
            attested_stake: 0,
            attested_daily_limit: 0,
            original_registration_amount: 0,
            current_stake: 0,
            origin_transaction: TransactionReference {
                family,
                hash: [11; 32],
            },
            last_migrated_slot: 0,
            migration_reserved: [0; DOMAIN_MIGRATION_RESERVED_LEN],
        }
    }

    #[test]
    fn canonical_event_distinguishes_origin_and_mirror_with_ordering_and_reference() {
        let actor = Pubkey::new_unique();
        let origin = DomainStateChanged::from_domain(
            &record(RecordKind::Origin, NetworkFamily::Solana),
            DomainEventAction::Registered,
            actor,
            12,
        );
        let mirror = DomainStateChanged::from_domain(
            &record(RecordKind::Mirror, NetworkFamily::Evm),
            DomainEventAction::MirrorSynchronized,
            actor,
            13,
        );

        assert_eq!(origin.record_kind, RecordKind::Origin);
        assert_eq!(mirror.record_kind, RecordKind::Mirror);
        assert_eq!(origin.global_domain_epoch, 7);
        assert_eq!(mirror.origin_sequence, 8);
        assert_eq!(mirror.origin_family, NetworkFamily::Evm);
        assert_eq!(mirror.origin_registry, [3; 32]);
        assert_eq!(mirror.origin_transaction, [11; 32]);
    }
}
