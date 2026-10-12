// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../helpers/BaseTest.sol";

/// @dev Mock de implementação V3 para testar upgrades seguros
contract MAIVWRegistryV3Mock is MAIVWRegistry {
    function version() external pure returns (string memory) {
        return "v3.0.0-test";
    }

    function newFeature(string calldata _domain) external view returns (string memory) {
        require(this.isDomainActive(_domain), "Not registered");
        return string(abi.encodePacked("v3-feature-for-", _domain));
    }
}

/// @title UUPSUpgradeTest
/// @notice Valida autorização e preservação de estado durante upgrades UUPS (ERC-1967)
contract UUPSUpgradeTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    function test_upgradePreservesStateAndStorage() public {
        // 1. Registrar empresa na versão atual
        _registerCompanyHelper(
            "seguranca-upgrades.com",
            "https://mw.seguranca-upgrades.com/inbox",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        assertTrue(registry.isDomainActive("seguranca-upgrades.com"));
        assertEq(registry.totalStaked(), 6.5 ether);
        assertEq(registry.accumulatedFounderFees(), 1 ether);
        assertEq(registry.accumulatedTreasuryFees(), 2.5 ether);

        uint256 proxyBalanceBefore = address(registry).balance;

        // 2. Fazer deploy da nova implementação V3
        MAIVWRegistryV3Mock v3Impl = new MAIVWRegistryV3Mock();

        // 3. Executar o upgrade autenticado pelo Owner
        vm.prank(owner);
        registry.upgradeToAndCall(address(v3Impl), "");

        // 4. Instanciar interface pelo mock V3 no mesmo endereço do Proxy
        MAIVWRegistryV3Mock upgradedRegistry = MAIVWRegistryV3Mock(address(registry));

        // 5. Garantir que todo o estado prévio foi 100% preservado
        assertTrue(upgradedRegistry.isDomainActive("seguranca-upgrades.com"));
        assertEq(upgradedRegistry.totalStaked(), 6.5 ether);
        assertEq(upgradedRegistry.accumulatedFounderFees(), 1 ether);
        assertEq(upgradedRegistry.accumulatedTreasuryFees(), 2.5 ether);
        assertEq(address(upgradedRegistry).balance, proxyBalanceBefore);

        // 6. Testar novas funcionalidades da V3
        assertEq(upgradedRegistry.version(), "v3.0.0-test");
        assertEq(
            upgradedRegistry.newFeature("seguranca-upgrades.com"),
            "v3-feature-for-seguranca-upgrades.com"
        );
    }

    function test_upgradeUnauthorizedCallerReverts() public {
        MAIVWRegistryV3Mock v3Impl = new MAIVWRegistryV3Mock();

        // Usuário comum tenta forçar upgrade
        vm.prank(companyA);
        vm.expectRevert();
        registry.upgradeToAndCall(address(v3Impl), "");
    }
}
