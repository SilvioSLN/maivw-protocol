use anchor_lang::prelude::*;

use crate::{
    constants::{RECOVERY_PAYLOAD_MAGIC, RECOVERY_PAYLOAD_VERSION},
    error::MaivwError,
    state::{KeyAlgorithm, KeyDescriptor, RecoveryCase, RecoveryStatus},
};

pub const RECOVERY_PAYLOAD_LEN: usize = 121;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RequestRecoveryArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub nonce: [u8; 32],
    pub new_admin: Pubkey,
    pub new_operational_key: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct RecoveryCaseArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub nonce: [u8; 32],
}

pub fn recovery_payload_hash(args: &RequestRecoveryArgs, origin_sequence: u64) -> [u8; 32] {
    let mut encoded = [0_u8; RECOVERY_PAYLOAD_LEN];
    encoded[..8].copy_from_slice(&RECOVERY_PAYLOAD_MAGIC);
    encoded[8] = RECOVERY_PAYLOAD_VERSION;
    encoded[9..41].copy_from_slice(&args.domain_hash);
    encoded[41..49].copy_from_slice(&args.global_domain_epoch.to_be_bytes());
    encoded[49..57].copy_from_slice(&origin_sequence.to_be_bytes());
    encoded[57..89].copy_from_slice(&args.new_admin.to_bytes());
    encoded[89..121].copy_from_slice(&args.new_operational_key);
    maivw_attestation::keccak256(&encoded)
}

pub fn validate_recovery_keys(new_admin: Pubkey, new_operational_key: [u8; 32]) -> Result<()> {
    require!(
        new_admin != Pubkey::default(),
        MaivwError::InvalidNewDomainAdmin
    );
    require!(
        new_operational_key != [0; 32],
        MaivwError::InvalidOperationalKey
    );
    Ok(())
}

pub fn recovery_execute_after(now: i64, delay_seconds: u64) -> Result<i64> {
    let delay = i64::try_from(delay_seconds).map_err(|_| error!(MaivwError::ArithmeticOverflow))?;
    now.checked_add(delay)
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))
}

pub fn authorize_recovery_cancellation(
    recovery: &RecoveryCase,
    admin: KeyDescriptor,
    signer: Pubkey,
) -> Result<()> {
    require!(
        matches!(recovery.status, RecoveryStatus::Pending),
        MaivwError::InvalidRecoveryCase
    );
    require!(
        matches!(admin.algorithm, KeyAlgorithm::Ed25519SolanaPubkey)
            && admin.value == signer.to_bytes(),
        MaivwError::UnauthorizedDomainAdmin
    );
    Ok(())
}

pub fn authorize_recovery_execution(recovery: &RecoveryCase, now: i64) -> Result<()> {
    require!(
        matches!(recovery.status, RecoveryStatus::Pending),
        MaivwError::InvalidRecoveryCase
    );
    require!(now >= recovery.execute_after, MaivwError::RecoveryNotReady);
    Ok(())
}

pub fn next_recovery_epoch(current_epoch: u64) -> Result<u64> {
    current_epoch
        .checked_add(1)
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::RECOVERY_CASE_SCHEMA_VERSION;

    fn recovery(status: RecoveryStatus, execute_after: i64) -> RecoveryCase {
        RecoveryCase {
            schema_version: RECOVERY_CASE_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            global_domain_epoch: 2,
            nonce: [3; 32],
            attestation_digest: [4; 32],
            new_admin: Pubkey::new_unique(),
            new_operational_key: [5; 32],
            requested_by: Pubkey::new_unique(),
            requested_at: 10,
            execute_after,
            status,
            cancelled_by: Pubkey::default(),
            cancelled_at: 0,
            executed_by: Pubkey::default(),
            executed_at: 0,
            executed_epoch: 0,
            executed_sequence: 0,
        }
    }

    #[test]
    fn payload_is_fixed_and_binds_version_and_keys() {
        let args = RequestRecoveryArgs {
            domain_hash: [1; 32],
            global_domain_epoch: 7,
            nonce: [2; 32],
            new_admin: Pubkey::new_from_array([3; 32]),
            new_operational_key: [4; 32],
        };
        let hash = recovery_payload_hash(&args, 9);
        assert_ne!(hash, [0; 32]);

        let mut changed = args.clone();
        changed.new_operational_key = [5; 32];
        assert_ne!(hash, recovery_payload_hash(&changed, 9));
        assert_ne!(hash, recovery_payload_hash(&args, 10));
    }

    #[test]
    fn keys_delay_and_epoch_are_checked() {
        assert!(validate_recovery_keys(Pubkey::new_unique(), [1; 32]).is_ok());
        assert!(validate_recovery_keys(Pubkey::default(), [1; 32]).is_err());
        assert!(validate_recovery_keys(Pubkey::new_unique(), [0; 32]).is_err());
        assert_eq!(recovery_execute_after(10, 20).unwrap(), 30);
        assert!(recovery_execute_after(i64::MAX, 1).is_err());
        assert_eq!(next_recovery_epoch(8).unwrap(), 9);
        assert!(next_recovery_epoch(u64::MAX).is_err());
    }

    #[test]
    fn only_current_admin_cancels_pending_case() {
        let signer = Pubkey::new_unique();
        let admin = KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: signer.to_bytes(),
        };
        assert!(authorize_recovery_cancellation(
            &recovery(RecoveryStatus::Pending, 20),
            admin,
            signer
        )
        .is_ok());
        assert!(authorize_recovery_cancellation(
            &recovery(RecoveryStatus::Cancelled, 20),
            admin,
            signer
        )
        .is_err());
        assert!(authorize_recovery_cancellation(
            &recovery(RecoveryStatus::Pending, 20),
            admin,
            Pubkey::new_unique()
        )
        .is_err());
    }

    #[test]
    fn execution_is_permissionless_only_after_timelock() {
        let pending = recovery(RecoveryStatus::Pending, 20);
        assert!(authorize_recovery_execution(&pending, 19).is_err());
        assert!(authorize_recovery_execution(&pending, 20).is_ok());
        assert!(authorize_recovery_execution(&recovery(RecoveryStatus::Cancelled, 20), 21)
            .is_err());
    }
}
