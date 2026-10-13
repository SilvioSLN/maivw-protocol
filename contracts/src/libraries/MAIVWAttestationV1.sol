// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MAIVWAttestationV1
/// @notice Codifica o envelope binário assinado pelo oráculo MAIVW.
/// @dev O layout deve permanecer idêntico às implementações TypeScript e Rust.
library MAIVWAttestationV1 {
    bytes8 internal constant MAGIC = 0x4d41495657415454; // "MAIVWATT"
    uint8 internal constant VERSION = 1;
    uint256 internal constant ENCODED_SIZE = 292;

    uint8 internal constant KIND_ORIGIN_CLAIM = 1;
    uint8 internal constant KIND_STATE_ATTESTATION = 2;

    uint8 internal constant ACTION_REGISTER_ORIGIN = 1;
    uint8 internal constant ACTION_REGISTER_MIRROR = 2;
    uint8 internal constant ACTION_SYNC_MIRROR = 3;
    uint8 internal constant ACTION_REVOKE_MIRROR = 4;

    error InvalidAttestationKind(uint8 kind);
    error InvalidAttestationAction(uint8 kind, uint8 action);

    struct Attestation {
        uint8 kind;
        uint8 action;
        bytes32 domainHash;
        bytes32 originNetworkHash;
        bytes32 originRegistry;
        bytes32 destinationNetworkHash;
        bytes32 destinationRegistry;
        uint64 globalDomainEpoch;
        uint64 originSequence;
        bytes32 nonce;
        uint64 deadline;
        bytes32 payloadHash;
        bytes32 evidenceHash;
    }

    function encode(Attestation memory attestation) internal pure returns (bytes memory encoded) {
        _validate(attestation.kind, attestation.action);

        encoded = abi.encodePacked(
            MAGIC,
            VERSION,
            attestation.kind,
            attestation.action,
            uint8(0),
            attestation.domainHash,
            attestation.originNetworkHash,
            attestation.originRegistry,
            attestation.destinationNetworkHash,
            attestation.destinationRegistry,
            attestation.globalDomainEpoch,
            attestation.originSequence,
            attestation.nonce,
            attestation.deadline,
            attestation.payloadHash,
            attestation.evidenceHash
        );

        assert(encoded.length == ENCODED_SIZE);
    }

    function digest(Attestation memory attestation) internal pure returns (bytes32) {
        return keccak256(encode(attestation));
    }

    function _validate(uint8 kind, uint8 action) private pure {
        if (kind == KIND_ORIGIN_CLAIM) {
            if (action != ACTION_REGISTER_ORIGIN) revert InvalidAttestationAction(kind, action);
            return;
        }
        if (kind == KIND_STATE_ATTESTATION) {
            if (action < ACTION_REGISTER_MIRROR || action > ACTION_REVOKE_MIRROR) {
                revert InvalidAttestationAction(kind, action);
            }
            return;
        }
        revert InvalidAttestationKind(kind);
    }
}
