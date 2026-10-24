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
  assert.match(dockerfile, /"prisma", "migrate", "deploy"/);
  assert.match(dockerfile, /scripts\/with-database-url\.mjs/);
  assert.doesNotMatch(dockerfile, /prisma db push/);
});

test("gateway isolates migrations from application runtime start (AWS-010)", async () => {
  const dockerfile = await readFile(dockerfileUrl, "utf8");

  // Migrator target exists and defines prisma migrate deploy as CMD
  assert.match(dockerfile, /FROM base AS migrator/);
  const migratorSection = dockerfile.split("FROM base AS migrator")[1]?.split("FROM base AS runner")[0] || "";
  assert.match(migratorSection, /"prisma", "migrate", "deploy"/);
  assert.match(migratorSection, /scripts\/with-database-url\.mjs/);

  // Runner target exists and starts the runtime WITHOUT running prisma migrate deploy
  assert.match(dockerfile, /FROM base AS runner/);
  const runnerSection = dockerfile.split("FROM base AS runner")[1] || "";
  assert.doesNotMatch(runnerSection, /"prisma", "migrate", "deploy"/);
  assert.match(runnerSection, /npx tsx src\/runtime\.ts/);
});

test("gateway package.json exposes dedicated migration commands", async () => {
  const pkgUrl = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(pkgUrl, "utf8"));

  assert.equal(pkg.scripts["db:migrate"], "prisma migrate deploy");
  assert.equal(pkg.scripts["db:migrate:status"], "prisma migrate status");
  assert.ok(pkg.scripts["db:migrate:check"]);
});

test("migration policy checker enforces Expand -> Migrate -> Contract rules", async () => {
  const { checkMigrationSql, validateAllMigrations } = await import("../scripts/check-migration-policy.js");

  // 1. All actual migrations in repo must pass
  const results = validateAllMigrations();
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.isCompliant, true, `Migration ${r.migrationName} violates policy: ${r.violations.join(", ")}`);
  }

  // 2. Additive migration (Expand) passes
  const validExpand = `
    ALTER TABLE "User" ADD COLUMN "nickname" TEXT;
    ALTER TABLE "User" ADD COLUMN "reputationScore" INTEGER NOT NULL DEFAULT 0;
  `;
  const resExpand = checkMigrationSql("test_expand", validExpand);
  assert.equal(resExpand.isCompliant, true);

  // 3. Destructive migration without CONTRACT_PHASE tag fails
  const invalidDropCol = `
    ALTER TABLE "User" DROP COLUMN "oldField";
  `;
  const resDropCol = checkMigrationSql("test_drop_col", invalidDropCol);
  assert.equal(resDropCol.isCompliant, false);
  assert.ok(resDropCol.violations.some((v) => v.includes("DROP COLUMN")));

  const invalidDropTable = `
    DROP TABLE "DeprecatedTable";
  `;
  const resDropTable = checkMigrationSql("test_drop_table", invalidDropTable);
  assert.equal(resDropTable.isCompliant, false);
  assert.ok(resDropTable.violations.some((v) => v.includes("DROP TABLE")));

  // 4. RENAME COLUMN fails (breaks backward compatibility with running N-1 app)
  const invalidRename = `
    ALTER TABLE "User" RENAME COLUMN "legacyEmail" TO "contactEmail";
  `;
  const resRename = checkMigrationSql("test_rename", invalidRename);
  assert.equal(resRename.isCompliant, false);
  assert.ok(resRename.violations.some((v) => v.includes("RENAME COLUMN")));

  // 5. ADD COLUMN NOT NULL without DEFAULT fails
  const invalidNotNullNoDefault = `
    ALTER TABLE "User" ADD COLUMN "mandatoryScore" INTEGER NOT NULL;
  `;
  const resNotNull = checkMigrationSql("test_not_null", invalidNotNullNoDefault);
  assert.equal(resNotNull.isCompliant, false);
  assert.ok(resNotNull.violations.some((v) => v.includes("NOT NULL sem cláusula DEFAULT")));

  // 6. Destructive operations with explicit CONTRACT_PHASE tag pass
  const validContractPhase = `
    /* CONTRACT_PHASE */
    -- Clean up legacy field after N-1 application instances have been decommissioned
    ALTER TABLE "User" DROP COLUMN "deprecatedField";
    DROP TABLE "LegacyArchive";
  `;
  const resContract = checkMigrationSql("test_contract", validContractPhase);
  assert.equal(resContract.isCompliant, true);
});
