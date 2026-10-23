import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { healthRoutes } from "../src/routes/health.js";
import { GracefulShutdownManager } from "../src/runtime/shutdown.js";
import { createJobQueue, resetQueueFactory } from "../src/queue/index.js";

test("liveness endpoint (/health/live) never calls external dependencies and prevents restart storms", async () => {
  const app = Fastify();
  let externalCalls = 0;
  const failingExternalProbe = async () => {
    externalCalls++;
    throw new Error("RPC provider outage / network timeout");
  };

  await healthRoutes(app, {
    service: "maivw-gateway",
    role: "gateway-api",
    activeComponents: ["gateway-api"],
    checks: {
      blockchain: failingExternalProbe,
      database: failingExternalProbe,
    },
    metadata: () => ({ contractAddress: "0x123" }),
  });

  try {
    // 1. Liveness must return 200 OK without touching external dependencies
    const liveResponse = await app.inject("/health/live");
    assert.equal(liveResponse.statusCode, 200);
    assert.deepEqual(liveResponse.json(), {
      status: "alive",
      service: "maivw-gateway",
      role: "gateway-api",
    });
    assert.equal(externalCalls, 0, "Liveness probe must NEVER invoke external checks");

    // 2. Readiness (/health and /health/ready) reports degradation and failure (503)
    const readyResponse = await app.inject("/health/ready");
    assert.equal(readyResponse.statusCode, 503);
    assert.equal(readyResponse.json().status, "not_ready");
    assert.equal(readyResponse.json().ready, false);
    assert.equal(readyResponse.json().dependencies.blockchain, "offline");

    const generalHealth = await app.inject("/health");
    assert.equal(generalHealth.statusCode, 503);
    assert.equal(generalHealth.json().status, "degraded");

    // 3. Repeated liveness calls remain 200 and zero additional external calls (no restart storm)
    for (let i = 0; i < 5; i++) {
      const resp = await app.inject("/health/live");
      assert.equal(resp.statusCode, 200);
    }
    assert.equal(externalCalls, 4, "Liveness calls must never invoke external probes (2 probes x 2 readiness checks = 4)");
  } finally {
    await app.close();
  }
});

test("readiness endpoints return 503 immediately during draining phase to divert ingress traffic", async () => {
  const app = Fastify();
  let isDraining = false;

  await healthRoutes(app, {
    service: "maivw-gateway",
    role: "p2p-ingress",
    activeComponents: ["p2p-ingress"],
    checks: {
      database: async () => true,
    },
    isShuttingDown: () => isDraining,
    metadata: () => ({}),
  });

  try {
    // Before shutdown: ready
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
    assert.equal((await app.inject("/health")).statusCode, 200);
    assert.equal((await app.inject("/health/live")).statusCode, 200);

    // Shutdown initiates: enter draining
    isDraining = true;

    // Liveness remains 200 to prevent orchestrator SIGKILL before drain completes
    const live = await app.inject("/health/live");
    assert.equal(live.statusCode, 200);
    assert.equal(live.json().shuttingDown, true);

    // Dedicated readiness returns 503 so load balancer stops sending requests
    const ready = await app.inject("/health/ready");
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.json().status, "shutting_down");
    assert.equal(ready.json().ready, false);

    // General health endpoint also returns 503
    const health = await app.inject("/health");
    assert.equal(health.statusCode, 503);
    assert.equal(health.json().status, "shutting_down");
    assert.equal(health.json().ready, false);
  } finally {
    await app.close();
  }
});

