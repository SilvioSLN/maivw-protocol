use anchor_lang::prelude::*;

use crate::{
    constants::MAX_MESSAGE_CLASS_LEN,
    error::MaivwError,
    state::{DomainStatus, KeyAlgorithm, KeyDescriptor, RecordKind},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RegisterIntentBatchArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub batch_nonce: [u8; 32],
    pub message_class: String,
    pub merkle_root: [u8; 32],
}

pub fn validate_intent_batch(
    args: &RegisterIntentBatchArgs,
    kind: RecordKind,
    status: DomainStatus,
    current_epoch: u64,
) -> Result<()> {
    require!(matches!(kind, RecordKind::Origin), MaivwError::MirrorReadOnly);
    require!(
        matches!(status, DomainStatus::Active),
        MaivwError::InvalidDomainStatus
    );
    require!(
        args.global_domain_epoch == current_epoch,
        MaivwError::InvalidIntentBatch
    );
    require!(args.batch_nonce != [0; 32], MaivwError::ZeroNonce);
    require!(
        !args.message_class.is_empty() && args.message_class.len() <= MAX_MESSAGE_CLASS_LEN,
        MaivwError::InvalidMessageClass
    );
    require!(
        args.merkle_root != [0; 32],
        MaivwError::InvalidMerkleRoot
    );
    Ok(())
}

pub fn authorize_intent_batch(
    operational_key: KeyDescriptor,
    admin_key: KeyDescriptor,
    oracle_key: [u8; 32],
    signer: Pubkey,
) -> Result<()> {
    let signer_bytes = signer.to_bytes();
    let is_operational = matches!(
        operational_key.algorithm,
        KeyAlgorithm::Ed25519SolanaPubkey
    ) && operational_key.value == signer_bytes;
    let is_admin = matches!(admin_key.algorithm, KeyAlgorithm::Ed25519SolanaPubkey)
        && admin_key.value == signer_bytes;
    let is_oracle = oracle_key == signer_bytes;
    require!(
        is_operational || is_admin || is_oracle,
        MaivwError::UnauthorizedIntentBatch
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(key: Pubkey) -> KeyDescriptor {
        KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: key.to_bytes(),
        }
    }

    fn args() -> RegisterIntentBatchArgs {
        RegisterIntentBatchArgs {
            domain_hash: [1; 32],
            global_domain_epoch: 2,
            batch_nonce: [3; 32],
            message_class: "TRANSACTIONAL".to_owned(),
            merkle_root: [4; 32],
        }
    }

    #[test]
    fn batch_requires_active_origin_explicit_nonce_class_and_root() {
        let valid = args();
        assert!(validate_intent_batch(&valid, RecordKind::Origin, DomainStatus::Active, 2).is_ok());

        let mut invalid = valid.clone();
        invalid.batch_nonce = [0; 32];
        assert!(validate_intent_batch(&invalid, RecordKind::Origin, DomainStatus::Active, 2).is_err());
        invalid = valid.clone();
        invalid.message_class = "x".repeat(MAX_MESSAGE_CLASS_LEN + 1);
        assert!(validate_intent_batch(&invalid, RecordKind::Origin, DomainStatus::Active, 2).is_err());
        invalid = valid.clone();
        invalid.merkle_root = [0; 32];
        assert!(validate_intent_batch(&invalid, RecordKind::Origin, DomainStatus::Active, 2).is_err());
        assert!(validate_intent_batch(&valid, RecordKind::Mirror, DomainStatus::Active, 2).is_err());
        assert!(validate_intent_batch(&valid, RecordKind::Origin, DomainStatus::Suspended, 2).is_err());
        assert!(validate_intent_batch(&valid, RecordKind::Origin, DomainStatus::Active, 3).is_err());
    }

    #[test]
    fn hot_key_admin_and_oracle_can_publish_but_stranger_cannot() {
        let operational = Pubkey::new_unique();
        let admin = Pubkey::new_unique();
        let oracle = Pubkey::new_unique();
        assert!(authorize_intent_batch(
            descriptor(operational),
            descriptor(admin),
            oracle.to_bytes(),
            operational
        )
        .is_ok());
        assert!(authorize_intent_batch(
            descriptor(operational),
            descriptor(admin),
            oracle.to_bytes(),
            admin
        )
        .is_ok());
        assert!(authorize_intent_batch(
            descriptor(operational),
            descriptor(admin),
            oracle.to_bytes(),
            oracle
        )
        .is_ok());
        assert!(authorize_intent_batch(
            descriptor(operational),
            descriptor(admin),
            oracle.to_bytes(),
            Pubkey::new_unique()
        )
        .is_err());
    }
}
