// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "../../src/MAIVWRegistry.sol";
import "../../src/MAIVWRegistryLens.sol";

/// @dev Mock de contrato V2 para teste de upgrade UUPS autorizado pela Safe
contract MAIVWRegistryV2Mock is MAIVWRegistry {
    function version() external pure returns (string memory) {
        return "2.1.0-safe-upgrade";
    }
}

contract GovernanceSafeTest is Test {
    MAIVWRegistry public registry;
    MAIVWRegistryLens public lens;

    address public deployer = makeAddr("deployer");
    address public safeGov = makeAddr("safe_multisig_2_of_3");
    address public emergencyGuardian = makeAddr("guardian_fast_pause_1_of_3");
    address public oracleNode = makeAddr("gcp_kms_oracle_node");
    address payable public treasury = payable(makeAddr("safe_treasury"));
    address payable public founderWallet = payable(makeAddr("founder_wallet"));
    address public attacker = makeAddr("attacker_eoa");

    // Provedor para testar slash e veto
    address public providerAdmin = makeAddr("provider_admin");
    address public providerKey = makeAddr("provider_key");

    function setUp() public {
        vm.deal(deployer, 100 ether);
        vm.deal(attacker, 100 ether);
        vm.deal(providerAdmin, 100 ether);

        InitConfig memory cfg = InitConfig({
            initialOwner: safeGov,
            guardian: emergencyGuardian,
            oracleNode: oracleNode,
            founderWallet: founderWallet,
            treasury: treasury,
            standardFee: 0.001 ether,
            providerFee: 0.005 ether,
            mirrorFee: 0.003 ether,
            slashDelay: 48 hours,
            recoveryDelay: 72 hours,
            startup: ProviderConfig({requiredStake: 0.01 ether, dailyLimit: 50_000, penaltyPerStrike: 0.0005 ether}),
            growth: ProviderConfig({requiredStake: 0.1 ether, dailyLimit: 1_000_000, penaltyPerStrike: 0.0005 ether}),
            enterprise: ProviderConfig({requiredStake: 1.0 ether, dailyLimit: type(uint256).max, penaltyPerStrike: 0.0005 ether})
        });

        vm.startPrank(deployer);
        MAIVWRegistry logic = new MAIVWRegistry();
        bytes memory initData = abi.encodeCall(MAIVWRegistry.initialize, (cfg));
        ERC1967Proxy proxy = new ERC1967Proxy(address(logic), initData);
        registry = MAIVWRegistry(address(proxy));
        lens = new MAIVWRegistryLens();
        vm.stopPrank();
    }

    // =========================================================================
    // 1. Verificação de Invariantes Iniciais de Governança
    // =========================================================================

    function test_InitialGovernanceSetup() public view {
        assertEq(registry.owner(), safeGov, "Owner deve ser a Safe 2-de-3");
        assertEq(registry.guardian(), emergencyGuardian, "Guardian deve ser o guardiao de plantao");
        assertEq(registry.oracleNode(), oracleNode, "Oracle deve ser o no GCP KMS");
        assertEq(registry.treasury(), treasury, "Treasury deve ser a Safe de Tesouraria");
        assertFalse(registry.paused(), "Contrato deve iniciar despausado");
    }

    // =========================================================================
    // 2. Isolamento do Deployer (Zero Privilégio Residual)
    // =========================================================================

    function test_DeployerHasZeroAdministrativeRights() public {
        vm.startPrank(deployer);

        // Deployer não pode pausar nem despausar
        vm.expectRevert(MAIVWRegistry.OnlyGuardianOrOwnerAllowed.selector);
        registry.pause();

        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, deployer));
        registry.unpause();

        // Deployer não pode mudar taxas nem tesouraria
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, deployer));
        registry.setFees(0.002 ether, 0.01 ether);

        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, deployer));
        registry.setTreasury(payable(deployer));

        // Deployer não pode fazer upgrade UUPS
        MAIVWRegistryV2Mock mockV2 = new MAIVWRegistryV2Mock();
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, deployer));
        registry.upgradeToAndCall(address(mockV2), "");

        vm.stopPrank();
    }

    function test_AttackerCannotExecuteAnyGovernanceCall() public {
        vm.startPrank(attacker);

        vm.expectRevert(MAIVWRegistry.OnlyGuardianOrOwnerAllowed.selector);
        registry.pause();

        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, attacker));
        registry.setOracleNode(attacker);

        vm.stopPrank();
    }

    // =========================================================================
    // 3. Papel do Guardian (Pausa Imediata e Proteção contra Abusos)
    // =========================================================================

    function test_GuardianCanPauseImmediatelyInEmergency() public {
        vm.prank(emergencyGuardian);
        registry.pause();

        assertTrue(registry.paused(), "Contrato deve estar pausado pelo Guardian");

        // Durante pausa, ate mesmo chamadas administrativas do Owner sao bloqueadas pelo whenNotPaused
        vm.prank(safeGov);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        registry.registerGenesisDomain("pause-test.com", "https://pause-test.com", safeGov);
    }

    function test_GuardianCannotUnpause() public {
        // Guardian pausa
        vm.prank(emergencyGuardian);
        registry.pause();

        // Guardian tenta despausar (DEVE FALHAR - apenas Owner pode despausar)
        vm.prank(emergencyGuardian);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, emergencyGuardian));
        registry.unpause();

        assertTrue(registry.paused(), "Contrato deve continuar pausado apos tentativa do Guardian");
    }

    function test_GuardianCannotUpgradeContract() public {
        MAIVWRegistryV2Mock mockV2 = new MAIVWRegistryV2Mock();

        vm.prank(emergencyGuardian);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, emergencyGuardian));
        registry.upgradeToAndCall(address(mockV2), "");
    }

    function test_GuardianCanVetoAbusivePendingSlash() public {
        // Registra provedor via genesis
        vm.prank(safeGov);
        registry.registerGenesisProvider("provider-veto.com", "https://api.veto.com", providerKey, ProviderTier.STARTUP);

        // Oráculo propõe slash com contestação (janela de 48h)
        address[] memory reporters = new address[](1);
        reporters[0] = makeAddr("reporter1");

        vm.prank(oracleNode);
        registry.proposeSlash("provider-veto.com", reporters);

        assertFalse(registry.isDomainActive("provider-veto.com"), "Dominio nao deve estar ativo durante contestacao (congelado)");

        // Guardian examina o caso e detecta falso positivo: Veta a proposta de slash
        vm.prank(emergencyGuardian);
        registry.vetoSlash("provider-veto.com");

        assertTrue(registry.isDomainActive("provider-veto.com"), "Dominio deve voltar a ficar ativo apos veto do Guardian");
        CompanyProfile memory prof = registry.getCompanyProfile("provider-veto.com");
        assertEq(uint8(prof.status), uint8(DomainStatus.ACTIVE), "Provedor deve continuar com status ACTIVE");
    }

    // =========================================================================
    // 4. Papel da Safe Multi-sig (Owner 2-de-3)
    // =========================================================================

    function test_SafeCanUnpauseAfterIncidentInvestigation() public {
        vm.prank(emergencyGuardian);
        registry.pause();
        assertTrue(registry.paused());

        // Safe 2-de-3 despausa apos resolver incidente
        vm.prank(safeGov);
        registry.unpause();
        assertFalse(registry.paused(), "Safe deve despausar o protocolo com sucesso");
    }

    function test_SafeCanAdjustEconomicParameters() public {
        vm.prank(safeGov);
        registry.setFees(0.002 ether, 0.01 ether);

        assertEq(registry.standardFee(), 0.002 ether);
        assertEq(registry.providerFee(), 0.01 ether);
    }

    function test_SafeCanRotateGuardian() public {
        address newGuardian = makeAddr("new_guardian_hardware_key");

        vm.prank(safeGov);
        registry.setGuardian(newGuardian);

        assertEq(registry.guardian(), newGuardian);

        // Antigo guardião perde o poder de pausar
        vm.prank(emergencyGuardian);
        vm.expectRevert(MAIVWRegistry.OnlyGuardianOrOwnerAllowed.selector);
        registry.pause();

        // Novo guardião consegue pausar
        vm.prank(newGuardian);
        registry.pause();
        assertTrue(registry.paused());
    }

    function test_SafeCanUpgradeContractUUPS() public {
        MAIVWRegistryV2Mock mockV2 = new MAIVWRegistryV2Mock();

        vm.prank(safeGov);
        registry.upgradeToAndCall(address(mockV2), "");

        // Converte proxy para V2
        MAIVWRegistryV2Mock upgraded = MAIVWRegistryV2Mock(address(registry));
        assertEq(upgraded.version(), "2.1.0-safe-upgrade", "Upgrade UUPS executado pela Safe com sucesso");
        assertEq(upgraded.owner(), safeGov, "Owner deve ser preservado apos upgrade");
    }

    // =========================================================================
    // 5. Transferência de Governança em 2 Etapas (Ownable2Step)
    // =========================================================================

    function test_TwoStepOwnershipTransfer() public {
        address newSafeGov = makeAddr("new_safe_multisig_dao");

        // Etapa 1: Safe atual propõe transferência
        vm.prank(safeGov);
        registry.transferOwnership(newSafeGov);

        // Owner continua sendo o safeGov antigo
        assertEq(registry.owner(), safeGov, "Owner ainda nao deve ter mudado");
        assertEq(registry.pendingOwner(), newSafeGov, "PendingOwner deve ser a nova Safe");

        // Estranho tenta aceitar (DEVE REVERTER)
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, attacker));
        registry.acceptOwnership();

        // Etapa 2: Nova Safe aceita ownership
        vm.prank(newSafeGov);
        registry.acceptOwnership();

        assertEq(registry.owner(), newSafeGov, "Nova Safe agora eh a dona oficial do protocolo");
        assertEq(registry.pendingOwner(), address(0), "PendingOwner deve ser resetado");
    }
}
