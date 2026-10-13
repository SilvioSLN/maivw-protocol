// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {BaseTest} from "./helpers/BaseTest.sol";
import {
    MAIVWMirrorRegistryV2,
    MirrorStateV2,
    MirrorProfileV2,
    MirrorVersionV2,
    KeyDescriptor,
    KeyAlgorithm
} from "../src/MAIVWMirrorRegistryV2.sol";
import {MAIVWAttestationV1} from "../src/libraries/MAIVWAttestationV1.sol";
import {DomainStatus, ProviderTier} from "../src/MAIVWRegistry.sol";
import {MAIVWRegistryLens} from "../src/MAIVWRegistryLens.sol";

contract MAIVWMirrorRegistryV2UpgradeMock is MAIVWMirrorRegistryV2 {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract MAIVWMirrorRegistryV2Test is BaseTest {
    MAIVWMirrorRegistryV2 internal mirrors;

    bytes32 internal constant SOLANA_NETWORK = keccak256("solana:devnet-genesis");
    bytes32 internal constant SOLANA_REGISTRY = bytes32(uint256(0x5151));

    function setUp() public {
        setUpRegistry();
        MAIVWMirrorRegistryV2 implementation = new MAIVWMirrorRegistryV2();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(
                MAIVWMirrorRegistryV2.initialize,
                (owner, guardian, oracle, address(registry))
            )
        );
        mirrors = MAIVWMirrorRegistryV2(address(proxy));
    }

    function test_registerSyncRevokeSolanaMirrorPreservesTypedKeysAndTombstone() public {
        string memory domain = "solana-origin.maivw.com";
        MirrorStateV2 memory state = _state(DomainStatus.ACTIVE, bytes32(uint256(0x1111)));
        MAIVWAttestationV1.Attestation memory registerAttestation = _attestation(domain, state, 2, 7, 1);

        assertTrue(mirrors.registerMirrorV2(domain, state, registerAttestation, _sign(registerAttestation)));
        assertFalse(mirrors.registerMirrorV2(domain, state, registerAttestation, _sign(registerAttestation)));
        vm.warp(registerAttestation.deadline + 1);
        assertFalse(mirrors.registerMirrorV2(domain, state, registerAttestation, _sign(registerAttestation)));
        vm.warp(registerAttestation.deadline - 1 hours);

        (KeyDescriptor memory publicKey, KeyDescriptor memory adminKey) = mirrors.getTypedKeys(domain);
        assertEq(uint8(publicKey.algorithm), uint8(KeyAlgorithm.ED25519_SOLANA_PUBKEY));
        assertEq(publicKey.keyData, bytes32(uint256(0x1111)));
        assertEq(uint8(adminKey.algorithm), uint8(KeyAlgorithm.ED25519_SOLANA_PUBKEY));
        assertTrue(mirrors.isMirrorActive(domain));

        string[] memory domains = new string[](1);
        domains[0] = domain;
        MAIVWRegistryLens.EnrichedMirrorV2[] memory enriched = lens.getEnrichedMirrorsV2(
            address(mirrors),
            domains
        );
        assertEq(enriched[0].profile.publicKey.keyData, bytes32(uint256(0x1111)));
        assertEq(enriched[0].version.originNetworkHash, SOLANA_NETWORK);

        state.endpointUrl = "https://v2.solana-origin.maivw.com/inbox";
        MAIVWAttestationV1.Attestation memory syncAttestation = _attestation(domain, state, 3, 7, 2);
        assertTrue(mirrors.syncMirrorV2(domain, state, syncAttestation, _sign(syncAttestation)));
        assertFalse(mirrors.syncMirrorV2(domain, state, syncAttestation, _sign(syncAttestation)));

        state.status = DomainStatus.REVOKED;
        MAIVWAttestationV1.Attestation memory revokeAttestation = _attestation(domain, state, 4, 7, 3);
        assertTrue(mirrors.revokeMirrorV2(domain, state, revokeAttestation, _sign(revokeAttestation)));
        assertFalse(mirrors.revokeMirrorV2(domain, state, revokeAttestation, _sign(revokeAttestation)));

        MirrorVersionV2 memory version = mirrors.getMirrorVersion(domain);
        assertTrue(version.exists);
        assertTrue(version.revoked);
        assertEq(version.globalDomainEpoch, 7);
        assertEq(version.originSequence, 3);
        assertFalse(mirrors.isMirrorActive(domain));
    }

    function test_rejectsRegressionConflictingReplayAndDivergentOrigin() public {
        string memory domain = "ordered.maivw.com";
        MirrorStateV2 memory state = _state(DomainStatus.ACTIVE, bytes32(uint256(0x2222)));
        MAIVWAttestationV1.Attestation memory first = _attestation(domain, state, 2, 3, 8);
        mirrors.registerMirrorV2(domain, state, first, _sign(first));

        MAIVWAttestationV1.Attestation memory regression = _attestation(domain, state, 3, 3, 7);
        vm.expectRevert(MAIVWMirrorRegistryV2.MirrorVersionRegression.selector);
        mirrors.syncMirrorV2(domain, state, regression, _sign(regression));

        state.endpointUrl = "https://conflict.maivw.com/inbox";
        MAIVWAttestationV1.Attestation memory conflict = _attestation(domain, state, 3, 3, 8);
        vm.expectRevert(MAIVWMirrorRegistryV2.MirrorVersionConflict.selector);
        mirrors.syncMirrorV2(domain, state, conflict, _sign(conflict));

        state.endpointUrl = "https://ordered.maivw.com/inbox";
        MAIVWAttestationV1.Attestation memory divergent = _attestation(domain, state, 3, 3, 9);
        divergent.originRegistry = bytes32(uint256(0x9999));
        vm.expectRevert(MAIVWMirrorRegistryV2.MirrorOriginMismatch.selector);
        mirrors.syncMirrorV2(domain, state, divergent, _sign(divergent));
    }

    function test_migratesLegacyMirrorWithSecp256k1Descriptors() public {
        string memory domain = "legacy-mirror.maivw.com";
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signMirror(registry, domain, companyA, companyB, companyA, 8453, deadline);
        vm.prank(companyA);
        registry.registerMirror{value: 0.003 ether}(
            domain,
            "https://legacy-mirror.maivw.com/inbox",
            companyA,
            companyB,
            8453,
            deadline,
            proof
        );

        vm.prank(owner);
        mirrors.migrateLegacyMirrorV2(domain, bytes32(uint256(0x8453)), 11, bytes32(uint256(0xabc)));
        (KeyDescriptor memory publicKey, KeyDescriptor memory adminKey) = mirrors.getTypedKeys(domain);
        assertEq(uint8(publicKey.algorithm), uint8(KeyAlgorithm.SECP256K1_EVM_ADDRESS));
        assertEq(publicKey.keyData, bytes32(uint256(uint160(companyA))));
        assertEq(adminKey.keyData, bytes32(uint256(uint160(companyB))));
    }

    function test_upgradeAndOperationalRollbackPreserveMirrorStorage() public {
        string memory domain = "upgrade.maivw.com";
        MirrorStateV2 memory state = _state(DomainStatus.ACTIVE, bytes32(uint256(0x3333)));
        MAIVWAttestationV1.Attestation memory attestation = _attestation(domain, state, 2, 1, 1);
        mirrors.registerMirrorV2(domain, state, attestation, _sign(attestation));

        MAIVWMirrorRegistryV2UpgradeMock upgradedImplementation = new MAIVWMirrorRegistryV2UpgradeMock();
        vm.prank(owner);
        mirrors.upgradeToAndCall(address(upgradedImplementation), "");
        assertEq(MAIVWMirrorRegistryV2UpgradeMock(address(mirrors)).version(), 2);
        assertTrue(mirrors.getMirrorVersion(domain).exists);

        MAIVWMirrorRegistryV2 rollbackImplementation = new MAIVWMirrorRegistryV2();
        vm.prank(owner);
        mirrors.upgradeToAndCall(address(rollbackImplementation), "");
        MirrorProfileV2 memory profile = mirrors.getMirrorProfile(domain);
        assertEq(profile.publicKey.keyData, bytes32(uint256(0x3333)));
        assertTrue(mirrors.isMirrorActive(domain));
    }

    function _state(
        DomainStatus status,
        bytes32 publicKeyData
    ) private view returns (MirrorStateV2 memory) {
        return MirrorStateV2({
            publicKey: KeyDescriptor(KeyAlgorithm.ED25519_SOLANA_PUBKEY, publicKeyData),
            adminKey: KeyDescriptor(KeyAlgorithm.ED25519_SOLANA_PUBKEY, bytes32(uint256(0xaaaa))),
            endpointUrl: "https://ordered.maivw.com/inbox",
            tlsFingerprint: keccak256("tls"),
            status: status,
            isProvider: false,
            tier: ProviderTier.NONE,
            strikeCount: 0,
            registrationTime: uint64(block.timestamp),
            attestedStake: 65_000_000,
            dailyLimit: 10_000
        });
    }

    function _attestation(
        string memory domain,
        MirrorStateV2 memory state,
        uint8 action,
        uint64 epoch,
        uint64 sequence
    ) private view returns (MAIVWAttestationV1.Attestation memory) {
        return MAIVWAttestationV1.Attestation({
            kind: 2,
            action: action,
            domainHash: keccak256(bytes(domain)),
            originNetworkHash: SOLANA_NETWORK,
            originRegistry: SOLANA_REGISTRY,
            destinationNetworkHash: keccak256(bytes(string.concat("evm:", vm.toString(block.chainid)))),
            destinationRegistry: bytes32(uint256(uint160(address(mirrors)))),
            globalDomainEpoch: epoch,
            originSequence: sequence,
            nonce: keccak256(abi.encode(domain, epoch, sequence, action)),
            deadline: uint64(block.timestamp + 1 hours),
            payloadHash: mirrors.hashMirrorStateV2(state),
            evidenceHash: keccak256(abi.encode("origin-tx", epoch, sequence))
        });
    }

    function _sign(
        MAIVWAttestationV1.Attestation memory attestation
    ) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PK, MAIVWAttestationV1.digest(attestation));
        return abi.encodePacked(r, s, v);
    }
}
