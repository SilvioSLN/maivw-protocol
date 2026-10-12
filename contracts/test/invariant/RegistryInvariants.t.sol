// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../helpers/BaseTest.sol";

/// @title RegistryInvariantsTest
/// @notice Testes de propriedades e invariantes com fuzzing contínuo
contract RegistryInvariantsTest is BaseTest {

    function setUp() public {
        setUpRegistry();
    }

    /// @notice I-1 Solvência estrita: todo passivo é coberto por ETH real em qualquer circunstância
    function testFuzz_InvariantSolvency(uint256 fee1, uint256 fee2) public {
        fee1 = bound(fee1, 10 ether, 1000 ether);
        fee2 = bound(fee2, 10 ether, 1000 ether);

        vm.deal(companyA, fee1);
        vm.deal(companyB, fee2);

        // Ações variadas de registro
        uint256 deadline = block.timestamp + 3600;
        bytes memory sigA = _signRegister(registry, "fuzz-a.com", companyA, companyA, companyA, false, 0, deadline);

        vm.prank(companyA);
        registry.registerCompany{value: 10 ether}(
            "fuzz-a.com",
            "https://inbox.com",
            companyA,
            companyA,
            false,
            deadline,
            sigA
        );

        // Invariante deve se manter estritamente:
        assertGe(address(registry).balance, registry.totalLiabilities());
        assertEq(address(registry).balance, registry.totalLiabilities());

        // Slash e saque parcial
        address[] memory reporters = new address[](1);
        reporters[0] = companyB;
        vm.prank(oracle);
        registry.slashDomain("fuzz-a.com", reporters);

        assertGe(address(registry).balance, registry.totalLiabilities());
        assertEq(address(registry).balance, registry.totalLiabilities());

        // Saque pull
        vm.prank(companyB);
        registry.withdrawPending();

        assertGe(address(registry).balance, registry.totalLiabilities());
        assertEq(address(registry).balance, registry.totalLiabilities());

        // Saque founder
        vm.prank(founder);
        registry.withdrawFounderFees();

        assertGe(address(registry).balance, registry.totalLiabilities());
        assertEq(address(registry).balance, registry.totalLiabilities());

        // Saque treasury
        uint256 tFees = registry.accumulatedTreasuryFees();
        vm.prank(owner);
        registry.withdrawTreasury(tFees);

        assertGe(address(registry).balance, registry.totalLiabilities());
        assertEq(address(registry).balance, registry.totalLiabilities());
    }

    /// @notice I-2 Invariante de Chaves: Domínio ACTIVE nunca possui publicKey zero
    function test_InvariantActiveDomainHasNonZeroKeys() public {
        _registerCompanyHelper(
            "key-check.com",
            "https://inbox.com",
            companyA,
            companyA,
            companyA,
            false,
            10 ether
        );

        CompanyProfile memory p = registry.getCompanyProfile("key-check.com");
        assertTrue(p.status == DomainStatus.ACTIVE);
        assertTrue(p.publicKey != address(0));
        assertTrue(p.adminKey != address(0));
    }
}
