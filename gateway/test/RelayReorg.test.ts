import assert from "node:assert/strict";
import test from "node:test";
import type { RelayDestinationRow, RelayJobRow, RelayStatus, RelayTransitionInput } from "../src/multichain/MultichainRelayJob.js";
import {
  RelayReorgError,
  RelayReorgService,
  type RelayCompensationRow,
  type RelayReorgRepository,
  type RelayReorgRow,
} from "../src/multichain/RelayReorg.js";

const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;

class MemoryReorgRepository implements RelayReorgRepository {
  readonly jobs = new Map<string, RelayJobRow>();
  readonly destinations = new Map<string, RelayDestinationRow>();
  readonly reorgs: RelayReorgRow[] = [];
  readonly compensations: RelayCompensationRow[] = [];
  readonly transitions: RelayTransitionInput[] = [];

  async transaction<T>(operation: (repository: RelayReorgRepository) => Promise<T>) { return operation(this); }
  async findJobBySourceEventKey(key: string) {
    return [...this.jobs.values()].find((job) => job.sourceEventKey === key) ?? null;
  }
  async listDestinations(jobId: string) {
    return [...this.destinations.values()].filter((destination) => destination.jobId === jobId);
  }
  async findReorgByJobId(jobId: string) { return this.reorgs.find((reorg) => reorg.jobId === jobId) ?? null; }
  async listCompensations(reorgId: string) { return this.compensations.filter((item) => item.reorgId === reorgId); }
  async lastReorg(domainHash: string) {
    const jobIds = [...this.jobs.values()].filter((job) => job.domainHash === domainHash).map((job) => job.id);
    return [...this.reorgs].reverse().find((reorg) => jobIds.includes(reorg.jobId)) ?? null;
  }
  async compareAndSetJob(id: string, expected: RelayStatus, next: RelayStatus, at: Date) {
    const job = this.jobs.get(id);
    if (!job || job.status !== expected) return false;
    this.jobs.set(id, { ...job, status: next, updatedAt: at });
    return true;
  }
  async compareAndSetDestination(id: string, expected: RelayStatus, next: RelayStatus, at: Date) {
    const destination = this.destinations.get(id);
    if (!destination || destination.status !== expected) return false;
    this.destinations.set(id, { ...destination, status: next, updatedAt: at });
    return true;
  }
  async createReorg(reorg: RelayReorgRow, compensations: readonly RelayCompensationRow[]) {
    this.reorgs.push(reorg);
    this.compensations.push(...compensations);
  }
  async appendTransition(input: RelayTransitionInput) { this.transitions.push(input); }
}

function seed(repository: MemoryReorgRepository, key: string, statuses: RelayStatus[], sequence = 1n) {
  const now = new Date("2026-10-16T12:00:00Z");
  const job: RelayJobRow = {
    id: `job:${key}`, sourceEventKey: key, domainHash: bytes(1), operation: "SYNC",
    originNetworkFamily: "EVM", originNetworkId: "evm:8453", originRegistryId: bytes(2),
    sourceTransactionId: `tx:${key}`, sourcePosition: `100:${sequence}`,
    globalDomainEpoch: 1n, originSequence: sequence,
    status: statuses.some((status) => ["SUBMITTED", "CONFIRMED", "RECONCILE"].includes(status))
      ? "SUBMITTED" : statuses[0],
    sourceStateHash: bytes(3), detectedAt: now, finalizedAt: now, createdAt: now, updatedAt: now,
  };
  repository.jobs.set(job.id, job);
  statuses.forEach((status, index) => repository.destinations.set(`destination:${key}:${index}`, {
    id: `destination:${key}:${index}`, jobId: job.id, destinationNetworkFamily: index % 2 ? "SOLANA" : "EVM",
    destinationNetworkId: index % 2 ? `solana:${"1".repeat(31)}${index + 1}` : `evm:${42_161 + index}`,
    destinationRegistryId: bytes(10 + index), status,
    attestationDigest: status === "DETECTED" || status === "FINALIZED" ? null : bytes(20 + index),
    submissionId: ["SUBMITTED", "CONFIRMED", "RECONCILE"].includes(status) ? `tx-destination-${index}` : null,
    confirmationReference: status === "CONFIRMED" || status === "RECONCILE" ? `block-${index}` : null,
    reconcileReference: status === "RECONCILE" ? `run-${index}` : null,
    createdAt: now, updatedAt: now,
  }));
  return job;
}

const signal = (sourceEventKey: string) => ({
  sourceEventKey,
  orphanedSourceReference: "evm:8453:block:100:old-hash",
  reason: "canonical block hash changed after deep reorg",
  detectedAt: new Date("2026-10-16T12:05:00Z"),
});

test("orphaned source cannot proceed when no destination was submitted", async () => {
  const repository = new MemoryReorgRepository();
  const job = seed(repository, "event-early", ["FINALIZED", "ATTESTED"]);
  const result = await new RelayReorgService(repository).handle(signal(job.sourceEventKey));
  assert.equal(result.reorg.outcome, "ORPHANED");
  assert.equal(repository.jobs.get(job.id)?.status, "ORPHANED");
  assert.ok([...repository.destinations.values()].every((destination) => destination.status === "ORPHANED"));
  assert.equal(result.compensations.length, 0);
});

test("submitted or confirmed mirrors become compensation-required without deleting evidence", async () => {
  const repository = new MemoryReorgRepository();
  const job = seed(repository, "event-materialized", ["ATTESTED", "SUBMITTED", "CONFIRMED"]);
  const service = new RelayReorgService(repository);
  const result = await service.handle(signal(job.sourceEventKey));
  assert.equal(result.reorg.outcome, "COMPENSATION_REQUIRED");
  assert.equal(repository.jobs.get(job.id)?.status, "COMPENSATION_REQUIRED");
  assert.equal(result.compensations.length, 2);
  assert.deepEqual(result.compensations.map((item) => item.submittedTransactionId), [
    "tx-destination-1", "tx-destination-2",
  ]);
  assert.equal(repository.destinations.get("destination:event-materialized:0")?.status, "ORPHANED");
  assert.equal(repository.destinations.get("destination:event-materialized:1")?.status, "COMPENSATION_REQUIRED");
  assert.ok(repository.transitions.some((transition) => transition.toStatus === "COMPENSATION_REQUIRED"));

  const retry = await service.handle(signal(job.sourceEventKey));
  assert.equal(retry.created, false);
  assert.equal(retry.compensations.length, 2);
});

test("chains reorg audit hashes and rejects a changed signal for the same job", async () => {
  const repository = new MemoryReorgRepository();
  const firstJob = seed(repository, "event-one", ["ATTESTED"], 1n);
  const secondJob = seed(repository, "event-two", ["ATTESTED"], 2n);
  const service = new RelayReorgService(repository);
  const first = await service.handle(signal(firstJob.sourceEventKey));
  const second = await service.handle(signal(secondJob.sourceEventKey));
  assert.equal(second.reorg.previousAuditHash, first.reorg.auditHash);
  await assert.rejects(
    service.handle({ ...signal(secondJob.sourceEventKey), reason: "different fork evidence" }),
    (error: unknown) => error instanceof RelayReorgError && error.code === "REORG_CONFLICT",
  );
});
