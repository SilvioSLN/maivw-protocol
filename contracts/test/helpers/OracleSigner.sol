// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MAIVWRegistry, ProviderTier} from "../../src/MAIVWRegistry.sol";

/// @title OracleSigner
/// @notice Helper para geração determinística de assinaturas EIP-712 em testes
abstract contract OracleSigner is Test {
    uint256 internal constant ORACLE_PK = 0xA11CE;
    address internal oracle = vm.addr(ORACLE_PK);

    function _signRegister(
        MAIVWRegistry r,
        string memory domain,
        address pubKey,
        address adminKey,
        address registrant,
        bool isProvider,
        uint8 tier,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 h = keccak256(bytes(domain));
        bytes32 structHash = keccak256(
            abi.encode(
                r.REGISTER_TYPEHASH(),
                h,
                pubKey,
                adminKey,
                registrant,
                isProvider,
                tier,
                r.domainNonces(h),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", r.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(ORACLE_PK, digest);
        return abi.encodePacked(rr, s, v);
    }

    function _signReclaim(
        MAIVWRegistry r,
        string memory domain,
        address pubKey,
        address adminKey,
        address registrant,
        bool isProvider,
        uint8 tier,
        uint32 epoch,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 h = keccak256(bytes(domain));
        bytes32 structHash = keccak256(
            abi.encode(
                r.RECLAIM_TYPEHASH(),
                h,
                pubKey,
                adminKey,
                registrant,
                isProvider,
                tier,
                epoch,
                r.domainNonces(h),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", r.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(ORACLE_PK, digest);
        return abi.encodePacked(rr, s, v);
    }

    function _signMirror(
        MAIVWRegistry r,
        string memory domain,
        address pubKey,
        address adminKey,
        address registrant,
        uint256 originChainId,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 h = keccak256(bytes(domain));
        bytes32 structHash = keccak256(
            abi.encode(
                r.MIRROR_TYPEHASH(),
                h,
                pubKey,
                adminKey,
                registrant,
                originChainId,
                r.domainNonces(h),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", r.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(ORACLE_PK, digest);
        return abi.encodePacked(rr, s, v);
    }

    function _signRecovery(
        MAIVWRegistry r,
        string memory domain,
        address newAdminKey,
        address newPublicKey,
        uint32 epoch,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 h = keccak256(bytes(domain));
        bytes32 structHash = keccak256(
            abi.encode(
                r.RECOVERY_TYPEHASH(),
                h,
                newAdminKey,
                newPublicKey,
                epoch,
                r.domainNonces(h),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", r.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(ORACLE_PK, digest);
        return abi.encodePacked(rr, s, v);
    }
}
