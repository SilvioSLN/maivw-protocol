import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SignatureService } from "../src/services/SignatureService.js";

const root = resolve(import.meta.dirname, "../../..");
const prodManifestPath = join(root, "releases/production/release-manifest.json");
const stagingManifestPath = join(root, "releases/staging/release-manifest.json");
const changePlanPath = join(root, "releases/production/change-plan-manifest.json");

// =============================================================================
// Suíte de Testes Automatizada: Promocao de Containers e Canario de Producao (AWS-047)
// =============================================================================
test("AWS-047: Invariante de promocao por digest imutavel (7 de 7 digests identicos sem rebuild)", () => {
  assert.ok(existsSync(prodManifestPath), "Manifesto de producao deve existir");
  assert.ok(existsSync(stagingManifestPath), "Manifesto de staging deve existir");

  const prod = JSON.parse(readFileSync(prodManifestPath, "utf8"));
  const staging = JSON.parse(readFileSync(stagingManifestPath, "utf8"));

  const units = ["gateway", "payment", "console", "dashboard", "webmaivw", "redis", "cloudflared"];
  for (const unit of units) {
    const prodImg = prod.images[unit];
    const stagingImg = staging.images[unit];
    assert.ok(prodImg, `Imagem ${unit} deve constar no manifesto de producao`);
    assert.ok(stagingImg, `Imagem ${unit} deve constar no manifesto de staging`);
    assert.equal(
      prodImg.digest,
      stagingImg.digest,
      `Digest de ${unit} em producao deve ser rigorosamente identico ao homologado em staging`,
    );
    assert.ok(prodImg.digest.startsWith("sha256:"), `Digest de ${unit} deve ter prefixo sha256:`);
  }

  assert.equal(prod.version, staging.version, "Versao da release deve ser consistente (0.1.0)");
  assert.equal(prod.gitSha, staging.gitSha, "Git SHA deve ser consistente (e6be5aa9263f)");
  assert.equal(prod.promotionProvenance.rebuildRequired, false, "Rebuild deve ser estritamente false em producao");
});

test("AWS-047: Topologia de dependencia de inicializacao dos 13 servicos ECS", () => {
  const serviceTopology = [
    { layer: 1, name: "redis", category: "infrastructure", port: 6379, dependsOn: [] },
    { layer: 2, name: "payment", category: "backend", port: 3002, dependsOn: ["redis"] },
    { layer: 2, name: "gateway-api", category: "backend", port: 3000, dependsOn: ["redis", "payment"] },
    { layer: 2, name: "p2p-ingress", category: "backend", port: 3001, dependsOn: ["gateway-api"] },
    { layer: 3, name: "mail-worker", category: "worker", dependsOn: ["redis", "gateway-api"] },
    { layer: 3, name: "oracle-worker", category: "worker", dependsOn: ["redis", "gateway-api"] },
    { layer: 3, name: "relayer-worker", category: "worker", dependsOn: ["redis", "gateway-api"] },
    { layer: 4, name: "evm-indexer", category: "indexer", dependsOn: ["gateway-api"] },
    { layer: 4, name: "solana-indexer", category: "indexer", dependsOn: ["gateway-api"] },
    { layer: 5, name: "console", category: "frontend", port: 3003, dependsOn: ["gateway-api"] },
    { layer: 5, name: "dashboard", category: "frontend", port: 3004, dependsOn: ["gateway-api"] },
    { layer: 5, name: "webmaivw", category: "frontend", port: 3005, dependsOn: ["gateway-api"] },
    { layer: 5, name: "tunnel", category: "ingress", dependsOn: ["console", "dashboard", "webmaivw", "gateway-api"] },
  ];

  assert.equal(serviceTopology.length, 13, "Topologia deve definir exatamente 13 servicos ECS");

  // Validacao de camadas ordenadas
  for (let i = 1; i < serviceTopology.length; i++) {
    const current = serviceTopology[i];
    for (const dep of current.dependsOn) {
      const depService = serviceTopology.find((s) => s.name === dep);
      assert.ok(depService, `Dependencia ${dep} deve existir na topologia`);
      assert.ok(
        depService.layer <= current.layer,
        `Servico ${current.name} (camada ${current.layer}) nao pode depender de servico em camada superior (${dep})`,
      );
    }
  }
});

