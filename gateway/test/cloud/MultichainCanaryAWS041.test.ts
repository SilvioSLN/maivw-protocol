import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { keccak256, padHex, stringToHex, type Address, type Hex } from "viem";

import {
  defineEvmNetwork,
  defineSolanaNetwork,
  NetworkCatalog,
  evmRegistryId,
  solanaRegistryId,
  type CanonicalDomainState,
} from "../../src/multichain/NetworkModel.js";
import {
  OriginCatalogError,
  OriginCatalogService,
  catalogDomainHash,
  verifyOriginAuditChain,
  type ActivateOriginInput,
} from "../../src/multichain/OriginCatalog.js";
import {
  RelayFanoutService,
  type FanoutDestination,
  type PreparedRelayTransactionSigner,
} from "../../src/multichain/RelayFanout.js";
import { createAttestationSigner } from "../../src/multichain/AttestationSigner.js";
import {
  RelaySubmissionCoordinator,
  RelaySubmissionError,
  type RelayBroadcastAdapter,
  type RelaySubmissionRow,
  type RelaySubmissionStore,
  type SubmissionAttemptInput,
} from "../../src/multichain/RelaySubmission.js";
import {
  MultichainRelayJobService,
  type RelayDestinationRow,
  type RelayJobRepository,
  type RelayJobRow,
  type RelayStatus,
  type RelayTransitionInput,
} from "../../src/multichain/MultichainRelayJob.js";
import {
  RelayReorgError,
  RelayReorgService,
  type RelayCompensationRow,
  type RelayReorgRepository,
  type RelayReorgRow,
} from "../../src/multichain/RelayReorg.js";
import {
  MultichainReconciliationService,
  type ReconciliationFindingRow,
  type ReconciliationRepository,
  type ReconciliationRunRow,
} from "../../src/multichain/MultichainReconciliation.js";
import {
  RelayCircuitBreakerService,
  type RelayCircuitBreakerRow,
  type RelayCircuitEventRow,
  type RelayCircuitBreakerRepository,
} from "../../src/multichain/RelayCircuitBreaker.js";
import { MultichainAlertService } from "../../src/multichain/MultichainAlerts.js";

import { hashNetworkId } from "../../src/multichain/AttestationCodec.js";

// =============================================================================
// Constantes e Utilitários de Teste Multichain
// =============================================================================
const bytes = (value: number): Hex => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const hashNetwork = (networkId: string) => keccak256(stringToHex(networkId));
const PRIVATE_KEY = `0x${"00".repeat(31)}01` as Hex;

const REGISTRY_BASE_SEPOLIA = ("0x" + "1".repeat(40)) as Address;
const REGISTRY_ARB_SEPOLIA = ("0x" + "2".repeat(40)) as Address;
const REGISTRY_POLYGON_AMOY = ("0x" + "3".repeat(40)) as Address;
const PROGRAM_SOLANA_DEVNET = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";

class FakeJobs {
  readonly attested: Array<{ destinationId: string; digest: string }> = [];
  async advanceDestination(input: any) {
    this.attested.push({ destinationId: input.destinationId, digest: input.artifactHash });
    return { destination: {}, changed: true } as any;
  }
}

class FakeSubmissions {
  readonly rows = new Map<string, RelaySubmissionRow>();
  async getByDestination(destinationId: string) {
    return [...this.rows.values()].find((row) => row.destinationId === destinationId) ?? null;
  }
  async prepare(input: any) {
    const row = {
      id: `submission:${input.destinationId}`,
      destinationId: input.destinationId,
      expectedTransactionId: input.expectedTransactionId,
      signedPayload: input.signedPayload,
      idempotencyKey: input.idempotencyKey,
    } as RelaySubmissionRow;
    this.rows.set(row.id, row);
    return { submission: row, created: true };
  }
  async submit(id: string, _worker: string, adapter: RelayBroadcastAdapter) {
    const row = this.rows.get(id)!;
    const result = await adapter.broadcast({
      signedPayload: row.signedPayload,
      expectedTransactionId: row.expectedTransactionId,
      idempotencyKey: row.idempotencyKey,
    });
    return { transactionId: result.transactionId, broadcast: true };
  }
}

function makeAdapter(): RelayBroadcastAdapter {
  return {
    broadcast: async ({ expectedTransactionId }) => ({ transactionId: expectedTransactionId }),
    checkFinality: async () => ({ status: "FINALIZED", reference: "ref:block:999" }),
  };
}

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
    findMany: async ({ where, take }: any) =>
      audits.filter((event) => event.domainHash === where.domainHash).slice(0, take),
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

  async transaction<T>(operation: (repository: RelayReorgRepository) => Promise<T>) {
    return operation(this);
  }
  async findJobBySourceEventKey(key: string) {
    return [...this.jobs.values()].find((job) => job.sourceEventKey === key) ?? null;
  }
  async listDestinations(jobId: string) {
    return [...this.destinations.values()].filter((destination) => destination.jobId === jobId);
  }
  async findReorgByJobId(jobId: string) {
    return this.reorgs.find((reorg) => reorg.jobId === jobId) ?? null;
  }
  async listCompensations(reorgId: string) {
    return this.compensations.filter((item) => item.reorgId === reorgId);
  }
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
  async appendTransition(input: RelayTransitionInput) {
    this.transitions.push(input);
  }
}

