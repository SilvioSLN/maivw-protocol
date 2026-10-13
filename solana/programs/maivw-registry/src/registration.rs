use anchor_lang::prelude::*;

use crate::{
    constants::{REGISTRATION_PAYLOAD_MAGIC, REGISTRATION_PAYLOAD_VERSION},
    state::{KeyAlgorithm, ProviderTier, ProviderTierConfig},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitializeRegistryArgs {
    pub guardian: Pubkey,
    pub oracle_key: [u8; 32],
    pub treasury: Pubkey,
    pub founder: Pubkey,
    pub network_hash: [u8; 32],
    pub standard_fee: u64,
    pub provider_fee: u64,
    pub mirror_fee: u64,
    pub slash_delay_seconds: u64,
    pub recovery_delay_seconds: u64,
    pub tiers: [ProviderTierConfig; 3],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterDomainArgs {
    pub domain_hash: [u8; 32],
    pub claim_nonce: [u8; 32],
    pub domain: String,
    pub endpoint: String,
    pub operational_key: [u8; 32],
    pub admin_key: [u8; 32],
    pub tls_fingerprint: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegisterProviderArgs {
    pub domain_hash: [u8; 32],
    pub claim_nonce: [u8; 32],
    pub domain: String,
    pub endpoint: String,
    pub operational_key: [u8; 32],
    pub admin_key: [u8; 32],
    pub tls_fingerprint: [u8; 32],
    pub tier: ProviderTier,
}

pub fn domain_payload_hash(
    args: &RegisterDomainArgs,
    registrant: Pubkey,
    mint: Pubkey,
    amount: u64,
) -> [u8; 32] {
    registration_payload_hash(
        args.domain_hash,
        &args.endpoint,
        args.operational_key,
        args.admin_key,
        args.tls_fingerprint,
        registrant,
        mint,
        false,
        ProviderTier::None,
        amount,
    )
}

pub fn provider_payload_hash(
    args: &RegisterProviderArgs,
    registrant: Pubkey,
    mint: Pubkey,
    amount: u64,
) -> [u8; 32] {
    registration_payload_hash(
        args.domain_hash,
        &args.endpoint,
        args.operational_key,
        args.admin_key,
        args.tls_fingerprint,
        registrant,
        mint,
        true,
        args.tier,
        amount,
    )
}

#[allow(clippy::too_many_arguments)]
fn registration_payload_hash(
    domain_hash: [u8; 32],
    endpoint: &str,
    operational_key: [u8; 32],
    admin_key: [u8; 32],
    tls_fingerprint: [u8; 32],
    registrant: Pubkey,
    mint: Pubkey,
    is_provider: bool,
    tier: ProviderTier,
    amount: u64,
) -> [u8; 32] {
    let endpoint_hash = maivw_attestation::keccak256(endpoint.as_bytes());
    let mut payload = Vec::with_capacity(245);
    payload.extend_from_slice(&REGISTRATION_PAYLOAD_MAGIC);
    payload.push(REGISTRATION_PAYLOAD_VERSION);
    payload.extend_from_slice(&domain_hash);
    payload.extend_from_slice(&registrant.to_bytes());
    payload.push(KeyAlgorithm::Ed25519SolanaPubkey as u8);
    payload.extend_from_slice(&operational_key);
    payload.push(KeyAlgorithm::Ed25519SolanaPubkey as u8);
    payload.extend_from_slice(&admin_key);
    payload.extend_from_slice(&endpoint_hash);
    payload.extend_from_slice(&tls_fingerprint);
    payload.push(u8::from(is_provider));
    payload.push(tier as u8);
    payload.extend_from_slice(&amount.to_be_bytes());
    payload.extend_from_slice(&mint.to_bytes());
    maivw_attestation::keccak256(&payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn domain_args() -> RegisterDomainArgs {
        RegisterDomainArgs {
            domain_hash: [1; 32],
            claim_nonce: [9; 32],
            domain: "mail.example".to_owned(),
            endpoint: "https://mail.example".to_owned(),
            operational_key: [2; 32],
            admin_key: [3; 32],
            tls_fingerprint: [4; 32],
        }
    }

    #[test]
    fn payload_binds_registrant_keys_endpoint_amount_and_mint() {
        let args = domain_args();
        let registrant = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let expected = domain_payload_hash(&args, registrant, mint, 100);

        assert_ne!(
            expected,
            domain_payload_hash(&args, Pubkey::new_unique(), mint, 100)
        );
        assert_ne!(expected, domain_payload_hash(&args, registrant, mint, 101));
        assert_ne!(
            expected,
            domain_payload_hash(&args, registrant, Pubkey::new_unique(), 100)
        );

        let mut changed = args;
        changed.endpoint.push_str("/v2");
        assert_ne!(
            expected,
            domain_payload_hash(&changed, registrant, mint, 100)
        );
    }

    #[test]
    fn provider_payload_is_distinct_from_standard_domain() {
        let domain = domain_args();
        let provider = RegisterProviderArgs {
            domain_hash: domain.domain_hash,
            claim_nonce: domain.claim_nonce,
            domain: domain.domain.clone(),
            endpoint: domain.endpoint.clone(),
            operational_key: domain.operational_key,
            admin_key: domain.admin_key,
            tls_fingerprint: domain.tls_fingerprint,
            tier: ProviderTier::Basic,
        };
        let registrant = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        assert_ne!(
            domain_payload_hash(&domain, registrant, mint, 100),
            provider_payload_hash(&provider, registrant, mint, 100)
        );
    }
}
