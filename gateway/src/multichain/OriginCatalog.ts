import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { keccak256, stringToHex, type Hex } from "viem";
import { hashNetworkId } from "./AttestationCodec.js";

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const MAX_U64 = (1n << 64n) - 1n;
const OUTBOX_TOPIC = "maivw.origin-catalog.v1";

export type OriginNetworkFamily = "EVM" | "SOLANA";

export interface OriginRecordRow {
  id: string;
  domainHash: string;
  domain: string;
  originNetworkFamily: OriginNetworkFamily;
  originNetworkId: string;
  originNetworkHash: string;
  originRegistryId: string;
  originVersion: number;
  status: "ACTIVE";
  originTxFamily: OriginNetworkFamily;
  originTxId: string;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  activatedAt: Date;
  lastReconciledAt: Date | null;
  lastAuditHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OriginAuditEventRow {
  id: string;
  ordinal: bigint;
  originRecordId: string;
  domainHash: string;
  action: "ORIGIN_ACTIVATED" | "ORIGIN_RECONCILED";
  previousState: unknown;
  nextState: unknown;
  actorType: string;
  actorIdHash: string | null;
  requestId: string;
  previousEventHash: string | null;
  eventHash: string;
  createdAt: Date;
}

interface OriginRecordDelegate {
  findUnique(args: unknown): Promise<OriginRecordRow | null>;
  create(args: unknown): Promise<OriginRecordRow>;
  update(args: unknown): Promise<OriginRecordRow>;
}

interface OriginAuditDelegate {
  create(args: unknown): Promise<OriginAuditEventRow>;
  findMany(args: unknown): Promise<OriginAuditEventRow[]>;
}

interface OriginCatalogTransaction {
  originRecord: OriginRecordDelegate;
  originAuditEvent: OriginAuditDelegate;
}

interface OriginCatalogDatabase extends OriginCatalogTransaction {
  $transaction<T>(
    operation: (tx: OriginCatalogTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export type CatalogErrorCode =
  | "INVALID_ORIGIN_INPUT"
  | "ORIGIN_ALREADY_ACTIVE"
  | "ORIGIN_NOT_FOUND"
  | "ORIGIN_REFERENCE_MISMATCH"
  | "ORIGIN_VERSION_REGRESSION"
  | "ORIGIN_CATALOG_RETRY";

export class OriginCatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    readonly existing?: OriginRecordRow,
  ) {
    super(message);
    this.name = "OriginCatalogError";
  }
}

export interface OriginReference {
  family: OriginNetworkFamily;
  networkId: string;
  registryId: Hex;
}

export interface OriginTransactionReference {
  family: OriginNetworkFamily;
  id: string;
}

export interface CatalogActor {
  type: string;
  idHash?: Hex;
}

export interface ActivateOriginInput {
  domain: string;
  domainHash?: Hex;
  origin: OriginReference;
  transaction: OriginTransactionReference;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  finalizedAt: Date;
  actor: CatalogActor;
  requestId: string;
}

export interface ReconcileOriginInput {
  domainHash: Hex;
  origin: OriginReference;
  transaction: OriginTransactionReference;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  finalizedAt: Date;
  actor: CatalogActor;
  requestId: string;
}

export interface ActivationResult {
  record: OriginRecordRow;
  created: boolean;
}

export interface ReconciliationResult {
  record: OriginRecordRow;
  changed: boolean;
}

interface NormalizedActivation extends ActivateOriginInput {
  domain: string;
  domainHash: Hex;
  origin: OriginReference & { registryId: Hex };
}

type AuditState = {
  domainHash: string;
  domain: string;
  originNetworkFamily: OriginNetworkFamily;
  originNetworkId: string;
  originNetworkHash: string;
  originRegistryId: string;
  originVersion: number;
  status: "ACTIVE";
  originTxFamily: OriginNetworkFamily;
  originTxId: string;
  globalDomainEpoch: string;
  originSequence: string;
  activatedAt: string;
  lastReconciledAt: string | null;
};

export interface AuditHashInput {
  id: string;
  originRecordId: string;
  domainHash: string;
  action: "ORIGIN_ACTIVATED" | "ORIGIN_RECONCILED";
  previousState: AuditState | null;
  nextState: AuditState;
  actorType: string;
  actorIdHash: string | null;
  requestId: string;
  previousEventHash: string | null;
  createdAt: Date;
}

export type AuditChainVerification =
  | { valid: true; lastEventHash: string | null }
  | { valid: false; eventId: string; reason: "BROKEN_LINK" | "INVALID_HASH" };

function invalid(message: string): never {
  throw new OriginCatalogError("INVALID_ORIGIN_INPUT", message);
}

function normalizeBytes32(name: string, value: string): Hex {
  const normalized = value.toLowerCase();
  if (!BYTES32_PATTERN.test(normalized)) invalid(`${name} deve conter exatamente 32 bytes em hexadecimal`);
  return normalized as Hex;
}

function assertU64(name: string, value: bigint): void {
  if (value < 0n || value > MAX_U64) invalid(`${name} deve caber em uint64`);
}

function assertText(name: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) invalid(`${name} inválido`);
  return normalized;
}

export function canonicalizeCatalogDomain(domain: string): string {
  const canonical = assertText("domain", domain, 253).toLowerCase();
  if (canonical.includes(" ") || canonical.startsWith(".") || canonical.endsWith(".")) {
    invalid("domain deve estar em formato canônico");
  }
  return canonical;
}

export function catalogDomainHash(domain: string): Hex {
  return keccak256(stringToHex(canonicalizeCatalogDomain(domain)));
}

function normalizeOrigin(origin: OriginReference): OriginReference {
  const networkId = assertText("origin.networkId", origin.networkId, 256);
  hashNetworkId(networkId);
  const expectedPrefix = origin.family === "EVM" ? "evm:" : "solana:";
  if (!networkId.startsWith(expectedPrefix)) {
    invalid(`origin.family não corresponde a ${networkId}`);
  }
  return {
    family: origin.family,
    networkId,
    registryId: normalizeBytes32("origin.registryId", origin.registryId),
  };
}

function normalizeTransaction(reference: OriginTransactionReference): OriginTransactionReference {
  return {
    family: reference.family,
    id: assertText("transaction.id", reference.id, 256),
  };
}

function normalizeActor(actor: CatalogActor): CatalogActor {
  return {
    type: assertText("actor.type", actor.type, 64),
    idHash: actor.idHash ? normalizeBytes32("actor.idHash", actor.idHash) : undefined,
  };
}

function assertDate(name: string, value: Date): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid(`${name} inválido`);
}

