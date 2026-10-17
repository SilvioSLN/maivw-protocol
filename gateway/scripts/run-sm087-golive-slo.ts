import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import assert from "node:assert/strict";
import {
  MultichainAlertService,
  type MultichainAlertCode,
  type MultichainOperationalSignal,
} from "../src/multichain/MultichainAlerts.js";

const gatewayRoot = resolve(import.meta.dirname, "..");
const protocolRoot = resolve(gatewayRoot, "..");

interface GoLiveChecklistItem {
  id: string;
  category: "SECURITY" | "GOVERNANCE" | "REPLICATION" | "ALERTING" | "SLO" | "ROLLBACK";
  description: string;
  passed: boolean;
  reference: string;
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
  // 1. Verify SM-084 Security Audit baseline
  const { path: sm084Path, value: sm084 } = latestEvidence("SM-084");
  assert.equal(sm084.findingsSummary.openCritical, 0, "No open critical findings allowed");
  assert.equal(sm084.findingsSummary.openHigh, 0, "No open high findings allowed");

  // 2. Verify SM-085 Deploy Manifest baseline
  const { path: sm085Path, value: sm085 } = latestEvidence("SM-085");
  assert.ok(sm085.publishedDeployments.solanaDevnet.programId, "Solana programId must exist");
  assert.ok(sm085.publishedDeployments.evmTestnets.baseSepolia.proxy, "Base Sepolia proxy must exist");

  // 3. Verify SM-086 Canary baseline
  const { path: sm086Path, value: sm086 } = latestEvidence("SM-086");
  assert.equal(sm086.canarySummary.totalDrifts, 0, "Canary must have zero drift");

  // 4. Validate Multichain Alert Rules & Runbook coverage (SM-076 requirement)
  const alertService = new MultichainAlertService();
  const requiredAlertCodes: MultichainAlertCode[] = [
    "ORIGIN_CONFLICT",
    "INDEXER_LAG",
    "REORG_PENDING",
    "LOW_BALANCE",
    "RELAYER_PAUSED",
    "KMS_FAILURE",
    "STATE_DRIFT",
  ];

  const signals: MultichainOperationalSignal[] = requiredAlertCodes.map((code) => ({
    code,
    scope: `golive-check:${code}`,
    value: 100,
    threshold: 10,
    details: { test: true },
  }));

  const activeAlerts = alertService.evaluate(signals);
  assert.equal(activeAlerts.length, requiredAlertCodes.length, "All alert rules must be evaluable");
  assert.ok(
    activeAlerts.every(
      (alert) =>
        alert.status === "FIRING" &&
        alert.runbook.startsWith("specs/multichain/RUNBOOK_MULTICHAIN_ALERTS_V1.md#")
    ),
    "All firing alerts must point to valid anchors in RUNBOOK_MULTICHAIN_ALERTS_V1.md"
  );

  // 5. Define and formalize SLOs
  const sloDefinitions = {
    crossChainReplicationLatency: {
      solanaToEvmP95Seconds: 60,
      solanaToEvmMaxSeconds: 180,
      evmToSolanaP95Seconds: 90,
      evmToSolanaMaxSeconds: 300,
      targetAvailabilityPercent: 99.9,
      status: "TARGET_DEFINED_UNMEASURED",
    },
    consistencyAndDrift: {
      maxAllowedPermanentDrift: 0,
      reconciliationIntervalSeconds: 300,
      maxAutoRepairAttempts: 3,
      status: "TARGET_DEFINED_UNMEASURED",
    },
    circuitBreakerAndSafety: {
      consecutiveErrorsTripThreshold: 3,
      isolationScope: "TARGET_DESTINATION",
      emergencyPauseRole: "GUARDIAN_OR_AUTHORITY",
      status: "CONFIGURED_NOT_PRODUCTION_EXERCISED",
    },
    rollbackAndRecovery: {
      zeroDataLossResume: true,
      persistentCursorReplay: true,
      compensatoryActionSupport: true,
      status: "TESTED_LOCALLY_NOT_PRODUCTION_EXERCISED",
    },
  };

  // 6. Go-Live Checklist validation
  const checklist: GoLiveChecklistItem[] = [
    {
      id: "CHK-SEC-01",
      category: "SECURITY",
      description: "Auditoria independente sem vulnerabilidades Críticas ou Altas pendentes",
      passed: sm084.acceptanceCriteriaMet === true,
      reference: "SM-084 (auditoria externa pendente)",
    },
    {
      id: "CHK-GOV-01",
      category: "GOVERNANCE",
      description: "Contratos e programas implantados com proxies verificáveis e multisig/timelock",
      passed: sm085.acceptanceCriteriaMet === true,
      reference: "SM-085 (handoff multisig pendente)",
    },
    {
      id: "CHK-CAN-01",
      category: "REPLICATION",
      description: "Canário multi-origem em execução contínua com zero drift em 4 domínios",
      passed: sm086.acceptanceCriteriaMet === true,
      reference: "SM-086 (canário on-chain contínuo pendente)",
    },
    {
      id: "CHK-ALT-01",
      category: "ALERTING",
      description: "7 regras de alerta operacionais cobrindo conflito, lag, reorg, saldo, pausa, KMS e drift com runbooks vinculados",
      passed: activeAlerts.length === 7,
      reference: "SM-076 (RUNBOOK_MULTICHAIN_ALERTS_V1.md)",
    },
    {
      id: "CHK-SLO-01",
      category: "SLO",
      description: "Metas de SLO de latência, disponibilidade (>99.9%) e consistência aprovadas",
      passed: false,
      reference: "SM-087 (metas definidas; janela de medição pendente)",
    },
    {
      id: "CHK-ROL-01",
      category: "ROLLBACK",
      description: "Procedimento de rollback de relayer, compensação de reorg e pausa de emergência validados",
      passed: true,
      reference: "SM-081 & RUNBOOK_MULTICHAIN_ALERTS_V1.md",
    },
  ];

  const allPassed = checklist.every((item) => item.passed);

  const runId = Date.now().toString(36);
  const evidence = {
    schemaVersion: 1,
    task: "SM-087",
    runId,
    baselineEvidence: {
      sm084: relative(protocolRoot, sm084Path),
      sm085: relative(protocolRoot, sm085Path),
      sm086: relative(protocolRoot, sm086Path),
    },
    evaluatedAt: new Date().toISOString(),
    status: allPassed ? "PASS" : "NOT_READY_FOR_PRODUCTION",
    criteria: "Checklist, alertas, reconciliação zero-drift e rollback aprovados",
    dependencies: ["SM-076", "SM-086"],
    checklistSummary: {
      totalItems: checklist.length,
      passedItems: checklist.filter((item) => item.passed).length,
      allPassed,
    },
    sloDefinitions,
    activeAlertsEvaluated: activeAlerts.map((a) => ({
      code: a.code,
      severity: a.severity,
      summary: a.summary,
      runbook: a.runbook,
    })),
    checklist,
  };

  const evidencePath = resolve(protocolRoot, `evidence/sm-087/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });

  process.stdout.write(
    `${JSON.stringify({
      evidencePath,
      status: evidence.status,
      totalChecklistItems: checklist.length,
      alertsValidated: activeAlerts.length,
    })}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
