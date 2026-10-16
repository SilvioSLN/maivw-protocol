import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../prisma/migrations/20261016000000_baseline_with_multichain/migration.sql", import.meta.url);
const dockerfileUrl = new URL("../Dockerfile", import.meta.url);

test("baseline migration persists the complete multichain relay lifecycle", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of [
    "OriginRecord", "OriginClaimIssuance", "EvmSourceEvent", "SolanaSourceEvent",
    "MultichainRelayJob", "MultichainRelayDestination", "MultichainRelaySubmission",
    "MultichainRelaySubmissionAttempt", "MultichainReconciliationRun",
    "MultichainReconciliationFinding",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`), `missing ${table}`);
  }
  assert.match(sql, /"globalDomainEpoch" BIGINT NOT NULL/);
  assert.match(sql, /"originSequence" BIGINT NOT NULL/);
  assert.match(sql, /MultichainRelayJob_sourceEventKey_key/);
  assert.match(sql, /MultichainRelayDestination_jobId_destinationNetworkId_desti_key/);
  assert.match(sql, /MultichainRelaySubmissionAttempt_submissionId_attempt_outco_key/);
  assert.match(sql, /ON DELETE RESTRICT/);
});

test("gateway deploys versioned migrations instead of mutating schema with db push", async () => {
  const dockerfile = await readFile(dockerfileUrl, "utf8");
  assert.match(dockerfile, /prisma migrate deploy/);
  assert.doesNotMatch(dockerfile, /prisma db push/);
});
