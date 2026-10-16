import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hexToBytes, keccak256, stringToHex, type Hex } from "viem";
import {
  MultichainRelayJobService,
  type RelayDestinationRow,
  type RelayJobRepository,
} from "./MultichainRelayJob.js";

export type RelaySubmissionStatus = "PREPARED" | "BROADCAST" | "CONFIRMED";

export interface RelaySubmissionRow {
  id: string;
  destinationId: string;
  idempotencyKey: string;
  signedPayload: string;
  signedPayloadHash: string;
  expectedTransactionId: string;
  deadline: Date;
  status: RelaySubmissionStatus;
  attempts: number;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  nextAttemptAt: Date;
  lastError: string | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  finalityReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmissionAttemptInput {
  id: string;
  submissionId: string;
  attempt: number;
  workerId: string;
  outcome: "BROADCAST" | "RETRY_SCHEDULED" | "CONFIRMED";
  transactionId?: string;
  finalityRef?: string;
  error?: string;
  createdAt: Date;
}

export interface RelaySubmissionStore {
  transaction<T>(operation: (store: RelaySubmissionStore) => Promise<T>): Promise<T>;
  getDestination(id: string): Promise<RelayDestinationRow | null>;
  findByDestination(destinationId: string): Promise<RelaySubmissionRow | null>;
  create(row: RelaySubmissionRow): Promise<void>;
  claim(id: string, workerId: string, now: Date, leaseUntil: Date): Promise<boolean>;
  get(id: string): Promise<RelaySubmissionRow | null>;
  markBroadcast(id: string, workerId: string, transactionId: string, at: Date): Promise<boolean>;
  releaseForRetry(id: string, workerId: string, error: string, nextAttemptAt: Date, at: Date): Promise<boolean>;
  markConfirmed(id: string, finalityReference: string, at: Date): Promise<boolean>;
  appendAttempt(input: SubmissionAttemptInput): Promise<void>;
}

type PrismaLike = Record<string, any> & {
  $transaction<T>(operation: (tx: Record<string, any>) => Promise<T>): Promise<T>;
};

export class PrismaRelaySubmissionStore implements RelaySubmissionStore {
  constructor(private readonly client: PrismaClient | PrismaLike) {}

