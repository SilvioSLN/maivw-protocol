import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { keccak256, stringToHex, type Hex } from "viem";
import type {
  RelayDestinationRow,
  RelayJobRow,
  RelayStatus,
  RelayTransitionInput,
} from "./MultichainRelayJob.js";

export interface RelayReorgRow {
  id: string;
  jobId: string;
  sourceEventKey: string;
  requestHash: string;
  orphanedSourceReference: string;
  reason: string;
  outcome: "ORPHANED" | "COMPENSATION_REQUIRED";
  previousAuditHash: string | null;
  auditHash: string;
  detectedAt: Date;
  createdAt: Date;
}

export interface RelayCompensationRow {
  id: string;
  reorgId: string;
  destinationId: string;
  destinationNetworkId: string;
  destinationRegistryId: string;
  submittedTransactionId: string | null;
  action: string;
  status: "PENDING" | "RESOLVED";
  resolutionReference: string | null;
  auditHash: string;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface RelayReorgRepository {
  transaction<T>(operation: (repository: RelayReorgRepository) => Promise<T>): Promise<T>;
  findJobBySourceEventKey(sourceEventKey: string): Promise<RelayJobRow | null>;
  listDestinations(jobId: string): Promise<RelayDestinationRow[]>;
  findReorgByJobId(jobId: string): Promise<RelayReorgRow | null>;
  listCompensations(reorgId: string): Promise<RelayCompensationRow[]>;
  lastReorg(domainHash: string): Promise<RelayReorgRow | null>;
  compareAndSetJob(id: string, expected: RelayStatus, next: RelayStatus, at: Date): Promise<boolean>;
  compareAndSetDestination(id: string, expected: RelayStatus, next: RelayStatus, at: Date): Promise<boolean>;
  createReorg(reorg: RelayReorgRow, compensations: readonly RelayCompensationRow[]): Promise<void>;
  appendTransition(input: RelayTransitionInput): Promise<void>;
}

type PrismaLike = Record<string, any> & {
  $transaction<T>(operation: (tx: Record<string, any>) => Promise<T>): Promise<T>;
};

export class PrismaRelayReorgRepository implements RelayReorgRepository {
  constructor(private readonly client: PrismaClient | PrismaLike) {}
  async transaction<T>(operation: (repository: RelayReorgRepository) => Promise<T>): Promise<T> {
    return (this.client as PrismaLike).$transaction((tx) => operation(new PrismaRelayReorgRepository(tx as PrismaLike)));
  }
  async findJobBySourceEventKey(sourceEventKey: string): Promise<RelayJobRow | null> {
    return (this.client as any).multichainRelayJob.findUnique({ where: { sourceEventKey } });
  }
  async listDestinations(jobId: string): Promise<RelayDestinationRow[]> {
    return (this.client as any).multichainRelayDestination.findMany({ where: { jobId } });
  }
  async findReorgByJobId(jobId: string): Promise<RelayReorgRow | null> {
    return (this.client as any).multichainRelayReorg.findUnique({ where: { jobId } });
  }
  async listCompensations(reorgId: string): Promise<RelayCompensationRow[]> {
    return (this.client as any).multichainRelayCompensation.findMany({
      where: { reorgId }, orderBy: { destinationNetworkId: "asc" },
    });
  }
  async lastReorg(domainHash: string): Promise<RelayReorgRow | null> {
    return (this.client as any).multichainRelayReorg.findFirst({
      where: { job: { domainHash } }, orderBy: { detectedAt: "desc" },
    });
  }
  async compareAndSetJob(id: string, expected: RelayStatus, next: RelayStatus, at: Date): Promise<boolean> {
    const result = await (this.client as any).multichainRelayJob.updateMany({
      where: { id, status: expected }, data: { status: next, updatedAt: at },
    });
    return result.count === 1;
  }
  async compareAndSetDestination(
    id: string,
    expected: RelayStatus,
    next: RelayStatus,
    at: Date,
  ): Promise<boolean> {
    const result = await (this.client as any).multichainRelayDestination.updateMany({
      where: { id, status: expected }, data: { status: next, updatedAt: at },
    });
    return result.count === 1;
  }
  async createReorg(reorg: RelayReorgRow, compensations: readonly RelayCompensationRow[]): Promise<void> {
    await (this.client as any).multichainRelayReorg.create({
      data: {
        ...reorg,
        compensations: { create: compensations.map(({ reorgId: _reorgId, ...compensation }) => compensation) },
      },
    });
  }
  async appendTransition(input: RelayTransitionInput): Promise<void> {
    await (this.client as any).multichainRelayTransition.create({ data: input });
  }
}

export interface HandleRelayReorgInput {
  sourceEventKey: string;
  orphanedSourceReference: string;
  reason: string;
  detectedAt: Date;
}

export class RelayReorgError extends Error {
  constructor(
    readonly code: "INVALID_REORG" | "REORG_JOB_NOT_FOUND" | "REORG_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "RelayReorgError";
  }
}

function fail(code: RelayReorgError["code"], message: string): never {
  throw new RelayReorgError(code, message);
}

function text(name: string, value: string, max = 1_000): string {
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!normalized || normalized.length > max) fail("INVALID_REORG", `${name} inválido`);
  return normalized;
}

