import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Hex } from "viem";
import { hashNetworkId } from "./AttestationCodec.js";

export type RelayNetworkFamily = "EVM" | "SOLANA";
export type RelayOperation = "REGISTER" | "SYNC" | "REVOKE";
export type RelayStatus =
  | "DETECTED" | "FINALIZED" | "ATTESTED" | "SUBMITTED" | "CONFIRMED" | "RECONCILE"
  | "ORPHANED" | "COMPENSATION_REQUIRED";

const STATUS_ORDER: readonly RelayStatus[] = [
  "DETECTED", "FINALIZED", "ATTESTED", "SUBMITTED", "CONFIRMED", "RECONCILE",
];
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const MAX_U64 = (1n << 64n) - 1n;

export interface RelayJobRow {
  id: string;
  sourceEventKey: string;
  domainHash: string;
  operation: RelayOperation;
  originNetworkFamily: RelayNetworkFamily;
  originNetworkId: string;
  originRegistryId: string;
  sourceTransactionId: string;
  sourcePosition: string;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  status: RelayStatus;
  sourceStateHash: string | null;
  detectedAt: Date;
  finalizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelayDestinationRow {
  id: string;
  jobId: string;
  destinationNetworkFamily: RelayNetworkFamily;
  destinationNetworkId: string;
  destinationRegistryId: string;
  status: RelayStatus;
  attestationDigest: string | null;
  submissionId: string | null;
  confirmationReference: string | null;
  reconcileReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelayTransitionInput {
  id: string;
  jobId: string;
  destinationId?: string;
  fromStatus: RelayStatus | null;
  toStatus: RelayStatus;
  artifactHash?: string;
  reference?: string;
  reason?: string;
  createdAt: Date;
}

export interface RelayJobRepository {
  transaction<T>(operation: (repository: RelayJobRepository) => Promise<T>): Promise<T>;
  findJobById(id: string): Promise<RelayJobRow | null>;
  findJobBySourceEventKey(sourceEventKey: string): Promise<RelayJobRow | null>;
  createJob(job: RelayJobRow, destinations: readonly RelayDestinationRow[]): Promise<void>;
  compareAndSetJob(id: string, expected: RelayStatus, data: Partial<RelayJobRow>): Promise<boolean>;
  listDestinations(jobId: string): Promise<RelayDestinationRow[]>;
  findDestination(id: string): Promise<RelayDestinationRow | null>;
  compareAndSetDestination(
    id: string,
    expected: RelayStatus,
    data: Partial<RelayDestinationRow>,
  ): Promise<boolean>;
  advanceAllDestinations(jobId: string, expected: RelayStatus, next: RelayStatus): Promise<number>;
  appendTransition(input: RelayTransitionInput): Promise<void>;
}

type PrismaLike = Record<string, any> & {
  $transaction<T>(operation: (tx: Record<string, any>) => Promise<T>): Promise<T>;
};

/** Prisma adapter kept behind a small repository so transition tests need no database. */
export class PrismaRelayJobRepository implements RelayJobRepository {
  constructor(private readonly client: PrismaClient | PrismaLike) {}

  async transaction<T>(operation: (repository: RelayJobRepository) => Promise<T>): Promise<T> {
    return (this.client as PrismaLike).$transaction((tx) => operation(new PrismaRelayJobRepository(tx as PrismaLike)));
  }

  async findJobById(id: string): Promise<RelayJobRow | null> {
    return (this.client as any).multichainRelayJob.findUnique({ where: { id } });
  }

  async findJobBySourceEventKey(sourceEventKey: string): Promise<RelayJobRow | null> {
    return (this.client as any).multichainRelayJob.findUnique({ where: { sourceEventKey } });
  }

  async createJob(job: RelayJobRow, destinations: readonly RelayDestinationRow[]): Promise<void> {
    await (this.client as any).multichainRelayJob.create({
      data: {
        ...job,
        destinations: { create: destinations.map(({ jobId: _jobId, ...destination }) => destination) },
      },
    });
  }

  async compareAndSetJob(id: string, expected: RelayStatus, data: Partial<RelayJobRow>): Promise<boolean> {
    const result = await (this.client as any).multichainRelayJob.updateMany({
      where: { id, status: expected }, data,
    });
    return result.count === 1;
  }

  async listDestinations(jobId: string): Promise<RelayDestinationRow[]> {
    return (this.client as any).multichainRelayDestination.findMany({
      where: { jobId }, orderBy: [{ destinationNetworkId: "asc" }, { destinationRegistryId: "asc" }],
    });
  }

  async findDestination(id: string): Promise<RelayDestinationRow | null> {
    return (this.client as any).multichainRelayDestination.findUnique({ where: { id } });
  }

  async compareAndSetDestination(
    id: string,
    expected: RelayStatus,
    data: Partial<RelayDestinationRow>,
  ): Promise<boolean> {
    const result = await (this.client as any).multichainRelayDestination.updateMany({
      where: { id, status: expected }, data,
    });
    return result.count === 1;
  }

  async advanceAllDestinations(jobId: string, expected: RelayStatus, next: RelayStatus): Promise<number> {
    const result = await (this.client as any).multichainRelayDestination.updateMany({
      where: { jobId, status: expected }, data: { status: next },
    });
    return result.count;
  }

  async appendTransition(input: RelayTransitionInput): Promise<void> {
    await (this.client as any).multichainRelayTransition.create({ data: input });
  }
}

export interface RelayDestinationInput {
  family: RelayNetworkFamily;
  networkId: string;
  registryId: Hex;
}

export interface DetectRelayJobInput {
  sourceEventKey: string;
  domainHash: Hex;
  operation: RelayOperation;
  origin: RelayDestinationInput;
  sourceTransactionId: string;
  sourcePosition: string;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  detectedAt: Date;
  destinations: readonly RelayDestinationInput[];
}

export interface AdvanceRelayDestinationInput {
  destinationId: string;
  toStatus: "ATTESTED" | "SUBMITTED" | "CONFIRMED" | "RECONCILE";
  artifactHash?: Hex;
  reference?: string;
  reason?: string;
  at?: Date;
}

export class RelayJobError extends Error {
  constructor(
    readonly code: "INVALID_RELAY_JOB" | "RELAY_JOB_NOT_FOUND" | "RELAY_TRANSITION_INVALID" | "RELAY_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "RelayJobError";
  }
}

function fail(code: RelayJobError["code"], message: string): never {
  throw new RelayJobError(code, message);
}

function text(name: string, value: string, max = 512): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) fail("INVALID_RELAY_JOB", `${name} inválido`);
  return normalized;
}

