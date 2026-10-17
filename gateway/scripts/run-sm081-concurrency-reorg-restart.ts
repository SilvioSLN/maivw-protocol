import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import {
  OriginCatalogError,
  OriginCatalogService,
  catalogDomainHash,
  verifyOriginAuditChain,
  type ActivateOriginInput,
} from "../src/multichain/OriginCatalog.js";
import {
  RelayReorgError,
  RelayReorgService,
  type RelayCompensationRow,
  type RelayReorgRepository,
  type RelayReorgRow,
} from "../src/multichain/RelayReorg.js";
import {
  RelaySubmissionCoordinator,
  RelaySubmissionError,
  type RelayBroadcastAdapter,
  type RelaySubmissionRow,
  type RelaySubmissionStore,
  type SubmissionAttemptInput,
} from "../src/multichain/RelaySubmission.js";
import {
  MultichainRelayJobService,
  type RelayDestinationRow,
  type RelayJobRepository,
  type RelayJobRow,
  type RelayStatus,
  type RelayTransitionInput,
} from "../src/multichain/MultichainRelayJob.js";

const bytes = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as const;
const EVM_REGISTRY = `0x${"0".repeat(24)}${"1".repeat(40)}` as const;
const SOLANA_REGISTRY = `0x${"2".repeat(64)}` as const;

