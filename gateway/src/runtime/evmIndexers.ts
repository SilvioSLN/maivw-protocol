import { createPublicClient, http } from "viem";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { REGISTRY_ABI } from "../config.js";
import type { LedgerService } from "../services/LedgerService.js";
import { EvmObserver, createEvmSourceEventDecoder, type EvmNetworkName } from "../multichain/EvmObserver.js";
import { startSerialPoller, type SerialPoller } from "./serialPoller.js";

/** Serial polling, with persistent cursors/reorg processing owned by EvmObserver. */
export function startEvmIndexers(config: EnvConfig, db: PrismaClient, ledger: LedgerService, onError: () => void) {
  const pollers: SerialPoller[] = [];
  for (const adapter of ledger.listAdapters()) {
    const network = adapter.network;
    if (network.family !== "EVM") continue;
    const name: EvmNetworkName | undefined = [8453, 84532].includes(network.chainId) ? "BASE" : [42161, 421614].includes(network.chainId) ? "ARBITRUM" : [137, 80002].includes(network.chainId) ? "POLYGON" : undefined;
    // Community Anvil keeps its existing listener; no unsupported-network substitution.
    if (!name) continue;
    const client = createPublicClient({ transport: http(network.rpcUrl) });
    const observer = new EvmObserver(db as any, client as any, createEvmSourceEventDecoder(REGISTRY_ABI), {
      networkName: name, networkId: network.networkId, chainId: BigInt(network.chainId), registryAddress: network.registryAddress,
      registryId: network.registryId, confirmations: network.finality.confirmations, startBlock: config.EVM_OBSERVER_START_BLOCK, maxBlocksPerPoll: config.EVM_OBSERVER_MAX_BLOCKS,
    });
    pollers.push(startSerialPoller(async () => {
      if (await client.getChainId() !== network.chainId) throw new Error("Indexer chain mismatch");
      await observer.poll();
    }, config.EVM_OBSERVER_POLL_INTERVAL_MS, onError));
  }
  return { count: pollers.length, async stop() { await Promise.all(pollers.map(poller => poller.stop())); } };
}