function bytes32(name: string, value: string): string {
  if (!BYTES32.test(value)) fail("INVALID_RELAY_JOB", `${name} deve conter 32 bytes`);
  return value.toLowerCase();
}

function u64(name: string, value: bigint): bigint {
  if (value < 0n || value > MAX_U64) fail("INVALID_RELAY_JOB", `${name} deve caber em uint64`);
  return value;
}

function date(name: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail("INVALID_RELAY_JOB", `${name} inválido`);
  return value;
}

function normalizeDeployment(input: RelayDestinationInput): RelayDestinationInput {
  const networkId = text("networkId", input.networkId, 256);
  hashNetworkId(networkId);
  if (!networkId.startsWith(input.family === "EVM" ? "evm:" : "solana:")) {
    fail("INVALID_RELAY_JOB", "family e networkId divergem");
  }
  return { family: input.family, networkId, registryId: bytes32("registryId", input.registryId) as Hex };
}

function deploymentKey(input: RelayDestinationInput): string {
  return `${input.networkId}:${input.registryId.toLowerCase()}`;
}

function sameJob(existing: RelayJobRow, input: DetectRelayJobInput): boolean {
  return existing.domainHash === input.domainHash.toLowerCase()
    && existing.operation === input.operation
    && existing.originNetworkFamily === input.origin.family
    && existing.originNetworkId === input.origin.networkId
    && existing.originRegistryId === input.origin.registryId.toLowerCase()
    && existing.sourceTransactionId === input.sourceTransactionId
    && existing.sourcePosition === input.sourcePosition
    && existing.globalDomainEpoch === input.globalDomainEpoch
    && existing.originSequence === input.originSequence;
}

function rank(status: RelayStatus): number {
  return STATUS_ORDER.indexOf(status);
}

export class MultichainRelayJobService {
  constructor(private readonly repository: RelayJobRepository) {}

