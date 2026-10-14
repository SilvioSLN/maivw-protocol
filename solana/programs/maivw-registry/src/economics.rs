use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};

use crate::{
    constants::{BPS_DENOMINATOR, FOUNDER_FEE_BPS, REPORTER_BOUNTY_BPS, TREASURY_FEE_BPS},
    error::MaivwError,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FeeSplit {
    pub founder: u64,
    pub treasury: u64,
    pub stake: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SlashDistribution {
    pub per_reporter: u64,
    pub reporter_pool: u64,
    pub burned: u64,
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

pub fn slash_distribution(
    original_registration_amount: u64,
    current_stake: u64,
    reporter_count: u32,
) -> Result<SlashDistribution> {
    let reporter_cap =
        basis_points(original_registration_amount, REPORTER_BOUNTY_BPS)?.min(current_stake);
    let per_reporter = if reporter_count == 0 {
        0
    } else {
        reporter_cap / u64::from(reporter_count)
    };
    let reporter_pool = per_reporter
        .checked_mul(u64::from(reporter_count))
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
    let burned = current_stake
        .checked_sub(reporter_pool)
        .ok_or_else(|| error!(MaivwError::ArithmeticOverflow))?;
    require!(
        reporter_pool
            .checked_add(burned)
            .is_some_and(|total| total == current_stake),
        MaivwError::InvalidFeeSplit
    );
    Ok(SlashDistribution {
        per_reporter,
        reporter_pool,
        burned,
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

#[allow(clippy::too_many_arguments)]
pub fn burn_tokens_signed<'info>(
    token_program: Pubkey,
    mint: AccountInfo<'info>,
    from: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let instruction = token::spl_token::instruction::burn_checked(
        &token_program,
        from.key,
        mint.key,
        authority.key,
        &[],
        amount,
        decimals,
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &instruction,
        &[from, mint, authority],
        signer_seeds,
    )
    .map_err(Into::into)
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

    #[test]
    fn slash_split_is_constant_work_and_conserves_stake() {
        for (original, current, reporters) in [
            (1_000, 650, 3),
            (1_000, 50, 3),
            (u64::MAX, u64::MAX, 65_536),
            (100, 10, 0),
        ] {
            let split = slash_distribution(original, current, reporters).unwrap();
            assert_eq!(split.reporter_pool + split.burned, current);
            assert_eq!(
                split.reporter_pool,
                split.per_reporter * u64::from(reporters)
            );
        }
    }

    #[test]
    fn slash_split_caps_pool_and_burns_rounding_remainder() {
        assert_eq!(
            slash_distribution(1_000, 650, 3).unwrap(),
            SlashDistribution {
                per_reporter: 33,
                reporter_pool: 99,
                burned: 551,
            }
        );
        assert_eq!(
            slash_distribution(1_000, 10, 0).unwrap(),
            SlashDistribution {
                per_reporter: 0,
                reporter_pool: 0,
                burned: 10,
            }
        );
    }
}
