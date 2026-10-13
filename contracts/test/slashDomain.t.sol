// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./helpers/BaseTest.sol";

/// @title SlashDomainTest (v2)
contract SlashDomainTest is BaseTest {

    address public constant DEAD = address(0x000000000000000000000000000000000000dEaD);

    function setUp() public {
        setUpRegistry();
    }

    function test_SlashDomain_BurnAndBounty() public {
        _registerCompanyHelper(
            "spammer.com",
            "https://spammer.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        assertTrue(registry.isDomainActive("spammer.com"));
        assertEq(registry.domainStakes(keccak256(bytes("spammer.com"))), 6.5 ether);
        assertEq(registry.domainTotalFees(keccak256(bytes("spammer.com"))), 10 ether);

        uint256 deadBalBefore = DEAD.balance;

        address[] memory reporters = new address[](2);
        if (companyA < companyB) {
            reporters[0] = companyA;
            reporters[1] = companyB;
        } else {
            reporters[0] = companyB;
            reporters[1] = companyA;
        }

        vm.prank(oracle);
        registry.slashDomain("spammer.com", reporters);

        assertFalse(registry.isDomainActive("spammer.com"));
        assertEq(registry.getCompanyProfile("spammer.com").publicKey, address(0));
        assertEq(registry.domainStakes(keccak256(bytes("spammer.com"))), 0);

        // Crédito pull para denunciantes (H-07)
        assertEq(registry.pendingWithdrawals(reporters[0]), 0.5 ether);
        assertEq(registry.pendingWithdrawals(reporters[1]), 0.5 ether);

        // 5.5 ether enviado para DEAD
        assertEq(DEAD.balance - deadBalBefore, 5.5 ether);
    }

    function test_SlashDomain_RevertIfNotOracle() public {
        _registerCompanyHelper(
            "spammer.com",
            "https://spammer.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](1);
        reporters[0] = companyB;

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.OnlyOracleAllowed.selector);
        registry.slashDomain("spammer.com", reporters);
    }

    function test_ReclaimDomain_SuccessWithOracleProof() public {
        _registerCompanyHelper(
            "vitima.com",
            "https://vitima.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("vitima.com", reporters);
        assertFalse(registry.isDomainActive("vitima.com"));

        // Empresa Inocente compra o domínio e obtém prova EIP-712 do Oráculo
        address newPubKey = address(0x999);
        address newAdminKey = address(0x999);
        uint256 deadline = block.timestamp + 3600;

        bytes memory oracleProof = _signReclaim(
            registry,
            "vitima.com",
            newPubKey,
            newAdminKey,
            companyB,
            false,
            0,
            0, // epoch original = 0
            deadline
        );

        vm.prank(companyB);
        registry.reclaimDomain{value: 10 ether}(
            "vitima.com",
            "https://vitima.com/inbox",
            newPubKey,
            newAdminKey,
            false,
            0,
            deadline,
            oracleProof
        );

        assertTrue(registry.isDomainActive("vitima.com"));
        assertEq(registry.getPublicKey("vitima.com"), newPubKey);
        assertEq(registry.domainStakes(keccak256(bytes("vitima.com"))), 6.5 ether);
    }

    function test_ReclaimDomain_RevertInvalidProof() public {
        _registerCompanyHelper(
            "vitima.com",
            "https://vitima.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("vitima.com", reporters);

        // Assinatura gerada com chave não autorizada
        uint256 attackerKey = 0x666;
        address newPubKey = address(0x999);
        address newAdminKey = address(0x999);
        uint256 deadline = block.timestamp + 3600;

        bytes32 h = keccak256(bytes("vitima.com"));
        bytes32 structHash = keccak256(
            abi.encode(
                registry.RECLAIM_TYPEHASH(),
                h,
                newPubKey,
                newAdminKey,
                companyB,
                false,
                0,
                0, // epoch
                registry.domainNonces(h),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerKey, digest);
        bytes memory fakeProof = abi.encodePacked(r, s, v);

        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.InvalidOracleProof.selector);
        registry.reclaimDomain{value: 10 ether}(
            "vitima.com",
            "https://vitima.com/inbox",
            newPubKey,
            newAdminKey,
            false,
            0,
            deadline,
            fakeProof
        );
    }

    function test_RegisterIntentBatch() public {
        _registerCompanyHelper(
            "sender.com",
            "https://sender.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        bytes32 merkleRoot = keccak256("merkle_root_batch_test");
        vm.prank(companyA);
        registry.registerIntentBatch("sender.com", "MARKETING", merkleRoot);
    }

    function test_ProviderWarningTicketsAndSlashingAt3Strikes() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(
            registry,
            "sendgrid.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "sendgrid.com",
            "https://api.sendgrid.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            sig
        );

        assertTrue(registry.isDomainProvider("sendgrid.com"));

        // Strike 1
        vm.prank(oracle);
        registry.issueWarningTicket("sendgrid.com", "sub_user_123");
        assertEq(registry.getCompanyProfile("sendgrid.com").strikeCount, 1);
        assertFalse(registry.isDomainActive("sendgrid.com"));

        // Strike 2
        vm.prank(oracle);
        registry.issueWarningTicket("sendgrid.com", "sub_user_456");
        assertEq(registry.getCompanyProfile("sendgrid.com").strikeCount, 2);
        assertFalse(registry.isDomainActive("sendgrid.com"));

        // Mais advertências até o esgotamento total do saldo
        for (uint256 i = 3; i <= 20; i++) {
            vm.prank(oracle);
            registry.issueWarningTicket("sendgrid.com", string(abi.encodePacked("sub_", vm.toString(i))));
        }

        assertFalse(registry.isDomainActive("sendgrid.com"));
        assertEq(registry.domainStakes(keccak256(bytes("sendgrid.com"))), 0);
    }
}