  async detect(input: DetectRelayJobInput): Promise<{ job: RelayJobRow; created: boolean }> {
    const normalizedOrigin = normalizeDeployment(input.origin);
    const destinations = input.destinations.map(normalizeDeployment);
    if (destinations.length === 0) fail("INVALID_RELAY_JOB", "job exige pelo menos um destino");
    const keys = destinations.map(deploymentKey);
    if (new Set(keys).size !== keys.length || keys.includes(deploymentKey(normalizedOrigin))) {
      fail("INVALID_RELAY_JOB", "destinos devem ser únicos e diferentes da origem");
    }
    const normalized: DetectRelayJobInput = {
      ...input,
      sourceEventKey: text("sourceEventKey", input.sourceEventKey),
      domainHash: bytes32("domainHash", input.domainHash) as Hex,
      origin: normalizedOrigin,
      sourceTransactionId: text("sourceTransactionId", input.sourceTransactionId),
      sourcePosition: text("sourcePosition", input.sourcePosition),
      globalDomainEpoch: u64("globalDomainEpoch", input.globalDomainEpoch),
      originSequence: u64("originSequence", input.originSequence),
      detectedAt: date("detectedAt", input.detectedAt),
      destinations,
    };
    return this.repository.transaction(async (repository) => {
      const existing = await repository.findJobBySourceEventKey(normalized.sourceEventKey);
      if (existing) {
        if (!sameJob(existing, normalized)) fail("RELAY_CONFLICT", "sourceEventKey já vinculado a outro job");
        const existingDestinations = await repository.listDestinations(existing.id);
        const existingKeys = existingDestinations.map((item) => deploymentKey({
          family: item.destinationNetworkFamily,
          networkId: item.destinationNetworkId,
          registryId: item.destinationRegistryId as Hex,
        })).sort();
        if (JSON.stringify(existingKeys) !== JSON.stringify([...keys].sort())) {
          fail("RELAY_CONFLICT", "retry alterou o conjunto de destinos");
        }
        return { job: existing, created: false };
      }
      const now = new Date();
      const job: RelayJobRow = {
        id: randomUUID(),
        sourceEventKey: normalized.sourceEventKey,
        domainHash: normalized.domainHash,
        operation: normalized.operation,
        originNetworkFamily: normalized.origin.family,
        originNetworkId: normalized.origin.networkId,
        originRegistryId: normalized.origin.registryId,
        sourceTransactionId: normalized.sourceTransactionId,
        sourcePosition: normalized.sourcePosition,
        globalDomainEpoch: normalized.globalDomainEpoch,
        originSequence: normalized.originSequence,
        status: "DETECTED",
        sourceStateHash: null,
        detectedAt: normalized.detectedAt,
        finalizedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const rows: RelayDestinationRow[] = destinations.map((destination) => ({
        id: randomUUID(),
        jobId: job.id,
        destinationNetworkFamily: destination.family,
        destinationNetworkId: destination.networkId,
        destinationRegistryId: destination.registryId,
        status: "DETECTED",
        attestationDigest: null,
        submissionId: null,
        confirmationReference: null,
        reconcileReference: null,
        createdAt: now,
        updatedAt: now,
      }));
      await repository.createJob(job, rows);
      await repository.appendTransition({
        id: randomUUID(), jobId: job.id, fromStatus: null, toStatus: "DETECTED", createdAt: now,
      });
      return { job, created: true };
    });
  }

  async finalize(jobId: string, sourceStateHash: Hex, finalizedAt: Date): Promise<{ job: RelayJobRow; changed: boolean }> {
    return this.repository.transaction(async (repository) => {
      const job = await repository.findJobById(text("jobId", jobId));
      if (!job) fail("RELAY_JOB_NOT_FOUND", "job não encontrado");
      const normalizedHash = bytes32("sourceStateHash", sourceStateHash);
      if (rank(job.status) >= rank("FINALIZED")) {
        if (job.sourceStateHash !== normalizedHash) fail("RELAY_CONFLICT", "estado finalizado diverge do job");
        return { job, changed: false };
      }
      if (job.status !== "DETECTED") fail("RELAY_TRANSITION_INVALID", "job não pode ser finalizado");
      const at = date("finalizedAt", finalizedAt);
      const destinations = await repository.listDestinations(job.id);
      const changed = await repository.compareAndSetJob(job.id, "DETECTED", {
        status: "FINALIZED", sourceStateHash: normalizedHash, finalizedAt: at, updatedAt: at,
      });
      if (!changed) fail("RELAY_CONFLICT", "job avançou concorrentemente");
      const count = await repository.advanceAllDestinations(job.id, "DETECTED", "FINALIZED");
      if (count !== destinations.length) fail("RELAY_CONFLICT", "destinos avançaram de forma parcial");
      await repository.appendTransition({
        id: randomUUID(), jobId: job.id, fromStatus: "DETECTED", toStatus: "FINALIZED",
        artifactHash: normalizedHash, createdAt: at,
      });
      return {
        job: { ...job, status: "FINALIZED", sourceStateHash: normalizedHash, finalizedAt: at, updatedAt: at },
        changed: true,
      };
    });
  }

  async advanceDestination(input: AdvanceRelayDestinationInput): Promise<{ destination: RelayDestinationRow; changed: boolean }> {
    return this.repository.transaction(async (repository) => {
      const destination = await repository.findDestination(text("destinationId", input.destinationId));
      if (!destination) fail("RELAY_JOB_NOT_FOUND", "destino não encontrado");
      const target = input.toStatus;
      const targetRank = rank(target);
      const currentRank = rank(destination.status);
      const artifact = input.artifactHash ? bytes32("artifactHash", input.artifactHash) : undefined;
      const reference = input.reference ? text("reference", input.reference) : undefined;
      if (currentRank === targetRank) {
        if ((target === "ATTESTED" && destination.attestationDigest !== artifact)
          || (target === "SUBMITTED" && destination.submissionId !== reference)
          || (target === "CONFIRMED" && destination.confirmationReference !== reference)
          || (target === "RECONCILE" && destination.reconcileReference !== reference)) {
          fail("RELAY_CONFLICT", "retry da transição usa artefato diferente");
        }
        return { destination, changed: false };
      }
      if (targetRank !== currentRank + 1 || currentRank < rank("FINALIZED")) {
        fail("RELAY_TRANSITION_INVALID", `${destination.status} não pode avançar para ${target}`);
      }
      if (target === "ATTESTED" && !artifact) fail("INVALID_RELAY_JOB", "ATTESTED exige digest");
      if (target !== "ATTESTED" && !reference) fail("INVALID_RELAY_JOB", `${target} exige referência`);
      const at = input.at ? date("at", input.at) : new Date();
      const patch: Partial<RelayDestinationRow> = { status: target, updatedAt: at };
      if (target === "ATTESTED") patch.attestationDigest = artifact!;
      if (target === "SUBMITTED") patch.submissionId = reference!;
      if (target === "CONFIRMED") patch.confirmationReference = reference!;
      if (target === "RECONCILE") patch.reconcileReference = reference!;
      if (!await repository.compareAndSetDestination(destination.id, destination.status, patch)) {
        fail("RELAY_CONFLICT", "destino avançou concorrentemente");
      }
      await repository.appendTransition({
        id: randomUUID(), jobId: destination.jobId, destinationId: destination.id,
        fromStatus: destination.status, toStatus: target, artifactHash: artifact,
        reference, reason: input.reason, createdAt: at,
      });
      const updated = { ...destination, ...patch } as RelayDestinationRow;
      await this.refreshAggregate(repository, destination.jobId, at);
      return { destination: updated, changed: true };
    });
  }

  private async refreshAggregate(repository: RelayJobRepository, jobId: string, at: Date): Promise<void> {
    const job = await repository.findJobById(jobId);
    if (!job) fail("RELAY_JOB_NOT_FOUND", "job não encontrado ao agregar destinos");
    const destinations = await repository.listDestinations(jobId);
    const aggregate = destinations.reduce<RelayStatus>((minimum, destination) =>
      rank(destination.status) < rank(minimum) ? destination.status : minimum, "RECONCILE");
    if (rank(aggregate) <= rank(job.status)) return;
    if (!await repository.compareAndSetJob(job.id, job.status, { status: aggregate, updatedAt: at })) {
      const concurrent = await repository.findJobById(jobId);
      if (concurrent && rank(concurrent.status) >= rank(aggregate)) return;
      fail("RELAY_CONFLICT", "estado agregado avançou concorrentemente");
    }
    await repository.appendTransition({
      id: randomUUID(), jobId, fromStatus: job.status, toStatus: aggregate,
      reason: "all destinations reached state", createdAt: at,
    });
  }
}
