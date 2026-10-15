// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MAIVWRegistrationPayloadV1
/// @notice Codec fixo do payload comprometido por OriginClaimV1.payloadHash.
library MAIVWRegistrationPayloadV1 {
    bytes8 internal constant MAGIC = 0x4d41495657524547; // MAIVWREG
    uint8 internal constant VERSION = 1;
    uint256 internal constant ENCODED_SIZE = 245;

    uint8 internal constant KEY_SECP256K1 = 1;
    uint8 internal constant KEY_ED25519 = 2;

    error InvalidRegistrationField();
    error InvalidKeyAlgorithm(uint8 algorithm);
    error InvalidProviderTier(uint8 tier);

    struct Payload {
        bytes32 domainHash;
        bytes32 registrant;
        uint8 operationalKeyAlgorithm;
        bytes32 operationalKey;
        uint8 adminKeyAlgorithm;
        bytes32 adminKey;
        bytes32 endpointHash;
        bytes32 tlsFingerprint;
        bool isProvider;
        uint8 providerTier;
        uint64 payment;
        bytes32 mint;
    }

    function encode(Payload memory payload) internal pure returns (bytes memory encoded) {
        _validate(payload);
        encoded = abi.encodePacked(
            MAGIC,
            VERSION,
            payload.domainHash,
            payload.registrant,
            payload.operationalKeyAlgorithm,
            payload.operationalKey,
            payload.adminKeyAlgorithm,
            payload.adminKey,
            payload.endpointHash,
            payload.tlsFingerprint,
            uint8(payload.isProvider ? 1 : 0),
            payload.providerTier,
            payload.payment,
            payload.mint
        );
        assert(encoded.length == ENCODED_SIZE);
    }

    function digest(Payload memory payload) internal pure returns (bytes32) {
        return keccak256(encode(payload));
    }

    function _validate(Payload memory payload) private pure {
        if (
            payload.domainHash == bytes32(0) || payload.registrant == bytes32(0) || payload.operationalKey == bytes32(0)
                || payload.adminKey == bytes32(0) || payload.endpointHash == bytes32(0) || payload.mint == bytes32(0)
        ) revert InvalidRegistrationField();
        if (payload.operationalKeyAlgorithm < KEY_SECP256K1 || payload.operationalKeyAlgorithm > KEY_ED25519) {
            revert InvalidKeyAlgorithm(payload.operationalKeyAlgorithm);
        }
        if (payload.adminKeyAlgorithm < KEY_SECP256K1 || payload.adminKeyAlgorithm > KEY_ED25519) {
            revert InvalidKeyAlgorithm(payload.adminKeyAlgorithm);
        }
        if (payload.providerTier > 3 || payload.isProvider == (payload.providerTier == 0)) {
            revert InvalidProviderTier(payload.providerTier);
        }
    }
}
