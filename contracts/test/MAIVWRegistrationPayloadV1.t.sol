// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../src/libraries/MAIVWAttestationV1.sol";
import "../src/libraries/MAIVWRegistrationPayloadV1.sol";

contract MAIVWRegistrationPayloadV1Test is Test {
    function test_MatchesSharedOriginClaimVector() public pure {
        MAIVWRegistrationPayloadV1.Payload memory payload = _payload();
        bytes memory encoded = MAIVWRegistrationPayloadV1.encode(payload);
        bytes32 payloadHash = keccak256(encoded);

        assertEq(encoded.length, 245);
        assertEq(payloadHash, 0xacfbb9810205e87af11a74f2898f75ab2b55fbd988177094be0e62bc34203313);

        MAIVWAttestationV1.Attestation memory claim = MAIVWAttestationV1.Attestation({
            kind: 1,
            action: 1,
            domainHash: payload.domainHash,
            originNetworkHash: 0x39bdec9a23498f13474d87c0a6c712f950d1e6016f13bc2b073c57367e5af60c,
            originRegistry: 0x6666666666666666666666666666666666666666666666666666666666666666,
            destinationNetworkHash: 0x39bdec9a23498f13474d87c0a6c712f950d1e6016f13bc2b073c57367e5af60c,
            destinationRegistry: 0x6666666666666666666666666666666666666666666666666666666666666666,
            globalDomainEpoch: 0,
            originSequence: 0,
            nonce: 0x7777777777777777777777777777777777777777777777777777777777777777,
            deadline: 2_000_000_000,
            payloadHash: payloadHash,
            evidenceHash: 0x8888888888888888888888888888888888888888888888888888888888888888
        });
        assertEq(MAIVWAttestationV1.digest(claim), 0xdd448bd6eedf63202749b9e024f35493f2f8f15dcfdb20bef2d86a4efc630a9f);
    }

    function test_RejectsProviderWithoutTier() public {
        MAIVWRegistrationPayloadV1.Payload memory payload = _payload();
        payload.isProvider = true;
        vm.expectRevert(abi.encodeWithSelector(MAIVWRegistrationPayloadV1.InvalidProviderTier.selector, 0));
        this.encode(payload);
    }

    function encode(MAIVWRegistrationPayloadV1.Payload memory payload) external pure returns (bytes memory) {
        return MAIVWRegistrationPayloadV1.encode(payload);
    }

    function _payload() private pure returns (MAIVWRegistrationPayloadV1.Payload memory) {
        return MAIVWRegistrationPayloadV1.Payload({
            domainHash: 0x02438d3405cadd648e08dbff51bdbeb415913e642189100dc4a012064c870883,
            registrant: 0x1111111111111111111111111111111111111111111111111111111111111111,
            operationalKeyAlgorithm: 2,
            operationalKey: 0x2222222222222222222222222222222222222222222222222222222222222222,
            adminKeyAlgorithm: 2,
            adminKey: 0x3333333333333333333333333333333333333333333333333333333333333333,
            endpointHash: 0x4444444444444444444444444444444444444444444444444444444444444444,
            tlsFingerprint: bytes32(0),
            isProvider: false,
            providerTier: 0,
            payment: 5_000_000,
            mint: 0x5555555555555555555555555555555555555555555555555555555555555555
        });
    }
}
