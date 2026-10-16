import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex, type Hex } from "viem";
import {
  MultichainRelayJobService,
  RelayJobError,
  type RelayDestinationRow,
  type RelayJobRepository,
  type RelayJobRow,
  type RelayStatus,
  type RelayTransitionInput,
} from "../src/multichain/MultichainRelayJob.js";

const bytes = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}` as Hex;

class MemoryRelayRepository implements RelayJobRepository {
  readonly jobs = new Map<string, RelayJobRow>();
  readonly destinations = new Map<string, RelayDestinationRow>();
  readonly transitions: RelayTransitionInput[] = [];

  async transaction<T>(operation: (repository: RelayJobRepository) => Promise<T>): Promise<T> {
    return operation(this);
  }
  async findJobById(id: string): Promise<RelayJobRow | null> { return this.jobs.get(id) ?? null; }
  async findJobBySourceEventKey(key: string): Promise<RelayJobRow | null> {
    return [...this.jobs.values()].find((job) => job.sourceEventKey === key) ?? null;
  }
  async createJob(job: RelayJobRow, destinations: readonly RelayDestinationRow[]): Promise<void> {
    this.jobs.set(job.id, job);
    destinations.forEach((destination) => this.destinations.set(destination.id, destination));
  }
  async compareAndSetJob(id: string, expected: RelayStatus, data: Partial<RelayJobRow>): Promise<boolean> {
    const row = this.jobs.get(id);
    if (!row || row.status !== expected) return false;
    this.jobs.set(id, { ...row, ...data });
    return true;
  }
  async listDestinations(jobId: string): Promise<RelayDestinationRow[]> {
    return [...this.destinations.values()].filter((destination) => destination.jobId === jobId)
      .sort((a, b) => a.destinationNetworkId.localeCompare(b.destinationNetworkId));
  }
  async findDestination(id: string): Promise<RelayDestinationRow | null> {
    return this.destinations.get(id) ?? null;
  }
  async compareAndSetDestination(
    id: string,
    expected: RelayStatus,
    data: Partial<RelayDestinationRow>,
  ): Promise<boolean> {
    const row = this.destinations.get(id);
    if (!row || row.status !== expected) return false;
    this.destinations.set(id, { ...row, ...data });
    return true;
  }
  async advanceAllDestinations(jobId: string, expected: RelayStatus, next: RelayStatus): Promise<number> {
    let count = 0;
    for (const [id, row] of this.destinations) {
      if (row.jobId === jobId && row.status === expected) {
        this.destinations.set(id, { ...row, status: next });
        count += 1;
      }
    }
    return count;
  }
  async appendTransition(input: RelayTransitionInput): Promise<void> { this.transitions.push(input); }
}

function detectedInput() {
  return {
    sourceEventKey: "evm:8453:0xabc:7",
    domainHash: keccak256(stringToHex("mail.example")),
    operation: "SYNC" as const,
    origin: { family: "EVM" as const, networkId: "evm:8453", registryId: bytes(1) },
    sourceTransactionId: "0xabc",
    sourcePosition: "123:7",
    globalDomainEpoch: 2n,
    originSequence: 9n,
    detectedAt: new Date("2026-10-16T12:00:00Z"),
    destinations: [
      { family: "EVM" as const, networkId: "evm:42161", registryId: bytes(2) },
      { family: "SOLANA" as const, networkId: "solana:11111111111111111111111111111111", registryId: bytes(3) },
    ],
  };
}

test("creates one durable job with N independent destinations and idempotent detection", async () => {
  const repository = new MemoryRelayRepository();
  const service = new MultichainRelayJobService(repository);
  const first = await service.detect(detectedInput());
  const retry = await service.detect(detectedInput());

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.job.id, first.job.id);
  assert.equal((await repository.listDestinations(first.job.id)).length, 2);
  assert.equal(repository.transitions.length, 1);

  await assert.rejects(
    service.detect({ ...detectedInput(), originSequence: 10n }),
    (error: unknown) => error instanceof RelayJobError && error.code === "RELAY_CONFLICT",
  );
});

test("advances detected/finalized and aggregates only when every destination advances", async () => {
  const repository = new MemoryRelayRepository();
  const service = new MultichainRelayJobService(repository);
  const { job } = await service.detect(detectedInput());
  const finalized = await service.finalize(job.id, bytes(10), new Date("2026-10-16T12:01:00Z"));
  assert.equal(finalized.job.status, "FINALIZED");

  const destinations = await repository.listDestinations(job.id);
  await service.advanceDestination({
    destinationId: destinations[0].id, toStatus: "ATTESTED", artifactHash: bytes(11),
  });
  assert.equal(repository.jobs.get(job.id)?.status, "FINALIZED");
  await service.advanceDestination({
    destinationId: destinations[1].id, toStatus: "ATTESTED", artifactHash: bytes(12),
  });
  assert.equal(repository.jobs.get(job.id)?.status, "ATTESTED");

  const retry = await service.advanceDestination({
    destinationId: destinations[1].id, toStatus: "ATTESTED", artifactHash: bytes(12),
  });
  assert.equal(retry.changed, false);
});

test("rejects skipped transitions and reaches reconcile through the complete sequence", async () => {
  const repository = new MemoryRelayRepository();
  const service = new MultichainRelayJobService(repository);
  const input = { ...detectedInput(), destinations: [detectedInput().destinations[0]] };
  const { job } = await service.detect(input);
  await service.finalize(job.id, bytes(20), new Date("2026-10-16T12:01:00Z"));
  const [destination] = await repository.listDestinations(job.id);

  await assert.rejects(
    service.advanceDestination({ destinationId: destination.id, toStatus: "SUBMITTED", reference: "tx-1" }),
    (error: unknown) => error instanceof RelayJobError && error.code === "RELAY_TRANSITION_INVALID",
  );
  await service.advanceDestination({ destinationId: destination.id, toStatus: "ATTESTED", artifactHash: bytes(21) });
  await service.advanceDestination({ destinationId: destination.id, toStatus: "SUBMITTED", reference: "tx-1" });
  await service.advanceDestination({ destinationId: destination.id, toStatus: "CONFIRMED", reference: "block-10" });
  await service.advanceDestination({ destinationId: destination.id, toStatus: "RECONCILE", reference: "run-1" });

  assert.equal(repository.jobs.get(job.id)?.status, "RECONCILE");
  assert.equal(repository.destinations.get(destination.id)?.status, "RECONCILE");
});
