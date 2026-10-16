import assert from "node:assert/strict";
import test from "node:test";
import { MultichainAlertCollector, MultichainAlertService, type MultichainOperationalSignal } from "../src/multichain/MultichainAlerts.js";
import { MultichainTelemetry } from "../src/multichain/MultichainTelemetry.js";

test("alert rules cover conflict, lag, reorg, balance, pause, KMS and drift with runbooks", () => {
  const codes: MultichainOperationalSignal["code"][] = ["ORIGIN_CONFLICT", "INDEXER_LAG", "REORG_PENDING", "LOW_BALANCE", "RELAYER_PAUSED", "KMS_FAILURE", "STATE_DRIFT"];
  const alerts = new MultichainAlertService().evaluate(codes.map((code) => ({ code, scope: `scope:${code}`, value: 1, threshold: 1 })));
  assert.deepEqual(alerts.map((alert) => alert.code).sort(), [...codes].sort());
  assert.ok(alerts.every((alert) => alert.status === "FIRING" && alert.runbook.includes("RUNBOOK_MULTICHAIN_ALERTS_V1.md#")));
  assert.equal(new MultichainAlertService().evaluate([{ code: "INDEXER_LAG", scope: "solana:test", value: 5, threshold: 10 }]).length, 0);
});

test("collector derives actionable signals from durable state and redacted telemetry", async () => {
  const telemetry = new MultichainTelemetry({ info() {}, warn() {}, error() {} });
  telemetry.record("kms.failed", {}, { secret: "must-not-escape" }, "error");
  const collector = new MultichainAlertCollector({
    multichainRelayCircuitBreaker: { findMany: async () => [
      { scopeKey: "domain:one", triggerSignal: "ORIGIN_CONFLICT" },
      { scopeKey: "deployment:two", triggerSignal: "LOW_BALANCE" },
      { scopeKey: "domain:three", triggerSignal: "STATE_DRIFT" },
    ] },
    solanaObserverCursor: { findMany: async () => [{ networkId: "solana:test", observedSlot: 500n, lastSlot: 300n }] },
    multichainRelayCompensation: { count: async () => 2 },
  } as any, telemetry, 128);
  const alerts = new MultichainAlertService().evaluate(await collector.collect());
  assert.ok(alerts.some((alert) => alert.code === "INDEXER_LAG" && alert.value === 200));
  assert.ok(alerts.some((alert) => alert.code === "REORG_PENDING" && alert.value === 2));
  assert.ok(alerts.some((alert) => alert.code === "KMS_FAILURE"));
  assert.equal(JSON.stringify(alerts).includes("must-not-escape"), false);
});
