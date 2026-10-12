import type { FastifyInstance } from "fastify";

interface HealthOptions {
  checks: Record<"blockchain" | "redis" | "database", () => Promise<unknown>>;
  oracleBalance: () => Promise<bigint>;
  oracleMinBalance: bigint;
  metadata: () => Record<string, unknown>;
  timeoutMs?: number;
}

async function bounded<T>(check: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Health check timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function healthRoutes(app: FastifyInstance, options: HealthOptions) {
  // Liveness only: this does not assert that the node can deliver messages.
  app.get("/health/live", async () => ({ status: "alive", service: "maivw-gateway" }));

  app.get("/health", async (_request, reply) => {
    const timeout = options.timeoutMs ?? 2000;
    const [blockchain, redis, database, balance] = await Promise.allSettled([
      bounded(options.checks.blockchain, timeout),
      bounded(options.checks.redis, timeout),
      bounded(options.checks.database, timeout),
      bounded(options.oracleBalance, timeout),
    ]);
    const ready = [blockchain, redis, database].every((result) => result.status === "fulfilled");
    return reply.code(ready ? 200 : 503).send({
      ...options.metadata(),
      status: ready ? "ok" : "degraded",
      service: "maivw-gateway",
      timestamp: new Date().toISOString(),
      blockchain: blockchain.status === "fulfilled" ? "online" : "offline",
      redis: redis.status === "fulfilled" ? "online" : "offline",
      database: database.status === "fulfilled" ? "online" : "offline",
      oracleBalanceWei: balance.status === "fulfilled" ? balance.value.toString() : null,
      oracleBalanceLow: balance.status === "fulfilled" ? balance.value < options.oracleMinBalance : null,
    });
  });
}