function normalizeActivation(input: ActivateOriginInput): NormalizedActivation {
  const domain = canonicalizeCatalogDomain(input.domain);
  const computedHash = catalogDomainHash(domain);
  const domainHash = input.domainHash ? normalizeBytes32("domainHash", input.domainHash) : computedHash;
  if (domainHash !== computedHash) invalid("domainHash não corresponde ao domínio canônico");
  assertU64("globalDomainEpoch", input.globalDomainEpoch);
  assertU64("originSequence", input.originSequence);
  assertDate("finalizedAt", input.finalizedAt);
  const origin = normalizeOrigin(input.origin);
  const transaction = normalizeTransaction(input.transaction);
  if (transaction.family !== origin.family) invalid("transaction.family deve corresponder à família da origem");
  return {
    ...input,
    domain,
    domainHash,
    origin,
    transaction,
    actor: normalizeActor(input.actor),
    requestId: assertText("requestId", input.requestId, 128),
  };
}

function normalizeReconciliation(input: ReconcileOriginInput): ReconcileOriginInput {
  assertU64("globalDomainEpoch", input.globalDomainEpoch);
  assertU64("originSequence", input.originSequence);
  assertDate("finalizedAt", input.finalizedAt);
  const origin = normalizeOrigin(input.origin);
  const transaction = normalizeTransaction(input.transaction);
  if (transaction.family !== origin.family) invalid("transaction.family deve corresponder à família da origem");
  return {
    ...input,
    domainHash: normalizeBytes32("domainHash", input.domainHash),
    origin,
    transaction,
    actor: normalizeActor(input.actor),
    requestId: assertText("requestId", input.requestId, 128),
  };
}

