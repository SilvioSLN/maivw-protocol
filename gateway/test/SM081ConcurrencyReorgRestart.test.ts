import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, padHex, stringToHex, type Hex } from "viem";
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
const EVM_REGISTRY = `0x${"0".repeat(24)}${"1".repeat(40)}` as Hex;
const SOLANA_REGISTRY = `0x${"2".repeat(64)}` as Hex;

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
    const now = new Date("2026-10-16T10:00:00Z");
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

test("SM-081: 1. Concorrência de Origem — Apenas uma origem vence e perdedora falha fail-closed", async () => {
  const memory = memoryCatalogDatabase();
  const catalog = new OriginCatalogService(memory.database as any);
  const domain = "concurrency-test.maivw.org";
  const domainHash = catalogDomainHash(domain);

  const evmActivation: ActivateOriginInput = {
    domain,
    origin: { family: "EVM", networkId: "evm:84532", registryId: EVM_REGISTRY },
    transaction: { family: "EVM", id: `0x${"a".repeat(64)}` },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date("2026-10-17T00:00:00.000Z"),
    actor: { type: "EVM_OBSERVER" },
    requestId: "req-concurrency-evm",
  };

  const solanaActivation: ActivateOriginInput = {
    domain,
    origin: { family: "SOLANA", networkId: "solana:devnet", registryId: SOLANA_REGISTRY },
    transaction: { family: "SOLANA", id: "5SolanaOriginTxSignature111111111111111111111111111" },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date("2026-10-17T00:00:00.000Z"),
    actor: { type: "SOLANA_OBSERVER" },
    requestId: "req-concurrency-solana",
  };

  // Executa concorrentemente
  const results = await Promise.allSettled([
    catalog.activate(evmActivation),
    catalog.activate(solanaActivation),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  assert.equal(fulfilled.length, 1, "Exatamente uma origem deve ser ativada");
  assert.equal(rejected.length, 1, "A origem concorrente deve ser rejeitada");
  assert.ok(rejected[0].reason instanceof OriginCatalogError);
  assert.equal(rejected[0].reason.code, "ORIGIN_ALREADY_ACTIVE");

  // Verifica que a base de dados tem exatamente 1 registro de origem
  assert.equal(memory.records.size, 1);
  const activeRecord = memory.records.get(domainHash);
  assert.ok(activeRecord);
  assert.equal(activeRecord.domain, domain);

  // Cadeia append-only íntegra e sem drift
  const verification = verifyOriginAuditChain(memory.audits);
  assert.equal(verification.valid, true);
});

test("SM-081: 2. Reorg de Origem — Evento órfão é isolado e compensações duráveis impedem regressão", async () => {
  const repository = new MemoryReorgStore();
  const service = new RelayReorgService(repository);
  const now = new Date("2026-10-17T01:00:00Z");

  // Cenário 2.1: Reorg antes de submeter aos destinos
  const unsubmittedJob: RelayJobRow = {
    id: "job-pre-submit", sourceEventKey: "event-pre-submit", domainHash: bytes(10), operation: "REGISTER",
    originNetworkFamily: "EVM", originNetworkId: "evm:84532", originRegistryId: bytes(11),
    sourceTransactionId: "tx-pre-submit", sourcePosition: "100:1", globalDomainEpoch: 1n, originSequence: 1n,
    status: "ATTESTED", sourceStateHash: bytes(12), detectedAt: now, finalizedAt: now, createdAt: now, updatedAt: now,
  };
  repository.jobs.set(unsubmittedJob.id, unsubmittedJob);
  repository.destinations.set("dest-pre-submit", {
    id: "dest-pre-submit", jobId: unsubmittedJob.id, destinationNetworkFamily: "SOLANA",
    destinationNetworkId: "solana:devnet", destinationRegistryId: bytes(13), status: "ATTESTED",
    attestationDigest: bytes(14), submissionId: null, confirmationReference: null,
    reconcileReference: null, createdAt: now, updatedAt: now,
  });

  const earlyReorg = await service.handle({
    sourceEventKey: unsubmittedJob.sourceEventKey,
    orphanedSourceReference: "evm:84532:block:500:fork-a",
    reason: "block hash diverged during shallow reorg",
    detectedAt: new Date(now.getTime() + 60_000),
  });

  assert.equal(earlyReorg.reorg.outcome, "ORPHANED");
  assert.equal(repository.jobs.get(unsubmittedJob.id)?.status, "ORPHANED");
  assert.equal(repository.destinations.get("dest-pre-submit")?.status, "ORPHANED");
  assert.equal(earlyReorg.compensations.length, 0, "Sem compensação para transação não transmitida");

  // Cenário 2.2: Reorg após submissão em destinos (materializado)
  const submittedJob: RelayJobRow = {
    id: "job-post-submit", sourceEventKey: "event-post-submit", domainHash: bytes(20), operation: "SYNC",
    originNetworkFamily: "SOLANA", originNetworkId: "solana:devnet", originRegistryId: bytes(21),
    sourceTransactionId: "tx-post-submit", sourcePosition: "200:1", globalDomainEpoch: 1n, originSequence: 2n,
    status: "SUBMITTED", sourceStateHash: bytes(22), detectedAt: now, finalizedAt: now, createdAt: now, updatedAt: now,
  };
  repository.jobs.set(submittedJob.id, submittedJob);
  repository.destinations.set("dest-evm-1", {
    id: "dest-evm-1", jobId: submittedJob.id, destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:84532", destinationRegistryId: bytes(23), status: "SUBMITTED",
    attestationDigest: bytes(24), submissionId: "tx-evm-submitted", confirmationReference: null,
    reconcileReference: null, createdAt: now, updatedAt: now,
  });
  repository.destinations.set("dest-evm-2", {
    id: "dest-evm-2", jobId: submittedJob.id, destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:421614", destinationRegistryId: bytes(25), status: "CONFIRMED",
    attestationDigest: bytes(26), submissionId: "tx-arb-confirmed", confirmationReference: "arb-block-100",
    reconcileReference: null, createdAt: now, updatedAt: now,
  });

  const lateReorg = await service.handle({
    sourceEventKey: submittedJob.sourceEventKey,
    orphanedSourceReference: "solana:slot:511928000:fork-x",
    reason: "slot pruned from finalized branch",
    detectedAt: new Date(now.getTime() + 120_000),
  });

  assert.equal(lateReorg.reorg.outcome, "COMPENSATION_REQUIRED");
  assert.equal(repository.jobs.get(submittedJob.id)?.status, "COMPENSATION_REQUIRED");
  assert.equal(lateReorg.compensations.length, 2, "Destinos materializados recebem compensação durável");
  assert.equal(repository.destinations.get("dest-evm-1")?.status, "COMPENSATION_REQUIRED");
  assert.equal(repository.destinations.get("dest-evm-2")?.status, "COMPENSATION_REQUIRED");

  // Rejeição de sinal divergente para o mesmo evento (anti-tamper)
  await assert.rejects(
    service.handle({
      sourceEventKey: submittedJob.sourceEventKey,
      orphanedSourceReference: "solana:slot:divergent",
      reason: "divergent conflicting reason",
      detectedAt: new Date(now.getTime() + 180_000),
    }),
    (error: unknown) => error instanceof RelayReorgError && error.code === "REORG_CONFLICT",
  );
});

test("SM-081: 3. Restart / Crash Recovery — Retoma lease, não duplica broadcast e rejeita regressão", async () => {
  const memory = new MemorySubmissionStore();
  const coordinator = new RelaySubmissionCoordinator(memory, new MultichainRelayJobService(memory), {
    leaseMs: 2_000,
    baseRetryMs: 200,
    maxRetryMs: 2_000,
  });

  const now = new Date("2026-10-17T02:00:00Z");
  const prepareData = {
    destinationId: "dest-sm081",
    idempotencyKey: "sm081:job:dest:v1",
    signedPayload: "0xdeadbeefcafebabe",
    expectedTransactionId: "0xexpected_tx_hash_123",
    deadline: new Date(now.getTime() + 600_000),
    now,
  };

  // 3.1: Preparação persistida antes de qualquer broadcast
  const { submission } = await coordinator.prepare(prepareData);
  assert.equal(submission.status, "PREPARED");

  // Worker 1 simula falha durante submissão (RPC temporariamente indisponível)
  let broadcastCount = 0;
  const adapter: RelayBroadcastAdapter = {
    broadcast: async ({ expectedTransactionId }) => {
      broadcastCount += 1;
      if (broadcastCount === 1) throw new Error("Worker 1 crashed or RPC dropped socket");
      return { transactionId: expectedTransactionId };
    },
    checkFinality: async () => ({ status: "PENDING" }),
  };

  await assert.rejects(
    coordinator.submit(submission.id, "worker-1", adapter, now),
    (error: unknown) => error instanceof RelaySubmissionError && error.code === "SUBMISSION_RETRY_SCHEDULED",
  );

  // Worker 2 tenta submeter antes do backoff (ainda não está pronto)
  await assert.rejects(
    coordinator.submit(submission.id, "worker-2", adapter, new Date(now.getTime() + 100)),
    (error: unknown) => error instanceof RelaySubmissionError && error.code === "SUBMISSION_RETRY_NOT_READY",
  );

  // Worker 2 reinicia após o backoff de 200ms e submete com sucesso
  const submitResult = await coordinator.submit(submission.id, "worker-2", adapter, new Date(now.getTime() + 250));
  assert.equal(submitResult.broadcast, true);
  assert.equal(submitResult.transactionId, "0xexpected_tx_hash_123");
  assert.equal(broadcastCount, 2);

  // 3.2: Crash pós-broadcast — Worker 3 reinicia e tenta submeter o mesmo job
  // Deve ser NO-OP (não retransmite bytes já transmitidos)
  const restartResult = await coordinator.submit(submission.id, "worker-3", adapter, new Date(now.getTime() + 500));
  assert.equal(restartResult.broadcast, false, "Restart pós-broadcast não deve retransmitir a transação");
  assert.equal(broadcastCount, 2, "Contador de broadcasts on-chain permanece inalterado");

  // 3.3: Confirmação após restart
  let finalityState: "PENDING" | "FINALIZED" = "PENDING";
  const finalizingAdapter: RelayBroadcastAdapter = {
    broadcast: async () => { throw new Error("não deve ser chamado"); },
    checkFinality: async () => finalityState === "FINALIZED"
      ? { status: "FINALIZED", reference: "slot:511929000" }
      : { status: "PENDING" },
  };

  const pendingConfirm = await coordinator.confirm(submission.id, finalizingAdapter);
  assert.equal(pendingConfirm.confirmed, false);

  finalityState = "FINALIZED";
  const confirmed = await coordinator.confirm(submission.id, finalizingAdapter);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.reference, "slot:511929000");
  assert.equal(memory.destination.status, "CONFIRMED");

  // 3.4: Rejeição de regressão de versão na reconciliação
  const catalogMem = memoryCatalogDatabase();
  const catalog = new OriginCatalogService(catalogMem.database as any);
  await catalog.activate({
    domain: "regression-check.org",
    origin: { family: "EVM", networkId: "evm:84532", registryId: EVM_REGISTRY },
    transaction: { family: "EVM", id: `0x${"1".repeat(64)}` },
    globalDomainEpoch: 1n,
    originSequence: 5n,
    finalizedAt: now,
    actor: { type: "EVM_OBSERVER" },
    requestId: "req-v5",
  });

  // Tenta regredir para sequence 4 após restart
  await assert.rejects(
    catalog.reconcile({
      domainHash: catalogDomainHash("regression-check.org"),
      origin: { family: "EVM", networkId: "evm:84532", registryId: EVM_REGISTRY },
      transaction: { family: "EVM", id: `0x${"2".repeat(64)}` },
      globalDomainEpoch: 1n,
      originSequence: 4n,
      finalizedAt: new Date(now.getTime() + 10_000),
      actor: { type: "EVM_OBSERVER" },
      requestId: "req-regression-attempt",
    }),
    (error: unknown) => error instanceof OriginCatalogError && error.code === "ORIGIN_VERSION_REGRESSION",
  );
});
