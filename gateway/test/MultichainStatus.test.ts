import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { Hex } from "viem";
import { hashNetworkId } from "../src/multichain/AttestationCodec.js";
import { MultichainStatusService } from "../src/multichain/MultichainStatus.js";
import { defineEvmNetwork, defineSolanaNetwork } from "../src/multichain/NetworkModel.js";
import { catalogDomainHash, type OriginRecordRow } from "../src/multichain/OriginCatalog.js";
import { multiChainRoutes } from "../src/routes/multichain.js";
import type { LedgerAdapter, LedgerDomainIdentity } from "../src/services/ledger/LedgerAdapter.js";

const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const evm = defineEvmNetwork({
  chainId: 84532, name: "Base Sepolia", rpcUrl: "https://rpc.example.com",
  registryAddress: "0x1111111111111111111111111111111111111111",
  explorerUrl: "https://sepolia.basescan.org",
  asset: { kind: "NATIVE", symbol: "ETH", decimals: 18, address: null },
  finality: { confirmations: 12, reorgMarginBlocks: 32 },
  capabilities: { origin: true, mirror: true },
});
const solana = defineSolanaNetwork({
  genesisHash: "11111111111111111111111111111111", name: "Solana Test",
  rpcUrl: "https://api.testnet.solana.com", programId: "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9",
  explorerUrl: "https://explorer.solana.com", explorerClusterQuery: "cluster=testnet",
  asset: { kind: "NATIVE", symbol: "SOL", decimals: 9, mint: null },
  finality: { reorgMarginSlots: 64 }, capabilities: { origin: true, mirror: true },
});

function identity(adapter: typeof evm | typeof solana, kind: "ORIGIN" | "MIRROR", sequence: bigint): LedgerDomainIdentity {
  return {
    family: adapter.family, networkId: adapter.networkId, registryId: adapter.registryId,
    recordKind: kind, domain: "example.com", endpointUrl: "https://mail.example.com",
    operationalKey: { algorithm: adapter.family === "EVM" ? 1 : 2, keyData: bytes(3) },
    adminKey: { algorithm: adapter.family === "EVM" ? 1 : 2, keyData: bytes(4) },
    status: "ACTIVE", globalDomainEpoch: 1n, originSequence: sequence,
    originNetworkHash: hashNetworkId(evm.networkId), originRegistryId: evm.registryId,
  };
}

function adapter(network: typeof evm | typeof solana, value: LedgerDomainIdentity | Error | null): LedgerAdapter {
  return {
    network, family: network.family, networkId: network.networkId, registryId: network.registryId,
    async readDomainIdentity() {
      if (value instanceof Error) throw value;
      return value;
    },
    async readProviderState() { return null; },
    async checkHealth() {},
  };
}

function origin(): OriginRecordRow {
  const now = new Date("2026-10-16T00:00:00.000Z");
  return {
    id: "origin-1", domainHash: catalogDomainHash("example.com"), domain: "example.com",
    originNetworkFamily: "EVM", originNetworkId: evm.networkId,
    originNetworkHash: hashNetworkId(evm.networkId), originRegistryId: evm.registryId,
    originVersion: 1, status: "ACTIVE", originTxFamily: "EVM", originTxId: bytes(8),
    globalDomainEpoch: 1n, originSequence: 2n, activatedAt: now, lastReconciledAt: null,
    lastAuditHash: bytes(9), createdAt: now, updatedAt: now,
  };
}

test("status resolves the catalog origin and reads every real deployment", async () => {
  const service = new MultichainStatusService(
    { get: async () => origin() },
    { listAdapters: () => [adapter(evm, identity(evm, "ORIGIN", 2n)), adapter(solana, identity(solana, "MIRROR", 1n))] },
  );
  const result = await service.get(" Example.COM ");
  assert.equal(result.registered, true);
  assert.equal(result.origin?.networkId, evm.networkId);
  assert.equal(result.deployments.length, 2);
  assert.equal(result.deployments[0]?.role, "ORIGIN");
  assert.equal(result.deployments[0]?.projection, "IN_SYNC");
  assert.equal(result.deployments[1]?.role, "MIRROR");
  assert.equal(result.deployments[1]?.projection, "VERSION_BEHIND");
  assert.equal(result.deployments[1]?.identity?.originSequence, "1");
});

test("status isolates an unreadable destination and does not invent unconfigured networks", async () => {
  const failure = Object.assign(new Error("private provider detail"), { code: "SOLANA_RPC_UNAVAILABLE" });
  const service = new MultichainStatusService(
    { get: async () => origin() },
    { listAdapters: () => [adapter(evm, identity(evm, "ORIGIN", 2n)), adapter(solana, failure)] },
  );
  const result = await service.get("example.com");
  assert.equal(result.deployments.length, 2);
  assert.equal(result.deployments[1]?.projection, "UNREADABLE");
  assert.equal(result.deployments[1]?.errorCode, "SOLANA_RPC_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes("private provider detail"), false);
});

test("GET /multichain/status delegates to the catalog-backed status service", async () => {
  const expected = { domain: "example.com", domainHash: bytes(1), registered: false, origin: null, deployments: [] };
  const app = Fastify();
  await app.register(multiChainRoutes, {
    ledger: {} as any, oracle: {} as any, prisma: {} as any,
    multichainStatus: { get: async () => expected } as any,
  });
  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/multichain/status/example.com" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { success: true, ...expected });
  } finally {
    await app.close();
  }
});
