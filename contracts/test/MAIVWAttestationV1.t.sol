// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "../src/libraries/MAIVWAttestationV1.sol";

contract MAIVWAttestationV1Test is Test {
    function test_MatchesNormativeTypeScriptVector() public pure {
        MAIVWAttestationV1.Attestation memory attestation = _fixture();
        bytes memory encoded = MAIVWAttestationV1.encode(attestation);

        assertEq(encoded.length, 292);
        assertEq(keccak256(encoded), 0x352787c5569ab7635ee3ecde594824fe3f0f9c1241bd6de7cc81e09b6f79400e);
        assertEq(MAIVWAttestationV1.digest(attestation), keccak256(encoded));
    }

    function test_RejectsInvalidKindActionPair() public {
        MAIVWAttestationV1.Attestation memory attestation = _fixture();
        attestation.kind = 1;

        vm.expectRevert(abi.encodeWithSelector(MAIVWAttestationV1.InvalidAttestationAction.selector, 1, 3));
        this.encode(attestation);
    }

    function test_AcceptsRecoveryStateAttestation() public pure {
        MAIVWAttestationV1.Attestation memory attestation = _fixture();
        attestation.action = 5;

        assertEq(MAIVWAttestationV1.encode(attestation).length, 292);
    }

    function test_AcceptsReclaimOriginClaim() public pure {
        MAIVWAttestationV1.Attestation memory attestation = _fixture();
        attestation.kind = 1;
        attestation.action = 6;

        assertEq(MAIVWAttestationV1.encode(attestation).length, 292);
    }

    function encode(MAIVWAttestationV1.Attestation memory attestation) external pure returns (bytes memory) {
        return MAIVWAttestationV1.encode(attestation);
    }

    function _fixture() private pure returns (MAIVWAttestationV1.Attestation memory) {
        return MAIVWAttestationV1.Attestation({
            kind: 2,
            action: 3,
            domainHash: 0x02438d3405cadd648e08dbff51bdbeb415913e642189100dc4a012064c870883,
            originNetworkHash: 0x644bb03931ef9418fcf4156df7d257895da4d0908881dbf1e68c4e6dfba94f68,
            originRegistry: 0x0000000000000000000000001111111111111111111111111111111111111111,
            destinationNetworkHash: 0x39bdec9a23498f13474d87c0a6c712f950d1e6016f13bc2b073c57367e5af60c,
            destinationRegistry: 0x2222222222222222222222222222222222222222222222222222222222222222,
            globalDomainEpoch: 7,
            originSequence: 19,
            nonce: 0x3333333333333333333333333333333333333333333333333333333333333333,
            deadline: 2_000_000_000,
            payloadHash: 0x4444444444444444444444444444444444444444444444444444444444444444,
            evidenceHash: 0x5555555555555555555555555555555555555555555555555555555555555555
        });
    }
}
