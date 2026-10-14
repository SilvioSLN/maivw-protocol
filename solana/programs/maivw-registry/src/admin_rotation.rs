use anchor_lang::prelude::*;

use crate::{
    error::MaivwError,
    state::{KeyAlgorithm, KeyDescriptor, PendingAdmin, PendingAdminStatus},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct ProposeDomainAdminArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub new_admin: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct AcceptDomainAdminArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
}

pub fn validate_new_admin(current_admin: KeyDescriptor, new_admin: Pubkey) -> Result<()> {
    require!(
        matches!(current_admin.algorithm, KeyAlgorithm::Ed25519SolanaPubkey)
            && new_admin != Pubkey::default()
            && new_admin.to_bytes() != current_admin.value,
        MaivwError::InvalidNewDomainAdmin
    );
    Ok(())
}

pub fn authorize_pending_acceptance(
    pending: &PendingAdmin,
    current_admin: KeyDescriptor,
    candidate: Pubkey,
) -> Result<()> {
    require!(
        matches!(pending.status, PendingAdminStatus::Pending)
            && matches!(current_admin.algorithm, KeyAlgorithm::Ed25519SolanaPubkey)
            && pending.proposed_by.to_bytes() == current_admin.value,
        MaivwError::InvalidPendingAdmin
    );
    require!(
        pending.new_admin == candidate,
        MaivwError::UnauthorizedPendingAdmin
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::PENDING_ADMIN_SCHEMA_VERSION;

    fn descriptor(key: Pubkey) -> KeyDescriptor {
        KeyDescriptor {
            algorithm: KeyAlgorithm::Ed25519SolanaPubkey,
            value: key.to_bytes(),
        }
    }

    fn pending(proposer: Pubkey, candidate: Pubkey) -> PendingAdmin {
        PendingAdmin {
            schema_version: PENDING_ADMIN_SCHEMA_VERSION,
            bump: 1,
            domain_hash: [1; 32],
            global_domain_epoch: 2,
            proposed_by: proposer,
            new_admin: candidate,
            proposed_at: 3,
            proposed_sequence: 4,
            status: PendingAdminStatus::Pending,
            accepted_at: 0,
            accepted_sequence: 0,
        }
    }

    #[test]
    fn candidate_must_be_nonzero_and_different() {
        let current = Pubkey::new_unique();
        assert!(validate_new_admin(descriptor(current), Pubkey::new_unique()).is_ok());
        assert!(validate_new_admin(descriptor(current), Pubkey::default()).is_err());
        assert!(validate_new_admin(descriptor(current), current).is_err());
    }

    #[test]
    fn only_candidate_can_accept_current_admin_proposal() {
        let current = Pubkey::new_unique();
        let candidate = Pubkey::new_unique();
        let proposal = pending(current, candidate);
        assert!(authorize_pending_acceptance(&proposal, descriptor(current), candidate).is_ok());
        assert!(
            authorize_pending_acceptance(&proposal, descriptor(current), Pubkey::new_unique())
                .is_err()
        );
    }

    #[test]
    fn stale_or_consumed_proposal_cannot_be_accepted() {
        let current = Pubkey::new_unique();
        let candidate = Pubkey::new_unique();
        let proposal = pending(current, candidate);
        assert!(authorize_pending_acceptance(
            &proposal,
            descriptor(Pubkey::new_unique()),
            candidate
        )
        .is_err());

        let mut consumed = proposal;
        consumed.status = PendingAdminStatus::Accepted;
        assert!(authorize_pending_acceptance(&consumed, descriptor(current), candidate).is_err());
    }
}
