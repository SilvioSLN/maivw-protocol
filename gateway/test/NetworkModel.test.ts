import assert from "node:assert/strict";
import test from "node:test";
import {
  NetworkCatalog,
  NetworkModelError,
  defineEvmNetwork,
  defineSolanaNetwork,
  evmRegistryId,
  explorerReferenceUrl,
  solanaRegistryId,
} from "../src/multichain/NetworkModel.js";

const EVM_REGISTRY = "0x1111111111111111111111111111111111111111" as const;
const SOLANA_KEY = "11111111111111111111111111111111";
const SOLANA_PROGRAM = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";

test("defines EVM network with canonical typed identifiers, asset and finality", () => {
  const network = defineEvmNetwork({
    chainId: 84532, name: "Base Sepolia", rpcUrl: "https://sepolia.base.org",
    registryAddress: EVM_REGISTRY, explorerUrl: "https://sepolia.basescan.org/",
    asset: { kind: "NATIVE", symbol: "eth", decimals: 18, address: null },
    finality: { confirmations: 12, reorgMarginBlocks: 32 },
    capabilities: { origin: true, mirror: true },
  });
  assert.equal(network.networkId, "evm:84532");
  assert.equal(network.registryId, evmRegistryId(EVM_REGISTRY));
  assert.equal(network.asset.family, "EVM");
  assert.equal(network.finality.mode, "CONFIRMATIONS");
  assert.equal(explorerReferenceUrl(network, "transaction", "0xabc"), "https://sepolia.basescan.org/tx/0xabc");
});

test("defines Solana network without pretending it has an EVM chain id", () => {
  const network = defineSolanaNetwork({
    genesisHash: SOLANA_KEY, name: "Solana Local", rpcUrl: "http://localhost:8899",
    programId: SOLANA_PROGRAM, explorerUrl: "https://explorer.solana.com",
    explorerClusterQuery: "cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899",
    asset: { kind: "NATIVE", symbol: "SOL", decimals: 9, mint: null },
    finality: { reorgMarginSlots: 64 }, capabilities: { origin: true, mirror: true },
  });
  assert.equal(network.networkId, `solana:${SOLANA_KEY}`);
  assert.equal(network.registryId, solanaRegistryId(SOLANA_PROGRAM));
  assert.equal(network.asset.family, "SOLANA");
  assert.equal(network.finality.commitment, "finalized");
  assert.equal("chainId" in network, false);
});

test("catalog rejects ambiguity and resolves only exact network or registry ids", () => {
  const evm = defineEvmNetwork({
    chainId: 84532, name: "Base Sepolia", rpcUrl: "https://sepolia.base.org",
    registryAddress: EVM_REGISTRY, explorerUrl: "https://sepolia.basescan.org",
    asset: { kind: "NATIVE", symbol: "ETH", decimals: 18, address: null },
    finality: { confirmations: 12, reorgMarginBlocks: 32 }, capabilities: { origin: true, mirror: true },
  });
  const catalog = new NetworkCatalog([evm]);
  assert.equal(catalog.require("evm:84532"), evm);
  assert.equal(catalog.getByRegistry(evm.registryId), evm);
  assert.equal(catalog.get("84532"), null);
  assert.throws(() => new NetworkCatalog([evm, evm]), { code: "NETWORK_CONFLICT" });
  assert.throws(() => catalog.require("solana:missing"), { code: "NETWORK_NOT_FOUND" });
});

test("rejects family-specific malformed ids, registry values and finality", () => {
  assert.throws(() => defineEvmNetwork({
    chainId: 0, name: "bad", rpcUrl: "https://rpc.example.com", registryAddress: EVM_REGISTRY,
    explorerUrl: "https://explorer.example.com",
    asset: { kind: "NATIVE", symbol: "ETH", decimals: 18, address: null },
    finality: { confirmations: 0, reorgMarginBlocks: 0 }, capabilities: { origin: true, mirror: true },
  }), (error: unknown) => error instanceof NetworkModelError && error.code === "INVALID_NETWORK");
  assert.throws(() => defineSolanaNetwork({
    genesisHash: "not-base58-0", name: "bad", rpcUrl: "https://rpc.example.com",
    programId: SOLANA_PROGRAM, explorerUrl: "https://explorer.solana.com",
    asset: { kind: "NATIVE", symbol: "SOL", decimals: 9, mint: null },
    finality: { reorgMarginSlots: 0 }, capabilities: { origin: true, mirror: true },
  }), { code: "INVALID_NETWORK" });
});