function memoryCatalogDatabase() {
  const records = new Map<string, any>();
  const audits: any[] = [];
  const outbox: any[] = [];

  const originRecord = {
    findUnique: async ({ where }: any) => records.get(where.domainHash) ?? null,
    create: async ({ data }: any) => {
      if (records.has(data.domainHash)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const now = new Date();
      const row = { ...data, lastReconciledAt: data.lastReconciledAt ?? null, createdAt: now, updatedAt: now };
      records.set(row.domainHash, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = [...records.values()].find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("record not found");
      const updated = { ...row, ...data, updatedAt: new Date() };
      records.set(updated.domainHash, updated);
      return updated;
    },
  };

  const originAuditEvent = {
    create: async ({ data }: any) => {
      if (audits.some((event) => event.domainHash === data.domainHash && event.requestId === data.requestId)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const { outboxEvent, ...eventData } = data;
      const event = {
        ordinal: BigInt(audits.length + 1),
        previousState: null,
        actorIdHash: null,
        previousEventHash: null,
        ...eventData,
      };
      audits.push(event);
      outbox.push({ auditEventId: event.id, status: "PENDING", ...outboxEvent.create });
      return event;
    },
    findMany: async ({ where, take }: any) => audits
      .filter((event) => event.domainHash === where.domainHash)
      .slice(0, take),
  };

  const database = {
    originRecord,
    originAuditEvent,
    $transaction: async (operation: (tx: any) => Promise<any>) => operation({ originRecord, originAuditEvent }),
  };
  return { database, records, audits, outbox };
}

class MemoryReorgStore implements RelayReorgRepository {
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

class MemorySubmissionStore implements RelayJobRepository, RelaySubmissionStore {
  readonly job: RelayJobRow;
  destination: RelayDestinationRow;
  submission: RelaySubmissionRow | null = null;
  attempts: SubmissionAttemptInput[] = [];
  transitions: RelayTransitionInput[] = [];

  constructor() {
    const now = new Date("2026-10-17T02:00:00Z");
    this.job = {
      id: "job-sm081", sourceEventKey: "event-sm081", domainHash: bytes(1), operation: "REGISTER",
      originNetworkFamily: "EVM", originNetworkId: "evm:84532", originRegistryId: bytes(2),
      sourceTransactionId: "source-tx-sm081", sourcePosition: "10:0", globalDomainEpoch: 1n,
      originSequence: 1n, status: "ATTESTED", sourceStateHash: bytes(3), detectedAt: now,
      finalizedAt: now, createdAt: now, updatedAt: now,
    };
    this.destination = {
      id: "dest-sm081", jobId: this.job.id, destinationNetworkFamily: "SOLANA",
      destinationNetworkId: "solana:devnet", destinationRegistryId: bytes(4), status: "ATTESTED",
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

async function main(): Promise<void> {
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const executedAt = new Date().toISOString();
  const steps: any[] = [];

  // Scenario 1: Origin Concurrency
  const s1Start = Date.now();
  const memCatalog = memoryCatalogDatabase();
  const catalog = new OriginCatalogService(memCatalog.database as any);
  const domain = `sm081-${runId}.maivw.test`;
  const domainHash = catalogDomainHash(domain);

  const evmAct: ActivateOriginInput = {
    domain,
    origin: { family: "EVM", networkId: "evm:84532", registryId: EVM_REGISTRY },
    transaction: { family: "EVM", id: `0x${"a".repeat(64)}` },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date(),
    actor: { type: "EVM_OBSERVER" },
    requestId: `req-evm-${runId}`,
  };

  const solAct: ActivateOriginInput = {
    domain,
    origin: { family: "SOLANA", networkId: "solana:devnet", registryId: SOLANA_REGISTRY },
    transaction: { family: "SOLANA", id: "5SolanaOriginTx11111111111111111111111111111111111" },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date(),
    actor: { type: "SOLANA_OBSERVER" },
    requestId: `req-sol-${runId}`,
  };

  const concResults = await Promise.allSettled([catalog.activate(evmAct), catalog.activate(solAct)]);
  const concFulfilled = concResults.filter((r) => r.status === "fulfilled");
  const concRejected = concResults.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  assert.equal(concFulfilled.length, 1);
  assert.equal(concRejected.length, 1);
  assert.ok(concRejected[0].reason instanceof OriginCatalogError);
  assert.equal(concRejected[0].reason.code, "ORIGIN_ALREADY_ACTIVE");
  assert.equal(memCatalog.records.size, 1);
  assert.equal(verifyOriginAuditChain(memCatalog.audits).valid, true);

  steps.push({
    pillar: "ORIGIN_CONCURRENCY",
    status: "PASS",
    details: "Concorrencia simultanea EVM x Solana resolvida deterministicamente com 1 vencedor e 1 rejeitado (ORIGIN_ALREADY_ACTIVE)",
    domain,
    activeOriginFamily: memCatalog.records.get(domainHash).originFamily,
    latencyMs: Date.now() - s1Start,
  });

  // Scenario 2: Source Reorg (Shallow and Deep Materialized)
  const s2Start = Date.now();
  const repo = new MemoryReorgStore();
  const reorgService = new RelayReorgService(repo);
  const now = new Date();

  // 2.1 Shallow Reorg (Unsubmitted)
  const unsubmitted: RelayJobRow = {
    id: `job-pre-${runId}`, sourceEventKey: `event-pre-${runId}`, domainHash, operation: "REGISTER",
    originNetworkFamily: "EVM", originNetworkId: "evm:84532", originRegistryId: bytes(11),
    sourceTransactionId: "tx-pre", sourcePosition: "100:1", globalDomainEpoch: 1n, originSequence: 1n,
    status: "ATTESTED", sourceStateHash: bytes(12), detectedAt: now, finalizedAt: now, createdAt: now, updatedAt: now,
  };
  repo.jobs.set(unsubmitted.id, unsubmitted);
  repo.destinations.set(`dest-pre-${runId}`, {
    id: `dest-pre-${runId}`, jobId: unsubmitted.id, destinationNetworkFamily: "SOLANA",
    destinationNetworkId: "solana:devnet", destinationRegistryId: bytes(13), status: "ATTESTED",
    attestationDigest: bytes(14), submissionId: null, confirmationReference: null,
    reconcileReference: null, createdAt: now, updatedAt: now,
  });

  const earlyRes = await reorgService.handle({
    sourceEventKey: unsubmitted.sourceEventKey,
    orphanedSourceReference: "evm:84532:block:500:fork-orphan",
    reason: "block hash diverged during shallow reorg",
    detectedAt: new Date(now.getTime() + 60_000),
  });
  assert.equal(earlyRes.reorg.outcome, "ORPHANED");
  assert.equal(earlyRes.compensations.length, 0);

  // 2.2 Deep Reorg (Materialized)
  const submitted: RelayJobRow = {
    id: `job-post-${runId}`, sourceEventKey: `event-post-${runId}`, domainHash, operation: "SYNC",
    originNetworkFamily: "SOLANA", originNetworkId: "solana:devnet", originRegistryId: bytes(21),
    sourceTransactionId: "tx-post", sourcePosition: "200:1", globalDomainEpoch: 1n, originSequence: 2n,
    status: "SUBMITTED", sourceStateHash: bytes(22), detectedAt: now, finalizedAt: now, createdAt: now, updatedAt: now,
  };
  repo.jobs.set(submitted.id, submitted);
  repo.destinations.set(`dest-mat-${runId}`, {
    id: `dest-mat-${runId}`, jobId: submitted.id, destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:84532", destinationRegistryId: bytes(23), status: "CONFIRMED",
    attestationDigest: bytes(24), submissionId: "tx-confirmed-hash", confirmationReference: "block:100",
    reconcileReference: null, createdAt: now, updatedAt: now,
  });

  const lateRes = await reorgService.handle({
    sourceEventKey: submitted.sourceEventKey,
    orphanedSourceReference: "solana:slot:pruned",
    reason: "slot reorged after finality checkpoint",
    detectedAt: new Date(now.getTime() + 120_000),
  });
  assert.equal(lateRes.reorg.outcome, "COMPENSATION_REQUIRED");
  assert.equal(lateRes.compensations.length, 1);
  assert.equal(lateRes.compensations[0].status, "PENDING");

  steps.push({
    pillar: "SOURCE_REORG",
    status: "PASS",
    details: "Reorg pre-submissao isolado como ORPHANED; reorg pos-submissao aciona COMPENSATION_REQUIRED preservando trilha auditavel",
    latencyMs: Date.now() - s2Start,
  });

  // Scenario 3: Pipeline Crash Recovery & Nonce/Regression Protection
  const s3Start = Date.now();
  const subStore = new MemorySubmissionStore();
  const coordinator = new RelaySubmissionCoordinator(subStore, new MultichainRelayJobService(subStore), {
    leaseMs: 1_000,
    baseRetryMs: 100,
    maxRetryMs: 1_000,
  });

  const { submission } = await coordinator.prepare({
    destinationId: "dest-sm081",
    idempotencyKey: `idemp-${runId}`,
    signedPayload: "0xabcdef123456",
    expectedTransactionId: "0xtx_recovery_hash",
    deadline: new Date(now.getTime() + 600_000),
    now,
  });

  let broadcasts = 0;
  const adapter: RelayBroadcastAdapter = {
    broadcast: async ({ expectedTransactionId }) => {
      broadcasts += 1;
      if (broadcasts === 1) throw new Error("crash simulated on attempt 1");
      return { transactionId: expectedTransactionId };
    },
    checkFinality: async () => ({ status: "FINALIZED", reference: "slot:finalized" }),
  };

  // Falha na primeira tentativa
  await assert.rejects(coordinator.submit(submission.id, "worker-1", adapter, now));

  // Recovery por worker-2 apos backoff
  const subOk = await coordinator.submit(submission.id, "worker-2", adapter, new Date(now.getTime() + 150));
  assert.equal(subOk.broadcast, true);
  assert.equal(broadcasts, 2);

  // Crash apos broadcast: worker-3 tenta reenviar (NO-OP)
  const dupSub = await coordinator.submit(submission.id, "worker-3", adapter, new Date(now.getTime() + 300));
  assert.equal(dupSub.broadcast, false);
  assert.equal(broadcasts, 2);

  // Confirmacao
  const conf = await coordinator.confirm(submission.id, adapter);
  assert.equal(conf.confirmed, true);
  assert.equal(subStore.destination.status, "CONFIRMED");

  // Rejeicao de regressao de sequence
  await assert.rejects(
    catalog.reconcile({
      domainHash,
      origin: evmAct.origin,
      transaction: { family: "EVM", id: `0x${"9".repeat(64)}` },
      globalDomainEpoch: 1n,
      originSequence: 0n,
      finalizedAt: new Date(),
      actor: { type: "EVM_OBSERVER" },
      requestId: `regress-${runId}`,
    }),
    (err: unknown) => err instanceof OriginCatalogError && err.code === "ORIGIN_VERSION_REGRESSION",
  );

  steps.push({
    pillar: "PIPELINE_RESTART_RECOVERY",
    status: "PASS",
    details: "Recuperacao idempotente pos-crash: retoma lease, bloqueia broadcast redundante, confirma com finalidade e rejeita regressao de sequencia",
    latencyMs: Date.now() - s3Start,
  });

  const evidence = {
    schemaVersion: 1,
    task: "SM-081",
    runId,
    executedAt,
    status: "PASS",
    criteria: "Apenas uma origem vence e pipeline recupera sem regressão",
    dependencies: ["SM-046", "SM-058", "SM-079"],
    summary: {
      originConcurrencyPassed: true,
      sourceReorgHandlingPassed: true,
      crashRecoveryPassed: true,
      regressionRejectionPassed: true,
    },
    steps,
  };

  const gatewayRoot = resolve(import.meta.dirname, "..");
  const protocolRoot = resolve(gatewayRoot, "..");
  const evidencePath = resolve(protocolRoot, `evidence/sm-081/${runId}.json`);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o644 });

  process.stdout.write(`${JSON.stringify({ evidencePath, status: evidence.status, steps: steps.length })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exitCode = 1;
});