  async transaction<T>(operation: (store: RelaySubmissionStore) => Promise<T>): Promise<T> {
    return (this.client as PrismaLike).$transaction((tx) => operation(new PrismaRelaySubmissionStore(tx as PrismaLike)));
  }
  async getDestination(id: string): Promise<RelayDestinationRow | null> {
    return (this.client as any).multichainRelayDestination.findUnique({ where: { id } });
  }
  async findByDestination(destinationId: string): Promise<RelaySubmissionRow | null> {
    return (this.client as any).multichainRelaySubmission.findUnique({ where: { destinationId } });
  }
  async create(row: RelaySubmissionRow): Promise<void> {
    await (this.client as any).multichainRelaySubmission.create({ data: row });
  }
  async claim(id: string, workerId: string, now: Date, leaseUntil: Date): Promise<boolean> {
    const result = await (this.client as any).multichainRelaySubmission.updateMany({
      where: {
        id,
        status: "PREPARED",
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: { leaseOwner: workerId, leaseUntil, attempts: { increment: 1 }, updatedAt: now },
    });
    return result.count === 1;
  }
  async get(id: string): Promise<RelaySubmissionRow | null> {
    return (this.client as any).multichainRelaySubmission.findUnique({ where: { id } });
  }
  async markBroadcast(id: string, workerId: string, transactionId: string, at: Date): Promise<boolean> {
    const result = await (this.client as any).multichainRelaySubmission.updateMany({
      where: { id, status: "PREPARED", leaseOwner: workerId },
      data: {
        status: "BROADCAST", submittedAt: at, lastError: null,
        leaseOwner: null, leaseUntil: null, expectedTransactionId: transactionId, updatedAt: at,
      },
    });
    return result.count === 1;
  }
  async releaseForRetry(
    id: string,
    workerId: string,
    error: string,
    nextAttemptAt: Date,
    at: Date,
  ): Promise<boolean> {
    const result = await (this.client as any).multichainRelaySubmission.updateMany({
      where: { id, status: "PREPARED", leaseOwner: workerId },
      data: { leaseOwner: null, leaseUntil: null, lastError: error, nextAttemptAt, updatedAt: at },
    });
    return result.count === 1;
  }
  async markConfirmed(id: string, finalityReference: string, at: Date): Promise<boolean> {
    const result = await (this.client as any).multichainRelaySubmission.updateMany({
      where: { id, status: "BROADCAST" },
      data: { status: "CONFIRMED", finalityReference, confirmedAt: at, updatedAt: at },
    });
    return result.count === 1;
  }
  async appendAttempt(input: SubmissionAttemptInput): Promise<void> {
    await (this.client as any).multichainRelaySubmissionAttempt.create({ data: input });
  }
}

export interface PrepareRelaySubmissionInput {
  destinationId: string;
  idempotencyKey: string;
  signedPayload: string;
  expectedTransactionId: string;
  deadline: Date;
  now?: Date;
}

export interface RelayBroadcastAdapter {
  broadcast(input: {
    signedPayload: string;
    expectedTransactionId: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string }>;
  checkFinality(transactionId: string): Promise<
    | { status: "PENDING" }
    | { status: "FINALIZED"; reference: string }
    | { status: "REVERTED" | "DROPPED"; reason: string }
  >;
}

export interface RelaySubmissionPolicy {
  leaseMs: number;
  baseRetryMs: number;
  maxRetryMs: number;
}

export class RelaySubmissionError extends Error {
  constructor(
    readonly code:
      | "INVALID_SUBMISSION"
      | "SUBMISSION_NOT_FOUND"
      | "SUBMISSION_CONFLICT"
      | "SUBMISSION_BUSY"
      | "SUBMISSION_RETRY_NOT_READY"
      | "SUBMISSION_DEADLINE_EXPIRED"
      | "SUBMISSION_RETRY_SCHEDULED"
      | "SUBMISSION_TRANSACTION_MISMATCH"
      | "SUBMISSION_FINALITY_FAILED",
    message: string,
    readonly retryAt?: Date,
  ) {
    super(message);
    this.name = "RelaySubmissionError";
  }
}

function fail(code: RelaySubmissionError["code"], message: string, retryAt?: Date): never {
  throw new RelaySubmissionError(code, message, retryAt);
}

function text(name: string, value: string, max = 16_384): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) fail("INVALID_SUBMISSION", `${name} inválido`);
  return normalized;
}

function date(name: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail("INVALID_SUBMISSION", `${name} inválido`);
  return value;
}

function payloadHash(payload: string): Hex {
  if (/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) return keccak256(hexToBytes(payload as Hex));
  return keccak256(stringToHex(payload));
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 1_000);
}

const DEFAULT_POLICY: RelaySubmissionPolicy = { leaseMs: 30_000, baseRetryMs: 1_000, maxRetryMs: 60_000 };

export class RelaySubmissionCoordinator {
  private readonly policy: RelaySubmissionPolicy;

