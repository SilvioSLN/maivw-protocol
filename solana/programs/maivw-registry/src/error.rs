use anchor_lang::prelude::*;

#[error_code]
pub enum MaivwError {
    #[msg("registry is paused")]
    RegistryPaused,
    #[msg("invalid instructions sysvar")]
    InvalidInstructionsSysvar,
    #[msg("attestation envelope is malformed")]
    InvalidAttestation,
    #[msg("attestation destination does not match this deployment")]
    InvalidDestination,
    #[msg("attestation has expired")]
    AttestationExpired,
    #[msg("attestation nonce must not be zero")]
    ZeroNonce,
    #[msg("the immediately preceding instruction must be Ed25519 verification")]
    MissingEd25519Instruction,
    #[msg("only one canonical Ed25519 signature is accepted")]
    InvalidEd25519Instruction,
    #[msg("Ed25519 signer does not match the configured oracle")]
    InvalidOracleSigner,
    #[msg("Ed25519 message does not match the attestation digest")]
    InvalidSignedMessage,
    #[msg("registry configuration is invalid")]
    InvalidRegistryConfig,
    #[msg("domain record is invalid")]
    InvalidDomainRecord,
    #[msg("domain must be canonical lowercase ASCII")]
    InvalidDomain,
    #[msg("domain hash does not match the canonical domain")]
    InvalidDomainHash,
    #[msg("origin records must identify this Solana deployment")]
    InvalidOriginReference,
    #[msg("mirror records must identify a distinct origin deployment")]
    InvalidMirrorReference,
}
