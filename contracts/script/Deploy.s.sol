// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/MAIVWRegistry.sol";
import "../src/MAIVWRegistryLens.sol";
import "../src/MAIVWMirrorRegistryV2.sol";

/// @title DeployScript — Deploy do MAIVWRegistry v2 e MAIVWRegistryLens
contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        InitConfig memory cfg;

        if (block.chainid == 31337) {
            cfg = InitConfig({
                initialOwner: deployer,
                guardian: deployer,
                oracleNode: deployer,
                founderWallet: payable(deployer),
                treasury: payable(deployer),
                standardFee: 10 ether,
                providerFee: 1000 ether,
                mirrorFee: 0.003 ether,
                slashDelay: 0,
                recoveryDelay: 0,
                startup: ProviderConfig({requiredStake: 1 ether, dailyLimit: 50_000, penaltyPerStrike: 0.05 ether}),
                growth: ProviderConfig({requiredStake: 10 ether, dailyLimit: 1_000_000, penaltyPerStrike: 0.05 ether}),
                enterprise: ProviderConfig({requiredStake: 100 ether, dailyLimit: type(uint256).max, penaltyPerStrike: 0.05 ether})
            });
        } else if (block.chainid == 84532 || block.chainid == 421614 || block.chainid == 80002) {
            cfg = InitConfig({
                initialOwner: deployer,
                guardian: deployer,
                oracleNode: deployer,
                founderWallet: payable(deployer),
                treasury: payable(deployer),
                standardFee: 0.0001 ether,
                providerFee: 0.0005 ether,
                mirrorFee: 0.003 ether,
                slashDelay: 0,
                recoveryDelay: 0,
                startup: ProviderConfig({requiredStake: 0.001 ether, dailyLimit: 50_000, penaltyPerStrike: 0.00005 ether}),
                growth: ProviderConfig({requiredStake: 0.01 ether, dailyLimit: 1_000_000, penaltyPerStrike: 0.00005 ether}),
                enterprise: ProviderConfig({requiredStake: 0.1 ether, dailyLimit: type(uint256).max, penaltyPerStrike: 0.00005 ether})
            });
        } else {
            cfg = InitConfig({
                initialOwner: deployer,
                guardian: deployer,
                oracleNode: deployer,
                founderWallet: payable(deployer),
                treasury: payable(deployer),
                standardFee: 0.001 ether,
                providerFee: 0.005 ether,
                mirrorFee: 0.003 ether,
                slashDelay: 48 hours,
                recoveryDelay: 72 hours,
                startup: ProviderConfig({requiredStake: 0.01 ether, dailyLimit: 50_000, penaltyPerStrike: 0.0005 ether}),
                growth: ProviderConfig({requiredStake: 0.1 ether, dailyLimit: 1_000_000, penaltyPerStrike: 0.0005 ether}),
                enterprise: ProviderConfig({requiredStake: 1 ether, dailyLimit: type(uint256).max, penaltyPerStrike: 0.0005 ether})
            });
        }

        vm.startBroadcast(deployerKey);

        MAIVWRegistry impl = new MAIVWRegistry();
        bytes memory initData = abi.encodeCall(MAIVWRegistry.initialize, (cfg));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        MAIVWRegistry registry = MAIVWRegistry(address(proxy));
        MAIVWMirrorRegistryV2 mirrorImpl = new MAIVWMirrorRegistryV2();
        ERC1967Proxy mirrorProxy = new ERC1967Proxy(
            address(mirrorImpl),
            abi.encodeCall(
                MAIVWMirrorRegistryV2.initialize,
                (deployer, deployer, deployer, address(registry))
            )
        );
        MAIVWRegistryLens lens = new MAIVWRegistryLens();

        console.log("============================================");
        console.log("  Implementation (Logica):     ", address(impl));
        console.log("  PROXY (Endereco Oficial):    ", address(proxy));
        console.log("  MAIVWRegistryLens:           ", address(lens));
        console.log("  Mirror Registry V2 Proxy:    ", address(mirrorProxy));
        console.log("  Standard Fee (wei):          ", registry.standardFee());
        console.log("  Provider Fee (wei):          ", registry.providerFee());
        console.log("============================================");

        vm.stopBroadcast();
    }
}
