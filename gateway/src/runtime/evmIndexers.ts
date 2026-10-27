import { createPublicClient, http } from "viem";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { REGISTRY_ABI } from "../config.js";
import type { LedgerService } from "../services/LedgerService.js";
import { EvmObserver, createEvmSourceEventDecoder, type EvmNetworkName } from "../multichain/EvmObserver.js";

/** Serial polling, with persistent cursors/reorg processing owned by EvmObserver. */
export function startEvmIndexers(config: EnvConfig, db: PrismaClient, ledger: LedgerService, onError: () => void) {
  const pollers: { stop(): void }[] = [];
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
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { if (await client.getChainId() !== network.chainId) throw new Error("Indexer chain mismatch"); await observer.poll(); }
      catch { onError(); }
      finally { if (!stopped) timer = setTimeout(poll, config.EVM_OBSERVER_POLL_INTERVAL_MS); }
    };
    void poll();
    pollers.push({ stop() { stopped = true; clearTimeout(timer); } });
  }
  return { count: pollers.length, stop() { for (const poller of pollers) poller.stop(); } };
}
