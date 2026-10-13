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
    #[msg("origin claim does not authorize this registration")]
    InvalidOriginClaim,
    #[msg("origin claim payload does not match the registration")]
    InvalidRegistrationPayload,
    #[msg("origin claim must carry DNS evidence")]
    MissingOriginEvidence,
    #[msg("provider tier is invalid")]
    InvalidProviderTier,
    #[msg("token mint or token program does not match registry configuration")]
    InvalidAsset,
    #[msg("token decimals do not match registry configuration")]
    InvalidAssetDecimals,
    #[msg("economic calculation overflowed")]
    ArithmeticOverflow,
    #[msg("fee split does not conserve the full payment")]
    InvalidFeeSplit,
    #[msg("stake vault accounting does not match its token account")]
    InvalidStakeVault,
}
