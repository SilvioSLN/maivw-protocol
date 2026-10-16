import assert from "node:assert/strict";
import test from "node:test";
import type {
  RelayDestinationRow,
  RelayJobRepository,
  RelayJobRow,
  RelayStatus,
  RelayTransitionInput,
} from "../src/multichain/MultichainRelayJob.js";
import { MultichainRelayJobService } from "../src/multichain/MultichainRelayJob.js";
import {
  RelaySubmissionCoordinator,
  RelaySubmissionError,
  type RelayBroadcastAdapter,
  type RelaySubmissionRow,
  type RelaySubmissionStore,
  type SubmissionAttemptInput,
} from "../src/multichain/RelaySubmission.js";

const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as const;

class MemoryStore implements RelayJobRepository, RelaySubmissionStore {
  readonly job: RelayJobRow;
  destination: RelayDestinationRow;
  submission: RelaySubmissionRow | null = null;
  attempts: SubmissionAttemptInput[] = [];
  transitions: RelayTransitionInput[] = [];

  constructor() {
    const now = new Date("2026-10-16T10:00:00Z");
    this.job = {
      id: "job-1", sourceEventKey: "event-1", domainHash: bytes(1), operation: "SYNC",
      originNetworkFamily: "EVM", originNetworkId: "evm:8453", originRegistryId: bytes(2),
      sourceTransactionId: "source-tx", sourcePosition: "10:0", globalDomainEpoch: 1n,
      originSequence: 2n, status: "ATTESTED", sourceStateHash: bytes(3), detectedAt: now,
      finalizedAt: now, createdAt: now, updatedAt: now,
    };
    this.destination = {
      id: "destination-1", jobId: this.job.id, destinationNetworkFamily: "EVM",
      destinationNetworkId: "evm:42161", destinationRegistryId: bytes(4), status: "ATTESTED",
      attestationDigest: bytes(5), submissionId: null, confirmationReference: null,
      reconcileReference: null, createdAt: now, updatedAt: now,
    };
  }

  async transaction<T>(operation: (store: any) => Promise<T>): Promise<T> { return operation(this); }
  async getDestination(id: string) { return id === this.destination.id ? this.destination : null; }
  async findByDestination(id: string) { return this.submission?.destinationId === id ? this.submission : null; }
  async create(row: RelaySubmissionRow) { this.submission = row; }
  async claim(id: string, workerId: string, now: Date, leaseUntil: Date) {
    if (!this.submission || this.submission.id !== id || this.submission.status !== "PREPARED"
      || this.submission.nextAttemptAt > now || (this.submission.leaseUntil && this.submission.leaseUntil > now)) return false;
    this.submission = { ...this.submission, leaseOwner: workerId, leaseUntil, attempts: this.submission.attempts + 1 };
    return true;
  }
  async get(id: string) { return this.submission?.id === id ? this.submission : null; }
  async markBroadcast(id: string, worker: string, transactionId: string, at: Date) {
    if (!this.submission || this.submission.id !== id || this.submission.leaseOwner !== worker) return false;
    this.submission = {
      ...this.submission, status: "BROADCAST", expectedTransactionId: transactionId,
      leaseOwner: null, leaseUntil: null, submittedAt: at, updatedAt: at,
    };
    return true;
  }
  async releaseForRetry(id: string, worker: string, error: string, next: Date, at: Date) {
    if (!this.submission || this.submission.id !== id || this.submission.leaseOwner !== worker) return false;
    this.submission = {
      ...this.submission, leaseOwner: null, leaseUntil: null, lastError: error,
      nextAttemptAt: next, updatedAt: at,
    };
    return true;
  }
  async markConfirmed(id: string, reference: string, at: Date) {
    if (!this.submission || this.submission.id !== id || this.submission.status !== "BROADCAST") return false;
    this.submission = {
      ...this.submission, status: "CONFIRMED", finalityReference: reference,
      confirmedAt: at, updatedAt: at,
    };
    return true;
  }
  async appendAttempt(input: SubmissionAttemptInput) { this.attempts.push(input); }

