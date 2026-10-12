// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MAIVWRegistry, InitConfig, ProviderConfig, ProviderTier, DomainStatus, CompanyProfile} from "../../src/MAIVWRegistry.sol";
import {MAIVWRegistryLens} from "../../src/MAIVWRegistryLens.sol";
import {OracleSigner} from "./OracleSigner.sol";

abstract contract BaseTest is Test, OracleSigner {
    MAIVWRegistry public registry;
    MAIVWRegistryLens public lens;

    address public owner = address(0xAA);
    address public guardian = address(0xBB);
    address public founder = address(0xCC);
    address public treasury = address(0xDD);

    address public companyA = address(0x1);
    address public companyB = address(0x2);
    address public providerC = address(0x3);

    receive() external payable {}

    function setUpRegistry() internal {
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

        MAIVWRegistry impl = new MAIVWRegistry();
        bytes memory initData = abi.encodeCall(MAIVWRegistry.initialize, (cfg));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = MAIVWRegistry(address(proxy));
        lens = new MAIVWRegistryLens();

        vm.deal(companyA, 1000 ether);
        vm.deal(companyB, 1000 ether);
        vm.deal(providerC, 5000 ether);
        vm.deal(owner, 100 ether);
    }

    function _registerCompanyHelper(
        string memory domain,
        string memory endpoint,
        address pubKey,
        address adminKey,
        address caller,
        bool isProvider,
        uint256 fee
    ) internal {
        uint256 deadline = block.timestamp + 3600;
        bytes memory sig = _signRegister(registry, domain, pubKey, adminKey, caller, isProvider, 0, deadline);

        vm.prank(caller);
        registry.registerCompany{value: fee}(
            domain,
            endpoint,
            pubKey,
            adminKey,
            isProvider,
            deadline,
            sig
        );
    }
}
