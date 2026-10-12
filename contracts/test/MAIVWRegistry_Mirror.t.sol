// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./helpers/BaseTest.sol";

/// @title MAIVWRegistry_MirrorTest (v2)
contract MAIVWRegistry_MirrorTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    // ============================================
    //  Multi-Chain Mirroring (v2 com EIP-712 e Pull)
    // ============================================

    function test_RegisterMirror_Success() public {
        uint256 fee = registry.mirrorFee();
        assertEq(fee, 0.003 ether);

        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signMirror(
            registry,
            "saas-empresa.com",
            companyA,
            companyA,
            companyA,
            84532, // Origem: Base Sepolia
            deadline
        );

        vm.prank(companyA);
        registry.registerMirror{value: fee}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyA,
            companyA,
            84532,
            deadline,
            sig
        );

        assertTrue(registry.isDomainActive("saas-empresa.com"));
        assertEq(registry.getPublicKey("saas-empresa.com"), companyA);
        assertEq(registry.getEndpointUrl("saas-empresa.com"), "https://p2p.saas-empresa.com/inbox");

        (bool isMirror, uint256 originChain, uint256 mirroredAt) = registry.getMirrorInfo("saas-empresa.com");
        assertTrue(isMirror);
        assertEq(originChain, 84532);
        assertGt(mirroredAt, 0);

        // M-07: Taxa retida como crédito pull para o oráculo
        assertEq(registry.pendingWithdrawals(oracle), fee);

        vm.prank(oracle);
        registry.withdrawPending();
        assertEq(oracle.balance, fee);
    }

    function test_RegisterMirror_RevertInsufficientFee() public {
        uint256 fee = registry.mirrorFee();
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signMirror(
            registry,
            "saas-empresa.com",
            companyA,
            companyA,
            companyA,
            84532,
            deadline
        );

        vm.prank(companyA);
        vm.expectRevert(
            abi.encodeWithSelector(
                MAIVWRegistry.IncorrectFee.selector,
                fee,
                fee - 1
            )
        );
        registry.registerMirror{value: fee - 1}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyA,
            companyA,
            84532,
            deadline,
            sig
        );
    }

    function test_RegisterMirror_RevertSameOriginChain() public {
        uint256 fee = registry.mirrorFee();
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signMirror(
            registry,
            "saas-empresa.com",
            companyA,
            companyA,
            companyA,
            block.chainid,
            deadline
        );

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidMirrorOrigin.selector);
        registry.registerMirror{value: fee}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyA,
            companyA,
            block.chainid,
            deadline,
            sig
        );
    }

    function test_RegisterMirror_RevertDuplicate() public {
        uint256 fee = registry.mirrorFee();
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signMirror(
            registry,
            "saas-empresa.com",
            companyA,
            companyA,
            companyA,
            84532,
            deadline
        );

        vm.prank(companyA);
        registry.registerMirror{value: fee}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyA,
            companyA,
            84532,
            deadline,
            sig
        );

        bytes memory sig2 = _signMirror(
            registry,
            "saas-empresa.com",
            companyB,
            companyB,
            companyB,
            84532,
            deadline
        );

        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.DomainAlreadyRegistered.selector);
        registry.registerMirror{value: fee}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyB,
            companyB,
            84532,
            deadline,
            sig2
        );
    }

    function test_DeactivateMirror_ByOracle() public {
        uint256 fee = registry.mirrorFee();
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signMirror(
            registry,
            "saas-empresa.com",
            companyA,
            companyA,
            companyA,
            84532,
            deadline
        );

        vm.prank(companyA);
        registry.registerMirror{value: fee}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyA,
            companyA,
            84532,
            deadline,
            sig
        );

        vm.prank(oracle);
        registry.deactivateMirror("saas-empresa.com");

        assertFalse(registry.isDomainActive("saas-empresa.com"));
        (bool isMirror, , ) = registry.getMirrorInfo("saas-empresa.com");
        assertFalse(isMirror);
    }

    function test_DeactivateMirror_RevertUnauthorized() public {
        uint256 fee = registry.mirrorFee();
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signMirror(
            registry,
            "saas-empresa.com",
            companyA,
            companyA,
            companyA,
            84532,
            deadline
        );

        vm.prank(companyA);
        registry.registerMirror{value: fee}(
            "saas-empresa.com",
            "https://p2p.saas-empresa.com/inbox",
            companyA,
            companyA,
            84532,
            deadline,
            sig
        );

        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.OnlyOracleAllowed.selector);
        registry.deactivateMirror("saas-empresa.com");
    }

    function test_SetMirrorFee_Success() public {
        vm.prank(owner);
        registry.setMirrorFee(0.005 ether);
        assertEq(registry.mirrorFee(), 0.005 ether);
    }

    function test_SetMirrorFee_RevertNonOwner() public {
        vm.prank(companyA);
        vm.expectRevert();
        registry.setMirrorFee(0.005 ether);
    }
}
