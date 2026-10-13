pub const REGISTRY_CONFIG_SEED: &[u8] = b"registry-config";
pub const DOMAIN_RECORD_SEED: &[u8] = b"domain";

pub const MAX_DOMAIN_LEN: usize = 253;
pub const MAX_ENDPOINT_LEN: usize = 512;
pub const PROVIDER_TIER_COUNT: usize = 3;
pub const REGISTRY_SCHEMA_VERSION: u16 = 1;
pub const DOMAIN_SCHEMA_VERSION: u16 = 1;

pub const ED25519_SIGNATURE_SIZE: usize = 64;
pub const ED25519_PUBLIC_KEY_SIZE: usize = 32;
pub const ATTESTATION_DIGEST_SIZE: usize = 32;
pub const ED25519_OFFSETS_START: usize = 2;
pub const ED25519_OFFSETS_SIZE: usize = 14;
pub const CURRENT_INSTRUCTION_INDEX: u16 = u16::MAX;
