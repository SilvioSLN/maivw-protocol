import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { multiChainRoutes } from "../src/routes/multichain.js";

test("GET /multichain/networks returns the live adapter catalog without authentication", async () => {
  const catalog = [{
    family: "SOLANA",
    networkId: "solana:genesis",
    registryId: "0x01",
    registryVersion: 2,
    name: "Solana Test",
    capabilities: { origin: true, mirror: true },
    asset: { family: "SOLANA", kind: "NATIVE", symbol: "SOL", decimals: 9, mint: null },
    finality: { family: "SOLANA", mode: "COMMITMENT", commitment: "finalized", reorgMarginSlots: 64 },
    explorer: { family: "SOLANA", baseUrl: "https://explorer.solana.com" },
    state: { status: "AVAILABLE", checkedAt: "2026-10-16T00:00:00.000Z", errorCode: null },
  }];
  let calls = 0;
  const ledger = {
    async getMultichainNetworks() {
      calls += 1;
      return catalog;
    },
  } as any;
  const app = Fastify();
  await app.register(multiChainRoutes, { ledger, oracle: {} as any, prisma: {} as any });

  try {
    const response = await app.inject({ method: "GET", url: "/api/v1/multichain/networks" });
    assert.equal(response.statusCode, 200);
    assert.equal(calls, 1);
    assert.deepEqual(response.json(), { success: true, networks: catalog });
  } finally {
    await app.close();
  }
});
