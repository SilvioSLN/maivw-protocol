//! Codificador sem dependências de runtime para o envelope MAIVW Attestation V1.

use tiny_keccak::{Hasher, Keccak};

pub const MAGIC: [u8; 8] = *b"MAIVWATT";
pub const VERSION: u8 = 1;
pub const ENCODED_SIZE: usize = 292;

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
    InvalidKindAction {
        kind: AttestationKind,
        action: AttestationAction,
    },
}

impl AttestationV1 {
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
        write(&mut output, &mut offset, &self.global_domain_epoch.to_be_bytes());
        write(&mut output, &mut offset, &self.origin_sequence.to_be_bytes());
        write(&mut output, &mut offset, &self.nonce);
        write(&mut output, &mut offset, &self.deadline.to_be_bytes());
        write(&mut output, &mut offset, &self.payload_hash);
        write(&mut output, &mut offset, &self.evidence_hash);

        debug_assert_eq!(offset, ENCODED_SIZE);
        Ok(output)
    }

    pub fn digest(&self) -> Result<[u8; 32], AttestationError> {
        let encoded = self.encode()?;
        let mut digest = [0_u8; 32];
        let mut hasher = Keccak::v256();
        hasher.update(&encoded);
        hasher.finalize(&mut digest);
        Ok(digest)
    }

    fn validate(&self) -> Result<(), AttestationError> {
        let valid = matches!(
            (self.kind, self.action),
            (AttestationKind::OriginClaim, AttestationAction::RegisterOrigin)
                | (
                    AttestationKind::StateAttestation,
                    AttestationAction::RegisterMirror
                        | AttestationAction::SyncMirror
                        | AttestationAction::RevokeMirror
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

fn write(output: &mut [u8; ENCODED_SIZE], offset: &mut usize, value: &[u8]) {
    let end = *offset + value.len();
    output[*offset..end].copy_from_slice(value);
    *offset = end;
}