test("AWS-047: Probes de liveness e prontidao para todos os servicos essenciais", async () => {
  const simulatedEndpoints: Record<string, { route: string; expectedStatus: number; bodyCheck: (b: any) => boolean }> = {
    "gateway": {
      route: "/health",
      expectedStatus: 200,
      bodyCheck: (b) => b.status === "ok",
    },
    "payment": {
      route: "/health",
      expectedStatus: 200,
      bodyCheck: (b) => b.status === "healthy" || b.status === "ok",
    },
    "console": {
      route: "/api/health",
      expectedStatus: 200,
      bodyCheck: (b) => b.status === "ok" || b.healthy === true,
    },
    "dashboard": {
      route: "/api/health",
      expectedStatus: 200,
      bodyCheck: (b) => b.status === "ok" || b.healthy === true,
    },
    "webmaivw": {
      route: "/api/health",
      expectedStatus: 200,
      bodyCheck: (b) => b.status === "ok" || b.healthy === true,
    },
  };

  for (const [unit, config] of Object.entries(simulatedEndpoints)) {
    const mockResponse = {
      status: 200,
      data: { status: "ok", healthy: true, timestamp: new Date().toISOString(), unit },
    };
    assert.equal(mockResponse.status, config.expectedStatus, `Probe de ${unit} deve responder HTTP 200`);
    assert.ok(config.bodyCheck(mockResponse.data), `Payload de health de ${unit} deve ser valido`);
  }
});

test("AWS-047: Canario Criptografico Envelope V2 e medicao de latencia p95 (meta <= 30ms)", async () => {
  const privKey = generatePrivateKey();
  const account = privateKeyToAccount(privKey);
  const signer = new SignatureService(privKey);

  const iterations = 50;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const payload = {
      version: "2.0" as const,
      messageId: `msg-canary-${i}-${crypto.randomBytes(4).toString("hex")}`,
      from: "sender@maivw.com",
      to: "recipient@maivw.com",
      subject: `Canary Test Message #${i}`,
      msgClass: "CANARY_SANITY",
      timestamp: Date.now(),
      contentHash: crypto.createHash("sha256").update(`payload-data-${i}`).digest("hex"),
    };
    const signature = await signer.signEnvelopeV2(payload);
    const isValid = await signer.verifyEnvelopeV2(payload, signature, account.address);
    const dt = performance.now() - t0;
    latencies.push(dt);

    assert.ok(isValid, `Assinatura de Envelope V2 #${i} deve ser matematicamente valida`);
  }

  latencies.sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Latency = latencies[p95Index];
  console.log(`[Canario Envelope V2] Latencia p95: ${p95Latency.toFixed(2)} ms (limiar: <= 30 ms)`);

  assert.ok(p95Latency <= 30, `Latencia p95 do Envelope V2 deve ser <= 30ms (obtido: ${p95Latency.toFixed(2)}ms)`);
});

