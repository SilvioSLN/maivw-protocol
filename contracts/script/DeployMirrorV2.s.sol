// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MAIVWMirrorRegistryV2} from "../src/MAIVWMirrorRegistryV2.sol";

/// @notice Adiciona o Registry de mirrors V2 a um deploy legado sem substituir o Registry canônico.
contract DeployMirrorV2Script is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address legacyRegistry = vm.envAddress("LEGACY_REGISTRY_ADDRESS");

        vm.startBroadcast(deployerKey);
        MAIVWMirrorRegistryV2 implementation = new MAIVWMirrorRegistryV2();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(
                MAIVWMirrorRegistryV2.initialize,
                (deployer, deployer, deployer, legacyRegistry)
            )
        );
        vm.stopBroadcast();

        console.log("Mirror Registry V2 Proxy:    ", address(proxy));
    }
}