function snapshot(record: {
  domainHash: string;
  domain: string;
  originNetworkFamily: OriginNetworkFamily;
  originNetworkId: string;
  originNetworkHash: string;
  originRegistryId: string;
  originVersion: number;
  status: "ACTIVE";
  originTxFamily: OriginNetworkFamily;
  originTxId: string;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  activatedAt: Date;
  lastReconciledAt: Date | null;
}): AuditState {
  return {
    domainHash: record.domainHash,
    domain: record.domain,
    originNetworkFamily: record.originNetworkFamily,
    originNetworkId: record.originNetworkId,
    originNetworkHash: record.originNetworkHash,
    originRegistryId: record.originRegistryId,
    originVersion: record.originVersion,
    status: record.status,
    originTxFamily: record.originTxFamily,
    originTxId: record.originTxId,
    globalDomainEpoch: record.globalDomainEpoch.toString(),
    originSequence: record.originSequence.toString(),
    activatedAt: record.activatedAt.toISOString(),
    lastReconciledAt: record.lastReconciledAt?.toISOString() ?? null,
  };
}

/** Hash encadeado que torna qualquer edição, remoção ou reordenação detectável. */
export function hashOriginAuditEvent(input: AuditHashInput): Hex {
  return keccak256(stringToHex(JSON.stringify({
    version: 1,
    id: input.id,
    originRecordId: input.originRecordId,
    domainHash: input.domainHash,
    action: input.action,
    previousState: input.previousState,
    nextState: input.nextState,
    actorType: input.actorType,
    actorIdHash: input.actorIdHash,
    requestId: input.requestId,
    previousEventHash: input.previousEventHash,
    createdAt: input.createdAt.toISOString(),
  })));
}

/** Verifica a ordem append-only e recalcula cada elo sem confiar no hash armazenado. */
export function verifyOriginAuditChain(events: readonly OriginAuditEventRow[]): AuditChainVerification {
  let previousEventHash: string | null = null;
  for (const event of events) {
    if (event.previousEventHash !== previousEventHash) {
      return { valid: false, eventId: event.id, reason: "BROKEN_LINK" };
    }
    const computed = hashOriginAuditEvent({
      id: event.id,
      originRecordId: event.originRecordId,
      domainHash: event.domainHash,
      action: event.action,
      previousState: event.previousState as AuditState | null,
      nextState: event.nextState as AuditState,
      actorType: event.actorType,
      actorIdHash: event.actorIdHash,
      requestId: event.requestId,
      previousEventHash: event.previousEventHash,
      createdAt: event.createdAt,
    });
    if (computed !== event.eventHash) {
      return { valid: false, eventId: event.id, reason: "INVALID_HASH" };
    }
    previousEventHash = event.eventHash;
  }
  return { valid: true, lastEventHash: previousEventHash };
}

function sameOrigin(record: OriginRecordRow, origin: OriginReference): boolean {
  return record.originNetworkFamily === origin.family
    && record.originNetworkId === origin.networkId
    && record.originRegistryId === origin.registryId;
}

function sameActivation(record: OriginRecordRow, input: NormalizedActivation): boolean {
  return record.domain === input.domain
    && sameOrigin(record, input.origin)
    && record.originTxFamily === input.transaction.family
    && record.originTxId === input.transaction.id
    && record.globalDomainEpoch === input.globalDomainEpoch
    && record.originSequence === input.originSequence;
}

function compareVersion(record: OriginRecordRow, epoch: bigint, sequence: bigint): number {
  if (epoch !== record.globalDomainEpoch) return epoch > record.globalDomainEpoch ? 1 : -1;
  if (sequence !== record.originSequence) return sequence > record.originSequence ? 1 : -1;
  return 0;
}

function knownPrismaCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export class OriginCatalogService {
  private readonly database: OriginCatalogDatabase;

  constructor(prisma: PrismaClient | OriginCatalogDatabase) {
    this.database = prisma as unknown as OriginCatalogDatabase;
  }

  async activate(input: ActivateOriginInput): Promise<ActivationResult> {
    const normalized = normalizeActivation(input);
    try {
      return await this.database.$transaction(async (tx) => {
        const existing = await tx.originRecord.findUnique({ where: { domainHash: normalized.domainHash } });
        if (existing) return this.resolveExistingActivation(existing, normalized);

        const now = new Date();
        const recordId = randomUUID();
        const auditId = randomUUID();
        const nextState: AuditState = {
          domainHash: normalized.domainHash,
          domain: normalized.domain,
          originNetworkFamily: normalized.origin.family,
          originNetworkId: normalized.origin.networkId,
          originNetworkHash: hashNetworkId(normalized.origin.networkId),
          originRegistryId: normalized.origin.registryId,
          originVersion: 1,
          status: "ACTIVE",
          originTxFamily: normalized.transaction.family,
          originTxId: normalized.transaction.id,
          globalDomainEpoch: normalized.globalDomainEpoch.toString(),
          originSequence: normalized.originSequence.toString(),
          activatedAt: normalized.finalizedAt.toISOString(),
          lastReconciledAt: null,
        };
        const auditInput: AuditHashInput = {
          id: auditId,
          originRecordId: recordId,
          domainHash: normalized.domainHash,
          action: "ORIGIN_ACTIVATED",
          previousState: null,
          nextState,
          actorType: normalized.actor.type,
          actorIdHash: normalized.actor.idHash ?? null,
          requestId: normalized.requestId,
          previousEventHash: null,
          createdAt: now,
        };
        const eventHash = hashOriginAuditEvent(auditInput);
        const record = await tx.originRecord.create({
          data: {
            id: recordId,
            domainHash: normalized.domainHash,
            domain: normalized.domain,
            originNetworkFamily: normalized.origin.family,
            originNetworkId: normalized.origin.networkId,
            originNetworkHash: nextState.originNetworkHash,
            originRegistryId: normalized.origin.registryId,
            originVersion: 1,
            status: "ACTIVE",
            originTxFamily: normalized.transaction.family,
            originTxId: normalized.transaction.id,
            globalDomainEpoch: normalized.globalDomainEpoch,
            originSequence: normalized.originSequence,
            activatedAt: normalized.finalizedAt,
            lastAuditHash: eventHash,
          },
        });
        await this.appendAudit(tx, auditInput, eventHash);
        return { record, created: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (knownPrismaCode(error) === "P2002") {
        const existing = await this.database.originRecord.findUnique({ where: { domainHash: normalized.domainHash } });
        if (existing) return this.resolveExistingActivation(existing, normalized);
      }
      if (knownPrismaCode(error) === "P2034") {
        throw new OriginCatalogError("ORIGIN_CATALOG_RETRY", "concorrência serializável; repetir a operação");
      }
      throw error;
    }
  }

  async reconcile(input: ReconcileOriginInput): Promise<ReconciliationResult> {
    const normalized = normalizeReconciliation(input);
    try {
      return await this.database.$transaction(async (tx) => {
        const current = await tx.originRecord.findUnique({ where: { domainHash: normalized.domainHash } });
        if (!current) throw new OriginCatalogError("ORIGIN_NOT_FOUND", "origem ainda não está ativa");
        if (!sameOrigin(current, normalized.origin)) {
          throw new OriginCatalogError("ORIGIN_REFERENCE_MISMATCH", "rede ou Registry diverge da origem imutável", current);
        }

        const ordering = compareVersion(current, normalized.globalDomainEpoch, normalized.originSequence);
        if (ordering < 0) {
          throw new OriginCatalogError("ORIGIN_VERSION_REGRESSION", "epoch/sequence observado regride o catálogo", current);
        }
        if (ordering === 0) {
          if (current.originTxFamily !== normalized.transaction.family
            || current.originTxId !== normalized.transaction.id) {
            throw new OriginCatalogError(
              "ORIGIN_REFERENCE_MISMATCH",
              "a mesma versão já foi reconciliada com outra transação",
              current,
            );
          }
          return { record: current, changed: false };
        }

        const now = new Date();
        const auditId = randomUUID();
        const previousState = snapshot(current);
        const nextState: AuditState = {
          ...previousState,
          originTxFamily: normalized.transaction.family,
          originTxId: normalized.transaction.id,
          globalDomainEpoch: normalized.globalDomainEpoch.toString(),
          originSequence: normalized.originSequence.toString(),
          lastReconciledAt: normalized.finalizedAt.toISOString(),
        };
        const auditInput: AuditHashInput = {
          id: auditId,
          originRecordId: current.id,
          domainHash: current.domainHash,
          action: "ORIGIN_RECONCILED",
          previousState,
          nextState,
          actorType: normalized.actor.type,
          actorIdHash: normalized.actor.idHash ?? null,
          requestId: normalized.requestId,
          previousEventHash: current.lastAuditHash,
          createdAt: now,
        };
        const eventHash = hashOriginAuditEvent(auditInput);
        const record = await tx.originRecord.update({
          where: { id: current.id },
          data: {
            originTxFamily: normalized.transaction.family,
            originTxId: normalized.transaction.id,
            globalDomainEpoch: normalized.globalDomainEpoch,
            originSequence: normalized.originSequence,
            lastReconciledAt: normalized.finalizedAt,
            lastAuditHash: eventHash,
          },
        });
        await this.appendAudit(tx, auditInput, eventHash);
        return { record, changed: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (knownPrismaCode(error) === "P2034") {
        throw new OriginCatalogError("ORIGIN_CATALOG_RETRY", "concorrência serializável; repetir a operação");
      }
      throw error;
    }
  }

  async get(domainHash: Hex): Promise<OriginRecordRow | null> {
    return this.database.originRecord.findUnique({
      where: { domainHash: normalizeBytes32("domainHash", domainHash) },
    });
  }

  async history(domainHash: Hex, limit = 100): Promise<OriginAuditEventRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) invalid("limit deve estar entre 1 e 500");
    return this.database.originAuditEvent.findMany({
      where: { domainHash: normalizeBytes32("domainHash", domainHash) },
      orderBy: { ordinal: "asc" },
      take: limit,
    });
  }

  private resolveExistingActivation(existing: OriginRecordRow, input: NormalizedActivation): ActivationResult {
    if (sameActivation(existing, input)) return { record: existing, created: false };
    throw new OriginCatalogError(
      "ORIGIN_ALREADY_ACTIVE",
      `domainHash já possui origem ativa em ${existing.originNetworkId}`,
      existing,
    );
  }

  private async appendAudit(
    tx: OriginCatalogTransaction,
    input: AuditHashInput,
    eventHash: Hex,
  ): Promise<void> {
    await tx.originAuditEvent.create({
      data: {
        id: input.id,
        originRecordId: input.originRecordId,
        domainHash: input.domainHash,
        action: input.action,
        ...(input.previousState ? { previousState: input.previousState } : {}),
        nextState: input.nextState,
        actorType: input.actorType,
        actorIdHash: input.actorIdHash,
        requestId: input.requestId,
        previousEventHash: input.previousEventHash,
        eventHash,
        createdAt: input.createdAt,
        outboxEvent: {
          create: {
            id: randomUUID(),
            topic: OUTBOX_TOPIC,
            partitionKey: input.domainHash,
            payload: {
              version: 1,
              auditEventId: input.id,
              eventHash,
              domainHash: input.domainHash,
              action: input.action,
              originRecordId: input.originRecordId,
            },
          },
        },
      },
    });
  }
}