class MemorySubmissionStore implements RelayJobRepository, RelaySubmissionStore {
  readonly jobs = new Map<string, RelayJobRow>();
  readonly destinations = new Map<string, RelayDestinationRow>();
  readonly submissions = new Map<string, RelaySubmissionRow>();
  readonly attempts: SubmissionAttemptInput[] = [];
  readonly transitions: RelayTransitionInput[] = [];

  async transaction<T>(operation: (store: any) => Promise<T>): Promise<T> {
    return operation(this);
  }
  async getDestination(id: string) {
    return this.destinations.get(id) ?? null;
  }
  async findByDestination(id: string) {
    return [...this.submissions.values()].find((s) => s.destinationId === id) ?? null;
  }
  async create(row: RelaySubmissionRow) {
    this.submissions.set(row.id, row);
  }
  async claim(id: string, workerId: string, now: Date, leaseUntil: Date) {
    const submission = this.submissions.get(id);
    if (
      !submission ||
      submission.status !== "PREPARED" ||
      submission.nextAttemptAt > now ||
      (submission.leaseUntil && submission.leaseUntil > now)
    ) {
      return false;
    }
    this.submissions.set(id, {
      ...submission,
      leaseOwner: workerId,
      leaseUntil,
      attempts: submission.attempts + 1,
    });
    return true;
  }
  async get(id: string) {
    return this.submissions.get(id) ?? null;
  }
  async markBroadcast(id: string, worker: string, transactionId: string, at: Date) {
    const submission = this.submissions.get(id);
    if (!submission || submission.leaseOwner !== worker) return false;
    this.submissions.set(id, {
      ...submission,
      status: "BROADCAST",
      expectedTransactionId: transactionId,
      leaseOwner: null,
      leaseUntil: null,
      submittedAt: at,
      updatedAt: at,
    });
    return true;
  }
  async releaseForRetry(id: string, worker: string, error: string, next: Date, at: Date) {
    const submission = this.submissions.get(id);
    if (!submission || submission.leaseOwner !== worker) return false;
    this.submissions.set(id, {
      ...submission,
      leaseOwner: null,
      leaseUntil: null,
      lastError: error,
      nextAttemptAt: next,
      updatedAt: at,
    });
    return true;
  }
  async markConfirmed(id: string, reference: string, at: Date) {
    const submission = this.submissions.get(id);
    if (!submission || submission.status !== "BROADCAST") return false;
    this.submissions.set(id, {
      ...submission,
      status: "CONFIRMED",
      finalityReference: reference,
      confirmedAt: at,
      updatedAt: at,
    });
    return true;
  }
  async appendAttempt(input: SubmissionAttemptInput) {
    this.attempts.push(input);
  }

  async findJobById(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async findJobBySourceEventKey(key: string) {
    return [...this.jobs.values()].find((j) => j.sourceEventKey === key) ?? null;
  }
  async createJob(job: RelayJobRow) {
    this.jobs.set(job.id, job);
  }
  async compareAndSetJob(id: string, expected: RelayStatus, data: Partial<RelayJobRow>) {
    const job = this.jobs.get(id);
    if (!job || job.status !== expected) return false;
    Object.assign(job, data);
    return true;
  }
  async listDestinations(jobId: string) {
    return [...this.destinations.values()].filter((d) => d.jobId === jobId);
  }
  async findDestination(id: string) {
    return this.destinations.get(id) ?? null;
  }
  async compareAndSetDestination(id: string, expected: RelayStatus, data: Partial<RelayDestinationRow>) {
    const destination = this.destinations.get(id);
    if (!destination || destination.status !== expected) return false;
    Object.assign(destination, data);
    return true;
  }
  async advanceAllDestinations() {
    return 0;
  }
  async appendTransition(input: RelayTransitionInput) {
    this.transitions.push(input);
  }
}

class MemoryReconciliationRepository implements ReconciliationRepository {
  readonly runs: ReconciliationRunRow[] = [];
  readonly findings: ReconciliationFindingRow[] = [];
  async transaction<T>(operation: (repository: ReconciliationRepository) => Promise<T>) {
    return operation(this);
  }
  async findRunByRequestId(requestId: string) {
    return this.runs.find((run) => run.requestId === requestId) ?? null;
  }
  async listFindings(runId: string) {
    return this.findings.filter((finding) => finding.runId === runId);
  }
  async lastRun(domainHash: string) {
    return [...this.runs].reverse().find((run) => run.domainHash === domainHash) ?? null;
  }
  async createRun(run: ReconciliationRunRow, findings: readonly ReconciliationFindingRow[]) {
    this.runs.push(run);
    this.findings.push(...findings);
  }
}

class MemoryCircuitBreakerRepository implements RelayCircuitBreakerRepository {
  readonly breakers = new Map<string, RelayCircuitBreakerRow>();
  readonly events: RelayCircuitEventRow[] = [];

