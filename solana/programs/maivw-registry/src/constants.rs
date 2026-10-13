pub const REGISTRY_CONFIG_SEED: &[u8] = b"registry-config";
pub const DOMAIN_RECORD_SEED: &[u8] = b"domain";
pub const ORIGIN_CLAIM_RECEIPT_SEED: &[u8] = b"origin-claim";
pub const STAKE_VAULT_SEED: &[u8] = b"stake-vault";
pub const FOUNDER_VAULT_AUTHORITY_SEED: &[u8] = b"founder-vault";
pub const TREASURY_VAULT_AUTHORITY_SEED: &[u8] = b"treasury-vault";

pub const MAX_DOMAIN_LEN: usize = 253;
pub const MAX_ENDPOINT_LEN: usize = 512;
pub const PROVIDER_TIER_COUNT: usize = 3;
pub const REGISTRY_SCHEMA_VERSION: u16 = 1;
pub const DOMAIN_SCHEMA_VERSION: u16 = 1;
pub const RECEIPT_SCHEMA_VERSION: u16 = 1;
pub const STAKE_VAULT_SCHEMA_VERSION: u16 = 1;

pub const BPS_DENOMINATOR: u64 = 10_000;
pub const FOUNDER_FEE_BPS: u64 = 1_000;
pub const TREASURY_FEE_BPS: u64 = 2_500;
pub const REGISTRATION_PAYLOAD_MAGIC: [u8; 8] = *b"MAIVWREG";
pub const REGISTRATION_PAYLOAD_VERSION: u8 = 1;

pub const ED25519_SIGNATURE_SIZE: usize = 64;
pub const ED25519_PUBLIC_KEY_SIZE: usize = 32;
pub const ATTESTATION_DIGEST_SIZE: usize = 32;
pub const ED25519_OFFSETS_START: usize = 2;
pub const ED25519_OFFSETS_SIZE: usize = 14;
pub const CURRENT_INSTRUCTION_INDEX: u16 = u16::MAX;
