// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./helpers/BaseTest.sol";

/// @title MAIVWRegistry Economics Tests (v2)
contract MAIVWRegistryEconomicsTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    // ============================================
    //  1. Governança de Preço Dinâmica
    // ============================================

    function test_SetRegistrationFee_Success() public {
        uint256 newFee = 25 ether;
        vm.prank(owner);
        registry.setFees(newFee, 1000 ether);

        assertEq(registry.standardFee(), newFee);

        _registerCompanyHelper(
            "nova-empresa.com",
            "https://api.nova-empresa.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            newFee
        );

        assertTrue(registry.isDomainActive("nova-empresa.com"));
    }

    function test_SetRegistrationFee_RevertNonOwner() public {
        vm.prank(providerC);
        vm.expectRevert();
        registry.setFees(50 ether, 1000 ether);
    }

    function test_RevertWhen_RegistrationFeeInsufficientAfterIncrease() public {
        vm.prank(owner);
        registry.setFees(20 ether, 1000 ether);

        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, "antiga-taxa.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        vm.expectRevert(MAIVWRegistry.IncorrectFee.selector);
        registry.registerCompany{value: 10 ether}(
            "antiga-taxa.com",
            "https://api.antiga.com/inbox",
            companyA,
            companyA,
            false,
            deadline,
            sig
        );
    }

    // ============================================
    //  2. Cota Gênesis do Fundador (1000 Máximo)
    // ============================================

    function test_RegisterGenesisDomain_Success() public {
        (uint256 countInitial, uint256 maxGenesis) = registry.getGenesisStatus();
        assertEq(countInitial, 0);
        assertEq(maxGenesis, 1000);

        vm.prank(owner);
        registry.registerGenesisDomain(
            "parceiro-fundador.com",
            "https://api.parceiro.com/inbox",
            address(0x444)
        );

        (uint256 countAfter, ) = registry.getGenesisStatus();
        assertEq(countAfter, 1);
        assertTrue(registry.isDomainActive("parceiro-fundador.com"));
        assertEq(registry.getPublicKey("parceiro-fundador.com"), address(0x444));
    }

    function test_RegisterGenesisDomain_RevertNonOwner() public {
        vm.prank(providerC);
        vm.expectRevert();
        registry.registerGenesisDomain(
            "hacker-domain.com",
            "https://api.hacker.com/inbox",
            address(0x555)
        );
    }

    function test_RegisterGenesisDomain_ExhaustionAt1000() public {
        vm.startPrank(owner);
        for (uint256 i = 1; i <= 1000; i++) {
            string memory dom = string(abi.encodePacked("gen", vm.toString(i), ".com"));
            registry.registerGenesisDomain(
                dom,
                "https://api.genesis.com/inbox",
                address(uint160(i + 1000))
            );
        }

        (uint256 totalCount, uint256 maxGenesis) = registry.getGenesisStatus();
        assertEq(totalCount, 1000);
        assertEq(maxGenesis, 1000);

        vm.expectRevert(MAIVWRegistry.GenesisExhausted.selector);
        registry.registerGenesisDomain(
            "gen-1001.com",
            "https://api.genesis.com/inbox",
            address(0x9999)
        );
        vm.stopPrank();
    }

    // ============================================
    //  3. Tiers de Provedores e Rate Limit On-Chain
    // ============================================

    function test_RegisterProvider_StartupTier() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(
            registry,
            "startup-esp.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "startup-esp.com",
            "https://api.startup-esp.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            sig
        );

        assertTrue(registry.isDomainActive("startup-esp.com"));
        assertTrue(registry.isDomainProvider("startup-esp.com"));
        assertEq(registry.getAllowedDailyVolume("startup-esp.com"), 50_000);

        (
            bool isProvider,
            ProviderTier tier,
            uint256 dailyLimit,
            uint256 stakeBalance,
            uint32 strikeCount,
            bool isSuspended
        ) = registry.getProviderInfo("startup-esp.com");

        assertTrue(isProvider);
        assertEq(uint8(tier), uint8(ProviderTier.STARTUP));
        assertEq(dailyLimit, 50_000);
        assertEq(stakeBalance, 1 ether);
        assertEq(strikeCount, 0);
        assertFalse(isSuspended);
    }

    function test_RegisterProvider_GrowthTier() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(
            registry,
            "growth-esp.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.GROWTH),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 10 ether}(
            "growth-esp.com",
            "https://api.growth-esp.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.GROWTH),
            deadline,
            sig
        );

        assertEq(registry.getAllowedDailyVolume("growth-esp.com"), 1_000_000);
    }

    function test_RegisterProvider_EnterpriseTier() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(
            registry,
            "bigtech.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.ENTERPRISE),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 100 ether}(
            "bigtech.com",
            "https://api.bigtech.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.ENTERPRISE),
            deadline,
            sig
        );

        assertEq(registry.getAllowedDailyVolume("bigtech.com"), type(uint256).max);
    }

    function test_RegisterProvider_RevertIncorrectFee() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(
            registry,
            "fraud-esp.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.GROWTH),
            deadline
        );

        vm.prank(providerC);
        vm.expectRevert(MAIVWRegistry.IncorrectFee.selector);
        registry.registerProvider{value: 1 ether}(
            "fraud-esp.com",
            "https://api.fraud.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.GROWTH),
            deadline,
            sig
        );
    }

    // ============================================
    //  4. Opção Nuclear: Saldo Zerado e Reativação Segura (C-04)
    // ============================================

    function test_ProviderSuspension_WhenBalanceZero_AndReactivation() public {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(
            registry,
            "monitored-esp.com",
            providerC,
            providerC,
            providerC,
            true,
            uint8(ProviderTier.STARTUP),
            deadline
        );

        vm.prank(providerC);
        registry.registerProvider{value: 1 ether}(
            "monitored-esp.com",
            "https://api.monitored.com/inbox",
            providerC,
            providerC,
            uint8(ProviderTier.STARTUP),
            deadline,
            sig
        );

        for (uint256 i = 1; i <= 19; i++) {
            vm.prank(oracle);
            registry.issueWarningTicket("monitored-esp.com", string(abi.encodePacked("sub-", vm.toString(i))));
        }

        assertTrue(registry.isDomainActive("monitored-esp.com"));
        assertEq(registry.domainStakes(keccak256(bytes("monitored-esp.com"))), 0.05 ether);

        // 20ª infração zera o caução -> Provedor é SUSPENSO
        vm.prank(oracle);
        registry.issueWarningTicket("monitored-esp.com", "sub-20");

        assertFalse(registry.isDomainActive("monitored-esp.com"));
        assertEq(registry.domainStakes(keccak256(bytes("monitored-esp.com"))), 0);
        assertEq(registry.getAllowedDailyVolume("monitored-esp.com"), 0);

        // C-04: Recarga parcial (0.5 ether < 1 ether requiredStake) NÃO reativa o provedor!
        vm.prank(providerC);
        registry.topUpBalance{value: 0.5 ether}("monitored-esp.com");
        assertFalse(registry.isDomainActive("monitored-esp.com"), "Parcial nao deve reativar");

        // Completando para requiredStake (1 ether total) -> Reativa com segurança!
        vm.prank(providerC);
        registry.topUpBalance{value: 0.5 ether}("monitored-esp.com");
        assertTrue(registry.isDomainActive("monitored-esp.com"), "Requer requiredStake completo");
        assertEq(registry.getAllowedDailyVolume("monitored-esp.com"), 50_000);
    }

    function test_RegisterGenesisProvider() public {
        vm.prank(owner);
        registry.registerGenesisProvider{value: 10 ether}(
            "genesis-esp.com",
            "https://p2p.genesis-esp.com/inbox",
            providerC,
            ProviderTier.GROWTH
        );

        assertTrue(registry.isDomainActive("genesis-esp.com"));
        assertTrue(registry.isDomainProvider("genesis-esp.com"));
        assertEq(registry.getAllowedDailyVolume("genesis-esp.com"), 1_000_000);

        (uint256 count, uint256 maxGenesis) = registry.getGenesisStatus();
        assertEq(count, 1);
        assertEq(maxGenesis, 1000);

        assertEq(registry.domainStakes(keccak256(bytes("genesis-esp.com"))), 10 ether);
    }

    // ============================================
    //  5. Tesouraria e Saques Bounded (C-01)
    // ============================================

    function test_Treasury_DefaultAndSetTreasury() public {
        assertEq(registry.treasury(), treasury);

        address payable newTreasury = payable(address(0x8888));
        vm.prank(owner);
        registry.setTreasury(newTreasury);
        assertEq(registry.treasury(), newTreasury);
    }

    function test_Treasury_Withdraw_Success() public {
        _registerCompanyHelper(
            "startup-teste.com",
            "https://api.startup-teste.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        // 65% retido como stake (6.5 ether), 25% tesouraria (2.5 ether), 10% fundador (1 ether)
        assertEq(registry.domainStakes(keccak256(bytes("startup-teste.com"))), 6.5 ether);
        assertEq(registry.accumulatedTreasuryFees(), 2.5 ether);
        assertEq(registry.accumulatedFounderFees(), 1.0 ether);

        // Owner saca 2 ether da tesouraria
        vm.prank(owner);
        registry.withdrawTreasury(2 ether);
        assertEq(treasury.balance, 2 ether);
        assertEq(registry.accumulatedTreasuryFees(), 0.5 ether);

        // Tentativa de sacar acima do saldo de tesouraria falha (C-01 protegido!)
        vm.prank(owner);
        vm.expectRevert(MAIVWRegistry.InvalidAmount.selector);
        registry.withdrawTreasury(1 ether);
    }

    function test_Treasury_Withdraw_RevertNonOwner() public {
        _registerCompanyHelper(
            "startup-teste2.com",
            "https://api.startup-teste2.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        vm.prank(providerC);
        vm.expectRevert();
        registry.withdrawTreasury(1 ether);
    }

    // ============================================
    //  6. Divisão Econômica Perfeita com Pull & Solvência (C-01, C-07, H-07)
    // ============================================

    function test_Economics_ExactSplit_Founder_Treasury_Stake_Slash() public {
        address reporter1 = address(0xCCC1);
        address reporter2 = address(0xCCC2);
        address dead = 0x000000000000000000000000000000000000dEaD;

        uint256 regFee = 10 ether;

        _registerCompanyHelper(
            "alvo-golpe.com",
            "https://api.alvo-golpe.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            regFee
        );

        // Contabilidade estrita pós-registro
        assertEq(registry.accumulatedFounderFees(), 1 ether);
        assertEq(registry.accumulatedTreasuryFees(), 2.5 ether);
        bytes32 domainHash = keccak256(bytes("alvo-golpe.com"));
        assertEq(registry.domainStakes(domainHash), 6.5 ether);

        // 2. Fraude e Slashing com 2 denunciantes estritamente ordenados
        address[] memory reporters = new address[](2);
        if (reporter1 < reporter2) {
            reporters[0] = reporter1;
            reporters[1] = reporter2;
        } else {
            reporters[0] = reporter2;
            reporters[1] = reporter1;
        }

        uint256 deadBalBefore = dead.balance;

        vm.prank(oracle);
        registry.slashDomain("alvo-golpe.com", reporters);

        // Reporters recebem crédito pull (H-07)
        assertEq(registry.pendingWithdrawals(reporters[0]), 0.5 ether);
        assertEq(registry.pendingWithdrawals(reporters[1]), 0.5 ether);

        // Saque pull dos reporters
        vm.prank(reporters[0]);
        registry.withdrawPending();
        assertEq(reporters[0].balance, 0.5 ether);

        vm.prank(reporters[1]);
        registry.withdrawPending();
        assertEq(reporters[1].balance, 0.5 ether);

        // Queima exata de 55%
        assertEq(dead.balance - deadBalBefore, 5.5 ether);
        assertEq(registry.domainStakes(domainHash), 0);

        // Fundador e Tesouraria sacam seus respectivos saldos
        vm.prank(founder);
        registry.withdrawFounderFees();
        assertEq(founder.balance, 1 ether);

        vm.prank(owner);
        registry.withdrawTreasury(2.5 ether);
        assertEq(treasury.balance, 2.5 ether);

        // Solvência matemática absoluta: balanço residual = 0, liabilities = 0
        assertEq(address(registry).balance, 0);
        assertEq(registry.totalLiabilities(), 0);
    }
}
