use anchor_lang::prelude::*;

use crate::error::MaivwError;

pub fn authorize_pause(
    authority: Pubkey,
    guardian: Pubkey,
    signer: Pubkey,
    active: bool,
) -> Result<()> {
    require!(active, MaivwError::RegistryAlreadyPaused);
    require!(
        signer == authority || signer == guardian,
        MaivwError::UnauthorizedPause
    );
    Ok(())
}

pub fn authorize_unpause(authority: Pubkey, signer: Pubkey, active: bool) -> Result<()> {
    require!(!active, MaivwError::RegistryAlreadyActive);
    require_keys_eq!(signer, authority, MaivwError::UnauthorizedUnpause);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guardian_and_authority_can_pause_only_once() {
        let authority = Pubkey::new_unique();
        let guardian = Pubkey::new_unique();

        assert!(authorize_pause(authority, guardian, authority, true).is_ok());
        assert!(authorize_pause(authority, guardian, guardian, true).is_ok());
        assert!(authorize_pause(authority, guardian, Pubkey::new_unique(), true).is_err());
        assert!(authorize_pause(authority, guardian, guardian, false).is_err());
    }

    #[test]
    fn only_authority_can_unpause_an_inactive_registry() {
        let authority = Pubkey::new_unique();
        let guardian = Pubkey::new_unique();

        assert!(authorize_unpause(authority, authority, false).is_ok());
        assert!(authorize_unpause(authority, guardian, false).is_err());
        assert!(authorize_unpause(authority, authority, true).is_err());
    }
}
