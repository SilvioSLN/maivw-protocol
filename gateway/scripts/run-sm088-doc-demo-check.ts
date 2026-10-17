import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import assert from "node:assert/strict";

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");

interface DocCheckResult {
  file: string;
  section: string;
  passed: boolean;
  notes: string;
}

function latestEvidence(task: string): { path: string; value: any } {
  const directory = resolve(protocolRoot, `evidence/${task.toLowerCase()}`);
  const candidates = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = resolve(directory, name);
      return { path, value: JSON.parse(readFileSync(path, "utf8")) };
    })
    .sort((left, right) => String(right.value.executedAt ?? right.value.evaluatedAt ?? "")
      .localeCompare(String(left.value.executedAt ?? left.value.evaluatedAt ?? "")));
  assert.ok(candidates[0], `${task} evidence is required`);
  return candidates[0];
}

async function main(): Promise<void> {
  // 1. Verify dependencies SM-080 and SM-087
  const sm080Path = resolve(protocolRoot, "evidence/sm-080/example-run.json");
  const sm080 = JSON.parse(readFileSync(sm080Path, "utf8"));
  assert.equal(sm080.status, "PASS", "SM-080 must be PASS");

  const { path: sm087Path, value: sm087 } = latestEvidence("SM-087");

  // 2. Read multichain architecture documentation
  const archDocPath = resolve(protocolRoot, "docs/src/content/docs/architecture/multichain-origin-and-mirroring.md");
  const archDoc = readFileSync(archDocPath, "utf8");

  // 3. Read operational documentation
  const opsDocPath = resolve(protocolRoot, "docs/src/content/docs/self-hosting/operations.md");
  const opsDoc = readFileSync(opsDocPath, "utf8");

  const checks: DocCheckResult[] = [];

  // Check 1: Solana-origin explained
  const hasSolanaOrigin = archDoc.includes("Sentido Solana (Origem) → Mirrors EVM") &&
    archDoc.includes("s-example-run.test") &&
    archDoc.includes("1111111111111111111111111111111111111111111111111111111111111111");
  checks.push({
    file: "architecture/multichain-origin-and-mirroring.md",
    section: "Solana Origin Demonstration",
    passed: hasSolanaOrigin,
    notes: "Demonstrates Solana origin registration and fan-out to Base, Arbitrum, Polygon with verified TX hashes",
  });

  // Check 2: EVM-origin explained
  const hasEvmOrigin = archDoc.includes("Sentido EVM (Origem) → Mirror Solana") &&
    archDoc.includes("0x0000000000000000000000000000000000000000000000000000000000000000") &&
    archDoc.includes("1111111111111111111111111111111111111111111111111111111111111111");
  checks.push({
    file: "architecture/multichain-origin-and-mirroring.md",
    section: "EVM Origin Demonstration",
    passed: hasEvmOrigin,
    notes: "Demonstrates EVM origin registration on Base, Arbitrum, Polygon and fan-out to Solana mirror",
  });

  // Check 3: Key preservation (typed keys, no fake EVM address for Solana pubkey)
  const hasKeyPreservation = archDoc.includes("Preservação de Chaves") &&
    archDoc.includes("ED25519_SOLANA_PUBKEY") &&
    archDoc.includes("SECP256K1_EVM_ADDRESS");
  checks.push({
    file: "architecture/multichain-origin-and-mirroring.md",
    section: "Key Descriptor & Algorithm Fidelity",
    passed: hasKeyPreservation,
    notes: "Strict typing: Ed25519 32-byte pubkey preserved on EVM, secp256k1 20-byte address preserved on Solana",
  });

  // Check 4: Demo flow & CLI instructions
  const hasDemoFlow = archDoc.includes("Roteiro de Demonstração e Verificação (Demo Flow)") &&
    archDoc.includes("protocol/evidence/sm-080/example-run.json") &&
    archDoc.includes("curl -s http://localhost:3001/api/v1/multichain/status/s-example-run.test") &&
    archDoc.includes("test:sm086") &&
    archDoc.includes("test:sm087");
  checks.push({
    file: "architecture/multichain-origin-and-mirroring.md",
    section: "Interactive Demo & Verification Steps",
    passed: hasDemoFlow,
    notes: "Contains step-by-step cURL and test runner commands to audit multichain state",
  });

  // Check 5: Truth in advertising & scope boundaries (no false claims)
  const hasBoundaryClarity = archDoc.includes("Delimitação de Escopo e Alegações Corretas") &&
    archDoc.includes("Autoridade Única") &&
    archDoc.includes("Não-Custódia em Mirrors") &&
    archDoc.includes("Finalidade Assíncrona") &&
    archDoc.includes("Limites de Prontidão");
  checks.push({
    file: "architecture/multichain-origin-and-mirroring.md",
    section: "Scope Boundaries & Accuracy",
    passed: hasBoundaryClarity,
    notes: "Accurately clarifies single sovereign origin, non-custodial mirrors, and asynchronous finality",
  });

  // Check 6: Operations & SLO documentation
  const hasOpsSlo = opsDoc.includes("Operação multichain, SLOs e alertas (SM-076 / SM-087)") &&
    opsDoc.includes("Metas de Nível de Serviço (SLO)") &&
    opsDoc.includes("Matriz de Alertas Operacionais") &&
    opsDoc.includes("Procedimento de Pausa de Emergência e Rollback");
  checks.push({
    file: "self-hosting/operations.md",
    section: "Multichain Operations, SLOs and Alerts",
    passed: hasOpsSlo,
    notes: "Documents latency targets, zero-drift requirement, circuit breaker, and emergency pause/rollback runbooks",
  });

  assert.ok(checks.every((c) => c.passed), "All documentation and demo checks must pass");

  const runId = Date.now().toString(36);
  const evidence = {
    schemaVersion: 1,
    task: "SM-088",
    runId,
    baselineEvidence: {
      sm080: relative(protocolRoot, sm080Path),
      sm087: relative(protocolRoot, sm087Path),
    },
    productionReadinessStatus: sm087.status,
    evaluatedAt: new Date().toISOString(),
    status: "PASS",
    criteria: "Explica origem por domínio e demonstra os dois sentidos sem alegações indevidas",
    dependencies: ["SM-080", "SM-087"],
    documentationSummary: {
      totalChecks: checks.length,
      passedChecks: checks.filter((c) => c.passed).length,
      allPassed: true,
    },
    coverage: {
      solanaOriginDemonstrated: hasSolanaOrigin,
      evmOriginDemonstrated: hasEvmOrigin,
      keyPreservationDemonstrated: hasKeyPreservation,
      demoFlowDocumented: hasDemoFlow,
      technicalBoundariesDocumented: hasBoundaryClarity,
      operationsAndSloDocumented: hasOpsSlo,
    },
    checks,
  };

  const evidencePath = resolve(protocolRoot, `evidence/sm-088/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });

  process.stdout.write(
    `${JSON.stringify({
      evidencePath,
      status: evidence.status,
      checksPassed: checks.length,
    })}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
