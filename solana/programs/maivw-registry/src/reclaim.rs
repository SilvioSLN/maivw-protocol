use anchor_lang::prelude::*;

use crate::{
    constants::{RECLAIM_PAYLOAD_MAGIC, RECLAIM_PAYLOAD_VERSION},
    error::MaivwError,
    state::{
        KeyAlgorithm, PendingAdmin, PendingAdminStatus, ProviderTier, RecoveryCase,
        RecoveryStatus, SlashCase, SlashCaseStatus,
    },
    ID,
};

pub const RECLAIM_PAYLOAD_LEN: usize = 261;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct ReclaimDomainArgs {
    pub domain_hash: [u8; 32],
    pub claim_nonce: [u8; 32],
    pub current_global_domain_epoch: u64,
    pub domain: String,
    pub endpoint: String,
    pub operational_key: [u8; 32],
    pub admin_key: [u8; 32],
    pub tls_fingerprint: [u8; 32],
    pub tier: ProviderTier,
}

impl ReclaimDomainArgs {
    pub fn is_provider(&self) -> bool {
        !matches!(self.tier, ProviderTier::None)
    }
}

pub fn reclaim_payload_hash(
    args: &ReclaimDomainArgs,
    registrant: Pubkey,
    mint: Pubkey,
    current_origin_sequence: u64,
    payment: u64,
) -> [u8; 32] {
    let endpoint_hash = maivw_attestation::keccak256(args.endpoint.as_bytes());
    let mut payload = Vec::with_capacity(RECLAIM_PAYLOAD_LEN);
    payload.extend_from_slice(&RECLAIM_PAYLOAD_MAGIC);
    payload.push(RECLAIM_PAYLOAD_VERSION);
    payload.extend_from_slice(&args.domain_hash);
    payload.extend_from_slice(&registrant.to_bytes());
    payload.push(KeyAlgorithm::Ed25519SolanaPubkey as u8);
    payload.extend_from_slice(&args.operational_key);
    payload.push(KeyAlgorithm::Ed25519SolanaPubkey as u8);
    payload.extend_from_slice(&args.admin_key);
    payload.extend_from_slice(&endpoint_hash);
    payload.extend_from_slice(&args.tls_fingerprint);
    payload.push(u8::from(args.is_provider()));
    payload.push(args.tier as u8);
    payload.extend_from_slice(&args.current_global_domain_epoch.to_be_bytes());
    payload.extend_from_slice(&current_origin_sequence.to_be_bytes());
    payload.extend_from_slice(&payment.to_be_bytes());
    payload.extend_from_slice(&mint.to_bytes());
    debug_assert_eq!(payload.len(), RECLAIM_PAYLOAD_LEN);
    maivw_attestation::keccak256(&payload)
}

pub fn pending_admin_must_close(status: PendingAdminStatus) -> bool {
    matches!(status, PendingAdminStatus::Pending)
}

pub fn recovery_must_close(status: RecoveryStatus) -> bool {
    matches!(status, RecoveryStatus::Pending)
}

pub fn slash_must_close(status: SlashCaseStatus) -> bool {
    matches!(status, SlashCaseStatus::Pending)
}

pub fn close_pending_processes(
    domain_hash: [u8; 32],
    global_domain_epoch: u64,
    pending_admin_info: &AccountInfo<'_>,
    recovery_case_info: &AccountInfo<'_>,
    slash_case_info: &AccountInfo<'_>,
    destination: &AccountInfo<'_>,
) -> Result<()> {
    if pending_admin_info.owner == &ID {
        let must_close = {
            let data = pending_admin_info.try_borrow_data()?;
            let mut bytes = data.as_ref();
            let pending = PendingAdmin::try_deserialize(&mut bytes)?;
            pending.validate_identity(domain_hash, global_domain_epoch)?;
            pending_admin_must_close(pending.status)
        };
        if must_close {
            close_program_account(pending_admin_info, destination)?;
        }
    } else {
        require!(
            pending_admin_info.owner == &anchor_lang::system_program::ID
                && pending_admin_info.data_is_empty(),
            MaivwError::InvalidPendingProcess
        );
    }

    if recovery_case_info.owner == &ID {
        let must_close = {
            let data = recovery_case_info.try_borrow_data()?;
            let mut bytes = data.as_ref();
            let recovery = RecoveryCase::try_deserialize(&mut bytes)?;
            recovery.validate_identity(domain_hash, global_domain_epoch, recovery.nonce)?;
            recovery_must_close(recovery.status)
        };
        if must_close {
            close_program_account(recovery_case_info, destination)?;
        }
    } else {
        require!(
            recovery_case_info.owner == &anchor_lang::system_program::ID
                && recovery_case_info.data_is_empty(),
            MaivwError::InvalidPendingProcess
        );
    }

    if slash_case_info.owner == &ID {
        let must_close = {
            let data = slash_case_info.try_borrow_data()?;
            let mut bytes = data.as_ref();
            let slash = SlashCase::try_deserialize(&mut bytes)?;
            slash.validate_identity(domain_hash, global_domain_epoch, slash.case_nonce)?;
            slash_must_close(slash.status)
        };
        if must_close {
            close_program_account(slash_case_info, destination)?;
        }
    } else {
        require!(
            slash_case_info.owner == &anchor_lang::system_program::ID
                && slash_case_info.data_is_empty(),
            MaivwError::InvalidPendingProcess
        );
    }
    Ok(())
}

fn close_program_account(source: &AccountInfo<'_>, destination: &AccountInfo<'_>) -> Result<()> {
    let destination_lamports = destination
        .lamports()
        .checked_add(source.lamports())
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
    **destination.try_borrow_mut_lamports()? = destination_lamports;
    **source.try_borrow_mut_lamports()? = 0;
    source.assign(&anchor_lang::system_program::ID);
    source.resize(0)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args() -> ReclaimDomainArgs {
        ReclaimDomainArgs {
            domain_hash: [1; 32],
            claim_nonce: [2; 32],
            current_global_domain_epoch: 7,
            domain: "mail.example".to_owned(),
            endpoint: "https://mail.example/inbox".to_owned(),
            operational_key: [3; 32],
            admin_key: [4; 32],
            tls_fingerprint: [5; 32],
            tier: ProviderTier::None,
        }
    }

    #[test]
    fn payload_binds_owner_version_payment_and_new_profile() {
        let input = args();
        let registrant = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let expected = reclaim_payload_hash(&input, registrant, mint, 9, 100);

        assert_ne!(
            expected,
            reclaim_payload_hash(&input, Pubkey::new_unique(), mint, 9, 100)
        );
        assert_ne!(expected, reclaim_payload_hash(&input, registrant, mint, 10, 100));
        assert_ne!(expected, reclaim_payload_hash(&input, registrant, mint, 9, 101));
        let mut changed = input;
        changed.admin_key = [8; 32];
        assert_ne!(expected, reclaim_payload_hash(&changed, registrant, mint, 9, 100));
    }

    #[test]
    fn only_live_pending_processes_are_closed() {
        assert!(pending_admin_must_close(PendingAdminStatus::Pending));
        assert!(!pending_admin_must_close(PendingAdminStatus::Accepted));
        assert!(recovery_must_close(RecoveryStatus::Pending));
        assert!(!recovery_must_close(RecoveryStatus::Cancelled));
        assert!(!recovery_must_close(RecoveryStatus::Executed));
        assert!(slash_must_close(SlashCaseStatus::Pending));
        assert!(!slash_must_close(SlashCaseStatus::Vetoed));
        assert!(!slash_must_close(SlashCaseStatus::Executed));
    }
}
