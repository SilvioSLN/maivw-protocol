use anchor_lang::prelude::*;

use crate::{
    constants::{MAX_REPORTERS_PER_POOL, MAX_REPORTER_PROOF_LEN, REPORTER_LEAF_MAGIC},
    error::MaivwError,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct ProposeSlashArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub reporter_root: [u8; 32],
    pub reporter_count: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct SlashCaseArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, Eq, PartialEq)]
pub struct ClaimReporterRewardArgs {
    pub domain_hash: [u8; 32],
    pub global_domain_epoch: u64,
    pub case_nonce: [u8; 32],
    pub proof: Vec<[u8; 32]>,
}

pub fn validate_reporter_set(root: [u8; 32], count: u32) -> Result<()> {
    require!(
        count <= MAX_REPORTERS_PER_POOL
            && ((count == 0 && root == [0; 32]) || (count > 0 && root != [0; 32])),
        MaivwError::InvalidReporterSet
    );
    Ok(())
}

pub fn reporter_leaf(
    domain_hash: [u8; 32],
    global_domain_epoch: u64,
    case_nonce: [u8; 32],
    reporter: Pubkey,
) -> [u8; 32] {
    let mut encoded = [0_u8; 121];
    encoded[..17].copy_from_slice(&REPORTER_LEAF_MAGIC);
    encoded[17..49].copy_from_slice(&domain_hash);
    encoded[49..57].copy_from_slice(&global_domain_epoch.to_be_bytes());
    encoded[57..89].copy_from_slice(&case_nonce);
    encoded[89..].copy_from_slice(reporter.as_ref());
    maivw_attestation::keccak256(&encoded)
}

pub fn verify_reporter_proof(root: [u8; 32], leaf: [u8; 32], proof: &[[u8; 32]]) -> Result<()> {
    require!(
        proof.len() <= MAX_REPORTER_PROOF_LEN,
        MaivwError::InvalidMerkleProof
    );
    let computed = proof.iter().fold(leaf, |node, sibling| {
        let mut pair = [0_u8; 64];
        if node <= *sibling {
            pair[..32].copy_from_slice(&node);
            pair[32..].copy_from_slice(sibling);
        } else {
            pair[..32].copy_from_slice(sibling);
            pair[32..].copy_from_slice(&node);
        }
        maivw_attestation::keccak256(&pair)
    });
    require!(computed == root, MaivwError::InvalidMerkleProof);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parent(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
        let mut pair = [0_u8; 64];
        let (first, second) = if left <= right {
            (left, right)
        } else {
            (right, left)
        };
        pair[..32].copy_from_slice(&first);
        pair[32..].copy_from_slice(&second);
        maivw_attestation::keccak256(&pair)
    }

    #[test]
    fn reporter_leaf_is_bound_to_case_epoch_and_signer() {
        let reporter = Pubkey::new_unique();
        let leaf = reporter_leaf([1; 32], 2, [3; 32], reporter);
        assert_ne!(leaf, reporter_leaf([9; 32], 2, [3; 32], reporter));
        assert_ne!(leaf, reporter_leaf([1; 32], 3, [3; 32], reporter));
        assert_ne!(leaf, reporter_leaf([1; 32], 2, [4; 32], reporter));
        assert_ne!(
            leaf,
            reporter_leaf([1; 32], 2, [3; 32], Pubkey::new_unique())
        );
    }

    #[test]
    fn sorted_pair_proof_accepts_member_and_rejects_substitution() {
        let first = reporter_leaf([1; 32], 2, [3; 32], Pubkey::new_unique());
        let second = reporter_leaf([1; 32], 2, [3; 32], Pubkey::new_unique());
        let third = reporter_leaf([1; 32], 2, [3; 32], Pubkey::new_unique());
        let fourth = reporter_leaf([1; 32], 2, [3; 32], Pubkey::new_unique());
        let left = parent(first, second);
        let right = parent(third, fourth);
        let root = parent(left, right);

        assert!(verify_reporter_proof(root, first, &[second, right]).is_ok());
        assert!(verify_reporter_proof(root, [8; 32], &[second, right]).is_err());
    }

    #[test]
    fn proof_and_reporter_set_limits_are_enforced() {
        assert!(validate_reporter_set([0; 32], 0).is_ok());
        assert!(validate_reporter_set([1; 32], MAX_REPORTERS_PER_POOL).is_ok());
        assert!(validate_reporter_set([1; 32], 0).is_err());
        assert!(validate_reporter_set([0; 32], 1).is_err());
        assert!(validate_reporter_set([1; 32], MAX_REPORTERS_PER_POOL + 1).is_err());
        assert!(verify_reporter_proof(
            [1; 32],
            [2; 32],
            &vec![[3; 32]; MAX_REPORTER_PROOF_LEN + 1]
        )
        .is_err());
    }

    #[test]
    fn maximum_claim_payload_is_bounded() {
        let args = ClaimReporterRewardArgs {
            domain_hash: [1; 32],
            global_domain_epoch: u64::MAX,
            case_nonce: [2; 32],
            proof: vec![[3; 32]; MAX_REPORTER_PROOF_LEN],
        };
        let mut encoded = Vec::new();
        args.serialize(&mut encoded).unwrap();
        assert_eq!(encoded.len(), 32 + 8 + 32 + 4 + (32 * 16));
        assert!(encoded.len() < 600);
    }
}
