import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { Hex } from "viem";
import { hashNetworkId } from "../src/multichain/AttestationCodec.js";
import { MultichainMirrorJobCoordinator } from "../src/multichain/MultichainMirrorJobs.js";
import { defineEvmNetwork, defineSolanaNetwork, type NetworkDefinition } from "../src/multichain/NetworkModel.js";
import { catalogDomainHash, type OriginRecordRow } from "../src/multichain/OriginCatalog.js";
import { multiChainRoutes } from "../src/routes/multichain.js";
import type { LedgerAdapter } from "../src/services/ledger/LedgerAdapter.js";

const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const evm = defineEvmNetwork({
  chainId: 84532, name: "Base Sepolia", rpcUrl: "https://base.example",
  registryAddress: "0x1111111111111111111111111111111111111111", explorerUrl: "https://base.explorer",
  asset: { kind: "NATIVE", symbol: "ETH", decimals: 18, address: null },
  finality: { confirmations: 12, reorgMarginBlocks: 32 }, capabilities: { origin: true, mirror: true },
});
const solana = defineSolanaNetwork({
  genesisHash: "11111111111111111111111111111111", name: "Solana Test", rpcUrl: "https://sol.example",
  programId: "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9", explorerUrl: "https://sol.explorer",
  asset: { kind: "NATIVE", symbol: "SOL", decimals: 9, mint: null },
  finality: { reorgMarginSlots: 64 }, capabilities: { origin: true, mirror: true },
});

function record(network: NetworkDefinition): OriginRecordRow {
  const now = new Date("2026-10-16T00:00:00.000Z");
  return {
    id: "origin", domainHash: catalogDomainHash("example.com"), domain: "example.com",
    originNetworkFamily: network.family, originNetworkId: network.networkId,
    originNetworkHash: hashNetworkId(network.networkId), originRegistryId: network.registryId,
    originVersion: 1, status: "ACTIVE", originTxFamily: network.family, originTxId: bytes(9),
    globalDomainEpoch: 2n, originSequence: 7n, activatedAt: now, lastReconciledAt: null,
    lastAuditHash: bytes(8), createdAt: now, updatedAt: now,
  };
}

function adapter(network: NetworkDefinition, origin: OriginRecordRow): LedgerAdapter {
  return {
    network, family: network.family, networkId: network.networkId, registryId: network.registryId,
    async readDomainIdentity() {
      if (network.networkId !== origin.originNetworkId) return null;
      return {
        family: network.family, networkId: network.networkId, registryId: network.registryId,
        recordKind: "ORIGIN", domain: "example.com", endpointUrl: "https://mail.example.com",
        operationalKey: { algorithm: network.family === "EVM" ? 1 : 2, keyData: bytes(3) },
        adminKey: { algorithm: network.family === "EVM" ? 1 : 2, keyData: bytes(4) },
        status: "ACTIVE", globalDomainEpoch: 2n, originSequence: 7n,
        originNetworkHash: origin.originNetworkHash as Hex, originRegistryId: network.registryId,
      };
    },
    async readProviderState() { return null; }, async checkHealth() {},
  };
}

async function requestJob(originNetwork: NetworkDefinition, destinationNetwork: NetworkDefinition) {
  const origin = record(originNetwork);
  let detected: any;
  const coordinator = new MultichainMirrorJobCoordinator(
    { get: async () => origin },
    { listAdapters: () => [adapter(originNetwork, origin), adapter(destinationNetwork, origin)] },
    { detect: async (input) => {
      detected = input;
      return { job: { id: "job-1", status: "DETECTED", operation: input.operation }, created: true } as any;
    } },
  );
  const result = await coordinator.request({
    domain: "example.com", operation: "REGISTER", destinationNetworkIds: [destinationNetwork.networkId],
  });
  return { result, detected };
}

test("creates a durable Solana-origin job targeting EVM", async () => {
  const { result, detected } = await requestJob(solana, evm);
  assert.equal(result.origin.family, "SOLANA");
  assert.deepEqual(result.destinations.map((item) => item.family), ["EVM"]);
  assert.equal(detected.origin.networkId, solana.networkId);
  assert.equal(detected.destinations[0].networkId, evm.networkId);
});

test("creates a durable EVM-origin job targeting Solana", async () => {
  const { result, detected } = await requestJob(evm, solana);
  assert.equal(result.origin.family, "EVM");
  assert.deepEqual(result.destinations.map((item) => item.family), ["SOLANA"]);
  assert.equal(detected.destinations[0].registryId, solana.registryId);
});

test("fulfill-mirror requires the relayer key and enqueues through the same durable coordinator", async () => {
  const app = Fastify();
  let calls = 0;
  await app.register(multiChainRoutes, {
    ledger: {} as any, oracle: {} as any, prisma: {} as any, internalServiceKey: "internal-secret-key",
    mirrorJobs: { request: async () => {
      calls += 1;
      return { jobId: "job-1", created: true, status: "DETECTED" };
    } } as any,
  });
  try {
    assert.equal((await app.inject({
      method: "POST", url: "/api/v1/multichain/fulfill-mirror", payload: { domain: "example.com" },
    })).statusCode, 403);
    const response = await app.inject({
      method: "POST", url: "/api/v1/multichain/fulfill-mirror",
      headers: { "x-internal-service-key": "internal-secret-key" },
      payload: { domain: "example.com", destinationNetworkIds: [solana.networkId] },
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().job.jobId, "job-1");
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});