  constructor(
    private readonly store: RelaySubmissionStore,
    private readonly jobs: MultichainRelayJobService,
    policy: Partial<RelaySubmissionPolicy> = {},
  ) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    if (!Number.isSafeInteger(this.policy.leaseMs) || this.policy.leaseMs < 1
      || !Number.isSafeInteger(this.policy.baseRetryMs) || this.policy.baseRetryMs < 1
      || !Number.isSafeInteger(this.policy.maxRetryMs) || this.policy.maxRetryMs < this.policy.baseRetryMs) {
      fail("INVALID_SUBMISSION", "política de lease/retry inválida");
    }
  }

  async getByDestination(destinationId: string): Promise<RelaySubmissionRow | null> {
    return this.store.findByDestination(text("destinationId", destinationId, 128));
  }

  async prepare(input: PrepareRelaySubmissionInput): Promise<{ submission: RelaySubmissionRow; created: boolean }> {
    const now = input.now ? date("now", input.now) : new Date();
    const deadline = date("deadline", input.deadline);
    if (deadline <= now) fail("SUBMISSION_DEADLINE_EXPIRED", "atestado expirou antes do preparo");
    const destinationId = text("destinationId", input.destinationId, 128);
    const idempotencyKey = text("idempotencyKey", input.idempotencyKey, 256);
    const signedPayload = text("signedPayload", input.signedPayload);
    const expectedTransactionId = text("expectedTransactionId", input.expectedTransactionId, 256);
    return this.store.transaction(async (store) => {
      const destination = await store.getDestination(destinationId);
      if (!destination) fail("SUBMISSION_NOT_FOUND", "destino não encontrado");
      if (destination.status !== "ATTESTED" || !destination.attestationDigest) {
        fail("SUBMISSION_CONFLICT", "destino precisa estar ATTESTED antes do preparo");
      }
      const existing = await store.findByDestination(destinationId);
      const hash = payloadHash(signedPayload);
      if (existing) {
        if (existing.idempotencyKey !== idempotencyKey || existing.signedPayloadHash !== hash
          || existing.expectedTransactionId !== expectedTransactionId
          || existing.deadline.getTime() !== deadline.getTime()) {
          fail("SUBMISSION_CONFLICT", "retry tentou substituir a transação preparada");
        }
        return { submission: existing, created: false };
      }
      const submission: RelaySubmissionRow = {
        id: randomUUID(), destinationId, idempotencyKey, signedPayload, signedPayloadHash: hash,
        expectedTransactionId, deadline, status: "PREPARED", attempts: 0,
        leaseOwner: null, leaseUntil: null, nextAttemptAt: now, lastError: null,
        submittedAt: null, confirmedAt: null, finalityReference: null,
        createdAt: now, updatedAt: now,
      };
      await store.create(submission);
      return { submission, created: true };
    });
  }

  async submit(
    submissionId: string,
    workerId: string,
    adapter: RelayBroadcastAdapter,
    now = new Date(),
  ): Promise<{ transactionId: string; broadcast: boolean }> {
    const id = text("submissionId", submissionId, 128);
    const worker = text("workerId", workerId, 128);
    date("now", now);
    let submission = await this.store.get(id);
    if (!submission) fail("SUBMISSION_NOT_FOUND", "submissão não encontrada");
    if (submission.status !== "PREPARED") {
      await this.ensureSubmitted(submission.destinationId, submission.expectedTransactionId);
      return { transactionId: submission.expectedTransactionId, broadcast: false };
    }
    if (now >= submission.deadline) fail("SUBMISSION_DEADLINE_EXPIRED", "deadline expirou antes do broadcast");
    if (now < submission.nextAttemptAt) {
      fail("SUBMISSION_RETRY_NOT_READY", "backoff ainda não terminou", submission.nextAttemptAt);
    }
    const leaseUntil = new Date(now.getTime() + this.policy.leaseMs);
    if (!await this.store.claim(id, worker, now, leaseUntil)) {
      submission = await this.store.get(id);
      if (submission && submission.status !== "PREPARED") {
        await this.ensureSubmitted(submission.destinationId, submission.expectedTransactionId);
        return { transactionId: submission.expectedTransactionId, broadcast: false };
      }
      fail("SUBMISSION_BUSY", "outra execução possui o lease desta submissão", submission?.leaseUntil ?? undefined);
    }
    submission = await this.store.get(id);
    if (!submission) fail("SUBMISSION_NOT_FOUND", "submissão desapareceu após lease");
    try {
      const result = await adapter.broadcast({
        signedPayload: submission.signedPayload,
        expectedTransactionId: submission.expectedTransactionId,
        idempotencyKey: submission.idempotencyKey,
      });
      if (result.transactionId !== submission.expectedTransactionId) {
        await this.scheduleRetry(submission, worker, now, "network returned a different transaction id");
        fail("SUBMISSION_TRANSACTION_MISMATCH", "broadcast retornou transaction id divergente");
      }
      if (!await this.store.markBroadcast(id, worker, result.transactionId, now)) {
        fail("SUBMISSION_CONFLICT", "lease perdido ao persistir broadcast");
      }
      await this.store.appendAttempt({
        id: randomUUID(), submissionId: id, attempt: submission.attempts,
        workerId: worker, outcome: "BROADCAST", transactionId: result.transactionId, createdAt: now,
      });
      await this.ensureSubmitted(submission.destinationId, result.transactionId);
      return { transactionId: result.transactionId, broadcast: true };
    } catch (error) {
      if (error instanceof RelaySubmissionError) throw error;
      const retryAt = await this.scheduleRetry(submission, worker, now, cleanError(error));
      fail("SUBMISSION_RETRY_SCHEDULED", "broadcast falhou; retry agendado", retryAt);
    }
  }

  async confirm(
    submissionId: string,
    adapter: RelayBroadcastAdapter,
    now = new Date(),
  ): Promise<{ confirmed: boolean; reference?: string }> {
    const submission = await this.store.get(text("submissionId", submissionId, 128));
    if (!submission) fail("SUBMISSION_NOT_FOUND", "submissão não encontrada");
    if (submission.status === "CONFIRMED") {
      await this.ensureConfirmed(submission.destinationId, submission.finalityReference!);
      return { confirmed: true, reference: submission.finalityReference! };
    }
    if (submission.status !== "BROADCAST") fail("SUBMISSION_CONFLICT", "transação ainda não foi submetida");
    const finality = await adapter.checkFinality(submission.expectedTransactionId);
    if (finality.status === "PENDING") return { confirmed: false };
    if (finality.status !== "FINALIZED") {
      fail("SUBMISSION_FINALITY_FAILED", `${finality.status}: ${cleanError(finality.reason)}`);
    }
    const reference = text("finality.reference", finality.reference, 512);
    if (!await this.store.markConfirmed(submission.id, reference, now)) {
      fail("SUBMISSION_CONFLICT", "confirmação avançou concorrentemente");
    }
    await this.store.appendAttempt({
      id: randomUUID(), submissionId: submission.id, attempt: submission.attempts,
      workerId: "finality", outcome: "CONFIRMED", transactionId: submission.expectedTransactionId,
      finalityRef: reference, createdAt: now,
    });
    await this.ensureConfirmed(submission.destinationId, reference);
    return { confirmed: true, reference };
  }

  private async scheduleRetry(
    submission: RelaySubmissionRow,
    workerId: string,
    now: Date,
    error: string,
  ): Promise<Date> {
    const exponent = Math.min(Math.max(submission.attempts - 1, 0), 20);
    const delay = Math.min(this.policy.baseRetryMs * (2 ** exponent), this.policy.maxRetryMs);
    const retryAt = new Date(now.getTime() + delay);
    if (!await this.store.releaseForRetry(submission.id, workerId, error, retryAt, now)) {
      fail("SUBMISSION_CONFLICT", "lease perdido ao agendar retry");
    }
    await this.store.appendAttempt({
      id: randomUUID(), submissionId: submission.id, attempt: submission.attempts,
      workerId, outcome: "RETRY_SCHEDULED", error, createdAt: now,
    });
    return retryAt;
  }

  private async ensureSubmitted(destinationId: string, transactionId: string): Promise<void> {
    const destination = await this.store.getDestination(destinationId);
    if (!destination) fail("SUBMISSION_NOT_FOUND", "destino não encontrado");
    if (destination.status === "ATTESTED") {
      await this.jobs.advanceDestination({ destinationId, toStatus: "SUBMITTED", reference: transactionId });
    }
  }

  private async ensureConfirmed(destinationId: string, reference: string): Promise<void> {
    const destination = await this.store.getDestination(destinationId);
    if (!destination) fail("SUBMISSION_NOT_FOUND", "destino não encontrado");
    if (destination.status === "ATTESTED") {
      const submission = await this.store.findByDestination(destinationId);
      await this.jobs.advanceDestination({
        destinationId, toStatus: "SUBMITTED", reference: submission!.expectedTransactionId,
      });
    }
    const refreshed = await this.store.getDestination(destinationId);
    if (refreshed?.status === "SUBMITTED") {
      await this.jobs.advanceDestination({ destinationId, toStatus: "CONFIRMED", reference });
    }
  }
}

export function createPrismaRelaySubmissionCoordinator(
  prisma: PrismaClient,
  jobsRepository: RelayJobRepository,
  policy?: Partial<RelaySubmissionPolicy>,
): RelaySubmissionCoordinator {
  return new RelaySubmissionCoordinator(
    new PrismaRelaySubmissionStore(prisma),
    new MultichainRelayJobService(jobsRepository),
    policy,
  );
}