  async transaction<T>(operation: (repository: RelayCircuitBreakerRepository) => Promise<T>) {
    return operation(this);
  }
  async findBreaker(scopeKey: string) {
    return this.breakers.get(scopeKey) ?? null;
  }
  async findOpenBreakers(scopeKeys: readonly string[]) {
    return [...this.breakers.values()].filter(
      (breaker) => scopeKeys.includes(breaker.scopeKey) && breaker.status === "OPEN",
    );
  }
  async findEvent(scopeKey: string, requestId: string) {
    const breaker = this.breakers.get(scopeKey);
    return (
      this.events.find((event) => event.breakerId === breaker?.id && event.requestId === requestId) ?? null
    );
  }
  async createBreaker(row: RelayCircuitBreakerRow) {
    this.breakers.set(row.scopeKey, row);
  }
  async updateBreaker(
    id: string,
    expectedVersion: number,
    next: Pick<
      RelayCircuitBreakerRow,
      "status" | "triggerSignal" | "reason" | "consecutiveFailures" | "openedAt" | "resetAt" | "lastAuditHash"
    >,
    at: Date,
  ) {
    const breaker = [...this.breakers.values()].find((item) => item.id === id);
    if (!breaker || breaker.version !== expectedVersion) return false;
    this.breakers.set(breaker.scopeKey, {
      ...breaker,
      ...next,
      version: breaker.version + 1,
      updatedAt: at,
    });
    return true;
  }
  async createEvent(row: RelayCircuitEventRow) {
    this.events.push(row);
  }
}

// =============================================================================
// Suíte de Testes Canário Multichain (AWS-041)
// =============================================================================
test("AWS-041: Canário multichain, concorrência, restart, reorg e reconciliação", async () => {
  console.log("\n=== INICIANDO ENSAIO CANÁRIO MULTICHAIN COMPLETO (AWS-041) ===");

  const timeline: Array<{ step: string; timestamp: string; details: Record<string, any> }> = [];
  const recordStep = (step: string, details: Record<string, any>) => {
    const entry = { step, timestamp: new Date().toISOString(), details };
    timeline.push(entry);
    console.log(`[CANARY STEP] ${step.padEnd(35)} ->`, JSON.stringify(details));
  };

  // ===========================================================================
  // 1. Matriz Canário das 4 Redes Válidas
  // ===========================================================================
  const baseSepolia = defineEvmNetwork({
    chainId: 84532,
    name: "Base Sepolia Testnet",
    rpcUrl: "https://sepolia.base.org",
    registryAddress: REGISTRY_BASE_SEPOLIA,
    explorerUrl: "https://sepolia.basescan.org",
    asset: { kind: "NATIVE", symbol: "ETH", decimals: 18 },
    finality: { confirmations: 2, reorgMarginBlocks: 10 },
    capabilities: { origin: true, mirror: true },
  });

  const arbitrumSepolia = defineEvmNetwork({
    chainId: 421614,
    name: "Arbitrum Sepolia Testnet",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    registryAddress: REGISTRY_ARB_SEPOLIA,
    explorerUrl: "https://sepolia.arbiscan.io",
    asset: { kind: "NATIVE", symbol: "ETH", decimals: 18 },
    finality: { confirmations: 2, reorgMarginBlocks: 10 },
    capabilities: { origin: true, mirror: true },
  });

  const polygonAmoy = defineEvmNetwork({
    chainId: 80002,
    name: "Polygon Amoy Testnet",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    registryAddress: REGISTRY_POLYGON_AMOY,
    explorerUrl: "https://amoy.polygonscan.com",
    asset: { kind: "NATIVE", symbol: "POL", decimals: 18 },
    finality: { confirmations: 3, reorgMarginBlocks: 15 },
    capabilities: { origin: true, mirror: true },
  });

  const solanaDevnet = defineSolanaNetwork({
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    name: "Solana Devnet",
    rpcUrl: "https://api.devnet.solana.com",
    programId: PROGRAM_SOLANA_DEVNET,
    explorerUrl: "https://explorer.solana.com",
    explorerClusterQuery: "cluster=devnet",
    asset: { kind: "NATIVE", symbol: "SOL", decimals: 9 },
    finality: { reorgMarginSlots: 32 },
    capabilities: { origin: true, mirror: true },
  });

  const catalog = new NetworkCatalog([baseSepolia, arbitrumSepolia, polygonAmoy, solanaDevnet]);
  assert.equal(catalog.list().length, 4, "Catálogo deve registrar exatamente 4 redes canário");
  assert.ok(catalog.get("evm:84532"));
  assert.ok(catalog.get("evm:421614"));
  assert.ok(catalog.get("evm:80002"));
  assert.ok(catalog.get(solanaDevnet.networkId));

  recordStep("CANARY_NETWORK_CATALOG_READY", {
    networks: catalog.list().map((n) => ({ id: n.networkId, family: n.family, name: n.name })),
    totalNetworks: 4,
  });

  // ===========================================================================
  // 2. Propagação de Origem EVM (Base Sepolia -> Arbitrum, Polygon, Solana)
  // ===========================================================================
  const evmDomain = "alpha-corp.test.maivw.com";
  const evmKey = padHex("0x1111111111111111111111111111111111111111", { size: 32 });
  const evmState: CanonicalDomainState = {
    domain: evmDomain,
    domainHash: keccak256(stringToHex(evmDomain)),
    recordKind: "ORIGIN",
    originFamily: "EVM",
    originNetworkHash: hashNetworkId("evm:84532"),
    originRegistry: baseSepolia.registryId,
    operationalKey: { algorithm: 1, value: evmKey },
    adminKey: { algorithm: 1, value: evmKey },
    endpoint: `https://${evmDomain}/inbox`,
    tlsFingerprint: `0x${"aa".repeat(32)}` as Hex,
    status: "ACTIVE",
    globalDomainEpoch: 1n,
    originSequence: 1n,
    isProvider: false,
    providerTier: 0,
    strikes: 0,
    registrationTime: 1_700_000_000n,
    updatedAt: 1_700_000_001n,
    attestedStake: 50_000_000n,
    attestedDailyLimit: 0n,
    originTransactionFamily: "EVM",
    originTransaction: `0x${"bb".repeat(32)}` as Hex,
    schemaVersion: 2,
  };

  const attestationSigner = await createAttestationSigner({
    ORACLE_SIGNER_TYPE: "local",
    ORACLE_PRIVATE_KEY: PRIVATE_KEY,
    GCP_KMS_KEY_VERSION: undefined,
    GCP_KMS_CREDENTIALS_BASE64: undefined,
  });

  const txSigner: PreparedRelayTransactionSigner = {
    async sign(input) {
      const suffix = input.family === "EVM" ? "evm" : "solana";
      return { signedPayload: `signed-${suffix}-payload`, transactionId: `tx-${suffix}-${crypto.randomBytes(8).toString("hex")}` };
    },
  };

  const destinationsEVMtoMirrors: FanoutDestination[] = [
    {
      family: "EVM",
      destinationId: "dest-arb",
      networkId: "evm:421614",
      networkHash: hashNetworkId("evm:421614"),
      mirrorRegistry: REGISTRY_ARB_SEPOLIA,
      adapter: makeAdapter(),
    },
    {
      family: "EVM",
      destinationId: "dest-polygon",
      networkId: "evm:80002",
      networkHash: hashNetworkId("evm:80002"),
      mirrorRegistry: REGISTRY_POLYGON_AMOY,
      adapter: makeAdapter(),
    },
    {
      family: "SOLANA",
      destinationId: "dest-solana",
      networkId: solanaDevnet.networkId,
      networkHash: hashNetworkId(solanaDevnet.networkId),
      programId: PROGRAM_SOLANA_DEVNET,
      relayer: "11111111111111111111111111111111",
      adapter: makeAdapter(),
    },
  ];

  const fanoutServiceEVM = new RelayFanoutService(
    new FakeJobs() as any,
    new FakeSubmissions() as any,
    attestationSigner,
    txSigner,
  );

  const fanoutPlanEVM = await fanoutServiceEVM.execute({
    jobId: "job-evm-01",
    operation: "REGISTER",
    state: evmState,
    attestationDeadline: BigInt(Math.floor(Date.now() / 1_000) + 3_600),
    destinations: destinationsEVMtoMirrors,
    workerId: "worker-canary-01",
  });

  assert.equal(fanoutPlanEVM.length, 3, "Origem EVM deve gerar espelhos para as 3 redes restantes");
  for (const mirror of fanoutPlanEVM) {
    assert.equal(mirror.status, "SUBMITTED");
    assert.ok(mirror.transactionId);
  }

  recordStep("EVM_ORIGIN_FANOUT_CONVERGED", {
    domain: evmDomain,
    originNetwork: "evm:84532",
    mirrorsDispatched: fanoutPlanEVM.map((m) => ({ destination: m.destinationId, txId: m.transactionId })),
  });

  // ===========================================================================
  // 3. Propagação de Origem Solana (Solana Devnet -> Base, Arbitrum, Polygon)
  // ===========================================================================
  const solanaDomain = "beta-solana.test.maivw.com";
  const solanaState: CanonicalDomainState = {
    domain: solanaDomain,
    domainHash: keccak256(stringToHex(solanaDomain)),
    recordKind: "ORIGIN",
    originFamily: "SOLANA",
    originNetworkHash: hashNetworkId(solanaDevnet.networkId),
    originRegistry: solanaDevnet.registryId,
    operationalKey: { algorithm: 2, value: `0x${"77".repeat(32)}` as Hex },
    adminKey: { algorithm: 2, value: `0x${"88".repeat(32)}` as Hex },
    endpoint: `https://${solanaDomain}/inbox`,
    tlsFingerprint: `0x${"99".repeat(32)}` as Hex,
    status: "ACTIVE",
    globalDomainEpoch: 1n,
    originSequence: 1n,
    isProvider: false,
    providerTier: 0,
    strikes: 0,
    registrationTime: 1_700_000_100n,
    updatedAt: 1_700_000_101n,
    attestedStake: 100_000_000n,
    attestedDailyLimit: 0n,
    originTransactionFamily: "SOLANA",
    originTransaction: ("0x" + crypto.createHash("sha256").update("5SolanaOriginTxMocked111111111111111111111111111111111").digest("hex")) as Hex,
    schemaVersion: 2,
  };

  const destinationsSolanaToMirrors: FanoutDestination[] = [
    {
      family: "EVM",
      destinationId: "dest-base",
      networkId: "evm:84532",
      networkHash: hashNetworkId("evm:84532"),
      mirrorRegistry: REGISTRY_BASE_SEPOLIA,
      adapter: makeAdapter(),
    },
    {
      family: "EVM",
      destinationId: "dest-arb-from-sol",
      networkId: "evm:421614",
      networkHash: hashNetworkId("evm:421614"),
      mirrorRegistry: REGISTRY_ARB_SEPOLIA,
      adapter: makeAdapter(),
    },
    {
      family: "EVM",
      destinationId: "dest-polygon-from-sol",
      networkId: "evm:80002",
      networkHash: hashNetworkId("evm:80002"),
      mirrorRegistry: REGISTRY_POLYGON_AMOY,
      adapter: makeAdapter(),
    },
  ];

  const fanoutServiceSolana = new RelayFanoutService(
    new FakeJobs() as any,
    new FakeSubmissions() as any,
    attestationSigner,
    txSigner,
  );

  const fanoutPlanSolana = await fanoutServiceSolana.execute({
    jobId: "job-sol-01",
    operation: "REGISTER",
    state: solanaState,
    attestationDeadline: BigInt(Math.floor(Date.now() / 1_000) + 3_600),
    destinations: destinationsSolanaToMirrors,
    workerId: "worker-canary-02",
  });

  assert.equal(fanoutPlanSolana.length, 3, "Origem Solana deve gerar espelhos para as 3 redes EVM");
  for (const mirror of fanoutPlanSolana) {
    assert.equal(mirror.status, "SUBMITTED");
    assert.ok(mirror.transactionId);
  }

  recordStep("SOLANA_ORIGIN_FANOUT_CONVERGED", {
    domain: solanaDomain,
    originNetwork: solanaDevnet.networkId,
    mirrorsDispatched: fanoutPlanSolana.map((m) => ({ destination: m.destinationId, txId: m.transactionId })),
  });

  // ===========================================================================
  // 4. Prevenção de Concorrência e Dupla Execução (Race Condition EVM vs Solana)
  // ===========================================================================
  const raceMemory = memoryCatalogDatabase();
  const raceCatalog = new OriginCatalogService(raceMemory.database as any);
  const raceDomain = "contested-race-domain.test.maivw.com";

  const evmActivationInput: ActivateOriginInput = {
    domain: raceDomain,
    origin: { family: "EVM", networkId: "evm:84532", registryId: baseSepolia.registryId },
    transaction: { family: "EVM", id: `0x${"a".repeat(64)}` },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date(),
    actor: { type: "EVM_OBSERVER" },
    requestId: "req-race-evm-01",
  };

  const solanaActivationInput: ActivateOriginInput = {
    domain: raceDomain,
    origin: { family: "SOLANA", networkId: solanaDevnet.networkId, registryId: solanaDevnet.registryId },
    transaction: { family: "SOLANA", id: "5SolanaRaceTxSignature111111111111111111111111111111" },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date(),
    actor: { type: "SOLANA_OBSERVER" },
    requestId: "req-race-solana-01",
  };

  // Executa simultaneamente (corrida de origens)
  const raceResults = await Promise.allSettled([
    raceCatalog.activate(evmActivationInput),
    raceCatalog.activate(solanaActivationInput),
  ]);

  const raceFulfilled = raceResults.filter((r) => r.status === "fulfilled");
  const raceRejected = raceResults.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  assert.equal(raceFulfilled.length, 1, "Exatamente uma origem deve vencer a corrida");
  assert.equal(raceRejected.length, 1, "A origem perdedora deve falhar fail-closed");
  assert.ok(raceRejected[0].reason instanceof OriginCatalogError);
  assert.equal(raceRejected[0].reason.code, "ORIGIN_ALREADY_ACTIVE");
  assert.equal(raceMemory.records.size, 1, "Apenas um registro canônico deve ser persistido no banco");

  const auditVerification = verifyOriginAuditChain(raceMemory.audits);
  assert.equal(auditVerification.valid, true, "Cadeia de auditoria deve ser estritamente consistente e append-only");

  recordStep("ORIGIN_CONCURRENCY_PREVENTED", {
    contestedDomain: raceDomain,
    winnerStatus: "ACTIVATED",
    loserStatus: "REJECTED_ORIGIN_ALREADY_ACTIVE",
    auditChainValid: true,
  });

  // ===========================================================================
  // 5. Resiliência a Restart e Crash Recovery de Workers
  // ===========================================================================
  const crashStore = new MemorySubmissionStore();
  const coordinator = new RelaySubmissionCoordinator(crashStore, new MultichainRelayJobService(crashStore), {
    leaseMs: 2_000,
    baseRetryMs: 200,
    maxRetryMs: 2_000,
  });

  const now = new Date();
  const submissionJobRow: RelayJobRow = {
    id: "job-crash-test",
    sourceEventKey: "event-crash-key",
    domainHash: bytes(1),
    operation: "REGISTER",
    originNetworkFamily: "EVM",
    originNetworkId: "evm:84532",
    originRegistryId: baseSepolia.registryId,
    sourceTransactionId: "tx-source-crash-01",
    sourcePosition: "100:1",
    globalDomainEpoch: 1n,
    originSequence: 1n,
    status: "ATTESTED",
    sourceStateHash: bytes(2),
    detectedAt: now,
    finalizedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  crashStore.jobs.set(submissionJobRow.id, submissionJobRow);

  const submissionDestRow: RelayDestinationRow = {
    id: "dest-crash-test",
    jobId: submissionJobRow.id,
    destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:421614",
    destinationRegistryId: arbitrumSepolia.registryId,
    status: "ATTESTED",
    attestationDigest: bytes(3),
    submissionId: null,
    confirmationReference: null,
    reconcileReference: null,
    createdAt: now,
    updatedAt: now,
  };
  crashStore.destinations.set(submissionDestRow.id, submissionDestRow);

  // 5.1: Preparação antes do broadcast
  const { submission: preparedSub } = await coordinator.prepare({
    destinationId: submissionDestRow.id,
    idempotencyKey: "idemp:canary:crash:v1",
    signedPayload: "0xdeadbeef",
    expectedTransactionId: "0xexpected_broadcast_tx_hash_999",
    deadline: new Date(now.getTime() + 600_000),
    now,
  });
  assert.equal(preparedSub.status, "PREPARED");

  // 5.2: Simulação de Crash do Worker 1 durante o envio
  let realBroadcastCalls = 0;
  const flakeyAdapter: RelayBroadcastAdapter = {
    broadcast: async ({ expectedTransactionId }) => {
      realBroadcastCalls += 1;
      if (realBroadcastCalls === 1) throw new Error("Worker 1 connection drop / RPC socket reset");
      return { transactionId: expectedTransactionId };
    },
    checkFinality: async () => ({ status: "PENDING" }),
  };

  await assert.rejects(
    coordinator.submit(preparedSub.id, "worker-1", flakeyAdapter, now),
    (err: any) => err instanceof RelaySubmissionError && err.code === "SUBMISSION_RETRY_SCHEDULED",
  );

  // Worker 2 tenta submeter antes do tempo de backoff
  await assert.rejects(
    coordinator.submit(preparedSub.id, "worker-2", flakeyAdapter, new Date(now.getTime() + 50)),
    (err: any) => err instanceof RelaySubmissionError && err.code === "SUBMISSION_RETRY_NOT_READY",
  );

  // Worker 2 retoma o lease após o backoff de 200ms e transmite com sucesso
  const submitRecovery = await coordinator.submit(
    preparedSub.id,
    "worker-2",
    flakeyAdapter,
    new Date(now.getTime() + 250),
  );
  assert.equal(submitRecovery.broadcast, true);
  assert.equal(submitRecovery.transactionId, "0xexpected_broadcast_tx_hash_999");
  assert.equal(realBroadcastCalls, 2);

  // 5.3: Crash pós-broadcast: Worker 3 reinicia e tenta retransmitir o mesmo job
  // Deve ser NO-OP absoluto (não duplica broadcast na blockchain)
  const restartNoOp = await coordinator.submit(
    preparedSub.id,
    "worker-3",
    flakeyAdapter,
    new Date(now.getTime() + 500),
  );
  assert.equal(restartNoOp.broadcast, false, "Restart pós-broadcast não deve retransmitir a transação");
  assert.equal(realBroadcastCalls, 2, "Contador de broadcasts on-chain permanece rigorosamente inalterado em 2");

  // 5.4: Confirmação de Finalidade pós-restart
  let isTargetFinalized = false;
  const finalityAdapter: RelayBroadcastAdapter = {
    broadcast: async () => {
      throw new Error("Não deve ser chamado");
    },
    checkFinality: async () =>
      isTargetFinalized
        ? { status: "FINALIZED", reference: "arb:block:987654" }
        : { status: "PENDING" },
  };

  const confirmPending = await coordinator.confirm(preparedSub.id, finalityAdapter);
  assert.equal(confirmPending.confirmed, false);

  isTargetFinalized = true;
  const confirmSuccess = await coordinator.confirm(preparedSub.id, finalityAdapter);
  assert.equal(confirmSuccess.confirmed, true);
  assert.equal(confirmSuccess.reference, "arb:block:987654");
  assert.equal(crashStore.destinations.get(submissionDestRow.id)?.status, "CONFIRMED");

  // 5.5: Rejeição de regressão de versão na origem
  await assert.rejects(
    raceCatalog.reconcile({
      domainHash: catalogDomainHash(raceDomain),
      origin: { family: "EVM", networkId: "evm:84532", registryId: baseSepolia.registryId },
      transaction: { family: "EVM", id: `0x${"f".repeat(64)}` },
      globalDomainEpoch: 1n,
      originSequence: 0n, // Tentativa de regressão de versão (era 1n)
      finalizedAt: new Date(),
      actor: { type: "EVM_OBSERVER" },
      requestId: "req-regression-bad",
    }),
    (err: any) => err instanceof OriginCatalogError && err.code === "ORIGIN_VERSION_REGRESSION",
  );

  recordStep("WORKER_CRASH_RECOVERY_NO_DOUBLE_BROADCAST", {
    submissionId: preparedSub.id,
    broadcastCalls: realBroadcastCalls,
    restartNoOpValidated: true,
    finalityConfirmed: true,
    versionRegressionBlocked: true,
  });

  // ===========================================================================
  // 6. Detecção e Tratamento de Reorganizações de Cadeia (Reorg)
  // ===========================================================================
  const reorgRepo = new MemoryReorgStore();
  const reorgService = new RelayReorgService(reorgRepo);

  // 6.1: Reorg raso (antes da submissão aos destinos)
  const unsubmittedJob: RelayJobRow = {
    id: "job-shallow-reorg",
    sourceEventKey: "event-shallow-key",
    domainHash: bytes(10),
    operation: "REGISTER",
    originNetworkFamily: "EVM",
    originNetworkId: "evm:84532",
    originRegistryId: baseSepolia.registryId,
    sourceTransactionId: "tx-shallow-source",
    sourcePosition: "50:1",
    globalDomainEpoch: 1n,
    originSequence: 1n,
    status: "ATTESTED",
    sourceStateHash: bytes(11),
    detectedAt: now,
    finalizedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  reorgRepo.jobs.set(unsubmittedJob.id, unsubmittedJob);
  reorgRepo.destinations.set("dest-shallow-01", {
    id: "dest-shallow-01",
    jobId: unsubmittedJob.id,
    destinationNetworkFamily: "SOLANA",
    destinationNetworkId: solanaDevnet.networkId,
    destinationRegistryId: solanaDevnet.registryId,
    status: "ATTESTED",
    attestationDigest: bytes(12),
    submissionId: null,
    confirmationReference: null,
    reconcileReference: null,
    createdAt: now,
    updatedAt: now,
  });

  const shallowReorgResult = await reorgService.handle({
    sourceEventKey: unsubmittedJob.sourceEventKey,
    orphanedSourceReference: "evm:84532:block:100:fork-shallow",
    reason: "block hash diverged during shallow 1-block reorg",
    detectedAt: new Date(),
  });

  assert.equal(shallowReorgResult.reorg.outcome, "ORPHANED");
  assert.equal(reorgRepo.jobs.get(unsubmittedJob.id)?.status, "ORPHANED");
  assert.equal(shallowReorgResult.compensations.length, 0, "Reorg raso sem broadcast não gera compensação");

  // 6.2: Reorg profundo e materializado (após submissão ou confirmação em destinos)
  const submittedJob: RelayJobRow = {
    id: "job-deep-reorg",
    sourceEventKey: "event-deep-key",
    domainHash: bytes(20),
    operation: "SYNC",
    originNetworkFamily: "SOLANA",
    originNetworkId: solanaDevnet.networkId,
    originRegistryId: solanaDevnet.registryId,
    sourceTransactionId: "5SolanaDeepReorgSource11111111111111111111111111",
    sourcePosition: "5000:2",
    globalDomainEpoch: 1n,
    originSequence: 2n,
    status: "SUBMITTED",
    sourceStateHash: bytes(21),
    detectedAt: now,
    finalizedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  reorgRepo.jobs.set(submittedJob.id, submittedJob);
  reorgRepo.destinations.set("dest-mat-01", {
    id: "dest-mat-01",
    jobId: submittedJob.id,
    destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:84532",
    destinationRegistryId: baseSepolia.registryId,
    status: "SUBMITTED",
    attestationDigest: bytes(22),
    submissionId: "tx-evm-base-mat",
    confirmationReference: null,
    reconcileReference: null,
    createdAt: now,
    updatedAt: now,
  });
  reorgRepo.destinations.set("dest-mat-02", {
    id: "dest-mat-02",
    jobId: submittedJob.id,
    destinationNetworkFamily: "EVM",
    destinationNetworkId: "evm:421614",
    destinationRegistryId: arbitrumSepolia.registryId,
    status: "CONFIRMED",
    attestationDigest: bytes(23),
    submissionId: "tx-evm-arb-mat",
    confirmationReference: "arb-block-confirmed-99",
    reconcileReference: null,
    createdAt: now,
    updatedAt: now,
  });

  const deepReorgResult = await reorgService.handle({
    sourceEventKey: submittedJob.sourceEventKey,
    orphanedSourceReference: "solana:slot:511999999:fork-pruned",
    reason: "slot dropped from finalized canonical branch",
    detectedAt: new Date(),
  });

  assert.equal(deepReorgResult.reorg.outcome, "COMPENSATION_REQUIRED");
  assert.equal(reorgRepo.jobs.get(submittedJob.id)?.status, "COMPENSATION_REQUIRED");
  assert.equal(deepReorgResult.compensations.length, 2, "Destinos materializados devem receber compensação durável");
  assert.equal(reorgRepo.destinations.get("dest-mat-01")?.status, "COMPENSATION_REQUIRED");
  assert.equal(reorgRepo.destinations.get("dest-mat-02")?.status, "COMPENSATION_REQUIRED");

  // Rejeição de sinal divergente para o mesmo evento (anti-tamper)
  await assert.rejects(
    reorgService.handle({
      sourceEventKey: submittedJob.sourceEventKey,
      orphanedSourceReference: "solana:slot:tampered",
      reason: "conflicting divergent tamper signal",
      detectedAt: new Date(),
    }),
    (err: any) => err instanceof RelayReorgError && err.code === "REORG_CONFLICT",
  );

  recordStep("CHAIN_REORG_HANDLED_WITH_COMPENSATION", {
    shallowReorgOutcome: shallowReorgResult.reorg.outcome,
    deepReorgOutcome: deepReorgResult.reorg.outcome,
    compensationsScheduled: deepReorgResult.compensations.length,
    antiTamperVerified: true,
  });

  // ===========================================================================
  // 7. Reconciliação Multichain, Detecção de Divergência e Fail-Closed
  // ===========================================================================
  const reconRepo = new MemoryReconciliationRepository();
  const reconService = new MultichainReconciliationService(reconRepo);
  const circuitRepo = new MemoryCircuitBreakerRepository();
  const circuitBreaker = new RelayCircuitBreakerService(circuitRepo as any);
  const alertService = new MultichainAlertService();

  const domainCanonical = evmState;
  const inSyncMirror: CanonicalDomainState = {
    ...domainCanonical,
    recordKind: "MIRROR",
    updatedAt: domainCanonical.updatedAt + 1n,
  };

  const behindMirror: CanonicalDomainState = {
    ...domainCanonical,
    recordKind: "MIRROR",
    originSequence: domainCanonical.originSequence - 1n, // Atrasado
    updatedAt: domainCanonical.updatedAt,
  };

  const driftedMirror: CanonicalDomainState = {
    ...domainCanonical,
    recordKind: "MIRROR",
    tlsFingerprint: `0x${"ff".repeat(32)}` as Hex, // Divergência de hash de segurança
    updatedAt: domainCanonical.updatedAt + 10n,
  };

  // 7.1: Reconciliação com N×N destinos (sincronizado, ausente, atrasado e RPC falho)
  const reconRun = await reconService.reconcile({
    requestId: "recon-canary-run-01",
    origin: { family: "EVM", networkId: "evm:84532", registryId: baseSepolia.registryId },
    originState: domainCanonical,
    targets: [
      {
        family: "EVM",
        networkId: "evm:421614",
        registryId: arbitrumSepolia.registryId,
        state: inSyncMirror,
      },
      {
        family: "EVM",
        networkId: "evm:80002",
        registryId: polygonAmoy.registryId,
        state: behindMirror,
      },
      {
        family: "SOLANA",
        networkId: solanaDevnet.networkId,
        registryId: solanaDevnet.registryId,
        state: undefined,
        readError: "Solana RPC rate-limited or node timeout",
      },
      {
        family: "EVM",
        networkId: "evm:999999",
        registryId: bytes(999),
        state: null, // Espelho ainda ausente
      },
    ],
    startedAt: new Date(now.getTime() - 1000),
    completedAt: new Date(),
  });

  assert.equal(reconRun.run.status, "DRIFTED");
  const findingsMap = new Map(reconRun.findings.map((f) => [f.destinationNetworkId, f]));

  // Arbitrum está sincronizado
  assert.equal(findingsMap.get("evm:421614")?.kind, "IN_SYNC");
  assert.equal(findingsMap.get("evm:421614")?.repairAction, "NONE");

  // Polygon está atrás -> precisa de sincronização (SYNC)
  assert.equal(findingsMap.get("evm:80002")?.kind, "VERSION_BEHIND");
  assert.equal(findingsMap.get("evm:80002")?.repairAction, "SYNC");

  // Solana inatingível -> marcado como UNREADABLE e NUNCA vira confirmação falsa!
  assert.equal(findingsMap.get(solanaDevnet.networkId)?.kind, "UNREADABLE");
  assert.equal(findingsMap.get(solanaDevnet.networkId)?.repairAction, "RETRY_READ");

  // Rede 999999 ausente -> marcado como MISSING_MIRROR (REGISTER)
  assert.equal(findingsMap.get("evm:999999")?.kind, "MISSING_MIRROR");
  assert.equal(findingsMap.get("evm:999999")?.repairAction, "REGISTER");

  // 7.2: Divergência Crítica de Estado -> Trip do Circuit Breaker e Alerta
  const driftRun = await reconService.reconcile({
    requestId: "recon-canary-drift-02",
    origin: { family: "EVM", networkId: "evm:84532", registryId: baseSepolia.registryId },
    originState: domainCanonical,
    targets: [
      {
        family: "EVM",
        networkId: "evm:421614",
        registryId: arbitrumSepolia.registryId,
        state: driftedMirror,
      },
    ],
    startedAt: new Date(now.getTime() - 500),
    completedAt: new Date(),
  });

  assert.equal(driftRun.run.status, "DRIFTED");
  const driftFinding = driftRun.findings[0];
  assert.equal(driftFinding.kind, "STATE_DRIFT");
  assert.equal(driftFinding.repairAction, "MANUAL_REVIEW");

  // Aciona o Circuit Breaker para a rede afetada
  const breakerTrip = await circuitBreaker.recordSignal({
    scope: { kind: "DEPLOYMENT", networkId: "evm:421614", registryId: arbitrumSepolia.registryId },
    signal: {
      kind: "STATE_DRIFT",
      evidence: { domain: evmDomain, reason: "tlsFingerprint hash mismatch on Arbitrum mirror" },
    },
    requestId: "req-breaker-trip-01",
    observedAt: new Date(),
  });

  assert.equal(breakerTrip.event.action, "TRIPPED");
  assert.equal(breakerTrip.breaker.status, "OPEN");

  // Avaliação de Alertas Operacionais
  const activeAlerts = alertService.evaluate([
    {
      code: "STATE_DRIFT",
      scope: "evm:421614",
      value: 1,
      threshold: 1,
      details: { domain: evmDomain, repair: "MANUAL_REVIEW" },
    },
    {
      code: "RELAYER_PAUSED",
      scope: "evm:421614",
      value: 1,
      threshold: 1,
      details: { breakerStatus: "OPEN" },
    },
  ]);

  assert.equal(activeAlerts.length, 2);
  assert.equal(activeAlerts[0].severity, "critical");
  assert.equal(activeAlerts[1].severity, "critical");

  recordStep("RECONCILIATION_DRIFT_AND_CIRCUIT_BREAKER_ALERTS", {
    cleanFindings: 1,
    behindFindings: 1,
    unreadableFindings: 1,
    missingFindings: 1,
    driftFindingAction: driftFinding.repairAction,
    circuitBreakerStatus: breakerTrip.breaker.status,
    operationalAlertsCount: activeAlerts.length,
  });

  // ===========================================================================
  // 8. Auditoria Final de Timeline Canário Multichain
  // ===========================================================================
  console.log("\n================================================================");
  console.log("  MATRIZ DE RASTREABILIDADE DO CANÁRIO MULTICHAIN (AWS-041)");
  console.log("================================================================");
  console.table(
    timeline.map((t, idx) => ({
      Index: idx + 1,
      Etapa: t.step,
      Timestamp: t.timestamp,
    }))
  );

  assert.equal(timeline.length, 7, "Timeline do canário deve conter exatamente 7 etapas auditadas");
  console.log("Timeline canário multichain auditada com sucesso: 7 etapas registradas.");
  console.log("\n✓ Suíte Canário Multichain Completa (AWS-041) executada com 100% de sucesso.\n");
});
