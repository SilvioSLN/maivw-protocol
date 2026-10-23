import type { FastifyInstance } from "fastify";

export interface HealthOptions {
  service?: string;
  role?: string;
  activeComponents?: readonly string[];
  checks: Record<string, () => Promise<unknown>>;
  oracleBalance?: () => Promise<bigint>;
  oracleMinBalance?: bigint;
  metadata: () => Record<string, unknown>;
  timeoutMs?: number;
  isShuttingDown?: () => boolean;
  getDiagnostics?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
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

  // Liveness probe:
  // Asserts only that the process event loop is responsive.
  // Must NEVER check remote RPCs, database or external services to prevent cascading restart storms.
  app.get("/health/live", async () => {
    const shuttingDown = options.isShuttingDown?.() ?? false;
    return shuttingDown
      ? { status: "alive", service, role, shuttingDown: true }
      : { status: "alive", service, role };
  });

  // Dedicated readiness probe:
  // Fails with 503 immediately during graceful shutdown/draining so orchestrators divert traffic.
  // Otherwise checks core dependency health for the active role.
  app.get("/health/ready", async (_request, reply) => {
    if (options.isShuttingDown?.()) {
      return reply.code(503).send({
        status: "shutting_down",
        ready: false,
        service,
        role,
        timestamp: new Date().toISOString(),
      });
    }

    const timeout = options.timeoutMs ?? 2000;
    const entries = Object.entries(options.checks);
    const results = await Promise.allSettled(entries.map(([, check]) => bounded(check, timeout)));
    const dependencies = Object.fromEntries(entries.map(([name], index) => [
      name, results[index].status === "fulfilled" ? "online" : "offline",
    ]));
    const ready = results.every((result) => result.status === "fulfilled");

    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      ready,
      service,
      role,
      activeComponents: options.activeComponents ?? [],
      timestamp: new Date().toISOString(),
      dependencies,
    });
  });

  // General readiness & health check (backward compatible path declared in runtime contract):
  // Fails with 503 during draining phase; otherwise returns component dependencies and oracle status.
  app.get("/health", async (_request, reply) => {
    if (options.isShuttingDown?.()) {
      return reply.code(503).send({
        ...options.metadata(),
        status: "shutting_down",
        ready: false,
        service,
        role,
        activeComponents: options.activeComponents ?? [],
        timestamp: new Date().toISOString(),
        dependencies: {},
      });
    }

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

  // Deep diagnostic endpoint:
  // Provides latency per check, queue depth/metrics, process telemetry and environment metadata.
  app.get("/health/diag", async (_request, reply) => {
    const timeout = options.timeoutMs ?? 2000;
    const entries = Object.entries(options.checks);
    const results = await Promise.allSettled(entries.map(async ([name, check]) => {
      const start = Date.now();
      try {
        await bounded(check, timeout);
        return { name, status: "online", latencyMs: Date.now() - start };
      } catch (err: any) {
        return { name, status: "offline", latencyMs: Date.now() - start, error: err?.message || "check failed" };
      }
    }));

    const dependencies = Object.fromEntries(
      results.map((r, i) => [
        entries[i][0],
        r.status === "fulfilled" ? r.value : { name: entries[i][0], status: "offline", error: "unhandled error" },
      ]),
    );

    const allOk = results.every((r) => r.status === "fulfilled" && r.value.status === "online");
    const extraDiag = options.getDiagnostics ? await options.getDiagnostics() : {};

    return reply.code(allOk ? 200 : 503).send({
      status: allOk ? "ok" : "degraded",
      service,
      role,
      shuttingDown: options.isShuttingDown?.() ?? false,
      activeComponents: options.activeComponents ?? [],
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryBytes: process.memoryUsage(),
        nodeVersion: process.version,
        pid: process.pid,
      },
      dependencies,
      diagnostics: extraDiag,
      metadata: options.metadata(),
      timestamp: new Date().toISOString(),
    });
  });
}
