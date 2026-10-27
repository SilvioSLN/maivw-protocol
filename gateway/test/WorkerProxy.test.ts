import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerWorkerProxyRoutes, requireWorkerServiceKey, workerOrigin } from "../src/runtime/workerProxy.js";
const key = "synthetic-worker-service-key-32-bytes";

test("proxy has fixed destinations, strips forged identity and preserves synchronous response/auth", async () => {
  const requests: any[] = []; const app = Fastify();
  await registerWorkerProxyRoutes(app, { mailUrl: "http://mail:3101", internalServiceKey: key, transport: (async (url, init) => {
    requests.push({ url: String(url), init }); return new Response('{"success":true,"messageId":"synthetic"}', { status: 201 });
  }) as typeof fetch });
  try {
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/send", payload: {} })).statusCode, 401);
    const r = await app.inject({ method: "POST", url: "/api/v1/send?destination=https://evil.invalid", headers: {
      authorization: "Bearer synthetic-session", "x-internal-service-key": "forged", "x-client-cert-fingerprint-sha256": "forged", "x-forwarded-for": "forged",
    }, payload: { to: "recipient@example.test" } });
    assert.equal(r.statusCode, 201); assert.equal(r.json().success, true);
    assert.equal(requests.length, 1); assert.equal(new URL(requests[0].url).origin, "http://mail:3101");
    assert.equal(requests[0].init.redirect, "manual");
    assert.deepEqual(requests[0].init.headers, { "x-internal-service-key": key, "content-type": "application/json", authorization: "Bearer synthetic-session" });
    for (const path of ["/api/v1/oracle/simulate", "/api/v1/onboarding/fulfill-registration", "/api/v1/multichain/fulfill-mirror"]) {
      assert.equal((await app.inject({ method: "POST", url: path, payload: {} })).statusCode, 404);
    }
  } finally { await app.close(); }
});

test("operator and proof requests fail closed before adding service authority", async () => {
  let calls = 0; const app = Fastify();
  await registerWorkerProxyRoutes(app, { oracleUrl: "http://oracle:3102", internalServiceKey: key, transport: (async () => { calls++; return new Response("{}"); }) as typeof fetch });
  try {
    assert.equal((await app.inject({ url: "/api/v1/oracle/status", headers: { "x-internal-service-key": key } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/oracle/reclaim-proof", payload: {} })).statusCode, 403);
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test("proxy never retries POST or follows redirects; transport errors and limits fail explicitly", async () => {
  for (const kind of ["failure", "timeout", "redirect", "oversized"] as const) {
    let calls = 0; const app = Fastify();
    await registerWorkerProxyRoutes(app, { mailUrl: "http://mail:3101", internalServiceKey: key, bodyLimit: 1024, transport: (async () => {
      calls++; if (kind === "failure") throw new Error("private transport detail");
      if (kind === "timeout") throw new DOMException("detail", "TimeoutError");
      if (kind === "redirect") return new Response(null, { status: 307, headers: { location: "https://evil.invalid" } });
      return new Response("x".repeat(2048));
    }) as typeof fetch });
    try {
      const r = await app.inject({ method: "POST", url: "/api/v1/send", headers: { authorization: "Bearer synthetic" }, payload: {} });
      assert.equal(r.statusCode, kind === "timeout" ? 504 : 502); assert.equal(calls, 1); assert.ok(!r.body.includes("private"));
      assert.equal((await app.inject({ method: "POST", url: "/api/v1/send", payload: { body: "x".repeat(2048) } })).statusCode, 413);
    } finally { await app.close(); }
  }
  const app = Fastify(); await registerWorkerProxyRoutes(app, { internalServiceKey: key });
  try { assert.equal((await app.inject({ method: "POST", url: "/api/v1/send", payload: {} })).statusCode, 503); }
  finally { await app.close(); }
  for (const value of ["file:///etc/passwd", "http://user:secret@mail:3101", "http://mail:3101/private", "http://mail:3101?key=private"]) assert.throws(() => workerOrigin(value));
});

test("separated worker rejects absent/invalid key before running authenticated operation; liveness stays public", async () => {
  const app = Fastify(); requireWorkerServiceKey(app, key); let calls = 0;
  app.get("/health/live", async () => ({ alive: true }));
  app.post("/api/v1/send", async req => { calls++; return { authorization: req.headers.authorization }; });
  try {
    assert.equal((await app.inject({ url: "/health/live" })).statusCode, 200);
    for (const supplied of [undefined, "wrong"]) assert.equal((await app.inject({ method: "POST", url: "/api/v1/send", headers: supplied ? { "x-internal-service-key": supplied } : {}, payload: {} })).statusCode, 403);
    assert.equal(calls, 0);
    const result = await app.inject({ method: "POST", url: "/api/v1/send", headers: { "x-internal-service-key": key, authorization: "Bearer original" }, payload: {} });
    assert.equal(result.statusCode, 200); assert.equal(result.json().authorization, "Bearer original");
  } finally { await app.close(); }
});

test("configured timeout aborts an in-flight request and authorized operator routes retain fixed paths", async () => {
  const app = Fastify(); let aborted = false;
  await registerWorkerProxyRoutes(app, { oracleUrl: "http://oracle:3102", internalServiceKey: key, timeoutMs: 50,
    authorize: async request => request.headers.authorization === "Bearer allowed-operator",
    transport: (async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => { aborted = true; reject(init!.signal!.reason); }, { once: true });
    })) as typeof fetch,
  });
  try {
    const hold = setTimeout(() => {}, 2000);
    try {
      const r = await app.inject({ url: "/api/v1/oracle/status", headers: { authorization: "Bearer allowed-operator" } });
      assert.equal(r.statusCode, 504); assert.equal(aborted, true);
    } finally { clearTimeout(hold); }
    assert.equal((await app.inject({ url: "/api/v1/oracle/reports/bad%2Fid", headers: { authorization: "Bearer allowed-operator" } })).statusCode, 400);
  } finally { await app.close(); }
});
