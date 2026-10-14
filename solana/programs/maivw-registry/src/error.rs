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
    #[msg("oracle signer does not match the configured oracle key")]
    UnauthorizedOracle,
    #[msg("amount must be greater than zero")]
    InvalidAmount,
    #[msg("operation requires a provider origin record")]
    NotProvider,
    #[msg("domain status does not allow this operation")]
    InvalidDomainStatus,
    #[msg("strike counter overflowed")]
    StrikeOverflow,
    #[msg("sub-identity hash must not be zero")]
    InvalidSubIdentity,
    #[msg("slash case is invalid")]
    InvalidSlashCase,
    #[msg("a slash case is already pending or was already executed")]
    SlashCaseUnavailable,
    #[msg("slash timelock has not elapsed")]
    SlashNotReady,
    #[msg("signer is not authorized to veto the slash")]
    UnauthorizedVeto,
    #[msg("reporter root and count are inconsistent or exceed protocol limits")]
    InvalidReporterSet,
    #[msg("reporter Merkle proof is invalid")]
    InvalidMerkleProof,
    #[msg("reporter pool accounting is invalid")]
    InvalidReporterPool,
    #[msg("reporter reward is zero or unavailable")]
    NothingToClaim,
    #[msg("reporter claim account is invalid")]
    InvalidReporterClaim,
    #[msg("signer does not match the domain admin key")]
    UnauthorizedDomainAdmin,
    #[msg("mirror records are read-only on this deployment")]
    MirrorReadOnly,
    #[msg("operational mail key must not be zero")]
    InvalidOperationalKey,
    #[msg("endpoint is empty or exceeds the protocol limit")]
    InvalidEndpoint,
}
