import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { healthRoutes } from "../src/routes/health.js";
import { EvmLedgerAdapter } from "../src/services/LedgerService.js";
import { RoutingPoolService } from "../src/services/RoutingPoolService.js";

test("health reports real dependency failures, recovery and unknown oracle balance", async () => {
  const app = Fastify();
  let failed: string | null = null;
  const probe = (name: string) => async () => {
    if (failed === name) throw new Error("unavailable");
  };
  await healthRoutes(app, {
    checks: { blockchain: probe("blockchain"), redis: probe("redis"), database: probe("database") },
    oracleBalance: async () => { throw new Error("RPC unavailable"); },
    oracleMinBalance: 10n,
    metadata: () => ({}),
  });
  try {
    for (const dependency of ["blockchain", "redis", "database"]) {
      failed = dependency;
      const response = await app.inject("/health");
      assert.equal(response.statusCode, 503);
      assert.equal(response.json()[dependency], "offline");
      assert.equal(response.json().status, "degraded");
      assert.equal(response.json().oracleBalanceLow, null);
      assert.equal((await app.inject("/health/live")).statusCode, 200);
    }
    failed = null;
    assert.equal((await app.inject("/health")).statusCode, 200);
  } finally { await app.close(); }
});

test("health probes do not convert contract failures or disconnected Redis to success", async () => {
  const ledger = Object.create(EvmLedgerAdapter.prototype) as EvmLedgerAdapter;
  Object.assign(ledger, {
    contractAddress: "0x1111111111111111111111111111111111111111",
    client: { readContract: async () => { throw new Error("RPC failed"); } },
  });
  await assert.rejects(ledger.checkBlockchainHealth(), /RPC failed/);
  Object.assign(ledger, { contractAddress: null });
  await assert.rejects(ledger.checkBlockchainHealth());

  const routing = Object.create(RoutingPoolService.prototype) as RoutingPoolService;
  Object.assign(routing, { redisPub: { status: "reconnecting", ping: async () => "PONG" } });
  await assert.rejects(routing.checkRedisHealth(), /not ready/);
  Object.assign(routing, { redisPub: { status: "ready", ping: async () => "PONG" } });
  await routing.checkRedisHealth();
});

test("health bounds stalled dependencies and reports a low oracle balance", async () => {
  const app = Fastify();
  await healthRoutes(app, {
    checks: { blockchain: () => new Promise(() => {}), redis: async () => {}, database: async () => {} },
    oracleBalance: async () => 1n,
    oracleMinBalance: 10n,
    timeoutMs: 10,
    metadata: () => ({}),
  });
  try {
    const response = await app.inject("/health");
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().blockchain, "offline");
    assert.equal(response.json().oracleBalanceWei, "1");
    assert.equal(response.json().oracleBalanceLow, true);
  } finally { await app.close(); }
});