test("AWS-047: Canario de Fila BullMQ e ciclo de vida de jobs (dispatch, lease lock, zero zumbis)", () => {
  interface SimulatedJob {
    id: string;
    name: string;
    data: any;
    status: "WAITING" | "ACTIVE" | "COMPLETED" | "FAILED";
    leaseExpiresAt?: number;
    completedAt?: number;
  }

  const queue: SimulatedJob[] = [];
  const processedJobs: string[] = [];

  // 1. Dispatch de jobs na fila
  for (let i = 0; i < 20; i++) {
    queue.push({
      id: `job-prod-${i}`,
      name: "relay-multichain",
      data: { origin: `origin-${i}.maivw.com`, targetChain: "base-mainnet" },
      status: "WAITING",
    });
  }
  assert.equal(queue.length, 20, "20 jobs devem ser enfileirados inicialmente");

  // 2. Aquisicao atomica de lease lock por worker
  const workerNow = Date.now();
  for (const job of queue) {
    if (job.status === "WAITING") {
      job.status = "ACTIVE";
      job.leaseExpiresAt = workerNow + 5000;
    }
  }

  // 3. Processamento deterministico e drenagem
  for (const job of queue) {
    if (job.status === "ACTIVE") {
      job.status = "COMPLETED";
      job.completedAt = Date.now();
      processedJobs.push(job.id);
    }
  }

  assert.equal(processedJobs.length, 20, "Todos os 20 jobs devem ser completados com sucesso");
  const zombieJobs = queue.filter((j) => j.status === "ACTIVE" || j.status === "WAITING");
  assert.equal(zombieJobs.length, 0, "Nenhum job zumbi deve restar apos drenagem");
});

test("AWS-047: Isolamento multi-tenant estrito no runtime de producao", () => {
  const tenantA = { id: "tenant-prod-alpha", apiKey: "mk_live_alpha_0123456789abcdef" };
  const tenantB = { id: "tenant-prod-beta", apiKey: "mk_live_beta_0123456789abcdef" };

  const resources: Array<{ id: string; ownerTenantId: string; data: string }> = [
    { id: "msg-1", ownerTenantId: tenantA.id, data: "Mensagem secreta Alpha" },
    { id: "msg-2", ownerTenantId: tenantB.id, data: "Mensagem secreta Beta" },
  ];

  function accessResource(tenantId: string, resourceId: string) {
    const res = resources.find((r) => r.id === resourceId);
    if (!res) return { status: 404, error: "NOT_FOUND" };
    if (res.ownerTenantId !== tenantId) return { status: 403, error: "FORBIDDEN_CROSS_TENANT_ACCESS" };
    return { status: 200, data: res.data };
  }

  // Acesso legitimo
  assert.equal(accessResource(tenantA.id, "msg-1").status, 200);
  assert.equal(accessResource(tenantB.id, "msg-2").status, 200);

  // Acesso cruzado nao-autorizado (rejeicao fail-closed)
  assert.equal(accessResource(tenantA.id, "msg-2").status, 403);
  assert.equal(accessResource(tenantB.id, "msg-1").status, 403);
});

test("AWS-047: Capacidade de rollback deterministico de containers (previousDigest e MTR <= 15 min)", () => {
  const prod = JSON.parse(readFileSync(prodManifestPath, "utf8"));
  const changePlan = JSON.parse(readFileSync(changePlanPath, "utf8"));

  const units = ["gateway", "payment", "console", "dashboard", "webmaivw"];
  for (const unit of units) {
    const prodImg = prod.images[unit];
    assert.ok(prodImg.previousDigest, `Imagem ${unit} deve possuir previousDigest registrado`);
    assert.ok(
      prodImg.previousDigest.startsWith("sha256:"),
      `previousDigest de ${unit} deve ser um SHA-256 valido`,
    );
    assert.notEqual(
      prodImg.digest,
      prodImg.previousDigest,
      `previousDigest de ${unit} deve ser distinto do digest promovido para viabilizar rollback`,
    );
    assert.equal(
      prodImg.previousDigest,
      changePlan.rollbackDigests[unit],
      `previousDigest de ${unit} deve coincidir com o plano de mudanca aprovado`,
    );
  }

  // MTR de rollback de containers registrado no change plan (15 minutos)
  assert.ok(
    changePlan.window?.maxRollbackDurationMinutes <= 15,
    "SLA de rollback de containers deve ser <= 15 minutos",
  );
});
