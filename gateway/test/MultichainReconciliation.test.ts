import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, padHex, stringToHex, type Hex } from "viem";
import type { CanonicalDomainState } from "../src/multichain/FinalizedStateReader.js";
import {
  MultichainReconciliationService,
  ReconciliationError,
  type ReconciliationFindingRow,
  type ReconciliationRepository,
  type ReconciliationRunRow,
} from "../src/multichain/MultichainReconciliation.js";

const bytes = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}` as Hex;

function origin(): CanonicalDomainState {
  const domain = "mail.example";
  const key = padHex("0x1111111111111111111111111111111111111111", { size: 32 });
  return {
    domain, domainHash: keccak256(stringToHex(domain)), recordKind: "ORIGIN", originFamily: "EVM",
    originNetworkHash: keccak256(stringToHex("evm:8453")), originRegistry: bytes(1),
    operationalKey: { algorithm: 1, value: key }, adminKey: { algorithm: 1, value: key },
    endpoint: "https://mail.example", tlsFingerprint: bytes(2), status: "ACTIVE",
    globalDomainEpoch: 3n, originSequence: 8n, isProvider: false, providerTier: 0, strikes: 1,
    registrationTime: 1_700_000_000n, updatedAt: 1_700_000_100n,
    attestedStake: 0n, attestedDailyLimit: 0n, originTransactionFamily: "EVM",
    originTransaction: bytes(3), schemaVersion: 2,
  };
}

function mirror(source = origin()): CanonicalDomainState {
  return { ...source, recordKind: "MIRROR", updatedAt: source.updatedAt + 1n };
}

class MemoryReconciliationRepository implements ReconciliationRepository {
  readonly runs: ReconciliationRunRow[] = [];
  readonly findings: ReconciliationFindingRow[] = [];
  async transaction<T>(operation: (repository: ReconciliationRepository) => Promise<T>) { return operation(this); }
  async findRunByRequestId(requestId: string) { return this.runs.find((run) => run.requestId === requestId) ?? null; }
  async listFindings(runId: string) { return this.findings.filter((finding) => finding.runId === runId); }
  async lastRun(domainHash: string) {
    return [...this.runs].reverse().find((run) => run.domainHash === domainHash) ?? null;
  }
  async createRun(run: ReconciliationRunRow, findings: readonly ReconciliationFindingRow[]) {
    this.runs.push(run);
    this.findings.push(...findings);
  }
}

const originDeployment = { family: "EVM" as const, networkId: "evm:8453", registryId: bytes(1) };
const target = (id: number, state?: CanonicalDomainState | null, readError?: string) => ({
  family: id % 2 ? "EVM" as const : "SOLANA" as const,
  networkId: id % 2 ? `evm:${42_160 + id}` : `solana:${"1".repeat(31)}${id}`,
  registryId: bytes(id),
  state,
  readError,
});

function input(repositoryRequest = "run-1") {
  return {
    requestId: repositoryRequest,
    origin: originDeployment,
    originState: origin(),
    targets: [target(2, mirror())],
    startedAt: new Date("2026-10-16T12:00:00Z"),
    completedAt: new Date("2026-10-16T12:00:01Z"),
  };
}

test("reports a clean N×N projection and makes an exact run retry idempotent", async () => {
  const repository = new MemoryReconciliationRepository();
  const service = new MultichainReconciliationService(repository);
  const first = await service.reconcile(input());
  const retry = await service.reconcile(input());
  assert.equal(first.run.status, "CLEAN");
  assert.equal(first.findings[0].kind, "IN_SYNC");
  assert.equal(first.findings[0].repairAction, "NONE");
  assert.equal(retry.created, false);
  assert.equal(repository.runs.length, 1);
});

test("classifies missing, behind and unreadable destinations with executable repairs", async () => {
  const repository = new MemoryReconciliationRepository();
  const service = new MultichainReconciliationService(repository);
  const behind = mirror();
  behind.originSequence = 7n;
  const result = await service.reconcile({
    ...input("run-drift"),
    targets: [target(2, null), target(3, behind), target(4, undefined, "rpc timeout")],
  });
  assert.equal(result.run.status, "DRIFTED");
  const repairs = new Map(result.findings.map((finding) => [finding.kind, finding.repairAction]));
  assert.equal(repairs.get("MISSING_MIRROR"), "REGISTER");
  assert.equal(repairs.get("VERSION_BEHIND"), "SYNC");
  assert.equal(repairs.get("UNREADABLE"), "RETRY_READ");
});

test("requires manual review for origin conflict, ahead version and same-version state drift", async () => {
  const repository = new MemoryReconciliationRepository();
  const service = new MultichainReconciliationService(repository);
  const conflict = mirror();
  conflict.originRegistry = bytes(99);
  const ahead = mirror();
  ahead.originSequence = 9n;
  const drift = mirror();
  drift.endpoint = "https://drift.example";
  const result = await service.reconcile({
    ...input("run-danger"), targets: [target(2, conflict), target(3, ahead), target(4, drift)],
  });
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.kind)),
    new Set(["ORIGIN_CONFLICT", "VERSION_AHEAD", "STATE_DRIFT"]),
  );
  assert.ok(result.findings.every((finding) => finding.repairAction === "MANUAL_REVIEW"));
});

test("chains audit hashes and rejects request id reuse with another snapshot", async () => {
  const repository = new MemoryReconciliationRepository();
  const service = new MultichainReconciliationService(repository);
  const first = await service.reconcile(input("audit-1"));
  const second = await service.reconcile(input("audit-2"));
  assert.equal(second.run.previousAuditHash, first.run.auditHash);
  assert.match(second.run.auditHash, /^0x[0-9a-f]{64}$/);
  await assert.rejects(
    service.reconcile({ ...input("audit-2"), targets: [target(2, null)] }),
    (error: unknown) => error instanceof ReconciliationError && error.code === "RECONCILIATION_CONFLICT",
  );
});
