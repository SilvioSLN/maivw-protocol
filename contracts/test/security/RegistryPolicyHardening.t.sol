// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../helpers/BaseTest.sol";

/// @title RegistryPolicyHardeningTest
/// @notice Cobre separação hot/cold, tier obrigatório, suspensão e paridade do Lens.
contract RegistryPolicyHardeningTest is BaseTest {
    address internal hotKey = address(0x101);
    address internal coldKey = address(0x102);
    address internal nextHotKey = address(0x103);
    address internal staleAdmin = address(0x104);

    function setUp() public {
        setUpRegistry();
    }

    function test_HotKeyCannotMutateDomainConfigurationButCanPublishIntent() public {
        _registerCompanyHelper(
            "keys.example.com",
            "https://keys.example.com/inbox",
            hotKey,
            coldKey,
            companyA,
            false,
            10 ether
        );

        vm.startPrank(hotKey);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.updatePublicKey("keys.example.com", nextHotKey);

        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.updateEndpoint("keys.example.com", "https://attacker.example/inbox");

        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.setDomainTlsFingerprint("keys.example.com", keccak256("attacker-cert"));

        registry.registerIntentBatch("keys.example.com", "TRANSACTIONAL", keccak256("batch"));
        vm.stopPrank();

        vm.prank(coldKey);
        registry.updatePublicKey("keys.example.com", nextHotKey);
        assertEq(registry.getPublicKey("keys.example.com"), nextHotKey);
    }

    function test_RecoveryInvalidatesPendingAdminProposal() public {
        _registerCompanyHelper(
            "recovery.example.com",
            "https://recovery.example.com/inbox",
            hotKey,
            coldKey,
            companyA,
            false,
            10 ether
        );

        vm.prank(coldKey);
        registry.proposeAdminKey("recovery.example.com", staleAdmin);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signRecovery(
            registry,
            "recovery.example.com",
            companyB,
            nextHotKey,
            0,
            deadline
        );
        registry.requestRecovery("recovery.example.com", companyB, nextHotKey, deadline, proof);
        registry.executeRecovery("recovery.example.com");

        vm.prank(staleAdmin);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.acceptAdminKey("recovery.example.com");

        CompanyProfile memory profile = registry.getCompanyProfile("recovery.example.com");
        assertEq(profile.adminKey, companyB);
        assertEq(profile.publicKey, nextHotKey);
        assertEq(profile.epoch, 1);
    }

    function test_RegisterCompanyRejectsProviderWithoutTier() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signRegister(
            registry,
            "tierless.example.com",
            hotKey,
            coldKey,
            companyA,
            true,
            uint8(ProviderTier.NONE),
            deadline
        );

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidTier.selector);
        registry.registerCompany{value: 1000 ether}(
            "tierless.example.com",
            "https://tierless.example.com/inbox",
            hotKey,
            coldKey,
            true,
            deadline,
            proof
        );
    }

    function test_ReclaimRejectsProviderWithoutTier() public {
        string memory domain = "reclaim-tier.example.com";
        _registerCompanyHelper(
            domain,
            "https://reclaim-tier.example.com/inbox",
            hotKey,
            coldKey,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](0);
        vm.prank(oracle);
        registry.slashDomain(domain, reporters);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signReclaim(
            registry,
            domain,
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.NONE),
            0,
            deadline
        );

        vm.prank(providerC);
        vm.expectRevert(MAIVWRegistry.InvalidTier.selector);
        registry.reclaimDomain{value: 1000 ether}(
            domain,
            "https://provider.example.com/inbox",
            providerC,
            providerC,
            true,
            uint8(ProviderTier.NONE),
            deadline,
            proof
        );
    }

    function test_ProviderSuspendsBelowTierMinimumAndReactivatesAtMinimum() public {
        _registerStartupProvider("minimum.example.com");

        vm.prank(oracle);
        registry.issueWarningTicket("minimum.example.com", "tenant-1");

        CompanyProfile memory suspended = registry.getCompanyProfile("minimum.example.com");
        assertEq(uint8(suspended.status), uint8(DomainStatus.SUSPENDED));
        assertEq(registry.domainStakes(keccak256(bytes("minimum.example.com"))), 0.95 ether);
        assertEq(registry.getAllowedDailyVolume("minimum.example.com"), 0);

        vm.prank(providerC);
        registry.topUpBalance{value: 0.05 ether}("minimum.example.com");

        assertTrue(registry.isDomainActive("minimum.example.com"));
        assertEq(registry.getAllowedDailyVolume("minimum.example.com"), 50_000);
    }

    function test_LensUsesProviderTierLimitInsteadOfCompanyQuarantine() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signRegister(
            registry,
            "lens-provider.example.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.GROWTH),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 10 ether}(
            "lens-provider.example.com",
            "https://lens-provider.example.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.GROWTH),
            deadline,
            proof
        );

        string[] memory domains = new string[](1);
        domains[0] = "lens-provider.example.com";
        MAIVWRegistryLens.EnrichedProfile[] memory enriched = lens.getEnrichedProfiles(address(registry), domains);

        assertEq(enriched[0].effectiveDailyLimit, 1_000_000);
        assertFalse(enriched[0].inQuarantine);
        assertEq(uint8(enriched[0].tier), uint8(ProviderTier.GROWTH));
    }

    function test_MirrorRejectsLocalConfigurationMutation() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signMirror(
            registry,
            "mirror-readonly.example.com",
            hotKey,
            coldKey,
            companyA,
            8453,
            deadline
        );

        vm.prank(companyA);
        registry.registerMirror{value: 0.003 ether}(
            "mirror-readonly.example.com",
            "https://mirror-readonly.example.com/inbox",
            hotKey,
            coldKey,
            8453,
            deadline,
            proof
        );

        vm.prank(coldKey);
        vm.expectRevert(MAIVWRegistry.MirrorIsReadOnly.selector);
        registry.updateEndpoint("mirror-readonly.example.com", "https://local-change.example/inbox");
    }

    function _registerStartupProvider(string memory domain) private {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _signRegister(
            registry,
            domain,
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );
        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            domain,
            "https://provider.example.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            proof
        );
    }
}
