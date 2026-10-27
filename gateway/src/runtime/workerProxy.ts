import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

export type WorkerAccess = "send" | "dispute" | "proof" | "operator";
export const WORKER_PROXY_ROUTES = [
  { method: "POST", path: "/api/v1/send", target: "mail", access: "send" },
  { method: "POST", path: "/api/v1/dispute", target: "oracle", access: "dispute" },
  { method: "POST", path: "/api/v1/report-spam", target: "oracle", access: "dispute" },
  { method: "POST", path: "/api/v1/oracle/reclaim-proof", target: "oracle", access: "proof" },
  { method: "GET", path: "/api/v1/oracle/status", target: "oracle", access: "operator" },
  { method: "GET", path: "/api/v1/oracle/reports", target: "oracle", access: "operator" },
  { method: "GET", path: "/api/v1/oracle/reports/:id", target: "oracle", access: "operator" },
  { method: "POST", path: "/api/v1/oracle/reports/:id/human-action", target: "oracle", access: "operator" },
] as const;

interface WorkerProxyOptions {
  mailUrl?: string;
  oracleUrl?: string;
  internalServiceKey: string;
  timeoutMs?: number;
  bodyLimit?: number;
  authorize?: (request: FastifyRequest, access: WorkerAccess) => Promise<boolean>;
  transport?: typeof fetch;
}

export function workerOrigin(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Worker URL must be an HTTP(S) origin without credentials, query or path");
  }
  return url.origin;
}

/** Used only by separated worker runtimes, never by Community all-in-one. */
export function requireWorkerServiceKey(app: FastifyInstance, key: string) {
  app.addHook("onRequest", async (request, reply) => {
    if (["/health", "/health/live", "/health/ready"].includes(request.url.split("?")[0])) return;
    const supplied = request.headers["x-internal-service-key"];
    const a = Buffer.from(typeof supplied === "string" ? supplied : "");
    const b = Buffer.from(key);
    if (!b.length || a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(403).send({ error: "Internal worker authentication required" });
    }
  });
}

export async function registerWorkerProxyRoutes(app: FastifyInstance, options: WorkerProxyOptions) {
  const origins = {
    mail: options.mailUrl ? workerOrigin(options.mailUrl) : undefined,
    oracle: options.oracleUrl ? workerOrigin(options.oracleUrl) : undefined,
  };
  if (Object.values(origins).some(Boolean) && options.internalServiceKey.length < 16) throw new Error("Worker service key is required");
  const transport = options.transport ?? fetch;
  const limit = options.bodyLimit ?? 1_048_576;
  for (const route of WORKER_PROXY_ROUTES) {
    app.route({ method: route.method, url: route.path, bodyLimit: limit, handler: async (request, reply) => {
      const origin = origins[route.target];
      if (!origin) return reply.code(503).send({ error: "Worker is not configured" });
      if (route.access === "send" && !request.headers.authorization?.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Credencial de envio obrigatória" });
      }
      if ((route.access === "operator" || route.access === "proof") && (!options.authorize || !await options.authorize(request, route.access))) {
        return reply.code(403).send({ error: "Operation is not authorized" });
      }
      const id = (request.params as { id?: string }).id;
      if (id !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) return reply.code(400).send({ error: "Invalid report ID" });
      const path = id === undefined ? route.path : route.path.replace(":id", encodeURIComponent(id));
      const target = new URL(path, origin);
      target.search = new URL(request.url, "http://request.invalid").search;
      const headers: Record<string, string> = { "x-internal-service-key": options.internalServiceKey, "content-type": "application/json" };
      for (const name of ["authorization", "accept", "idempotency-key"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      try {
        const upstream = await transport(target, {
          method: route.method, headers, redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
          ...(route.method === "POST" ? { body: JSON.stringify(request.body ?? {}) } : {}),
        });
        if (upstream.status >= 300 && upstream.status < 400) {
          await upstream.body?.cancel();
          return reply.code(502).send({ error: "Worker redirect refused" });
        }
        const chunks: Uint8Array[] = []; let size = 0;
        if (upstream.body) {
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) { await reader.cancel(); throw new Error("Oversized worker response"); }
            chunks.push(value);
          }
        }
        const contentType = upstream.headers.get("content-type") || "application/json";
        reply.type(contentType.startsWith("application/json") ? "application/json" : "text/plain");
        return reply.code(upstream.status).send(Buffer.concat(chunks));
      } catch (error) {
        const timeout = error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name);
        return reply.code(timeout ? 504 : 502).send({ error: timeout ? "Worker request timed out; result may require reconciliation" : "Worker unavailable" });
      }
    } });
  }
}
