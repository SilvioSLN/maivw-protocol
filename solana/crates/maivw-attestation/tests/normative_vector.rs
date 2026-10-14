use maivw_attestation::{AttestationAction, AttestationKind, AttestationV1, ENCODED_SIZE};

fn bytes32(value: &str) -> [u8; 32] {
    hex::decode(value.strip_prefix("0x").unwrap_or(value))
        .expect("hex fixture")
        .try_into()
        .expect("32-byte fixture")
}

fn fixture() -> AttestationV1 {
    AttestationV1 {
        kind: AttestationKind::StateAttestation,
        action: AttestationAction::SyncMirror,
        domain_hash: bytes32("02438d3405cadd648e08dbff51bdbeb415913e642189100dc4a012064c870883"),
        origin_network_hash: bytes32(
            "644bb03931ef9418fcf4156df7d257895da4d0908881dbf1e68c4e6dfba94f68",
        ),
        origin_registry: bytes32(
            "0000000000000000000000001111111111111111111111111111111111111111",
        ),
        destination_network_hash: bytes32(
            "39bdec9a23498f13474d87c0a6c712f950d1e6016f13bc2b073c57367e5af60c",
        ),
        destination_registry: [0x22; 32],
        global_domain_epoch: 7,
        origin_sequence: 19,
        nonce: [0x33; 32],
        deadline: 2_000_000_000,
        payload_hash: [0x44; 32],
        evidence_hash: [0x55; 32],
    }
}

#[test]
fn matches_normative_typescript_vector() {
    let attestation = fixture();
    let encoded = attestation.encode().expect("valid fixture");

    assert_eq!(encoded.len(), ENCODED_SIZE);
    assert_eq!(
        hex::encode(attestation.digest().expect("valid fixture")),
        "352787c5569ab7635ee3ecde594824fe3f0f9c1241bd6de7cc81e09b6f79400e"
    );
}

#[test]
fn rejects_invalid_kind_action_pair() {
    let mut attestation = fixture();
    attestation.kind = AttestationKind::OriginClaim;
    assert!(attestation.encode().is_err());
}

#[test]
fn decodes_the_canonical_envelope() {
    let expected = fixture();
    let encoded = expected.encode().expect("valid fixture");
    assert_eq!(AttestationV1::decode(&encoded), Ok(expected));
}

#[test]
fn rejects_non_canonical_wire_values() {
    let encoded = fixture().encode().expect("valid fixture");

    let mut bad_magic = encoded;
    bad_magic[0] ^= 1;
    assert!(AttestationV1::decode(&bad_magic).is_err());

    let mut bad_reserved = encoded;
    bad_reserved[11] = 1;
    assert!(AttestationV1::decode(&bad_reserved).is_err());

    assert!(AttestationV1::decode(&encoded[..encoded.len() - 1]).is_err());
}

#[test]
fn accepts_recovery_as_a_state_attestation() {
    let mut recovery = fixture();
    recovery.action = AttestationAction::RecoverOrigin;
    let encoded = recovery.encode().expect("valid recovery authorization");
    assert_eq!(AttestationV1::decode(&encoded), Ok(recovery));
}
