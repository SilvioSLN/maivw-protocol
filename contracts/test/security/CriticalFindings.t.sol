// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../helpers/BaseTest.sol";

/// @title CriticalFindingsTest
/// @notice Valida as correções dos achados Críticos C-01 até C-07
contract CriticalFindingsTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    // ============================================
    //  C-01: Saque indevido do caução
    // ============================================

    function test_C01_ownerCannotWithdrawUserStake() public {
        _registerCompanyHelper(
            "empresa1.com",
            "https://empresa1.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        // Saldo total do contrato = 10 ETH (6.5 ETH stake, 2.5 ETH tesouraria, 1 ETH founder)
        assertEq(address(registry).balance, 10 ether);
        assertEq(registry.accumulatedTreasuryFees(), 2.5 ether);

        // Tentativa de sacar o saldo total reverte com InvalidAmount
        vm.prank(owner);
        vm.expectRevert(MAIVWRegistry.InvalidAmount.selector);
        registry.withdrawTreasury(10 ether);

        // Saque do valor legítimo da tesouraria passa com sucesso
        vm.prank(owner);
        registry.withdrawTreasury(2.5 ether);
        assertEq(treasury.balance, 2.5 ether);

        // Tentativa de novo saque da tesouraria agora reverte
        vm.prank(owner);
        vm.expectRevert(MAIVWRegistry.InvalidAmount.selector);
        registry.withdrawTreasury(1 wei);
    }

    function test_C01_slashWorksAfterTreasuryWithdraw() public {
        _registerCompanyHelper(
            "spammer-c01.com",
            "https://spammer.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        // Owner saca toda a receita da tesouraria
        vm.prank(owner);
        registry.withdrawTreasury(2.5 ether);

        // Slashing ainda possui os 6.5 ETH de stake intactos e não reverte por falta de fundos
        address[] memory reporters = new address[](1);
        reporters[0] = companyB;

        vm.prank(oracle);
        registry.slashDomain("spammer-c01.com", reporters);

        assertFalse(registry.isDomainActive("spammer-c01.com"));
        assertEq(registry.pendingWithdrawals(companyB), 1.0 ether);
    }

    // ============================================
    //  C-02: Replay de provas do oráculo
    // ============================================

    function test_C02_proofCannotBeReusedAfterSlash() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory proof = _signRegister(
            registry,
            "spammer-c02.com",
            companyA,
            companyA,
            companyA,
            false,
            0,
            deadline
        );

        vm.prank(companyA);
        registry.registerCompany{value: 10 ether}(
            "spammer-c02.com",
            "https://spammer.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            proof
        );

        // Slash domain
        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("spammer-c02.com", reporters);

        // Tentativa de reutilizar a prova original para registrar novamente falha (nonce incrementado)
        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidOracleProof.selector);
        registry.registerCompany{value: 10 ether}(
            "spammer-c02.com",
            "https://spammer.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            proof
        );
    }

    function test_C02_registerProofRejectedOnReclaim() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory registerProof = _signRegister(
            registry,
            "domain-c02.com",
            companyA,
            companyA,
            companyA,
            false,
            0,
            deadline
        );

        vm.prank(companyA);
        registry.registerCompany{value: 10 ether}(
            "domain-c02.com",
            "https://domain.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            registerProof
        );

        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("domain-c02.com", reporters);

        // Usar prova de Register em Reclaim deve falhar por typehash incompatível
        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidOracleProof.selector);
        registry.reclaimDomain{value: 10 ether}(
            "domain-c02.com",
            "https://domain.com/inbox",
            companyA,
            companyA,
            false,
            0,
            deadline,
            registerProof
        );
    }

    function test_C02_expiredProofReverts() public {
        uint256 deadline = block.timestamp + 100;
        bytes memory proof = _signRegister(
            registry,
            "expired-c02.com",
            companyA,
            companyA,
            companyA,
            false,
            0,
            deadline
        );

        vm.warp(deadline + 1);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.ProofExpired.selector);
        registry.registerCompany{value: 10 ether}(
            "expired-c02.com",
            "https://domain.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            proof
        );
    }

    function test_C02_proofBoundToContract() public {
        InitConfig memory cfg = InitConfig({
            initialOwner: owner,
            guardian: guardian,
            oracleNode: oracle,
            founderWallet: payable(founder),
            treasury: payable(treasury),
            standardFee: 10 ether,
            providerFee: 1000 ether,
            mirrorFee: 0.003 ether,
            slashDelay: 0,
            recoveryDelay: 0,
            startup: ProviderConfig({requiredStake: 1 ether, dailyLimit: 50_000, penaltyPerStrike: 0.05 ether}),
            growth: ProviderConfig({requiredStake: 10 ether, dailyLimit: 1_000_000, penaltyPerStrike: 0.05 ether}),
            enterprise: ProviderConfig({requiredStake: 100 ether, dailyLimit: type(uint256).max, penaltyPerStrike: 0.05 ether})
        });

        MAIVWRegistry impl2 = new MAIVWRegistry();
        ERC1967Proxy proxy2 = new ERC1967Proxy(address(impl2), abi.encodeCall(MAIVWRegistry.initialize, (cfg)));
        MAIVWRegistry registry2 = MAIVWRegistry(address(proxy2));

        uint256 deadline = block.timestamp + 3600;
        // Assina para registry 1
        bytes memory proof = _signRegister(
            registry,
            "target.com",
            companyA,
            companyA,
            companyA,
            false,
            0,
            deadline
        );

        // Enviar para registry2 deve reverter
        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.InvalidOracleProof.selector);
        registry2.registerCompany{value: 10 ether}(
            "target.com",
            "https://domain.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            proof
        );
    }

    // ============================================
    //  C-03: Reclaim em domínio ativo
    // ============================================

    function test_C03_reclaimActiveDomainReverts() public {
        _registerCompanyHelper(
            "ativo.com",
            "https://ativo.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        uint256 deadline = block.timestamp + 3600;
        bytes memory reclaimProof = _signReclaim(
            registry,
            "ativo.com",
            companyB,
            companyB,
            companyB,
            false,
            0,
            0,
            deadline
        );

        vm.prank(companyB);
        vm.expectRevert(MAIVWRegistry.DomainStillActive.selector);
        registry.reclaimDomain{value: 10 ether}(
            "ativo.com",
            "https://ativo.com/inbox",
            companyB,
            companyB,
            false,
            0,
            deadline,
            reclaimProof
        );
    }

    function test_C03_residualStakeCreditedToPreviousAdmin() public {
        _registerCompanyHelper(
            "revogado.com",
            "https://revogado.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        // Desativa via suspensão manual (oráculo emite advertências ou desativa)
        // Simulando provedor suspenso com saldo residual
        uint256 deadline = block.timestamp + 3600;
        bytes memory provSig = _signRegister(
            registry,
            "provider-res.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "provider-res.com",
            "https://provider.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            provSig
        );

        // 20 advertências suspendem
        for (uint256 i = 1; i <= 20; i++) {
            vm.prank(oracle);
            registry.issueWarningTicket("provider-res.com", string(abi.encodePacked("sub_", vm.toString(i))));
        }

        // Faz topup de 0.1 ether (permanece SUSPENDED)
        vm.prank(providerC);
        registry.topUpBalance{value: 0.1 ether}("provider-res.com");

        // Reclaim por novo titular: residual de 0.1 ether vai como crédito para providerC
        bytes memory recSig = _signReclaim(
            registry,
            "provider-res.com",
            companyB,
            companyB,
            companyB,
            false,
            0,
            0,
            deadline
        );

        vm.prank(companyB);
        registry.reclaimDomain{value: 10 ether}(
            "provider-res.com",
            "https://provider.com/inbox",
            companyB,
            companyB,
            false,
            0,
            deadline,
            recSig
        );

        // ProviderC deve ter recebido o crédito residual
        assertEq(registry.pendingWithdrawals(providerC), 0.1 ether);
    }

    // ============================================
    //  C-04: Reativação indevida com 1 wei
    // ============================================

    function test_C04_slashedProviderCannotBeReactivatedByTopUp() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory provSig = _signRegister(
            registry,
            "provider-c04.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "provider-c04.com",
            "https://provider.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            provSig
        );

        // Slash direto
        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("provider-c04.com", reporters);

        // Topup em domínio SLASHED deve reverter com DomainNotEligible
        vm.prank(providerC);
        vm.expectRevert(MAIVWRegistry.DomainNotEligible.selector);
        registry.topUpBalance{value: 10 ether}("provider-c04.com");
    }

    function test_C04_suspendedProviderNeedsFullRequiredStake() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory provSig = _signRegister(
            registry,
            "provider-c04-sub.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "provider-c04-sub.com",
            "https://provider.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            provSig
        );

        // 20 advertências suspendem
        for (uint256 i = 1; i <= 20; i++) {
            vm.prank(oracle);
            registry.issueWarningTicket("provider-c04-sub.com", string(abi.encodePacked("sub_", vm.toString(i))));
        }

        // Com 1 wei continua suspenso
        vm.prank(providerC);
        registry.topUpBalance{value: 1 wei}("provider-c04-sub.com");
        assertFalse(registry.isDomainActive("provider-c04-sub.com"));

        // Com o valor faltante até requiredStake (1 ether), volta a ser ACTIVE
        vm.prank(providerC);
        registry.topUpBalance{value: 1 ether - 1 wei}("provider-c04-sub.com");
        assertTrue(registry.isDomainActive("provider-c04-sub.com"));
    }

    function test_C04_getPublicKeyNeverReturnsZero() public {
        _registerCompanyHelper(
            "slashed-pub.com",
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
        registry.slashDomain("slashed-pub.com", reporters);

        vm.expectRevert(MAIVWRegistry.DomainNotFound.selector);
        registry.getPublicKey("slashed-pub.com");
    }

    // ============================================
    //  C-05: Validação de Configuração do Construtor
    // ============================================

    function test_C05_constructorRejectsZeroOrInconsistentTiers() public {
        InitConfig memory badCfg = InitConfig({
            initialOwner: owner,
            guardian: guardian,
            oracleNode: oracle,
            founderWallet: payable(founder),
            treasury: payable(treasury),
            standardFee: 10 ether,
            providerFee: 5 ether, // providerFee < standardFee!
            mirrorFee: 0.003 ether,
            slashDelay: 0,
            recoveryDelay: 0,
            startup: ProviderConfig({requiredStake: 1 ether, dailyLimit: 50_000, penaltyPerStrike: 0.05 ether}),
            growth: ProviderConfig({requiredStake: 10 ether, dailyLimit: 1_000_000, penaltyPerStrike: 0.05 ether}),
            enterprise: ProviderConfig({requiredStake: 100 ether, dailyLimit: type(uint256).max, penaltyPerStrike: 0.05 ether})
        });

        MAIVWRegistry badImpl = new MAIVWRegistry();
        vm.expectRevert(MAIVWRegistry.InvalidConfig.selector);
        new ERC1967Proxy(address(badImpl), abi.encodeCall(MAIVWRegistry.initialize, (badCfg)));
    }

    // ============================================
    //  C-06: Personificação de Domínio e Recovery
    // ============================================

    function test_C06_ownerCannotUpdateForeignDomain() public {
        _registerCompanyHelper(
            "alvo-impersonate.com",
            "https://alvo.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        // Owner do contrato tenta atualizar endpoint de empresa de terceiro
        vm.prank(owner);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.updateEndpoint("alvo-impersonate.com", "https://malicious.com");

        // Owner do contrato tenta atualizar public key de terceiro
        vm.prank(owner);
        vm.expectRevert(MAIVWRegistry.UnauthorizedDomainCaller.selector);
        registry.updatePublicKey("alvo-impersonate.com", address(0x999));
    }

    function test_C06_recoveryCancelableByCurrentAdmin() public {
        _registerCompanyHelper(
            "recovery-domain.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        uint256 deadline = block.timestamp + 3600;
        address newAdmin = address(0x991);
        address newPub = address(0x992);

        bytes memory proof = _signRecovery(
            registry,
            "recovery-domain.com",
            newAdmin,
            newPub,
            0,
            deadline
        );

        // Inicia recovery
        registry.requestRecovery("recovery-domain.com", newAdmin, newPub, deadline, proof);

        // O admin atual percebe e cancela
        vm.prank(companyA);
        registry.cancelRecovery("recovery-domain.com");

        // Executar deve reverter
        vm.expectRevert(MAIVWRegistry.RecoveryNotReady.selector);
        registry.executeRecovery("recovery-domain.com");
    }

    // ============================================
    //  C-07: Contabilidade e Eliminação de Saldos Fantasmas
    // ============================================

    function test_C07_genesisWithoutValueHasZeroStake() public {
        vm.prank(owner);
        registry.registerGenesisDomain(
            "genesis-clean.com",
            "https://inbox.com",
            companyA
        );

        assertEq(registry.domainStakes(keccak256(bytes("genesis-clean.com"))), 0);
        assertEq(registry.totalStaked(), 0);
        assertEq(registry.totalLiabilities(), 0);
    }

    function test_C07_penaltyMovesToTreasury() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory provSig = _signRegister(
            registry,
            "provider-c07.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "provider-c07.com",
            "https://inbox.com",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            provSig
        );

        uint256 stakeBefore = registry.domainStakes(keccak256(bytes("provider-c07.com")));
        uint256 treasuryBefore = registry.accumulatedTreasuryFees();

        vm.prank(oracle);
        registry.issueWarningTicket("provider-c07.com", "sub_1");

        uint256 stakeAfter = registry.domainStakes(keccak256(bytes("provider-c07.com")));
        uint256 treasuryAfter = registry.accumulatedTreasuryFees();

        // 0.05 ether sai exatamente do stake e entra na tesouraria
        assertEq(stakeBefore - stakeAfter, 0.05 ether);
        assertEq(treasuryAfter - treasuryBefore, 0.05 ether);

        // Solvência estrita preservada
        assertEq(address(registry).balance, registry.totalLiabilities());
    }
}
