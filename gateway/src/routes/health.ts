import type { FastifyInstance } from "fastify";

interface HealthOptions {
  service?: string;
  role?: string;
  activeComponents?: readonly string[];
  checks: Record<string, () => Promise<unknown>>;
  oracleBalance?: () => Promise<bigint>;
  oracleMinBalance?: bigint;
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
  const service = options.service ?? "maivw-gateway";
  const role = options.role ?? "all-in-one";
  // Liveness only: this does not assert that the node can deliver messages.
  app.get("/health/live", async () => ({ status: "alive", service, role }));

  app.get("/health", async (_request, reply) => {
    const timeout = options.timeoutMs ?? 2000;
    const entries = Object.entries(options.checks);
    const results = await Promise.allSettled(entries.map(([, check]) => bounded(check, timeout)));
    const dependencies = Object.fromEntries(entries.map(([name], index) => [
      name, results[index].status === "fulfilled" ? "online" : "offline",
    ]));
    const ready = results.every((result) => result.status === "fulfilled");
    const balance = options.oracleBalance
      ? await Promise.allSettled([bounded(options.oracleBalance, timeout)]).then(([result]) => result)
      : undefined;
    return reply.code(ready ? 200 : 503).send({
      ...options.metadata(),
      status: ready ? "ok" : "degraded",
      service,
      role,
      activeComponents: options.activeComponents ?? [],
      timestamp: new Date().toISOString(),
      ...dependencies,
      dependencies,
      oracleBalanceWei: balance?.status === "fulfilled" ? balance.value.toString() : null,
      oracleBalanceLow: balance?.status === "fulfilled" && options.oracleMinBalance !== undefined
        ? balance.value < options.oracleMinBalance
        : null,
    });
  });
}