function date(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail("INVALID_REORG", "detectedAt inválido");
  return value;
}

function hash(value: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(value)));
}

function needsCompensation(status: RelayStatus): boolean {
  return status === "SUBMITTED" || status === "CONFIRMED" || status === "RECONCILE"
    || status === "COMPENSATION_REQUIRED";
}

/** Converts source orphaning into terminal logical state without deleting evidence. */
export class RelayReorgService {
  constructor(private readonly repository: RelayReorgRepository) {}

  async handle(input: HandleRelayReorgInput): Promise<{
    reorg: RelayReorgRow;
    compensations: RelayCompensationRow[];
    created: boolean;
  }> {
    const sourceEventKey = text("sourceEventKey", input.sourceEventKey, 512);
    const orphanedSourceReference = text("orphanedSourceReference", input.orphanedSourceReference, 512);
    const reason = text("reason", input.reason);
    const detectedAt = date(input.detectedAt);
    const requestHash = hash({
      version: 1, sourceEventKey, orphanedSourceReference, reason, detectedAt: detectedAt.toISOString(),
    });
    return this.repository.transaction(async (repository) => {
      const job = await repository.findJobBySourceEventKey(sourceEventKey);
      if (!job) fail("REORG_JOB_NOT_FOUND", "evento órfão não possui job");
      const existing = await repository.findReorgByJobId(job.id);
      if (existing) {
        if (existing.requestHash !== requestHash) fail("REORG_CONFLICT", "job já recebeu outro sinal de reorg");
        return { reorg: existing, compensations: await repository.listCompensations(existing.id), created: false };
      }
      const destinations = await repository.listDestinations(job.id);
      const compensationDestinations = destinations.filter((destination) => needsCompensation(destination.status));
      const outcome = compensationDestinations.length > 0 ? "COMPENSATION_REQUIRED" : "ORPHANED";
      const reorgId = randomUUID();
      const previous = await repository.lastReorg(job.domainHash);
      const compensations: RelayCompensationRow[] = compensationDestinations.map((destination) => {
        const base = {
          reorgId,
          destinationId: destination.id,
          destinationNetworkId: destination.destinationNetworkId,
          destinationRegistryId: destination.destinationRegistryId,
          submittedTransactionId: destination.submissionId,
          action: "RECONCILE_ORPHANED_SOURCE",
          status: "PENDING" as const,
          resolutionReference: null,
          createdAt: detectedAt,
          resolvedAt: null,
        };
        return { id: randomUUID(), ...base, auditHash: hash({ version: 1, ...base, createdAt: detectedAt.toISOString() }) };
      });
      const reorgBase = {
        jobId: job.id,
        sourceEventKey,
        requestHash,
        orphanedSourceReference,
        reason,
        outcome: outcome as "ORPHANED" | "COMPENSATION_REQUIRED",
        previousAuditHash: previous?.auditHash ?? null,
        detectedAt,
        createdAt: detectedAt,
      };
      const reorg: RelayReorgRow = {
        id: reorgId,
        ...reorgBase,
        auditHash: hash({
          version: 1,
          ...reorgBase,
          detectedAt: detectedAt.toISOString(),
          createdAt: detectedAt.toISOString(),
          compensationHashes: compensations.map((compensation) => compensation.auditHash),
        }),
      };

      for (const destination of destinations) {
        const next = needsCompensation(destination.status) ? "COMPENSATION_REQUIRED" : "ORPHANED";
        if (destination.status === next) continue;
        if (!await repository.compareAndSetDestination(destination.id, destination.status, next, detectedAt)) {
          fail("REORG_CONFLICT", "destino mudou durante compensação de reorg");
        }
        await repository.appendTransition({
          id: randomUUID(), jobId: job.id, destinationId: destination.id,
          fromStatus: destination.status, toStatus: next,
          reference: orphanedSourceReference, reason, createdAt: detectedAt,
        });
      }
      if (job.status !== outcome) {
        if (!await repository.compareAndSetJob(job.id, job.status, outcome, detectedAt)) {
          fail("REORG_CONFLICT", "job mudou durante compensação de reorg");
        }
        await repository.appendTransition({
          id: randomUUID(), jobId: job.id, fromStatus: job.status, toStatus: outcome,
          reference: orphanedSourceReference, reason, createdAt: detectedAt,
        });
      }
      await repository.createReorg(reorg, compensations);
      return { reorg, compensations, created: true };
    });
  }
}
