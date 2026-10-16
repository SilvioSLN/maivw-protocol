import type { EnvConfig } from "../../config.js";
import { defineSolanaNetwork } from "../../multichain/NetworkModel.js";
import { EvmLedgerAdapter } from "../LedgerService.js";
import type { LedgerAdapter } from "./LedgerAdapter.js";
import { SolanaLedgerAdapter } from "./SolanaLedgerAdapter.js";

/** Builds only deployments explicitly enabled by validated configuration. */
export function createConfiguredLedgerAdapters(config: EnvConfig): LedgerAdapter[] {
  const adapters: LedgerAdapter[] = [];
  const evmDeployments = [
    { chainId: 84532, rpcUrl: config.BASE_RPC_URL, registry: config.BASE_REGISTRY_ADDRESS },
    { chainId: 421614, rpcUrl: config.ARBITRUM_RPC_URL, registry: config.ARBITRUM_REGISTRY_ADDRESS },
    { chainId: 80002, rpcUrl: config.POLYGON_RPC_URL, registry: config.POLYGON_REGISTRY_ADDRESS },
  ];
  for (const deployment of evmDeployments) {
    if (!deployment.registry || deployment.chainId === config.CHAIN_ID) continue;
    adapters.push(new EvmLedgerAdapter({
      ...config,
      CHAIN_ID: deployment.chainId,
      RPC_URL: deployment.rpcUrl,
      REGISTRY_CONTRACT_ADDRESS: deployment.registry,
      BASE_REGISTRY_ADDRESS: deployment.registry,
      MIRROR_REGISTRY_V2_ADDRESS: deployment.registry,
    }));
  }
  if (config.SOLANA_ENABLED) {
    const asset = config.SOLANA_ASSET_KIND === "NATIVE"
      ? { kind: "NATIVE" as const, symbol: "SOL" as const, decimals: 9 as const, mint: null }
      : {
          kind: "SPL" as const,
          symbol: config.SOLANA_ASSET_SYMBOL,
          decimals: config.SOLANA_ASSET_DECIMALS,
          mint: config.SOLANA_ASSET_MINT!,
        };
    const network = defineSolanaNetwork({
      genesisHash: config.SOLANA_GENESIS_HASH!,
      name: "Solana",
      rpcUrl: config.SOLANA_RPC_URL!,
      programId: config.SOLANA_PROGRAM_ID!,
      explorerUrl: config.SOLANA_EXPLORER_URL,
      explorerClusterQuery: config.SOLANA_EXPLORER_CLUSTER_QUERY,
      asset,
      finality: { reorgMarginSlots: config.SOLANA_REORG_MARGIN_SLOTS },
      capabilities: { origin: config.SOLANA_ASSET_KIND === "SPL", mirror: true },
    });
    adapters.push(new SolanaLedgerAdapter(network));
  }
  return adapters;
}
