import assert from "node:assert/strict";
import test from "node:test";
import { MultichainTelemetry, redactTelemetry } from "../src/multichain/MultichainTelemetry.js";

test("telemetry correlates hash, claim, job, transaction and drift while redacting secrets", () => {
  const logs: any[] = [];
  const logger = {
    info: (payload: unknown, message: string) => logs.push({ payload, message }),
    warn: (payload: unknown, message: string) => logs.push({ payload, message }),
    error: (payload: unknown, message: string) => logs.push({ payload, message }),
  };
  const telemetry = new MultichainTelemetry(logger, () => new Date("2026-10-16T12:00:00Z"));
  telemetry.record("reconciliation.drift", {
    domainHash: `0x${"11".repeat(32)}`, originClaimId: "claim-1", jobId: "job-1",
    networkId: "solana:11111111111111111111111111111111",
    transaction: { family: "SOLANA", id: "public-signature" }, drift: "VERSION_BEHIND",
  }, { authorization: "Bearer private", signedPayload: "private-bytes", nested: { password: "private" } }, "warn");
  const encoded = JSON.stringify(logs[0]);
  assert.ok(encoded.includes("claim-1") && encoded.includes("job-1") && encoded.includes("public-signature"));
  assert.equal(encoded.includes("Bearer private"), false);
  assert.equal(encoded.includes("private-bytes"), false);
  assert.equal(encoded.includes('"password":"private"'), false);
  assert.deepEqual(telemetry.snapshot().counters, [{
    metric: "multichain_events_total{drift=VERSION_BEHIND,event=reconciliation.drift,family=SOLANA}", value: 1,
  }]);
  assert.equal(redactTelemetry("token-value", "apiToken"), "[REDACTED]");
});