  async findJobById(id: string) { return id === this.job.id ? this.job : null; }
  async findJobBySourceEventKey() { return this.job; }
  async createJob() { throw new Error("unused"); }
  async compareAndSetJob(id: string, expected: RelayStatus, data: Partial<RelayJobRow>) {
    if (id !== this.job.id || this.job.status !== expected) return false;
    Object.assign(this.job, data);
    return true;
  }
  async listDestinations(jobId: string) { return jobId === this.job.id ? [this.destination] : []; }
  async findDestination(id: string) { return this.getDestination(id); }
  async compareAndSetDestination(id: string, expected: RelayStatus, data: Partial<RelayDestinationRow>) {
    if (id !== this.destination.id || this.destination.status !== expected) return false;
    this.destination = { ...this.destination, ...data };
    return true;
  }
  async advanceAllDestinations() { return 0; }
  async appendTransition(input: RelayTransitionInput) { this.transitions.push(input); }
}

function coordinator(memory: MemoryStore) {
  return new RelaySubmissionCoordinator(memory, new MultichainRelayJobService(memory), {
    leaseMs: 1_000, baseRetryMs: 100, maxRetryMs: 1_000,
  });
}

function prepareInput(now = new Date("2026-10-16T12:00:00Z")) {
  return {
    destinationId: "destination-1",
    idempotencyKey: "job-1:destination-1:attestation-5",
    signedPayload: "0x010203",
    expectedTransactionId: "0xtx-1",
    deadline: new Date("2026-10-16T12:10:00Z"),
    now,
  };
}

test("prepares immutable signed bytes and makes exact retry idempotent", async () => {
  const memory = new MemoryStore();
  const service = coordinator(memory);
  const first = await service.prepare(prepareInput());
  const retry = await service.prepare(prepareInput());
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(first.submission.signedPayloadHash, retry.submission.signedPayloadHash);
  await assert.rejects(
    service.prepare({ ...prepareInput(), signedPayload: "0x0405" }),
    (error: unknown) => error instanceof RelaySubmissionError && error.code === "SUBMISSION_CONFLICT",
  );
});

test("retries the same transaction after backoff and never broadcasts it twice", async () => {
  const memory = new MemoryStore();
  const service = coordinator(memory);
  const { submission } = await service.prepare(prepareInput());
  let broadcasts = 0;
  const adapter: RelayBroadcastAdapter = {
    broadcast: async ({ expectedTransactionId }) => {
      broadcasts += 1;
      if (broadcasts === 1) throw new Error("rpc unavailable");
      return { transactionId: expectedTransactionId };
    },
    checkFinality: async () => ({ status: "PENDING" }),
  };
  const firstAt = new Date("2026-10-16T12:00:01Z");
  await assert.rejects(
    service.submit(submission.id, "worker-a", adapter, firstAt),
    (error: unknown) => error instanceof RelaySubmissionError && error.code === "SUBMISSION_RETRY_SCHEDULED",
  );
  await assert.rejects(
    service.submit(submission.id, "worker-b", adapter, new Date(firstAt.getTime() + 50)),
    (error: unknown) => error instanceof RelaySubmissionError && error.code === "SUBMISSION_RETRY_NOT_READY",
  );
  const sent = await service.submit(submission.id, "worker-b", adapter, new Date(firstAt.getTime() + 100));
  const duplicate = await service.submit(submission.id, "worker-c", adapter, new Date(firstAt.getTime() + 200));
  assert.deepEqual(sent, { transactionId: "0xtx-1", broadcast: true });
  assert.deepEqual(duplicate, { transactionId: "0xtx-1", broadcast: false });
  assert.equal(broadcasts, 2);
  assert.equal(memory.destination.status, "SUBMITTED");
});

test("respects deadline and only confirms after destination finality", async () => {
  const expiredMemory = new MemoryStore();
  const expired = coordinator(expiredMemory);
  await assert.rejects(
    expired.prepare(prepareInput(new Date("2026-10-16T12:11:00Z"))),
    (error: unknown) => error instanceof RelaySubmissionError && error.code === "SUBMISSION_DEADLINE_EXPIRED",
  );

  const memory = new MemoryStore();
  const service = coordinator(memory);
  const { submission } = await service.prepare(prepareInput());
  let finalized = false;
  const adapter: RelayBroadcastAdapter = {
    broadcast: async ({ expectedTransactionId }) => ({ transactionId: expectedTransactionId }),
    checkFinality: async () => finalized
      ? { status: "FINALIZED", reference: "block:100" }
      : { status: "PENDING" },
  };
  await service.submit(submission.id, "worker", adapter, new Date("2026-10-16T12:00:01Z"));
  assert.deepEqual(await service.confirm(submission.id, adapter), { confirmed: false });
  finalized = true;
  assert.deepEqual(await service.confirm(submission.id, adapter), { confirmed: true, reference: "block:100" });
  assert.equal(memory.destination.status, "CONFIRMED");
});
