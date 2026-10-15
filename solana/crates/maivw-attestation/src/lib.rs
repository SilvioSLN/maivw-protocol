#![no_std]

//! Codec sem dependências de runtime para o envelope MAIVW Attestation V1.

use tiny_keccak::{Hasher, Keccak};

pub const MAGIC: [u8; 8] = *b"MAIVWATT";
pub const VERSION: u8 = 1;
pub const ENCODED_SIZE: usize = 292;
pub const REGISTRATION_MAGIC: [u8; 8] = *b"MAIVWREG";
pub const REGISTRATION_VERSION: u8 = 1;
pub const REGISTRATION_ENCODED_SIZE: usize = 245;

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttestationKind {
    OriginClaim = 1,
    StateAttestation = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttestationAction {
    RegisterOrigin = 1,
    RegisterMirror = 2,
    SyncMirror = 3,
    RevokeMirror = 4,
    RecoverOrigin = 5,
    ReclaimOrigin = 6,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KeyAlgorithm {
    Secp256k1 = 1,
    Ed25519 = 2,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistrationPayloadV1 {
    pub domain_hash: [u8; 32],
    pub registrant: [u8; 32],
    pub operational_key_algorithm: KeyAlgorithm,
    pub operational_key: [u8; 32],
    pub admin_key_algorithm: KeyAlgorithm,
    pub admin_key: [u8; 32],
    pub endpoint_hash: [u8; 32],
    pub tls_fingerprint: [u8; 32],
    pub is_provider: bool,
    pub provider_tier: u8,
    pub payment: u64,
    pub mint: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationV1 {
    pub kind: AttestationKind,
    pub action: AttestationAction,
    pub domain_hash: [u8; 32],
    pub origin_network_hash: [u8; 32],
    pub origin_registry: [u8; 32],
    pub destination_network_hash: [u8; 32],
    pub destination_registry: [u8; 32],
    pub global_domain_epoch: u64,
    pub origin_sequence: u64,
    pub nonce: [u8; 32],
    pub deadline: u64,
    pub payload_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AttestationError {
    InvalidLength {
        actual: usize,
    },
    InvalidMagic,
    UnsupportedVersion(u8),
    NonZeroReserved(u8),
    UnknownKind(u8),
    UnknownAction(u8),
    InvalidKindAction {
        kind: AttestationKind,
        action: AttestationAction,
    },
    ZeroRegistrationField(&'static str),
    InvalidProviderTier(u8),
    InconsistentProviderTier,
}

impl RegistrationPayloadV1 {
    pub fn encode(&self) -> Result<[u8; REGISTRATION_ENCODED_SIZE], AttestationError> {
        self.validate()?;
        let mut output = [0_u8; REGISTRATION_ENCODED_SIZE];
        let mut offset = 0;
        write_registration(&mut output, &mut offset, &REGISTRATION_MAGIC);
        write_registration(&mut output, &mut offset, &[REGISTRATION_VERSION]);
        write_registration(&mut output, &mut offset, &self.domain_hash);
        write_registration(&mut output, &mut offset, &self.registrant);
        write_registration(
            &mut output,
            &mut offset,
            &[self.operational_key_algorithm as u8],
        );
        write_registration(&mut output, &mut offset, &self.operational_key);
        write_registration(
            &mut output,
            &mut offset,
            &[self.admin_key_algorithm as u8],
        );
        write_registration(&mut output, &mut offset, &self.admin_key);
        write_registration(&mut output, &mut offset, &self.endpoint_hash);
        write_registration(&mut output, &mut offset, &self.tls_fingerprint);
        write_registration(&mut output, &mut offset, &[u8::from(self.is_provider)]);
        write_registration(&mut output, &mut offset, &[self.provider_tier]);
        write_registration(&mut output, &mut offset, &self.payment.to_be_bytes());
        write_registration(&mut output, &mut offset, &self.mint);
        debug_assert_eq!(offset, REGISTRATION_ENCODED_SIZE);
        Ok(output)
    }

    pub fn digest(&self) -> Result<[u8; 32], AttestationError> {
        Ok(keccak256(&self.encode()?))
    }

    pub fn validate(&self) -> Result<(), AttestationError> {
        for (name, value) in [
            ("domain_hash", self.domain_hash),
            ("registrant", self.registrant),
            ("operational_key", self.operational_key),
            ("admin_key", self.admin_key),
            ("endpoint_hash", self.endpoint_hash),
            ("mint", self.mint),
        ] {
            if value == [0; 32] {
                return Err(AttestationError::ZeroRegistrationField(name));
            }
        }
        if self.provider_tier > 3 {
            return Err(AttestationError::InvalidProviderTier(self.provider_tier));
        }
        if self.is_provider == (self.provider_tier == 0) {
            return Err(AttestationError::InconsistentProviderTier);
        }
        Ok(())
    }
}

impl AttestationV1 {
    pub fn decode(input: &[u8]) -> Result<Self, AttestationError> {
        if input.len() != ENCODED_SIZE {
            return Err(AttestationError::InvalidLength {
                actual: input.len(),
            });
        }
        if input[..MAGIC.len()] != MAGIC {
            return Err(AttestationError::InvalidMagic);
        }

        let mut offset = MAGIC.len();
        let version = read_u8(input, &mut offset);
        if version != VERSION {
            return Err(AttestationError::UnsupportedVersion(version));
        }
        let kind = match read_u8(input, &mut offset) {
            1 => AttestationKind::OriginClaim,
            2 => AttestationKind::StateAttestation,
            value => return Err(AttestationError::UnknownKind(value)),
        };
        let action = match read_u8(input, &mut offset) {
            1 => AttestationAction::RegisterOrigin,
            2 => AttestationAction::RegisterMirror,
            3 => AttestationAction::SyncMirror,
            4 => AttestationAction::RevokeMirror,
            5 => AttestationAction::RecoverOrigin,
            6 => AttestationAction::ReclaimOrigin,
            value => return Err(AttestationError::UnknownAction(value)),
        };
        let reserved = read_u8(input, &mut offset);
        if reserved != 0 {
            return Err(AttestationError::NonZeroReserved(reserved));
        }

        let attestation = Self {
            kind,
            action,
            domain_hash: read_bytes32(input, &mut offset),
            origin_network_hash: read_bytes32(input, &mut offset),
            origin_registry: read_bytes32(input, &mut offset),
            destination_network_hash: read_bytes32(input, &mut offset),
            destination_registry: read_bytes32(input, &mut offset),
            global_domain_epoch: read_u64(input, &mut offset),
            origin_sequence: read_u64(input, &mut offset),
            nonce: read_bytes32(input, &mut offset),
            deadline: read_u64(input, &mut offset),
            payload_hash: read_bytes32(input, &mut offset),
            evidence_hash: read_bytes32(input, &mut offset),
        };
        debug_assert_eq!(offset, ENCODED_SIZE);
        attestation.validate()?;
        Ok(attestation)
    }

    pub fn encode(&self) -> Result<[u8; ENCODED_SIZE], AttestationError> {
        self.validate()?;

        let mut output = [0_u8; ENCODED_SIZE];
        let mut offset = 0;

        write(&mut output, &mut offset, &MAGIC);
        write(&mut output, &mut offset, &[VERSION]);
        write(&mut output, &mut offset, &[self.kind as u8]);
        write(&mut output, &mut offset, &[self.action as u8]);
        write(&mut output, &mut offset, &[0]);
        write(&mut output, &mut offset, &self.domain_hash);
        write(&mut output, &mut offset, &self.origin_network_hash);
        write(&mut output, &mut offset, &self.origin_registry);
        write(&mut output, &mut offset, &self.destination_network_hash);
        write(&mut output, &mut offset, &self.destination_registry);
        write(
            &mut output,
            &mut offset,
            &self.global_domain_epoch.to_be_bytes(),
        );
        write(
            &mut output,
            &mut offset,
            &self.origin_sequence.to_be_bytes(),
        );
        write(&mut output, &mut offset, &self.nonce);
        write(&mut output, &mut offset, &self.deadline.to_be_bytes());
        write(&mut output, &mut offset, &self.payload_hash);
        write(&mut output, &mut offset, &self.evidence_hash);

        debug_assert_eq!(offset, ENCODED_SIZE);
        Ok(output)
    }

    pub fn digest(&self) -> Result<[u8; 32], AttestationError> {
        let encoded = self.encode()?;
        Ok(keccak256(&encoded))
    }

    pub fn validate(&self) -> Result<(), AttestationError> {
        let valid = matches!(
            (self.kind, self.action),
            (
                AttestationKind::OriginClaim,
                AttestationAction::RegisterOrigin | AttestationAction::ReclaimOrigin
            ) | (
                AttestationKind::StateAttestation,
                AttestationAction::RegisterMirror
                    | AttestationAction::SyncMirror
                    | AttestationAction::RevokeMirror
                    | AttestationAction::RecoverOrigin
            )
        );
        if valid {
            Ok(())
        } else {
            Err(AttestationError::InvalidKindAction {
                kind: self.kind,
                action: self.action,
            })
        }
    }
}

pub fn keccak256(input: &[u8]) -> [u8; 32] {
    let mut digest = [0_u8; 32];
    let mut hasher = Keccak::v256();
    hasher.update(input);
    hasher.finalize(&mut digest);
    digest
}

fn write(output: &mut [u8; ENCODED_SIZE], offset: &mut usize, value: &[u8]) {
    let end = *offset + value.len();
    output[*offset..end].copy_from_slice(value);
    *offset = end;
}

fn write_registration(
    output: &mut [u8; REGISTRATION_ENCODED_SIZE],
    offset: &mut usize,
    value: &[u8],
) {
    let end = *offset + value.len();
    output[*offset..end].copy_from_slice(value);
    *offset = end;
}

fn read_u8(input: &[u8], offset: &mut usize) -> u8 {
    let value = input[*offset];
    *offset += 1;
    value
}

fn read_u64(input: &[u8], offset: &mut usize) -> u64 {
    let end = *offset + 8;
    let value = u64::from_be_bytes(input[*offset..end].try_into().expect("fixed-size slice"));
    *offset = end;
    value
}

fn read_bytes32(input: &[u8], offset: &mut usize) -> [u8; 32] {
    let end = *offset + 32;
    let value = input[*offset..end].try_into().expect("fixed-size slice");
    *offset = end;
    value
}
