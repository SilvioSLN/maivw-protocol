// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../helpers/BaseTest.sol";

contract MaliciousRecipient {
    receive() external payable {
        revert("Rejecting ETH transfer");
    }
}

/// @title HighAndMediumFindingsTest
/// @notice Valida as correções dos achados Altos (H-01..H-09) e Médios (M-01..M-08)
contract HighAndMediumFindingsTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    // ============================================
    //  H-01: strikeCount uint32 (>255 strikes sem overflow)
    // ============================================

    function test_H01_moreThan255Strikes() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory provSig = _signRegister(
            registry,
            "enterprise-esp.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.ENTERPRISE),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 100 ether}(
            "enterprise-esp.com",
            "https://inbox.com",
            providerC,
            providerC,
            uint8(ProviderTier.ENTERPRISE),
            deadline,
            provSig
        );

        // Emite 300 advertências (na v1 revertia no 256º strike)
        for (uint256 i = 1; i <= 300; i++) {
            vm.prank(oracle);
            registry.issueWarningTicket("enterprise-esp.com", string(abi.encodePacked("sub_", vm.toString(i))));
        }

        CompanyProfile memory p = registry.getCompanyProfile("enterprise-esp.com");
        assertEq(p.strikeCount, 300);
    }

    // ============================================
    //  H-02: Registro sobre domínio existente
    // ============================================

    function test_H02_registerOverSuspendedReverts() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory provSig = _signRegister(
            registry,
            "prov-h02.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "prov-h02.com",
            "https://inbox.com",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            provSig
        );

        // 20 advertências suspendem
        for (uint256 i = 1; i <= 20; i++) {
            vm.prank(oracle);
            registry.issueWarningTicket("prov-h02.com", string(abi.encodePacked("sub_", vm.toString(i))));
        }

        // Tentativa de registrar por cima de domínio suspenso falha
        bytes memory newSig = _signRegister(
            registry,
            "prov-h02.com",
            companyA,
            companyA,
            companyA,
            false,
            0,
            deadline
        );

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.DomainAlreadyRegistered.selector);
        registry.registerCompany{value: 10 ether}(
            "prov-h02.com",
            "https://inbox.com",
            companyA,
            companyA,
            false,
            deadline,
            newSig
        );
    }

    function test_H02_noDuplicateInRegistry() public {
        _registerCompanyHelper(
            "single.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        assertEq(registry.getRegisteredDomainCount(), 1);
    }

    // ============================================
    //  H-03: Autenticação de Lotes de Intenção
    // ============================================

    function test_H03_strangerCannotRegisterBatch() public {
        _registerCompanyHelper(
            "sender-h03.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        bytes32 root = keccak256("merkle");
        // Desconhecido tenta registrar lote em nome de sender-h03.com
        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.registerIntentBatch("sender-h03.com", "NOTIF", root);
    }

    function test_H03_oracleRelayAllowed() public {
        _registerCompanyHelper(
            "sender-h03-rel.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        bytes32 root = keccak256("merkle-relay");
        // Oráculo pode fazer o relay do lote
        vm.prank(oracle);
        registry.registerIntentBatch("sender-h03-rel.com", "TRANSACTIONAL", root);
    }

    // ============================================
    //  H-04: deactivateMirror apenas para mirrors
    // ============================================

    function test_H04_cannotDeactivateNonMirror() public {
        _registerCompanyHelper(
            "normal-domain.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.prank(oracle);
        vm.expectRevert(MAIVWRegistry.NotAMirror.selector);
        registry.deactivateMirror("normal-domain.com");
    }

    // ============================================
    //  H-06: Governança Two-Step e Pausa
    // ============================================

    function test_H06_ownershipTwoStep() public {
        address newOwner = address(0xEEEE);
        vm.prank(owner);
        registry.transferOwnership(newOwner);

        // Ainda é o owner antigo até aceite
        assertEq(registry.owner(), owner);

        // Novo owner aceita
        vm.prank(newOwner);
        registry.acceptOwnership();
        assertEq(registry.owner(), newOwner);
    }

    function test_H06_guardianPausesOwnerUnpauses() public {
        vm.prank(guardian);
        registry.pause();
        assertTrue(registry.paused());

        // Registro falha quando pausado
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "paused.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert();
        registry.registerCompany{value: 10 ether}(
            "paused.com",
            "https://inbox.com",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );

        // Owner despausa
        vm.prank(owner);
        registry.unpause();
        assertFalse(registry.paused());
    }

    function test_H06_withdrawPendingWorksWhilePaused() public {
        _registerCompanyHelper(
            "slash-paused.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("slash-paused.com", reporters);

        // Guardian pausa o protocolo
        vm.prank(guardian);
        registry.pause();

        // Usuário ainda consegue sacar seu saldo pendente (NUNCA pausável)
        vm.prank(companyB);
        registry.withdrawPending();
        assertEq(companyB.balance, 1001 ether);
    }

    // ============================================
    //  H-07: Slashing Seguro via Pull e Sem DoS
    // ============================================

    function test_H07_revertingReporterDoesNotBlockSlash() public {
        _registerCompanyHelper(
            "spammer-dos.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        MaliciousRecipient mal = new MaliciousRecipient();

        address[] memory reporters = new address[](2);
        address r1 = address(mal);
        address r2 = companyB;
        if (r1 < r2) {
            reporters[0] = r1;
            reporters[1] = r2;
        } else {
            reporters[0] = r2;
            reporters[1] = r1;
        }

        // Slashing passa porque o reporter recebe crédito PULL e não chamada externa direta
        vm.prank(oracle);
        registry.slashDomain("spammer-dos.com", reporters);
        assertFalse(registry.isDomainActive("spammer-dos.com"));
        assertEq(registry.pendingWithdrawals(address(mal)), 0.5 ether);
    }

    function test_H07_duplicateReportersRejected() public {
        _registerCompanyHelper(
            "spammer-dup.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](2);
        reporters[0] = companyB;
        reporters[1] = companyB; // Duplicado!

        vm.prank(oracle);
        vm.expectRevert(MAIVWRegistry.ReportersNotStrictlySorted.selector);
        registry.slashDomain("spammer-dup.com", reporters);
    }

    function test_H07_tooManyReporters() public {
        _registerCompanyHelper(
            "spammer-many.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        address[] memory reporters = new address[](51); // > MAX_REPORTERS (50)
        for (uint256 i = 0; i < 51; i++) {
            reporters[i] = address(uint160(i + 1));
        }

        vm.prank(oracle);
        vm.expectRevert(MAIVWRegistry.TooManyReporters.selector);
        registry.slashDomain("spammer-many.com", reporters);
    }

    // ============================================
    //  H-09: Domínios Gênesis com zero stake punidos
    // ============================================

    function test_H09_genesisZeroStakeCanBeSlashed() public {
        vm.prank(owner);
        registry.registerGenesisDomain(
            "genesis-bad.com",
            "https://inbox.com",
            companyA
        );

        assertTrue(registry.isDomainActive("genesis-bad.com"));

        address[] memory reporters = new address[](0);
        vm.prank(oracle);
        // Na v1 revertia com NoStakeToSlash; na v2 é desativado com sucesso
        registry.slashDomain("genesis-bad.com", reporters);
        assertFalse(registry.isDomainActive("genesis-bad.com"));
    }

    // ============================================
    //  M-03: Validação Estrita de Domínio (ASCII / Punycode)
    // ============================================

    function test_M03_rejectsUppercase() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "Empresa.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidDomain.selector);
        registry.registerCompany{value: 10 ether}(
            "Empresa.com",
            "https://inbox.com",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    function test_M03_rejectsTrailingDot() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "empresa.com.", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidDomain.selector);
        registry.registerCompany{value: 10 ether}(
            "empresa.com.",
            "https://inbox.com",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    function test_M03_acceptsPunycode() public {
        _registerCompanyHelper(
            "xn--exemplo-9za.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        assertTrue(registry.isDomainActive("xn--exemplo-9za.com"));
    }

    function test_M03_rejectsLeadingHyphen() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "-empresa.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidDomain.selector);
        registry.registerCompany{value: 10 ether}(
            "-empresa.com",
            "https://inbox.com",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    // ============================================
    //  M-04: Tamanho Máximo de Endpoint
    // ============================================

    function test_M04_endpointTooLongReverts() public {
        bytes memory longEndpoint = new bytes(513); // > MAX_ENDPOINT_LENGTH (512)
        for (uint256 i = 0; i < 513; i++) {
            longEndpoint[i] = "a";
        }

        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "long-ep.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidEndpoint.selector);
        registry.registerCompany{value: 10 ether}(
            "long-ep.com",
            string(longEndpoint),
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    // ============================================
    //  M-05: Paginação Segura via Lens
    // ============================================

    function test_M05_pagination() public {
        _registerCompanyHelper("a1.com", "https://inbox.com", companyA, companyA, companyA, false, 10 ether);
        _registerCompanyHelper("a2.com", "https://inbox.com", companyB, companyB, companyB, false, 10 ether);
        _registerCompanyHelper("a3.com", "https://inbox.com", providerC, providerC, providerC, false, 10 ether);

        CompanyProfile[] memory page1 = lens.getCompanies(address(registry), 0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].domain, "a1.com");
        assertEq(page1[1].domain, "a2.com");

        CompanyProfile[] memory page2 = lens.getCompanies(address(registry), 2, 2);
        assertEq(page2.length, 1);
        assertEq(page2[0].domain, "a3.com");

        CompanyProfile[] memory pageEmpty = lens.getCompanies(address(registry), 5, 2);
        assertEq(pageEmpty.length, 0);
    }

    // ============================================
    //  M-06: Tetos de Taxas e Parâmetros
    // ============================================

    function test_M06_feeAboveCapReverts() public {
        vm.prank(owner);
        // Teto de standardFee é 10x inicial = 100 ether
        vm.expectRevert(MAIVWRegistry.FeeExceedsCap.selector);
        registry.setFees(101 ether, 1000 ether);
    }

    // ============================================
    //  M-08: Separação adminKey (Cold) e publicKey (Hot)
    // ============================================

    function test_M08_adminTwoStepRotation() public {
        _registerCompanyHelper("rot.com", "https://inbox.com", companyA, companyA, companyA, false, 10 ether);

        address newAdmin = address(0x777);
        vm.prank(companyA);
        registry.proposeAdminKey("rot.com", newAdmin);

        // Novo admin aceita
        vm.prank(newAdmin);
        registry.acceptAdminKey("rot.com");

        CompanyProfile memory p = registry.getCompanyProfile("rot.com");
        assertEq(p.adminKey, newAdmin);
    }
}