test("diagnostics endpoint (/health/diag) returns deep telemetry, memory, uptime and dependency latencies", async () => {
  const app = Fastify();

  await healthRoutes(app, {
    service: "maivw-gateway",
    role: "all-in-one",
    activeComponents: ["gateway-api", "routing-health"],
    checks: {
      database: async () => new Promise((r) => setTimeout(r, 10)),
      redis: async () => true,
    },
    oracleBalance: async () => 5000000000000000000n,
    oracleMinBalance: 1000000000000000000n,
    metadata: () => ({
      contractAddress: "0xMockContract1234567890",
    }),
    getDiagnostics: async () => ({
      queueDepth: 42,
      activeWorkers: 3,
    }),
  });

  try {
    const response = await app.inject("/health/diag");
    assert.equal(response.statusCode, 200);
    const body = response.json();

    assert.equal(body.status, "ok");
    assert.equal(body.service, "maivw-gateway");
    assert.equal(body.role, "all-in-one");
    assert.equal(body.shuttingDown, false);
    assert.ok(Array.isArray(body.activeComponents));
    assert.ok(typeof body.process.uptimeSeconds === "number");
    assert.ok(typeof body.process.memoryBytes.heapUsed === "number");
    assert.equal(body.dependencies.database.status, "online");
    assert.ok(typeof body.dependencies.database.latencyMs === "number");
    assert.equal(body.dependencies.redis.status, "online");
    assert.equal(body.diagnostics.queueDepth, 42);
    assert.equal(body.metadata.contractAddress, "0xMockContract1234567890");
  } finally {
    await app.close();
  }
});

test("GracefulShutdownManager drains HTTP requests and in-flight queue jobs without loss", async () => {
  await resetQueueFactory();
  const app = Fastify();

  let httpFinished = false;
  app.get("/slow-work", async () => {
    await new Promise((r) => setTimeout(r, 150));
    httpFinished = true;
    return { ok: true };
  });

  // Create queue with one job taking time to process
  const testQueue = createJobQueue("mail:send", { driver: "memory" });
  let jobProcessed = false;
  testQueue.process(async (job) => {
    await new Promise((r) => setTimeout(r, 120));
    jobProcessed = true;
    return { status: "sent" };
  });

  await testQueue.enqueue({ data: { recipient: "user@example.com" } });

  let loopsStopped = false;
  let dbDisconnected = false;

  const shutdownManager = new GracefulShutdownManager({
    app,
    pauseQueues: async () => {
      await testQueue.pause();
    },
    drainJobs: async (timeoutMs) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const metrics = await testQueue.getMetrics();
        if (metrics.active === 0 && metrics.completed > 0) return { drained: true, remainingActive: 0 };
        await new Promise((r) => setTimeout(r, 20));
      }
      return { drained: false, remainingActive: 1 };
    },
    closeQueues: async () => {
      await testQueue.close();
    },
    stopLoops: () => {
      loopsStopped = true;
    },
    disconnectPrisma: async () => {
      dbDisconnected = true;
    },
  }, {
    timeoutMs: 5000,
    jobDrainTimeoutMs: 3000,
  });

  let requestStarted = false;
  app.addHook("onRequest", async () => {
    requestStarted = true;
  });

  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  // Start in-flight HTTP request
  const httpPromise = fetch(`${address}/slow-work`, {
    headers: { connection: "close" },
  });
  while (!requestStarted) {
    await new Promise((r) => setTimeout(r, 10));
  }

  // Initiate graceful shutdown
  assert.equal(shutdownManager.isShuttingDown(), false);
  const shutdownPromise = shutdownManager.initiateShutdown("SIGTERM");
  assert.equal(shutdownManager.isShuttingDown(), true);

  // Both the HTTP request and in-flight job must finish cleanly
  const httpResponse = await httpPromise;
  assert.equal(httpResponse.status, 200);
  assert.equal(httpFinished, true, "In-flight HTTP request must complete before shutdown ends");

  await shutdownPromise;
  assert.equal(jobProcessed, true, "In-flight queue job must be processed to completion");
  assert.equal(loopsStopped, true, "Background loops must be stopped");
  assert.equal(dbDisconnected, true, "Database connection must be closed");
  assert.equal(shutdownManager.getStatus(), "stopped");

  // Idempotency: initiating shutdown again returns immediately without error
  await shutdownManager.initiateShutdown("SIGTERM");
  assert.equal(shutdownManager.getStatus(), "stopped");

  await resetQueueFactory();
});

test("GracefulShutdownManager binds signals idempotently", () => {
  const manager = new GracefulShutdownManager();
  manager.bindSignals(["SIGTERM", "SIGINT"]);
  assert.deepEqual(manager.getRegisteredSignals(), ["SIGTERM", "SIGINT"]);

  // Duplicate bind does not add duplicates
  manager.bindSignals(["SIGTERM"]);
  assert.deepEqual(manager.getRegisteredSignals(), ["SIGTERM", "SIGINT"]);
});
