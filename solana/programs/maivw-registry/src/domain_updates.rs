use anchor_lang::prelude::*;

use crate::{
    constants::MAX_ENDPOINT_LEN,
    error::MaivwError,
    state::{DomainStatus, KeyAlgorithm, KeyDescriptor, RecordKind},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct UpdateMailKeyArgs {
    pub domain_hash: [u8; 32],
    pub new_mail_key: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct UpdateEndpointArgs {
    pub domain_hash: [u8; 32],
    pub new_endpoint: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct UpdateTlsFingerprintArgs {
    pub domain_hash: [u8; 32],
    pub new_tls_fingerprint: [u8; 32],
}

pub fn authorize_domain_admin(
    kind: RecordKind,
    status: DomainStatus,
    admin_key: KeyDescriptor,
    signer: Pubkey,
) -> Result<()> {
    require!(
        matches!(kind, RecordKind::Origin),
        MaivwError::MirrorReadOnly
    );
    require!(
        matches!(status, DomainStatus::Active),
        MaivwError::InvalidDomainStatus
    );
    require!(
        matches!(admin_key.algorithm, KeyAlgorithm::Ed25519SolanaPubkey)
            && admin_key.value == signer.to_bytes(),
        MaivwError::UnauthorizedDomainAdmin
    );
    Ok(())
}

pub fn validate_mail_key(mail_key: [u8; 32]) -> Result<()> {
    require!(mail_key != [0; 32], MaivwError::InvalidOperationalKey);
    Ok(())
}

pub fn validate_endpoint(endpoint: &str) -> Result<()> {
    require!(
        !endpoint.is_empty() && endpoint.len() <= MAX_ENDPOINT_LEN,
        MaivwError::InvalidEndpoint
    );
    Ok(())
}

pub fn next_origin_sequence(current: u64) -> Result<u64> {
    current
        .checked_add(1)
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn admin(signer: Pubkey) -> KeyDescriptor {
        KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: signer.to_bytes(),
        }
    }

    #[test]
    fn only_active_origin_admin_is_authorized() {
        let signer = Pubkey::new_unique();
        assert!(authorize_domain_admin(
            RecordKind::Origin,
            DomainStatus::Active,
            admin(signer),
            signer
        )
        .is_ok());
        assert!(authorize_domain_admin(
            RecordKind::Mirror,
            DomainStatus::Active,
            admin(signer),
            signer
        )
        .is_err());
        assert!(authorize_domain_admin(
            RecordKind::Origin,
            DomainStatus::Suspended,
            admin(signer),
            signer
        )
        .is_err());
        assert!(authorize_domain_admin(
            RecordKind::Origin,
            DomainStatus::Active,
            admin(Pubkey::new_unique()),
            signer
        )
        .is_err());
    }

    #[test]
    fn authority_must_be_a_solana_ed25519_descriptor() {
        let signer = Pubkey::new_unique();
        let evm_admin = KeyDescriptor {
            algorithm: KeyAlgorithm::Secp256k1EvmAddress,
            value: signer.to_bytes(),
        };
        assert!(authorize_domain_admin(
            RecordKind::Origin,
            DomainStatus::Active,
            evm_admin,
            signer
        )
        .is_err());
    }

    #[test]
    fn update_inputs_and_sequence_are_bounded() {
        assert!(validate_mail_key([1; 32]).is_ok());
        assert!(validate_mail_key([0; 32]).is_err());
        assert!(validate_endpoint("https://mail.example/inbox").is_ok());
        assert!(validate_endpoint("").is_err());
        assert!(validate_endpoint(&"e".repeat(MAX_ENDPOINT_LEN + 1)).is_err());
        assert_eq!(next_origin_sequence(41).unwrap(), 42);
        assert!(next_origin_sequence(u64::MAX).is_err());

        let args = UpdateEndpointArgs {
            domain_hash: [1; 32],
            new_endpoint: "e".repeat(MAX_ENDPOINT_LEN),
        };
        let mut encoded = Vec::new();
        args.serialize(&mut encoded).unwrap();
        assert_eq!(encoded.len(), 32 + 4 + MAX_ENDPOINT_LEN);
        assert!(encoded.len() < 600);
    }
}
