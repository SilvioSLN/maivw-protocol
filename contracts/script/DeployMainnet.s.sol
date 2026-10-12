// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/MAIVWRegistry.sol";
import "../src/MAIVWRegistryLens.sol";

/// @title DeployMainnetScript — Script de Deploy Canônico para Base Sepolia e Base Mainnet
/// @notice Configura a governança nativa da Safe Multi-sig (2-de-3) como Owner e Guardian dedicado desde o Bloco 0
contract DeployMainnetScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address safeGov = vm.envAddress("SAFE_GOVERNANCE_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address oracleNode = vm.envAddress("ORACLE_NODE_ADDRESS");
        address payable treasury = payable(vm.envAddress("SAFE_TREASURY_ADDRESS"));
        address payable founderWallet = payable(vm.envAddress("FOUNDER_WALLET_ADDRESS"));

        // ============================================
        //  Validações Rígidas de Segurança Pré-Deploy
        // ============================================
        require(safeGov != address(0), "DEPLOY: SAFE_GOVERNANCE_ADDRESS nao pode ser zero");
        require(guardian != address(0), "DEPLOY: GUARDIAN_ADDRESS nao pode ser zero");
        require(oracleNode != address(0), "DEPLOY: ORACLE_NODE_ADDRESS nao pode ser zero");
        require(treasury != address(0), "DEPLOY: SAFE_TREASURY_ADDRESS nao pode ser zero");
        require(founderWallet != address(0), "DEPLOY: FOUNDER_WALLET_ADDRESS nao pode ser zero");

        // Separação estrita de papéis: Owner (2-de-3) e Guardian (1-de-3 / plantão de emergência)
        require(
            safeGov != guardian,
            "DEPLOY: SAFE_GOVERNANCE_ADDRESS e GUARDIAN_ADDRESS devem ser enderecos distintos para separacao de papeis"
        );

        // Previne deploy inadvertido em rede local Anvil via script de Mainnet
        if (block.chainid == 31337) {
            console.log("AVISO: Executando DeployMainnetScript em chainid 31337 (Anvil). Use Deploy.s.sol para dev local.");
        }

        console.log("====================================================");
        console.log("  PROTOCOLO MAIVW - DEPLOY DE PRODUCAO / TESTNET");
        console.log("====================================================");
        console.log("  Chain ID:                    ", block.chainid);
        console.log("  Deployer EOA (Gas payer):    ", deployer);
        console.log("  Safe Governance (Owner 2/3): ", safeGov);
        console.log("  Emergency Guardian (1/3):    ", guardian);
        console.log("  Oracle Node (Cloud HSM):     ", oracleNode);
        console.log("  Protocol Treasury (Safe):    ", treasury);
        console.log("  Founder Wallet:              ", founderWallet);
        console.log("====================================================");

        // ============================================
        //  Parâmetros Econômicos Canônicos de Mainnet
        // ============================================
        InitConfig memory cfg = InitConfig({
            initialOwner: safeGov,           // Safe Multi-sig 2-de-3 é o Owner desde o bloco 0
            guardian: guardian,              // Safe 1-de-3 ou Guardião de plantão para pausa imediata
            oracleNode: oracleNode,          // Chave do Nó Oráculo no Google Cloud KMS
            founderWallet: founderWallet,    // Carteira de recebimento de taxas do fundador (10%)
            treasury: treasury,              // Tesouraria do protocolo governada pela Safe (25%)
            standardFee: 0.001 ether,        // Taxa de registro de empresa padrão (~$2.50 - $3.00)
            providerFee: 0.005 ether,        // Taxa de registro de provedor compartilhado
            mirrorFee: 0.003 ether,          // Taxa de espelhamento multi-chain
            slashDelay: 48 hours,            // Janela de contestação/veto de slashes
            recoveryDelay: 72 hours,         // Janela de recuperação administrativa de chave
            startup: ProviderConfig({
                requiredStake: 0.01 ether,
                dailyLimit: 50_000,
                penaltyPerStrike: 0.0005 ether
            }),
            growth: ProviderConfig({
                requiredStake: 0.1 ether,
                dailyLimit: 1_000_000,
                penaltyPerStrike: 0.0005 ether
            }),
            enterprise: ProviderConfig({
                requiredStake: 1.0 ether,
                dailyLimit: type(uint256).max,
                penaltyPerStrike: 0.0005 ether
            })
        });

        vm.startBroadcast(deployerKey);

        // 1. Deploy da Implementação da Lógica do MAIVWRegistry
        MAIVWRegistry logic = new MAIVWRegistry();

        // 2. Codificação da inicialização com configuração de governança
        bytes memory initData = abi.encodeCall(MAIVWRegistry.initialize, (cfg));

        // 3. Deploy do Proxy ERC-1967 (UUPS) apontando para a lógica
        ERC1967Proxy proxy = new ERC1967Proxy(address(logic), initData);
        MAIVWRegistry registry = MAIVWRegistry(address(proxy));

        // 4. Deploy do Lens de Consulta Otimizada (View-only)
        MAIVWRegistryLens lens = new MAIVWRegistryLens();

        vm.stopBroadcast();

        // ============================================
        //  Asserções Pós-Deploy On-Chain
        // ============================================
        require(registry.owner() == safeGov, "ERRO CRITICO: Owner do proxy nao bate com safeGov");
        require(registry.guardian() == guardian, "ERRO CRITICO: Guardian do proxy nao bate com guardian");
        require(registry.oracleNode() == oracleNode, "ERRO CRITICO: OracleNode do proxy nao bate com oracleNode");
        require(registry.treasury() == treasury, "ERRO CRITICO: Treasury do proxy nao bate com treasury");

        console.log("====================================================");
        console.log("  SUCESSO: CONTRATOS IMPLANTADOS COM GOVERNANCA SAFE");
        console.log("====================================================");
        console.log("  Proxy Oficial (Registro):    ", address(proxy));
        console.log("  Logica da Implementacao:     ", address(logic));
        console.log("  MAIVWRegistryLens:           ", address(lens));
        console.log("  Owner Verificado:            ", registry.owner());
        console.log("  Guardian Verificado:         ", registry.guardian());
        console.log("====================================================");
    }
}
