use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};

use crate::{
    constants::{BPS_DENOMINATOR, FOUNDER_FEE_BPS, TREASURY_FEE_BPS},
    error::MaivwError,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FeeSplit {
    pub founder: u64,
    pub treasury: u64,
    pub stake: u64,
}

pub fn split_standard_fee(amount: u64) -> Result<FeeSplit> {
    let founder = basis_points(amount, FOUNDER_FEE_BPS)?;
    let treasury = basis_points(amount, TREASURY_FEE_BPS)?;
    let stake = amount
        .checked_sub(founder)
        .and_then(|remaining| remaining.checked_sub(treasury))
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
    require!(
        founder
            .checked_add(treasury)
            .and_then(|subtotal| subtotal.checked_add(stake))
            == Some(amount),
        MaivwError::InvalidFeeSplit
    );
    Ok(FeeSplit {
        founder,
        treasury,
        stake,
    })
}

pub fn transfer_tokens<'info>(
    token_program: Pubkey,
    mint: AccountInfo<'info>,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer_checked(
        CpiContext::new(
            token_program,
            TransferChecked {
                from,
                mint,
                to,
                authority,
            },
        ),
        amount,
        decimals,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn transfer_tokens_signed<'info>(
    token_program: Pubkey,
    mint: AccountInfo<'info>,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from,
                mint,
                to,
                authority,
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

fn basis_points(amount: u64, basis_points: u64) -> Result<u64> {
    let value = u128::from(amount)
        .checked_mul(u128::from(basis_points))
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?
        / u128::from(BPS_DENOMINATOR);
    u64::try_from(value).map_err(|_| error!(MaivwError::ArithmeticOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_split_conserves_every_unit() {
        for amount in [1, 3, 10, 99, 100, 10_001, u64::MAX] {
            let split = split_standard_fee(amount).unwrap();
            assert_eq!(split.founder + split.treasury + split.stake, amount);
        }
    }

    #[test]
    fn standard_split_assigns_rounding_remainder_to_stake() {
        assert_eq!(
            split_standard_fee(101).unwrap(),
            FeeSplit {
                founder: 10,
                treasury: 25,
                stake: 66,
            }
        );
    }
}
