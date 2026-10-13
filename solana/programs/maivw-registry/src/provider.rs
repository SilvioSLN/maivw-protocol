use anchor_lang::prelude::*;

use crate::{error::MaivwError, state::DomainStatus};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct TopUpStakeArgs {
    pub domain_hash: [u8; 32],
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct IssueWarningArgs {
    pub domain_hash: [u8; 32],
    pub sub_identity_hash: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TopUpTransition {
    pub current_stake: u64,
    pub status: DomainStatus,
    pub reactivated: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct WarningTransition {
    pub penalty_charged: u64,
    pub current_stake: u64,
    pub status: DomainStatus,
    pub suspended: bool,
}

pub fn top_up_transition(
    current_stake: u64,
    amount: u64,
    required_stake: u64,
    status: DomainStatus,
) -> Result<TopUpTransition> {
    require!(amount > 0, MaivwError::InvalidAmount);
    require!(
        matches!(status, DomainStatus::Active | DomainStatus::Suspended),
        MaivwError::InvalidDomainStatus
    );
    let current_stake = current_stake
        .checked_add(amount)
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
    let reactivated = matches!(status, DomainStatus::Suspended) && current_stake >= required_stake;
    let status = if current_stake >= required_stake {
        DomainStatus::Active
    } else {
        DomainStatus::Suspended
    };
    Ok(TopUpTransition {
        current_stake,
        status,
        reactivated,
    })
}

pub fn warning_transition(
    current_stake: u64,
    penalty_per_strike: u64,
    required_stake: u64,
    status: DomainStatus,
) -> Result<WarningTransition> {
    require!(
        matches!(status, DomainStatus::Active | DomainStatus::Suspended),
        MaivwError::InvalidDomainStatus
    );
    let penalty_charged = penalty_per_strike.min(current_stake);
    let current_stake = current_stake
        .checked_sub(penalty_charged)
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
    let suspended = matches!(status, DomainStatus::Active) && current_stake < required_stake;
    Ok(WarningTransition {
        penalty_charged,
        current_stake,
        status: if suspended {
            DomainStatus::Suspended
        } else {
            status
        },
        suspended,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_top_up_does_not_reactivate_provider() {
        let partial = top_up_transition(0, 99, 100, DomainStatus::Suspended).unwrap();
        assert_eq!(partial.current_stake, 99);
        assert_eq!(partial.status, DomainStatus::Suspended);
        assert!(!partial.reactivated);

        let complete = top_up_transition(partial.current_stake, 1, 100, partial.status).unwrap();
        assert_eq!(complete.current_stake, 100);
        assert_eq!(complete.status, DomainStatus::Active);
        assert!(complete.reactivated);
    }

    #[test]
    fn top_up_rejects_zero_revoked_and_overflow() {
        assert!(top_up_transition(1, 0, 1, DomainStatus::Active).is_err());
        assert!(top_up_transition(1, 1, 1, DomainStatus::Revoked).is_err());
        assert!(top_up_transition(u64::MAX, 1, 1, DomainStatus::Active).is_err());

        let undercollateralized = top_up_transition(1, 1, 10, DomainStatus::Active).unwrap();
        assert_eq!(undercollateralized.status, DomainStatus::Suspended);
    }

    #[test]
    fn warning_charges_at_most_current_stake_and_suspends() {
        let first = warning_transition(100, 10, 100, DomainStatus::Active).unwrap();
        assert_eq!(first.penalty_charged, 10);
        assert_eq!(first.current_stake, 90);
        assert_eq!(first.status, DomainStatus::Suspended);
        assert!(first.suspended);

        let drained = warning_transition(3, 10, 100, DomainStatus::Suspended).unwrap();
        assert_eq!(drained.penalty_charged, 3);
        assert_eq!(drained.current_stake, 0);
        assert_eq!(drained.status, DomainStatus::Suspended);
        assert!(!drained.suspended);
    }
}
