use anchor_lang::prelude::*;
use maivw_attestation::{AttestationAction, AttestationKind, AttestationV1};
use solana_instruction::Instruction;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};
use solana_sdk_ids::secp256k1_program;

use crate::{
    ID,
    constants::{
        SECP256K1_ETH_ADDRESS_SIZE, SECP256K1_OFFSETS_SIZE, SECP256K1_SIGNATURE_SIZE,
    },
    error::MaivwError,
    state::RegistryConfig,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Secp256k1Offsets {
    signature_offset: u16,
    signature_instruction_index: u8,
    eth_address_offset: u16,
    eth_address_instruction_index: u8,
    message_data_offset: u16,
    message_data_size: u16,
    message_instruction_index: u8,
}

pub fn verify(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
) -> Result<AttestationV1> {
    let now = Clock::get()?.unix_timestamp;
    let attestation = validate_envelope(config, envelope, now)?;

    let current_index = load_current_index_checked(instructions_sysvar)?;
    require!(current_index > 0, MaivwError::MissingSecp256k1Instruction);
    let secp256k1_instruction =
        load_instruction_at_checked(usize::from(current_index - 1), instructions_sysvar)?;
    let program_instruction =
        load_instruction_at_checked(usize::from(current_index), instructions_sysvar)?;
    let verification_index = u8::try_from(current_index - 1)
        .map_err(|_| error!(MaivwError::InvalidSecp256k1Instruction))?;
    let program_index = u8::try_from(current_index)
        .map_err(|_| error!(MaivwError::InvalidSecp256k1Instruction))?;
    verify_secp256k1_instruction(
        &secp256k1_instruction,
        verification_index,
        &program_instruction,
        program_index,
        config.attestation_signer,
        envelope,
    )?;
    Ok(attestation)
}

pub fn verify_origin_claim(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
    expected_domain_hash: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<AttestationV1> {
    let attestation = verify(config, instructions_sysvar, envelope)?;
    validate_origin_claim(
        &attestation,
        config,
        expected_domain_hash,
        expected_payload_hash,
        expected_nonce,
    )?;
    Ok(attestation)
}

#[allow(clippy::too_many_arguments)]
pub fn verify_recovery(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
    expected_domain_hash: [u8; 32],
    expected_epoch: u64,
    expected_sequence: u64,
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<AttestationV1> {
    let attestation = verify(config, instructions_sysvar, envelope)?;
    validate_recovery(
        &attestation,
        config,
        expected_domain_hash,
        expected_epoch,
        expected_sequence,
        expected_payload_hash,
        expected_nonce,
    )?;
    Ok(attestation)
}

#[allow(clippy::too_many_arguments)]
pub fn verify_reclaim_claim(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
    expected_domain_hash: [u8; 32],
    expected_epoch: u64,
    expected_sequence: u64,
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<AttestationV1> {
    let attestation = verify(config, instructions_sysvar, envelope)?;
    validate_reclaim_claim(
        &attestation,
        config,
        expected_domain_hash,
        expected_epoch,
        expected_sequence,
        expected_payload_hash,
        expected_nonce,
    )?;
    Ok(attestation)
}

pub fn verify_register_mirror(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
    expected_domain_hash: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<AttestationV1> {
    let attestation = verify(config, instructions_sysvar, envelope)?;
    validate_register_mirror(
        &attestation,
        config,
        expected_domain_hash,
        expected_payload_hash,
        expected_nonce,
    )?;
    Ok(attestation)
}

#[allow(clippy::too_many_arguments)]
pub fn verify_sync_mirror(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
    expected_domain_hash: [u8; 32],
    expected_origin_network_hash: [u8; 32],
    expected_origin_registry: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<AttestationV1> {
    let attestation = verify(config, instructions_sysvar, envelope)?;
    validate_sync_mirror(
        &attestation,
        expected_domain_hash,
        expected_origin_network_hash,
        expected_origin_registry,
        expected_payload_hash,
        expected_nonce,
    )?;
    Ok(attestation)
}

#[allow(clippy::too_many_arguments)]
pub fn verify_revoke_mirror(
    config: &RegistryConfig,
    instructions_sysvar: &AccountInfo<'_>,
    envelope: &[u8],
    expected_domain_hash: [u8; 32],
    expected_origin_network_hash: [u8; 32],
    expected_origin_registry: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<AttestationV1> {
    let attestation = verify(config, instructions_sysvar, envelope)?;
    validate_revoke_mirror(
        &attestation,
        expected_domain_hash,
        expected_origin_network_hash,
        expected_origin_registry,
        expected_payload_hash,
        expected_nonce,
    )?;
    Ok(attestation)
}

#[allow(clippy::too_many_arguments)]
fn validate_revoke_mirror(
    attestation: &AttestationV1,
    expected_domain_hash: [u8; 32],
    expected_origin_network_hash: [u8; 32],
    expected_origin_registry: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<()> {
    require!(
        matches!(attestation.kind, AttestationKind::StateAttestation)
            && matches!(attestation.action, AttestationAction::RevokeMirror)
            && attestation.domain_hash == expected_domain_hash
            && attestation.nonce == expected_nonce,
        MaivwError::InvalidMirrorAttestation
    );
    require!(
        attestation.origin_network_hash == expected_origin_network_hash
            && attestation.origin_registry == expected_origin_registry
            && attestation.evidence_hash != [0; 32],
        MaivwError::MirrorOriginMismatch
    );
    require!(
        attestation.payload_hash == expected_payload_hash,
        MaivwError::InvalidMirrorPayload
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_sync_mirror(
    attestation: &AttestationV1,
    expected_domain_hash: [u8; 32],
    expected_origin_network_hash: [u8; 32],
    expected_origin_registry: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<()> {
    require!(
        matches!(attestation.kind, AttestationKind::StateAttestation)
            && matches!(attestation.action, AttestationAction::SyncMirror)
            && attestation.domain_hash == expected_domain_hash
            && attestation.nonce == expected_nonce,
        MaivwError::InvalidMirrorAttestation
    );
    require!(
        attestation.origin_network_hash == expected_origin_network_hash
            && attestation.origin_registry == expected_origin_registry
            && attestation.evidence_hash != [0; 32],
        MaivwError::MirrorOriginMismatch
    );
    require!(
        attestation.payload_hash == expected_payload_hash,
        MaivwError::InvalidMirrorPayload
    );
    Ok(())
}

fn validate_register_mirror(
    attestation: &AttestationV1,
    config: &RegistryConfig,
    expected_domain_hash: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<()> {
    require!(
        matches!(attestation.kind, AttestationKind::StateAttestation)
            && matches!(attestation.action, AttestationAction::RegisterMirror)
            && attestation.domain_hash == expected_domain_hash
            && attestation.nonce == expected_nonce,
        MaivwError::InvalidMirrorAttestation
    );
    require!(
        attestation.origin_network_hash != [0; 32]
            && attestation.origin_registry != [0; 32]
            && (attestation.origin_network_hash != config.network_hash
                || attestation.origin_registry != ID.to_bytes())
            && attestation.evidence_hash != [0; 32],
        MaivwError::InvalidMirrorReference
    );
    require!(
        attestation.payload_hash == expected_payload_hash,
        MaivwError::InvalidMirrorPayload
    );
    Ok(())
}

fn validate_origin_claim(
    attestation: &AttestationV1,
    config: &RegistryConfig,
    expected_domain_hash: [u8; 32],
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<()> {
    require!(
        matches!(attestation.kind, AttestationKind::OriginClaim)
            && matches!(attestation.action, AttestationAction::RegisterOrigin)
            && attestation.domain_hash == expected_domain_hash
            && attestation.origin_network_hash == config.network_hash
            && attestation.origin_registry == ID.to_bytes()
            && attestation.nonce == expected_nonce
            && attestation.global_domain_epoch == 0
            && attestation.origin_sequence == 0,
        MaivwError::InvalidOriginClaim
    );
    require!(
        attestation.payload_hash == expected_payload_hash,
        MaivwError::InvalidRegistrationPayload
    );
    require!(
        attestation.evidence_hash != [0; 32],
        MaivwError::MissingOriginEvidence
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_recovery(
    attestation: &AttestationV1,
    config: &RegistryConfig,
    expected_domain_hash: [u8; 32],
    expected_epoch: u64,
    expected_sequence: u64,
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<()> {
    require!(
        matches!(attestation.kind, AttestationKind::StateAttestation)
            && matches!(attestation.action, AttestationAction::RecoverOrigin)
            && attestation.domain_hash == expected_domain_hash
            && attestation.origin_network_hash == config.network_hash
            && attestation.origin_registry == ID.to_bytes()
            && attestation.global_domain_epoch == expected_epoch
            && attestation.origin_sequence == expected_sequence
            && attestation.nonce == expected_nonce,
        MaivwError::InvalidRecoveryAttestation
    );
    require!(
        attestation.payload_hash == expected_payload_hash,
        MaivwError::InvalidRecoveryPayload
    );
    require!(
        attestation.evidence_hash != [0; 32],
        MaivwError::MissingRecoveryEvidence
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_reclaim_claim(
    attestation: &AttestationV1,
    config: &RegistryConfig,
    expected_domain_hash: [u8; 32],
    expected_epoch: u64,
    expected_sequence: u64,
    expected_payload_hash: [u8; 32],
    expected_nonce: [u8; 32],
) -> Result<()> {
    require!(
        matches!(attestation.kind, AttestationKind::OriginClaim)
            && matches!(attestation.action, AttestationAction::ReclaimOrigin)
            && attestation.domain_hash == expected_domain_hash
            && attestation.origin_network_hash == config.network_hash
            && attestation.origin_registry == ID.to_bytes()
            && attestation.global_domain_epoch == expected_epoch
            && attestation.origin_sequence == expected_sequence
            && attestation.nonce == expected_nonce,
        MaivwError::InvalidReclaimClaim
    );
    require!(
        attestation.payload_hash == expected_payload_hash,
        MaivwError::InvalidReclaimPayload
    );
    require!(
        attestation.evidence_hash != [0; 32],
        MaivwError::MissingOriginEvidence
    );
    Ok(())
}

fn validate_envelope(
    config: &RegistryConfig,
    envelope: &[u8],
    unix_timestamp: i64,
) -> Result<AttestationV1> {
    config.validate()?;
    let attestation =
        AttestationV1::decode(envelope).map_err(|_| error!(MaivwError::InvalidAttestation))?;
    require!(
        attestation.destination_network_hash == config.network_hash
            && attestation.destination_registry == ID.to_bytes(),
        MaivwError::InvalidDestination
    );
    require!(
        attestation.deadline >= u64::try_from(unix_timestamp).unwrap_or(0),
        MaivwError::AttestationExpired
    );
    require!(attestation.nonce != [0; 32], MaivwError::ZeroNonce);
    Ok(attestation)
}

fn verify_secp256k1_instruction(
    instruction: &Instruction,
    verification_index: u8,
    program_instruction: &Instruction,
    program_index: u8,
    expected_oracle: [u8; 20],
    expected_envelope: &[u8],
) -> Result<()> {
    require_keys_eq!(
        instruction.program_id,
        secp256k1_program::ID,
        MaivwError::MissingSecp256k1Instruction
    );
    require!(
        instruction.accounts.is_empty(),
        MaivwError::InvalidSecp256k1Instruction
    );
    let data = &instruction.data;
    require!(
        data.len() >= 1 + SECP256K1_OFFSETS_SIZE && data[0] == 1,
        MaivwError::InvalidSecp256k1Instruction
    );
    let offsets = parse_offsets(data)?;
    require!(
        offsets.signature_instruction_index == verification_index
            && offsets.eth_address_instruction_index == verification_index
            && usize::from(offsets.message_data_size) == expected_envelope.len(),
        MaivwError::InvalidSecp256k1Instruction
    );

    let signature = checked_slice(data, offsets.signature_offset, SECP256K1_SIGNATURE_SIZE)?;
    require!(
        signature.iter().any(|byte| *byte != 0),
        MaivwError::InvalidSecp256k1Instruction
    );
    let recovery_id = checked_slice(
        data,
        offsets
            .signature_offset
            .checked_add(SECP256K1_SIGNATURE_SIZE as u16)
            .ok_or_else(|| error!(MaivwError::InvalidSecp256k1Instruction))?,
        1,
    )?[0];
    require!(recovery_id <= 1, MaivwError::InvalidSecp256k1Instruction);
    let public_key = checked_slice(
        data,
        offsets.eth_address_offset,
        SECP256K1_ETH_ADDRESS_SIZE,
    )?;
    require!(
        public_key == expected_oracle,
        MaivwError::InvalidOracleSigner
    );
    let message_data = if offsets.message_instruction_index == verification_index {
        data.as_slice()
    } else if offsets.message_instruction_index == program_index {
        require_keys_eq!(
            program_instruction.program_id,
            ID,
            MaivwError::InvalidSecp256k1Instruction
        );
        program_instruction.data.as_slice()
    } else {
        return err!(MaivwError::InvalidSecp256k1Instruction);
    };
    let message = checked_slice(
        message_data,
        offsets.message_data_offset,
        usize::from(offsets.message_data_size),
    )?;
    require!(message == expected_envelope, MaivwError::InvalidSignedMessage);
    Ok(())
}

fn parse_offsets(data: &[u8]) -> Result<Secp256k1Offsets> {
    let u16_at = |position| {
        u16::from_le_bytes(
            data[position..position + 2]
                .try_into()
                .expect("bounds checked by caller"),
        )
    };
    Ok(Secp256k1Offsets {
        signature_offset: u16_at(1),
        signature_instruction_index: data[3],
        eth_address_offset: u16_at(4),
        eth_address_instruction_index: data[6],
        message_data_offset: u16_at(7),
        message_data_size: u16_at(9),
        message_instruction_index: data[11],
    })
}

fn checked_slice(data: &[u8], offset: u16, size: usize) -> Result<&[u8]> {
    let start = usize::from(offset);
    let end = start
        .checked_add(size)
        .ok_or_else(|| error!(MaivwError::InvalidSecp256k1Instruction))?;
    data.get(start..end)
        .ok_or_else(|| error!(MaivwError::InvalidSecp256k1Instruction))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> RegistryConfig {
        RegistryConfig {
            schema_version: crate::constants::REGISTRY_SCHEMA_VERSION,
            bump: 1,
            active: true,
            authority: Pubkey::new_unique(),
            guardian: Pubkey::new_unique(),
            oracle_key: [1; 32],
            attestation_signer: [9; 20],
            asset_mint: Pubkey::new_unique(),
            token_program: anchor_spl::token::ID,
            asset_decimals: 9,
            treasury: Pubkey::new_unique(),
            founder: Pubkey::new_unique(),
            network_hash: [2; 32],
            standard_fee: 1,
            provider_fee: 1,
            mirror_fee: 1,
            slash_delay_seconds: 1,
            recovery_delay_seconds: 1,
            tiers: [
                crate::state::ProviderTierConfig {
                    required_stake: 10,
                    daily_limit: 1,
                    penalty_per_strike: 1,
                },
                crate::state::ProviderTierConfig {
                    required_stake: 20,
                    daily_limit: 2,
                    penalty_per_strike: 1,
                },
                crate::state::ProviderTierConfig {
                    required_stake: 30,
                    daily_limit: 3,
                    penalty_per_strike: 1,
                },
            ],
            created_at: 1,
        }
    }

    fn envelope() -> AttestationV1 {
        AttestationV1 {
            kind: AttestationKind::StateAttestation,
            action: AttestationAction::SyncMirror,
            domain_hash: [3; 32],
            origin_network_hash: [4; 32],
            origin_registry: [5; 32],
            destination_network_hash: [2; 32],
            destination_registry: ID.to_bytes(),
            global_domain_epoch: 1,
            origin_sequence: 1,
            nonce: [6; 32],
            deadline: 100,
            payload_hash: [7; 32],
            evidence_hash: [8; 32],
        }
    }

    fn put_u16(data: &mut [u8], offset: usize, value: u16) {
        data[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn instruction(oracle: [u8; 20], message: &[u8], instruction_index: u8) -> Instruction {
        let message_offset = 12 + 20 + 64 + 1;
        let mut data = vec![0_u8; message_offset + message.len()];
        data[0] = 1;
        put_u16(&mut data, 1, 32);
        data[3] = instruction_index;
        put_u16(&mut data, 4, 12);
        data[6] = instruction_index;
        put_u16(&mut data, 7, message_offset as u16);
        put_u16(&mut data, 9, message.len() as u16);
        data[11] = instruction_index;
        data[12..32].copy_from_slice(&oracle);
        data[32..96].fill(7);
        data[96] = 1;
        data[message_offset..].copy_from_slice(message);
        Instruction {
            program_id: secp256k1_program::ID,
            accounts: vec![],
            data,
        }
    }

    fn program_instruction(message: &[u8], message_offset: usize) -> Instruction {
        let mut data = vec![0_u8; message_offset + message.len()];
        data[message_offset..].copy_from_slice(message);
        Instruction { program_id: ID, accounts: vec![], data }
    }

    #[test]
    fn accepts_one_local_secp256k1_signature_over_exact_envelope() {
        assert!(verify_secp256k1_instruction(
            &instruction([1; 20], &[2; 292], 4),
            4,
            &program_instruction(&[2; 292], 8),
            5,
            [1; 20],
            &[2; 292],
        )
        .is_ok());
    }

    #[test]
    fn rejects_signer_message_and_unbound_instruction_references() {
        let valid = instruction([1; 20], &[2; 292], 4);
        let current = program_instruction(&[2; 292], 8);
        assert!(verify_secp256k1_instruction(&valid, 4, &current, 5, [3; 20], &[2; 292]).is_err());
        assert!(verify_secp256k1_instruction(&valid, 4, &current, 5, [1; 20], &[3; 292]).is_err());

        let mut cross_instruction = valid;
        cross_instruction.data[11] = 6;
        assert!(
            verify_secp256k1_instruction(&cross_instruction, 4, &current, 5, [1; 20], &[2; 292]).is_err()
        );
    }

    #[test]
    fn accepts_message_reference_to_the_current_maivw_instruction() {
        let message = [2; 292];
        let mut secp = instruction([1; 20], &message, 4);
        secp.data.truncate(97);
        put_u16(&mut secp.data, 7, 8);
        secp.data[11] = 5;
        let current = program_instruction(&message, 8);
        assert!(verify_secp256k1_instruction(
            &secp, 4, &current, 5, [1; 20], &message,
        ).is_ok());

        let wrong_program = Instruction { program_id: Pubkey::new_unique(), ..current };
        assert!(verify_secp256k1_instruction(
            &secp, 4, &wrong_program, 5, [1; 20], &message,
        ).is_err());
    }

    #[test]
    fn validates_destination_deadline_and_nonce() {
        let registry = config();
        let valid = envelope();
        assert!(validate_envelope(&registry, &valid.encode().unwrap(), 100).is_ok());

        let mut wrong_destination = envelope();
        wrong_destination.destination_network_hash = [9; 32];
        assert!(validate_envelope(&registry, &wrong_destination.encode().unwrap(), 100).is_err());
        assert!(validate_envelope(&registry, &valid.encode().unwrap(), 101).is_err());

        let mut zero_nonce = envelope();
        zero_nonce.nonce = [0; 32];
        assert!(validate_envelope(&registry, &zero_nonce.encode().unwrap(), 100).is_err());
    }

    #[test]
    fn origin_claim_binds_origin_domain_payload_and_initial_version() {
        let registry = config();
        let mut claim = envelope();
        claim.kind = AttestationKind::OriginClaim;
        claim.action = AttestationAction::RegisterOrigin;
        claim.domain_hash = [3; 32];
        claim.origin_network_hash = registry.network_hash;
        claim.origin_registry = ID.to_bytes();
        claim.global_domain_epoch = 0;
        claim.origin_sequence = 0;
        claim.payload_hash = [7; 32];
        claim.evidence_hash = [8; 32];

        assert!(validate_origin_claim(&claim, &registry, [3; 32], [7; 32], [6; 32]).is_ok());
        assert!(validate_origin_claim(&claim, &registry, [4; 32], [7; 32], [6; 32]).is_err());
        assert!(validate_origin_claim(&claim, &registry, [3; 32], [9; 32], [6; 32]).is_err());
        assert!(validate_origin_claim(&claim, &registry, [3; 32], [7; 32], [9; 32]).is_err());

        claim.evidence_hash = [0; 32];
        assert!(validate_origin_claim(&claim, &registry, [3; 32], [7; 32], [6; 32]).is_err());
    }

    #[test]
    fn recovery_binds_local_origin_version_payload_nonce_and_evidence() {
        let registry = config();
        let mut recovery = envelope();
        recovery.kind = AttestationKind::StateAttestation;
        recovery.action = AttestationAction::RecoverOrigin;
        recovery.origin_network_hash = registry.network_hash;
        recovery.origin_registry = ID.to_bytes();
        recovery.global_domain_epoch = 7;
        recovery.origin_sequence = 11;

        assert!(validate_recovery(
            &recovery,
            &registry,
            [3; 32],
            7,
            11,
            [7; 32],
            [6; 32],
        )
        .is_ok());

        recovery.origin_sequence = 12;
        assert!(validate_recovery(
            &recovery,
            &registry,
            [3; 32],
            7,
            11,
            [7; 32],
            [6; 32],
        )
        .is_err());
        recovery.origin_sequence = 11;
        recovery.evidence_hash = [0; 32];
        assert!(validate_recovery(
            &recovery,
            &registry,
            [3; 32],
            7,
            11,
            [7; 32],
            [6; 32],
        )
        .is_err());
    }

    #[test]
    fn reclaim_claim_binds_local_origin_current_version_and_payload() {
        let registry = config();
        let mut reclaim = envelope();
        reclaim.kind = AttestationKind::OriginClaim;
        reclaim.action = AttestationAction::ReclaimOrigin;
        reclaim.origin_network_hash = registry.network_hash;
        reclaim.origin_registry = ID.to_bytes();
        reclaim.global_domain_epoch = 7;
        reclaim.origin_sequence = 11;

        assert!(validate_reclaim_claim(
            &reclaim,
            &registry,
            [3; 32],
            7,
            11,
            [7; 32],
            [6; 32],
        )
        .is_ok());
        reclaim.global_domain_epoch = 8;
        assert!(validate_reclaim_claim(
            &reclaim,
            &registry,
            [3; 32],
            7,
            11,
            [7; 32],
            [6; 32],
        )
        .is_err());
    }

    #[test]
    fn mirror_registration_binds_external_origin_payload_nonce_and_evidence() {
        let registry = config();
        let mut mirror = envelope();
        mirror.action = AttestationAction::RegisterMirror;

        assert!(validate_register_mirror(
            &mirror,
            &registry,
            [3; 32],
            [7; 32],
            [6; 32],
        )
        .is_ok());

        mirror.origin_network_hash = registry.network_hash;
        mirror.origin_registry = ID.to_bytes();
        assert!(validate_register_mirror(
            &mirror,
            &registry,
            [3; 32],
            [7; 32],
            [6; 32],
        )
        .is_err());

        mirror.origin_network_hash = [4; 32];
        mirror.origin_registry = [5; 32];
        mirror.evidence_hash = [0; 32];
        assert!(validate_register_mirror(
            &mirror,
            &registry,
            [3; 32],
            [7; 32],
            [6; 32],
        )
        .is_err());
    }

    #[test]
    fn mirror_sync_binds_the_immutable_origin_payload_nonce_and_evidence() {
        let mut sync = envelope();

        assert!(validate_sync_mirror(
            &sync,
            [3; 32],
            [4; 32],
            [5; 32],
            [7; 32],
            [6; 32],
        )
        .is_ok());

        sync.origin_registry = [9; 32];
        assert!(validate_sync_mirror(
            &sync,
            [3; 32],
            [4; 32],
            [5; 32],
            [7; 32],
            [6; 32],
        )
        .is_err());

        sync.origin_registry = [5; 32];
        sync.payload_hash = [9; 32];
        assert!(validate_sync_mirror(
            &sync,
            [3; 32],
            [4; 32],
            [5; 32],
            [7; 32],
            [6; 32],
        )
        .is_err());
    }

    #[test]
    fn mirror_revoke_requires_its_action_and_the_immutable_origin() {
        let mut revoke = envelope();
        revoke.action = AttestationAction::RevokeMirror;

        assert!(validate_revoke_mirror(
            &revoke,
            [3; 32],
            [4; 32],
            [5; 32],
            [7; 32],
            [6; 32],
        )
        .is_ok());

        revoke.action = AttestationAction::SyncMirror;
        assert!(validate_revoke_mirror(
            &revoke,
            [3; 32],
            [4; 32],
            [5; 32],
            [7; 32],
            [6; 32],
        )
        .is_err());

        revoke.action = AttestationAction::RevokeMirror;
        revoke.origin_network_hash = [9; 32];
        assert!(validate_revoke_mirror(
            &revoke,
            [3; 32],
            [4; 32],
            [5; 32],
            [7; 32],
            [6; 32],
        )
        .is_err());
    }
}
