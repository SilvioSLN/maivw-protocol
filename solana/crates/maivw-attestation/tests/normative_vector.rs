use maivw_attestation::{
    AttestationAction, AttestationKind, AttestationV1, KeyAlgorithm, RegistrationPayloadV1,
    ENCODED_SIZE, REGISTRATION_ENCODED_SIZE,
};

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

#[test]
fn accepts_reclaim_as_an_origin_claim() {
    let mut reclaim = fixture();
    reclaim.kind = AttestationKind::OriginClaim;
    reclaim.action = AttestationAction::ReclaimOrigin;
    let encoded = reclaim.encode().expect("valid reclaim claim");
    assert_eq!(AttestationV1::decode(&encoded), Ok(reclaim));
}

#[test]
fn registration_payload_matches_shared_origin_claim_vector() {
    let payload = RegistrationPayloadV1 {
        domain_hash: bytes32("02438d3405cadd648e08dbff51bdbeb415913e642189100dc4a012064c870883"),
        registrant: [0x11; 32],
        operational_key_algorithm: KeyAlgorithm::Ed25519,
        operational_key: [0x22; 32],
        admin_key_algorithm: KeyAlgorithm::Ed25519,
        admin_key: [0x33; 32],
        endpoint_hash: [0x44; 32],
        tls_fingerprint: [0; 32],
        is_provider: false,
        provider_tier: 0,
        payment: 5_000_000,
        mint: [0x55; 32],
    };
    let encoded = payload.encode().expect("valid registration payload");
    assert_eq!(encoded.len(), REGISTRATION_ENCODED_SIZE);
    assert_eq!(
        hex::encode(payload.digest().expect("valid registration payload")),
        "acfbb9810205e87af11a74f2898f75ab2b55fbd988177094be0e62bc34203313"
    );

    let claim = AttestationV1 {
        kind: AttestationKind::OriginClaim,
        action: AttestationAction::RegisterOrigin,
        domain_hash: payload.domain_hash,
        origin_network_hash: bytes32(
            "39bdec9a23498f13474d87c0a6c712f950d1e6016f13bc2b073c57367e5af60c",
        ),
        origin_registry: [0x66; 32],
        destination_network_hash: bytes32(
            "39bdec9a23498f13474d87c0a6c712f950d1e6016f13bc2b073c57367e5af60c",
        ),
        destination_registry: [0x66; 32],
        global_domain_epoch: 0,
        origin_sequence: 0,
        nonce: [0x77; 32],
        deadline: 2_000_000_000,
        payload_hash: payload.digest().expect("valid registration payload"),
        evidence_hash: [0x88; 32],
    };
    assert_eq!(
        hex::encode(claim.digest().expect("valid origin claim")),
        "dd448bd6eedf63202749b9e024f35493f2f8f15dcfdb20bef2d86a4efc630a9f"
    );
}
