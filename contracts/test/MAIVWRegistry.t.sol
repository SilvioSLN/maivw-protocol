// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./helpers/BaseTest.sol";

/// @title MAIVWRegistry Tests (v2)
/// @notice Testes unitários cobrindo registro de empresas, validações, rate limiting e endpoints
contract MAIVWRegistryTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    // ============================================
    //  Happy Path: Registro Normal
    // ============================================

    function test_RegisterStandardCompany() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        assertTrue(registry.isDomainActive("empresaa.com"));

        CompanyProfile memory profile = registry.getCompanyProfile("empresaa.com");
        assertEq(profile.domain, "empresaa.com");
        assertEq(profile.endpointUrl, "https://api.empresaa.com/maivw/inbox");
        assertEq(profile.publicKey, companyA);
        assertEq(profile.adminKey, companyA);
        assertFalse(profile.isProvider);
        assertEq(uint8(profile.status), uint8(DomainStatus.ACTIVE));
        assertEq(profile.strikeCount, 0);
    }

    function test_RegisterProviderCompany() public {
        _registerCompanyHelper(
            "sendgrid.com",
            "https://api.sendgrid.com/maivw/inbox",
            providerC,
            providerC,
            providerC,
            true,
            1000 ether
        );

        CompanyProfile memory profile = registry.getCompanyProfile("sendgrid.com");
        assertTrue(profile.isProvider);
        assertEq(uint8(profile.status), uint8(DomainStatus.ACTIVE));
        assertEq(profile.endpointUrl, "https://api.sendgrid.com/maivw/inbox");
    }

    function test_RegisterMultipleCompanies() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        _registerCompanyHelper(
            "empresab.com",
            "https://api.empresab.com/maivw/inbox",
            companyB,
            companyB,
            companyB,
            false,
            10 ether
        );

        assertEq(registry.getRegisteredDomainCount(), 2);
    }

    // ============================================
    //  Failure Cases: Registro Inválido
    // ============================================

    function test_RevertWhen_InsufficientFee() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "empresaa.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.IncorrectFee.selector);
        registry.registerCompany{value: 5 ether}(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    function test_RevertWhen_ExcessFee() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "empresaa.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.IncorrectFee.selector);
        registry.registerCompany{value: 20 ether}(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    function test_RevertWhen_ProviderWithStandardFee() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "sendgrid.com", providerC, providerC, providerC, true, 0, deadline);

        vm.prank(providerC);
        vm.expectRevert(MAIVWRegistry.IncorrectFee.selector);
        registry.registerCompany{value: 10 ether}(
            "sendgrid.com",
            "https://api.sendgrid.com/maivw/inbox",
            providerC,
            providerC,
            true,
            deadline,
            sig
        );
    }

    function test_RevertWhen_DuplicateDomain() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "empresaa.com", companyB, companyB, companyB, false, 0, deadline);

        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.DomainAlreadyRegistered.selector);
        registry.registerCompany{value: 10 ether}(
            "empresaa.com",
            "https://api2.empresaa.com/maivw/inbox",
            companyB,
            companyB,
            false,
            deadline,
            sig
        );
    }

    function test_RevertWhen_EmptyDomain() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidDomain.selector);
        registry.registerCompany{value: 10 ether}(
            "",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    function test_RevertWhen_EmptyEndpoint() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "empresaa.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidEndpoint.selector);
        registry.registerCompany{value: 10 ether}(
            "empresaa.com",
            "",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    function test_RevertWhen_InvalidPublicKey() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "empresaa.com", address(0), companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidPublicKey.selector);
        registry.registerCompany{value: 10 ether}(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            address(0),
            companyA,
            false,
            deadline,
            sig
        );
    }

    // ============================================
    //  Rate Limiting (Quarentena)
    // ============================================

    function test_QuarantineVolume_DuringFirst30Days() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        uint256 volume = registry.getAllowedDailyVolume("empresaa.com");
        assertEq(volume, 50); // QUARANTINE_DAILY_VOLUME
    }

    function test_NormalVolume_After30Days() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.warp(block.timestamp + 31 days);

        uint256 volume = registry.getAllowedDailyVolume("empresaa.com");
        assertEq(volume, 10_000); // NORMAL_DAILY_VOLUME
    }

    function test_ZeroVolume_InactiveDomain() public view {
        uint256 volume = registry.getAllowedDailyVolume("inexistente.com");
        assertEq(volume, 0);
    }

    // ============================================
    //  View Functions & Lens (Alert 1)
    // ============================================

    function test_GetPublicKey() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address key = registry.getPublicKey("empresaa.com");
        assertEq(key, companyA);
    }

    function test_GetEndpointUrl() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        string memory endpoint = registry.getEndpointUrl("empresaa.com");
        assertEq(endpoint, "https://api.empresaa.com/maivw/inbox");
    }

    function test_GetAllCompanies_ViaLens() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        _registerCompanyHelper(
            "empresab.com",
            "https://api.empresab.com/maivw/inbox",
            companyB,
            companyB,
            companyB,
            false,
            10 ether
        );

        CompanyProfile[] memory companies = lens.getAllCompanies(address(registry));
        assertEq(companies.length, 2);
        assertEq(companies[0].domain, "empresaa.com");
        assertEq(companies[1].domain, "empresab.com");
    }

    // ============================================
    //  Security: Fundos e Custódia
    // ============================================

    function test_FundsAreLockedInContract() public {
        uint256 contractBalanceBefore = address(registry).balance;
        assertEq(contractBalanceBefore, 0);

        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        uint256 contractBalanceAfter = address(registry).balance;
        assertEq(contractBalanceAfter, 10 ether);
        assertEq(registry.domainStakes(keccak256(bytes("empresaa.com"))), 6.5 ether);
        assertEq(registry.totalLiabilities(), 10 ether);
    }

    // ============================================
    //  Slashing
    // ============================================

    function test_SlashDomain_DoesNotRevert() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](2);
        // Reporters ordenados estritamente em ordem crescente (H-07)
        if (companyA < companyB) {
            reporters[0] = companyA;
            reporters[1] = companyB;
        } else {
            reporters[0] = companyB;
            reporters[1] = companyA;
        }

        vm.prank(oracle);
        registry.slashDomain("empresaa.com", reporters);
        assertFalse(registry.isDomainActive("empresaa.com"));
    }

    // ============================================
    //  Endpoint & Public Key Updates (M-08 & C-06)
    // ============================================

    function test_UpdateEndpoint_ByDomainOwner() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.prank(companyA);
        registry.updateEndpoint("empresaa.com", "https://mw.empresaa.com/api/v1/inbox");

        assertEq(registry.getEndpointUrl("empresaa.com"), "https://mw.empresaa.com/api/v1/inbox");
    }

    function test_UpdateEndpoint_RevertUnauthorized() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.updateEndpoint("empresaa.com", "https://hacker.com/inbox");
    }

    function test_UpdatePublicKey_ByDomainOwner() public {
        _registerCompanyHelper(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address newKey = address(0x999);
        vm.prank(companyA);
        registry.updatePublicKey("empresaa.com", newKey);

        assertEq(registry.getPublicKey("empresaa.com"), newKey);
    }

    // ============================================
    //  Oracle Proof Registration Tests (C-02 & H-05)
    // ============================================

    function test_RegisterCompany_WithValidOracleProof() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory proof = _signRegister(
            registry,
            "empresaa.com",
            companyA,
            companyA,
            companyA,
            false,
            0,
            deadline
        );

        vm.prank(companyA);
        registry.registerCompany{value: 10 ether}(
            "empresaa.com",
            "https://api.empresaa.com/maivw/inbox",
            companyA,
            companyA,
            false,
            deadline,
            proof
        );

        assertTrue(registry.isDomainActive("empresaa.com"));
        assertEq(registry.getEndpointUrl("empresaa.com"), "https://api.empresaa.com/maivw/inbox");
    }

    function test_RegisterCompany_RevertInvalidOracleProof() public {
        uint256 attackerKey = 0x666;
        uint256 deadline = block.timestamp + 3600;

        bytes32 h = keccak256(bytes("google.com"));
        bytes32 structHash = keccak256(
            abi.encode(
                registry.REGISTER_TYPEHASH(),
                h,
                companyA,
                companyA,
                companyA,
                false,
                0,
                registry.domainNonces(h),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerKey, digest);
        bytes memory fakeProof = abi.encodePacked(r, s, v);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidOracleProof.selector);
        registry.registerCompany{value: 10 ether}(
            "google.com",
            "https://hacker.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            fakeProof
        );
    }
}
