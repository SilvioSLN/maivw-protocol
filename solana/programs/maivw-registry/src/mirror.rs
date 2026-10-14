use anchor_lang::prelude::*;

use crate::{
    error::MaivwError,
    state::{DomainStatus, KeyAlgorithm, KeyDescriptor, NetworkFamily, ProviderTier},
};

const MIRROR_STATE_V2_TYPE: &[u8] = b"MirrorStateV2(uint8 publicKeyAlgorithm,bytes32 publicKeyData,uint8 adminKeyAlgorithm,bytes32 adminKeyData,bytes32 endpointHash,bytes32 tlsFingerprint,uint8 status,bool isProvider,uint8 tier,uint32 strikeCount,uint64 registrationTime,uint256 attestedStake,uint256 dailyLimit)";

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterMirrorArgs {
    pub domain_hash: [u8; 32],
    pub attestation_nonce: [u8; 32],
    pub domain: String,
    pub origin_family: NetworkFamily,
    pub operational_key: KeyDescriptor,
    pub admin_key: KeyDescriptor,
    pub endpoint: String,
    pub tls_fingerprint: [u8; 32],
    pub status: DomainStatus,
    pub is_provider: bool,
    pub provider_tier: ProviderTier,
    pub strikes: u32,
    pub registration_time: u64,
    pub attested_stake: u64,
    pub attested_daily_limit: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SyncMirrorArgs {
    pub domain_hash: [u8; 32],
    pub attestation_nonce: [u8; 32],
    pub domain: String,
    pub origin_family: NetworkFamily,
    pub operational_key: KeyDescriptor,
    pub admin_key: KeyDescriptor,
    pub endpoint: String,
    pub tls_fingerprint: [u8; 32],
    pub status: DomainStatus,
    pub is_provider: bool,
    pub provider_tier: ProviderTier,
    pub strikes: u32,
    pub registration_time: u64,
    pub attested_stake: u64,
    pub attested_daily_limit: u64,
}

pub fn validate_register_mirror(args: &RegisterMirrorArgs) -> Result<()> {
    validate_mirror_state(
        args.domain_hash,
        &args.domain,
        args.origin_family,
        args.operational_key,
        args.admin_key,
        &args.endpoint,
        args.status,
        args.is_provider,
        args.provider_tier,
        args.registration_time,
        args.attested_daily_limit,
    )
}

pub fn validate_sync_mirror(args: &SyncMirrorArgs) -> Result<()> {
    validate_mirror_state(
        args.domain_hash,
        &args.domain,
        args.origin_family,
        args.operational_key,
        args.admin_key,
        &args.endpoint,
        args.status,
        args.is_provider,
        args.provider_tier,
        args.registration_time,
        args.attested_daily_limit,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_mirror_state(
    domain_hash: [u8; 32],
    domain: &str,
    origin_family: NetworkFamily,
    operational_key: KeyDescriptor,
    admin_key: KeyDescriptor,
    endpoint: &str,
    status: DomainStatus,
    is_provider: bool,
    provider_tier: ProviderTier,
    registration_time: u64,
    attested_daily_limit: u64,
) -> Result<()> {
    require!(
        domain_hash == maivw_attestation::keccak256(domain.as_bytes()),
        MaivwError::InvalidDomainHash
    );
    require!(
        !endpoint.is_empty() && endpoint.len() <= crate::constants::MAX_ENDPOINT_LEN,
        MaivwError::InvalidEndpoint
    );
    require!(
        !matches!(status, DomainStatus::Revoked),
        MaivwError::InvalidMirrorState
    );
    validate_typed_key(origin_family, operational_key)?;
    validate_typed_key(origin_family, admin_key)?;
    require!(
        (is_provider
            && !matches!(provider_tier, ProviderTier::None)
            && attested_daily_limit > 0)
            || (!is_provider
                && matches!(provider_tier, ProviderTier::None)
                && attested_daily_limit == 0),
        MaivwError::InvalidMirrorState
    );
    require!(
        i64::try_from(registration_time).is_ok(),
        MaivwError::InvalidMirrorState
    );
    Ok(())
}

pub fn mirror_state_payload_hash(args: &RegisterMirrorArgs) -> [u8; 32] {
    hash_mirror_state(
        args.operational_key,
        args.admin_key,
        &args.endpoint,
        args.tls_fingerprint,
        args.status,
        args.is_provider,
        args.provider_tier,
        args.strikes,
        args.registration_time,
        args.attested_stake,
        args.attested_daily_limit,
    )
}

pub fn sync_mirror_payload_hash(args: &SyncMirrorArgs) -> [u8; 32] {
    hash_mirror_state(
        args.operational_key,
        args.admin_key,
        &args.endpoint,
        args.tls_fingerprint,
        args.status,
        args.is_provider,
        args.provider_tier,
        args.strikes,
        args.registration_time,
        args.attested_stake,
        args.attested_daily_limit,
    )
}

#[allow(clippy::too_many_arguments)]
fn hash_mirror_state(
    operational_key: KeyDescriptor,
    admin_key: KeyDescriptor,
    endpoint: &str,
    tls_fingerprint: [u8; 32],
    status: DomainStatus,
    is_provider: bool,
    provider_tier: ProviderTier,
    strikes: u32,
    registration_time: u64,
    attested_stake: u64,
    attested_daily_limit: u64,
) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(14 * 32);
    encoded.extend_from_slice(&maivw_attestation::keccak256(MIRROR_STATE_V2_TYPE));
    push_u8_slot(&mut encoded, operational_key.algorithm as u8);
    encoded.extend_from_slice(&operational_key.value);
    push_u8_slot(&mut encoded, admin_key.algorithm as u8);
    encoded.extend_from_slice(&admin_key.value);
    encoded.extend_from_slice(&maivw_attestation::keccak256(endpoint.as_bytes()));
    encoded.extend_from_slice(&tls_fingerprint);
    push_u8_slot(&mut encoded, status_wire_value(status));
    push_u8_slot(&mut encoded, u8::from(is_provider));
    push_u8_slot(&mut encoded, provider_tier as u8);
    push_u64_slot(&mut encoded, u64::from(strikes));
    push_u64_slot(&mut encoded, registration_time);
    push_u64_slot(&mut encoded, attested_stake);
    push_u64_slot(&mut encoded, attested_daily_limit);
    debug_assert_eq!(encoded.len(), 14 * 32);
    maivw_attestation::keccak256(&encoded)
}

pub fn validate_sync_version(
    current_epoch: u64,
    current_sequence: u64,
    incoming_epoch: u64,
    incoming_sequence: u64,
) -> Result<()> {
    if incoming_epoch == current_epoch && incoming_sequence == current_sequence {
        return err!(MaivwError::MirrorVersionConflict);
    }
    require!(
        incoming_epoch > current_epoch
            || (incoming_epoch == current_epoch && incoming_sequence > current_sequence),
        MaivwError::MirrorVersionRegression
    );
    Ok(())
}

fn validate_typed_key(origin_family: NetworkFamily, key: KeyDescriptor) -> Result<()> {
    require!(key.value != [0; 32], MaivwError::InvalidTypedKey);
    match origin_family {
        NetworkFamily::Evm => require!(
            matches!(key.algorithm, KeyAlgorithm::Secp256k1EvmAddress)
                && key.value[..12].iter().all(|byte| *byte == 0),
            MaivwError::InvalidTypedKey
        ),
        NetworkFamily::Solana => require!(
            matches!(
                key.algorithm,
                KeyAlgorithm::Ed25519SolanaPubkey | KeyAlgorithm::Ed25519Raw
            ),
            MaivwError::InvalidTypedKey
        ),
    }
    Ok(())
}

fn status_wire_value(status: DomainStatus) -> u8 {
    match status {
        DomainStatus::Active => 1,
        DomainStatus::Suspended => 2,
        DomainStatus::Revoked => 3,
    }
}

fn push_u8_slot(encoded: &mut Vec<u8>, value: u8) {
    encoded.extend_from_slice(&[0; 31]);
    encoded.push(value);
}

fn push_u64_slot(encoded: &mut Vec<u8>, value: u64) {
    encoded.extend_from_slice(&[0; 24]);
    encoded.extend_from_slice(&value.to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> RegisterMirrorArgs {
        let domain = "mail.example".to_owned();
        let mut evm_key = [0; 32];
        evm_key[12..].fill(7);
        RegisterMirrorArgs {
            domain_hash: maivw_attestation::keccak256(domain.as_bytes()),
            attestation_nonce: [1; 32],
            domain,
            origin_family: NetworkFamily::Evm,
            operational_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Secp256k1EvmAddress,
                value: evm_key,
            },
            admin_key: KeyDescriptor {
                algorithm: KeyAlgorithm::Secp256k1EvmAddress,
                value: evm_key,
            },
            endpoint: "https://mail.example".to_owned(),
            tls_fingerprint: [2; 32],
            status: DomainStatus::Active,
            is_provider: true,
            provider_tier: ProviderTier::Trusted,
            strikes: 3,
            registration_time: 1_700_000_000,
            attested_stake: 1_000,
            attested_daily_limit: 10_000,
        }
    }

    #[test]
    fn validates_evm_and_solana_typed_keys() {
        assert!(validate_register_mirror(&args()).is_ok());

        let mut solana = args();
        solana.origin_family = NetworkFamily::Solana;
        solana.operational_key.algorithm = KeyAlgorithm::Ed25519SolanaPubkey;
        solana.operational_key.value = [3; 32];
        solana.admin_key.algorithm = KeyAlgorithm::Ed25519Raw;
        solana.admin_key.value = [4; 32];
        assert!(validate_register_mirror(&solana).is_ok());

        let mut malformed_evm = args();
        malformed_evm.operational_key.value[0] = 1;
        assert!(validate_register_mirror(&malformed_evm).is_err());
    }

    #[test]
    fn rejects_revoked_or_economically_inconsistent_initial_state() {
        let mut revoked = args();
        revoked.status = DomainStatus::Revoked;
        assert!(validate_register_mirror(&revoked).is_err());

        let mut not_provider = args();
        not_provider.is_provider = false;
        assert!(validate_register_mirror(&not_provider).is_err());
        not_provider.provider_tier = ProviderTier::None;
        not_provider.attested_daily_limit = 0;
        assert!(validate_register_mirror(&not_provider).is_ok());
    }

    #[test]
    fn payload_hash_binds_all_replicated_state_and_uses_evm_status_values() {
        let original = args();
        let expected = mirror_state_payload_hash(&original);
        assert_eq!(
            expected,
            [
                0x30, 0x9a, 0xb9, 0x81, 0x46, 0x6d, 0x05, 0x4d, 0x4a, 0x86, 0x4f, 0xe3,
                0xce, 0x46, 0xe6, 0x0f, 0xb2, 0x5e, 0xd3, 0xdc, 0x4f, 0x79, 0xe4, 0x19,
                0xe5, 0x0b, 0xa6, 0x3d, 0x0f, 0x58, 0x33, 0x2b,
            ]
        );

        let mut changed = original.clone();
        changed.operational_key.value[31] ^= 1;
        assert_ne!(expected, mirror_state_payload_hash(&changed));
        changed = original.clone();
        changed.endpoint.push_str("/v2");
        assert_ne!(expected, mirror_state_payload_hash(&changed));
        changed = original.clone();
        changed.status = DomainStatus::Suspended;
        assert_ne!(expected, mirror_state_payload_hash(&changed));
        changed = original.clone();
        changed.attested_stake += 1;
        assert_ne!(expected, mirror_state_payload_hash(&changed));

        assert_eq!(status_wire_value(DomainStatus::Active), 1);
        assert_eq!(status_wire_value(DomainStatus::Suspended), 2);
        assert_eq!(status_wire_value(DomainStatus::Revoked), 3);
    }

    #[test]
    fn register_and_sync_share_the_exact_state_payload_codec() {
        let register = args();
        let sync = SyncMirrorArgs {
            domain_hash: register.domain_hash,
            attestation_nonce: register.attestation_nonce,
            domain: register.domain.clone(),
            origin_family: register.origin_family,
            operational_key: register.operational_key,
            admin_key: register.admin_key,
            endpoint: register.endpoint.clone(),
            tls_fingerprint: register.tls_fingerprint,
            status: register.status,
            is_provider: register.is_provider,
            provider_tier: register.provider_tier,
            strikes: register.strikes,
            registration_time: register.registration_time,
            attested_stake: register.attested_stake,
            attested_daily_limit: register.attested_daily_limit,
        };

        assert!(validate_sync_mirror(&sync).is_ok());
        assert_eq!(
            mirror_state_payload_hash(&register),
            sync_mirror_payload_hash(&sync)
        );
    }

    #[test]
    fn sync_requires_a_strictly_newer_lexicographic_version() {
        assert!(validate_sync_version(7, 11, 7, 12).is_ok());
        assert!(validate_sync_version(7, 11, 8, 0).is_ok());
        assert!(validate_sync_version(7, 11, 7, 11).is_err());
        assert!(validate_sync_version(7, 11, 7, 10).is_err());
        assert!(validate_sync_version(7, 11, 6, u64::MAX).is_err());
    }
}
