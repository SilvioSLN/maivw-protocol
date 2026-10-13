// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../helpers/BaseTest.sol";

/// @title ReclaimStateResetTest
/// @notice Garante que processos do titular anterior não sobrevivem à troca de epoch.
contract ReclaimStateResetTest is BaseTest {
    function setUp() public {
        setUpRegistry();
    }

    function test_ReclaimInvalidatesPendingAdminAndTlsFingerprint() public {
        string memory domain = "reset-admin.com";
        address staleAdmin = address(0x991);
        bytes32 oldFingerprint = keccak256("old-certificate");

        _registerCompanyHelper(
            domain,
            "https://old.example/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.startPrank(companyA);
        registry.proposeAdminKey(domain, staleAdmin);
        registry.setDomainTlsFingerprint(domain, oldFingerprint);
        vm.stopPrank();

        _slashAndReclaim(domain, "https://new.example/inbox");

        vm.prank(staleAdmin);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.acceptAdminKey(domain);

        CompanyProfile memory profile = registry.getCompanyProfile(domain);
        assertEq(profile.adminKey, companyB);
        assertEq(registry.getDomainTlsFingerprint(domain), bytes32(0));
    }

    function test_ReclaimInvalidatesPendingRecovery() public {
        string memory domain = "reset-recovery.com";
        address staleAdmin = address(0x992);
        address stalePublicKey = address(0x993);

        _registerCompanyHelper(
            domain,
            "https://old.example/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory recoveryProof = _signRecovery(
            registry,
            domain,
            staleAdmin,
            stalePublicKey,
            0,
            deadline
        );
        registry.requestRecovery(domain, staleAdmin, stalePublicKey, deadline, recoveryProof);

        _slashAndReclaim(domain, "https://new.example/inbox");

        vm.expectRevert(MAIVWRegistry.RecoveryNotReady.selector);
        registry.executeRecovery(domain);

        CompanyProfile memory profile = registry.getCompanyProfile(domain);
        assertEq(profile.adminKey, companyB);
        assertEq(profile.publicKey, companyB);
    }

    function test_ReclaimClearsFrozenAndPendingSlash() public {
        string memory domain = "reset-slash.com";

        _registerCompanyHelper(
            domain,
            "https://old.example/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.prank(owner);
        registry.setDelays(1 days, 0);

        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.proposeSlash(domain, reporters);
        assertFalse(registry.isDomainActive(domain));

        // Executa um slash direto depois de zerar o delay. A proposta anterior ainda
        // existiria no storage se o reclaim não limpasse explicitamente o caso.
        vm.prank(owner);
        registry.setDelays(0, 0);
        vm.prank(oracle);
        registry.slashDomain(domain, reporters);

        _reclaim(domain, "https://new.example/inbox");
        assertTrue(registry.isDomainActive(domain));

        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(MAIVWRegistry.SlashNotReady.selector);
        registry.executeSlash(domain, reporters);
    }

    function _slashAndReclaim(string memory domain, string memory endpoint) internal {
        address[] memory reporters = new address[](0);
        vm.prank(oracle);
        registry.slashDomain(domain, reporters);
        _reclaim(domain, endpoint);
    }

    function _reclaim(string memory domain, string memory endpoint) internal {
        CompanyProfile memory beforeReclaim = registry.getCompanyProfile(domain);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signReclaim(
            registry,
            domain,
            companyB,
            companyB,
            companyB,
            false,
            0,
            beforeReclaim.epoch,
            deadline
        );

        vm.prank(companyB);
        registry.reclaimDomain{value: 10 ether}(
            domain,
            endpoint,
            companyB,
            companyB,
            false,
            0,
            deadline,
            proof
        );
    }
}
