use anchor_lang::prelude::*;

use crate::error::MaivwError;

/// Rejects account substitution where one address is supplied in two roles that
/// must be economically independent (for example, SPL source and destination).
pub fn require_distinct_accounts(accounts: &[Pubkey]) -> Result<()> {
    for (index, account) in accounts.iter().enumerate() {
        require!(
            !accounts[index + 1..].contains(account),
            MaivwError::InvalidAccountAlias
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        constants::{
            DOMAIN_RECORD_SEED, FOUNDER_VAULT_AUTHORITY_SEED, STAKE_VAULT_SEED,
            TREASURY_VAULT_AUTHORITY_SEED,
        },
        ID,
    };

    #[test]
    fn distinct_account_roles_are_accepted() {
        assert!(require_distinct_accounts(&[
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            Pubkey::new_unique(),
        ])
        .is_ok());
    }

    #[test]
    fn duplicated_account_roles_are_rejected_at_any_position() {
        let first = Pubkey::new_unique();
        let second = Pubkey::new_unique();
        assert!(require_distinct_accounts(&[first, first]).is_err());
        assert!(require_distinct_accounts(&[first, second, first]).is_err());
        assert!(require_distinct_accounts(&[first, second, second]).is_err());
    }

    #[test]
    fn canonical_authority_and_domain_pdas_are_separated_by_seed_namespace() {
        let founder = Pubkey::find_program_address(&[FOUNDER_VAULT_AUTHORITY_SEED], &ID).0;
        let treasury = Pubkey::find_program_address(&[TREASURY_VAULT_AUTHORITY_SEED], &ID).0;
        let domain_hash = [7; 32];
        let domain =
            Pubkey::find_program_address(&[DOMAIN_RECORD_SEED, domain_hash.as_ref()], &ID).0;
        let stake = Pubkey::find_program_address(&[STAKE_VAULT_SEED, domain_hash.as_ref()], &ID).0;

        require_distinct_accounts(&[founder, treasury, domain, stake]).unwrap();
    }
}
