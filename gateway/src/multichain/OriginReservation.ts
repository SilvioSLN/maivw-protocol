import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Resolver } from "node:dns/promises";
import type { PrismaClient } from "@prisma/client";
import { keccak256, stringToHex, type Hex } from "viem";
import {
  AttestationAction,
  AttestationKind,
  encodeAttestationV1,
  hashAttestationV1,
  hashNetworkId,
  type AttestationV1,
} from "./AttestationCodec.js";
import {
  canonicalizeCatalogDomain,
  catalogDomainHash,
  type OriginNetworkFamily,
} from "./OriginCatalog.js";

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const SECP256K1_SIGNATURE_PATTERN = /^0x[0-9a-f]{130}$/;
const ZERO32 = `0x${"0".repeat(64)}`;
const OUTBOX_TOPIC = "maivw.origin-reservation.v1";
const MAX_U64_SECONDS = (1n << 64n) - 1n;

export type OriginRegistrantAlgorithm = "SECP256K1_EVM" | "ED25519_SOLANA";
export type OriginDnsChallengeStatus = "PENDING" | "VERIFIED" | "EXPIRED";
export type OriginReservationStatus = "RESERVED" | "CLAIM_ISSUED" | "CONSUMED" | "EXPIRED" | "CANCELLED";
export type OriginClaimStatus = "ISSUED" | "SUBMITTED" | "CONSUMED" | "EXPIRED";
export type OriginReservationAuditAction = "RESERVATION_CREATED" | "CLAIM_ISSUED" | "RESERVATION_EXPIRED";

export type OriginReservationErrorCode =
  | "INVALID_RESERVATION_INPUT"
  | "ORIGIN_ALREADY_ACTIVE"
  | "DNS_CHALLENGE_NOT_FOUND"
  | "DNS_CHALLENGE_EXPIRED"
  | "DNS_CHALLENGE_ALREADY_USED"
  | "DNS_CHALLENGE_TOKEN_INVALID"
  | "DNS_PROOF_NOT_FOUND"
  | "ORIGIN_ALREADY_RESERVED"
  | "IDEMPOTENCY_MISMATCH"
  | "ORIGIN_RESERVATION_NOT_FOUND"
  | "ORIGIN_RESERVATION_EXPIRED"
  | "ORIGIN_RESERVATION_STATE_INVALID"
  | "ORIGIN_CLAIM_SIGNER_INVALID"
  | "ORIGIN_RESERVATION_RETRY";

export class OriginReservationError extends Error {
  constructor(
    readonly code: OriginReservationErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OriginReservationError";
  }
}

export interface ReservationOriginReference {
  family: OriginNetworkFamily;
  networkId: string;
  registryId: Hex;
}

export interface ReservationRegistrant {
  algorithm: OriginRegistrantAlgorithm;
  key: Hex;
}

export interface OriginDnsChallengeRow {
  id: string;
  domainHash: string;
  domain: string;
  requesterId: number;
  originNetworkFamily: OriginNetworkFamily;
  originNetworkId: string;
  originNetworkHash: string;
  originRegistryId: string;
  registrantAlgorithm: OriginRegistrantAlgorithm;
  registrantKey: string;
  tokenHash: string;
  contextHash: string;
  dnsValueHash: string;
  status: OriginDnsChallengeStatus;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
}

export interface OriginReservationRow {
  id: string;
  domainHash: string;
  blockingDomainHash: string | null;
  domain: string;
  dnsChallengeId: string;
  requesterId: number;
  originNetworkFamily: OriginNetworkFamily;
  originNetworkId: string;
  originNetworkHash: string;
  originRegistryId: string;
  registrantAlgorithm: OriginRegistrantAlgorithm;
  registrantKey: string;
  dnsEvidenceHash: string;
  nonce: string;
  status: OriginReservationStatus;
  idempotencyKeyHash: string;
  requestHash: string;
  expiresAt: Date;
  claimDeadline: Date | null;
  holdUntil: Date;
  lastAuditHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OriginClaimIssuanceRow {
  id: string;
  reservationId: string;
  domainHash: string;
  codecVersion: number;
  encoded: string;
  digest: string;
  signedBytesHash: string;
  signature: string;
  signerKeyId: string;
  signerKeyVersion: string;
  nonce: string;
  deadline: Date;
  payloadHash: string;
  evidenceHash: string;
  idempotencyKeyHash: string;
  requestHash: string;
  status: OriginClaimStatus;
  submittedAt: Date | null;
  consumedAt: Date | null;
  onChainTxFamily: OriginNetworkFamily | null;
  onChainTxId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OriginReservationAuditEventRow {
  id: string;
  ordinal: bigint;
  reservationId: string;
  domainHash: string;
  action: OriginReservationAuditAction;
  previousState: unknown;
  nextState: unknown;
  actorType: string;
  actorIdHash: string | null;
  requestId: string;
  previousEventHash: string | null;
  eventHash: string;
  createdAt: Date;
}

interface Delegate<Row> {
  findUnique(args: unknown): Promise<Row | null>;
  findFirst(args: unknown): Promise<Row | null>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

interface ReservationTransaction {
  originRecord: Pick<Delegate<unknown>, "findUnique">;
  originDnsChallenge: Delegate<OriginDnsChallengeRow>;
  originReservation: Delegate<OriginReservationRow>;
  originClaimIssuance: Delegate<OriginClaimIssuanceRow>;
  originReservationAuditEvent: Delegate<OriginReservationAuditEventRow> & {
    findMany(args: unknown): Promise<OriginReservationAuditEventRow[]>;
  };
}

interface ReservationDatabase extends ReservationTransaction {
  $transaction<T>(
    operation: (tx: ReservationTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}

export interface DnsTxtVerifier {
  hasTxt(host: string, expectedValue: string): Promise<boolean>;
}

/**
 * Verifica a mesma prova em resolvedores independentes. Erros e timeouts
 * contam como ausência; a emissão falha fechada se o quórum não for atingido.
 */
export class QuorumDnsTxtVerifier implements DnsTxtVerifier {
  private readonly resolvers: Resolver[];

  constructor(
    serverGroups: readonly (readonly string[])[] = [["1.1.1.1"], ["8.8.8.8"]],
    private readonly quorum = 2,
    private readonly timeoutMs = 4_000,
  ) {
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > serverGroups.length) {
      fail("INVALID_RESERVATION_INPUT", "quórum DNS inválido");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      fail("INVALID_RESERVATION_INPUT", "timeout DNS inválido");
    }
    this.resolvers = serverGroups.map((servers) => {
      if (servers.length === 0) fail("INVALID_RESERVATION_INPUT", "grupo de resolvedores vazio");
      const resolver = new Resolver();
      resolver.setServers([...servers]);
      return resolver;
    });
  }

  async hasTxt(host: string, expectedValue: string): Promise<boolean> {
    const checks = await Promise.all(this.resolvers.map(async (resolver) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const records = await Promise.race([
          resolver.resolveTxt(host),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("DNS timeout")), this.timeoutMs);
          }),
        ]);
        return records.some((parts) => parts.join("") === expectedValue);
      } catch {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }));
    return checks.filter(Boolean).length >= this.quorum;
  }
}

export interface OriginClaimSignerResult {
  signature: Hex;
  keyId: string;
  keyVersion: string;
}

export interface OriginClaimSigner {
  signDigest(
    digest: Hex,
    context: { issuanceId: string; reservationId: string },
  ): Promise<OriginClaimSignerResult>;
}

export interface OriginReservationPolicy {
  challengeTtlMs: number;
  reservationTtlMs: number;
  claimTtlMs: number;
  evmFinalityMarginMs: number;
  solanaFinalityMarginMs: number;
}

const DEFAULT_POLICY: OriginReservationPolicy = {
  challengeTtlMs: 30 * 60_000,
  reservationTtlMs: 15 * 60_000,
  claimTtlMs: 15 * 60_000,
  evmFinalityMarginMs: 30 * 60_000,
  solanaFinalityMarginMs: 5 * 60_000,
};

export interface CreateDnsChallengeInput {
  domain: string;
  requesterId: number;
  origin: ReservationOriginReference;
  registrant: ReservationRegistrant;
  now?: Date;
}

export interface CreatedDnsChallenge {
  challenge: OriginDnsChallengeRow;
  token: string;
  dnsRecord: { host: string; value: string };
}

export interface VerifyAndReserveInput {
  challengeId: string;
  requesterId: number;
  token: string;
  idempotencyKey: string;
  requestId: string;
  now?: Date;
}

export interface ReservationResult {
  reservation: OriginReservationRow;
  created: boolean;
}

export interface IssueOriginClaimInput {
  reservationId: string;
  requesterId: number;
  payloadHash: Hex;
  idempotencyKey: string;
  requestId: string;
  now?: Date;
}

export interface ClaimResult {
  reservation: OriginReservationRow;
  claim: OriginClaimIssuanceRow;
  created: boolean;
}

type ReservationAuditState = {
  domainHash: string;
  domain: string;
  dnsChallengeId: string;
  requesterId: number;
  originNetworkFamily: OriginNetworkFamily;
  originNetworkId: string;
  originNetworkHash: string;
  originRegistryId: string;
  registrantAlgorithm: OriginRegistrantAlgorithm;
  registrantKey: string;
  dnsEvidenceHash: string;
  nonce: string;
  status: OriginReservationStatus;
  expiresAt: string;
  claimDeadline: string | null;
  holdUntil: string;
};

interface ReservationAuditHashInput {
  id: string;
  reservationId: string;
  domainHash: string;
  action: OriginReservationAuditAction;
  previousState: ReservationAuditState | null;
  nextState: ReservationAuditState;
  actorType: string;
  actorIdHash: string | null;
  requestId: string;
  previousEventHash: string | null;
  createdAt: Date;
}

export type ReservationAuditVerification =
  | { valid: true; lastEventHash: string | null }
  | { valid: false; eventId: string; reason: "BROKEN_LINK" | "INVALID_HASH" };

function fail(code: OriginReservationErrorCode, message: string, details?: unknown): never {
  throw new OriginReservationError(code, message, details);
}

function text(name: string, value: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) fail("INVALID_RESERVATION_INPUT", `${name} inválido`);
  return normalized;
}

function bytes32(name: string, value: string): Hex {
  const normalized = value.toLowerCase();
  if (!BYTES32_PATTERN.test(normalized)) {
    fail("INVALID_RESERVATION_INPUT", `${name} deve conter exatamente 32 bytes`);
  }
  return normalized as Hex;
}

function validDate(name: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail("INVALID_RESERVATION_INPUT", `${name} inválido`);
  }
  return value;
}

function normalizeOrigin(origin: ReservationOriginReference): ReservationOriginReference & { registryId: Hex } {
  const networkId = text("origin.networkId", origin.networkId, 256);
  hashNetworkId(networkId);
  const prefix = origin.family === "EVM" ? "evm:" : "solana:";
  if (!networkId.startsWith(prefix)) {
    fail("INVALID_RESERVATION_INPUT", "família e networkId da origem divergem");
  }
  const registryId = bytes32("origin.registryId", origin.registryId);
  if (registryId === ZERO32) fail("INVALID_RESERVATION_INPUT", "origin.registryId não pode ser zero");
  return { ...origin, networkId, registryId };
}

function normalizeRegistrant(
  family: OriginNetworkFamily,
  registrant: ReservationRegistrant,
): ReservationRegistrant & { key: Hex } {
  const expected = family === "EVM" ? "SECP256K1_EVM" : "ED25519_SOLANA";
  if (registrant.algorithm !== expected) {
    fail("INVALID_RESERVATION_INPUT", "algoritmo do registrante incompatível com a rede de origem");
  }
  const key = bytes32("registrant.key", registrant.key);
  if (key === ZERO32) fail("INVALID_RESERVATION_INPUT", "registrant.key não pode ser zero");
  return { ...registrant, key };
}

function hashJson(value: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(value)));
}

function hashSecret(value: string): Hex {
  return keccak256(stringToHex(value));
}

function safeHashEqual(left: string, right: string): boolean {
  if (!BYTES32_PATTERN.test(left) || !BYTES32_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left.slice(2), "hex"), Buffer.from(right.slice(2), "hex"));
}

function knownCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function actorHash(requesterId: number): Hex {
  return hashSecret(`maivw-requester:${requesterId}`);
}

function state(row: OriginReservationRow): ReservationAuditState {
  return {
    domainHash: row.domainHash,
    domain: row.domain,
    dnsChallengeId: row.dnsChallengeId,
    requesterId: row.requesterId,
    originNetworkFamily: row.originNetworkFamily,
    originNetworkId: row.originNetworkId,
    originNetworkHash: row.originNetworkHash,
    originRegistryId: row.originRegistryId,
    registrantAlgorithm: row.registrantAlgorithm,
    registrantKey: row.registrantKey,
    dnsEvidenceHash: row.dnsEvidenceHash,
    nonce: row.nonce,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    claimDeadline: row.claimDeadline?.toISOString() ?? null,
    holdUntil: row.holdUntil.toISOString(),
  };
}

export function hashReservationAuditEvent(input: ReservationAuditHashInput): Hex {
  return hashJson({
    version: 1,
    id: input.id,
    reservationId: input.reservationId,
    domainHash: input.domainHash,
    action: input.action,
    previousState: input.previousState,
    nextState: input.nextState,
    actorType: input.actorType,
    actorIdHash: input.actorIdHash,
    requestId: input.requestId,
    previousEventHash: input.previousEventHash,
    createdAt: input.createdAt.toISOString(),
  });
}

export function verifyReservationAuditChain(
  events: readonly OriginReservationAuditEventRow[],
): ReservationAuditVerification {
  let previousEventHash: string | null = null;
  for (const event of events) {
    if (event.previousEventHash !== previousEventHash) {
      return { valid: false, eventId: event.id, reason: "BROKEN_LINK" };
    }
    const computed = hashReservationAuditEvent({
      id: event.id,
      reservationId: event.reservationId,
      domainHash: event.domainHash,
      action: event.action,
      previousState: event.previousState as ReservationAuditState | null,
      nextState: event.nextState as ReservationAuditState,
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

export class OriginReservationService {
  private readonly database: ReservationDatabase;
  private readonly policy: OriginReservationPolicy;

  constructor(
    prisma: PrismaClient | ReservationDatabase,
    private readonly dnsVerifier: DnsTxtVerifier,
    private readonly signer: OriginClaimSigner,
    policy: Partial<OriginReservationPolicy> = {},
  ) {
    this.database = prisma as unknown as ReservationDatabase;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    for (const [name, value] of Object.entries(this.policy)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        fail("INVALID_RESERVATION_INPUT", `${name} deve ser inteiro positivo`);
      }
    }
  }

  async createDnsChallenge(input: CreateDnsChallengeInput): Promise<CreatedDnsChallenge> {
    const now = validDate("now", input.now ?? new Date());
    if (!Number.isInteger(input.requesterId) || input.requesterId < 1) {
      fail("INVALID_RESERVATION_INPUT", "requesterId inválido");
    }
    const domain = canonicalizeCatalogDomain(input.domain);
    const domainHash = catalogDomainHash(domain);
    const origin = normalizeOrigin(input.origin);
    const registrant = normalizeRegistrant(origin.family, input.registrant);
    const active = await this.database.originRecord.findUnique({ where: { domainHash } });
    if (active) fail("ORIGIN_ALREADY_ACTIVE", "domínio já possui origem ativa", active);

    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const dnsValue = `maivw-origin-v1=${id}.${token}`;
    const expiresAt = new Date(now.getTime() + this.policy.challengeTtlMs);
    const contextHash = hashJson({
      version: 1,
      id,
      domainHash,
      requesterId: input.requesterId,
      originNetworkFamily: origin.family,
      originNetworkId: origin.networkId,
      originRegistryId: origin.registryId,
      registrantAlgorithm: registrant.algorithm,
      registrantKey: registrant.key,
      expiresAt: expiresAt.toISOString(),
    });
    const challenge = await this.database.originDnsChallenge.create({
      data: {
        id,
        domainHash,
        domain,
        requesterId: input.requesterId,
        originNetworkFamily: origin.family,
        originNetworkId: origin.networkId,
        originNetworkHash: hashNetworkId(origin.networkId),
        originRegistryId: origin.registryId,
        registrantAlgorithm: registrant.algorithm,
        registrantKey: registrant.key,
        tokenHash: hashSecret(token),
        contextHash,
        dnsValueHash: hashSecret(dnsValue),
        status: "PENDING",
        expiresAt,
        verifiedAt: null,
        createdAt: now,
      },
    });
    return {
      challenge,
      token,
      dnsRecord: { host: `_maivw-verify.${domain}`, value: dnsValue },
    };
  }

  async verifyDnsAndReserve(input: VerifyAndReserveInput): Promise<ReservationResult> {
    const now = validDate("now", input.now ?? new Date());
    const requestId = text("requestId", input.requestId, 160);
    const idempotencyKey = text("idempotencyKey", input.idempotencyKey, 256);
    const initial = await this.database.originDnsChallenge.findUnique({ where: { id: input.challengeId } });
    if (!initial || initial.requesterId !== input.requesterId) {
      fail("DNS_CHALLENGE_NOT_FOUND", "desafio DNS não encontrado");
    }
    const idempotencyKeyHash = hashSecret(`reservation:${input.requesterId}:${idempotencyKey}`);
    const requestHash = hashJson({
      version: 1,
      challengeId: initial.id,
      contextHash: initial.contextHash,
      requesterId: input.requesterId,
    });
    const priorRetry = await this.database.originReservation.findFirst({
      where: { requesterId: input.requesterId, idempotencyKeyHash },
    });
    if (priorRetry) return this.resolveReservationRetry(priorRetry, requestHash);

    this.assertChallenge(initial, input.requesterId, input.token, now);
    const dnsValue = `maivw-origin-v1=${initial.id}.${input.token}`;
    if (!safeHashEqual(initial.dnsValueHash, hashSecret(dnsValue))) {
      fail("DNS_CHALLENGE_TOKEN_INVALID", "valor DNS não corresponde ao desafio");
    }
    if (!await this.dnsVerifier.hasTxt(`_maivw-verify.${initial.domain}`, dnsValue)) {
      fail("DNS_PROOF_NOT_FOUND", "registro TXT do desafio ainda não foi encontrado");
    }

    try {
      return await this.database.$transaction(async (tx) => {
        const challenge = await tx.originDnsChallenge.findUnique({ where: { id: input.challengeId } });
        this.assertChallenge(challenge, input.requesterId, input.token, now);

        const idempotent = await tx.originReservation.findFirst({
          where: { requesterId: input.requesterId, idempotencyKeyHash },
        });
        if (idempotent) return this.resolveReservationRetry(idempotent, requestHash);
        const challengeReservation = await tx.originReservation.findFirst({
          where: { dnsChallengeId: challenge!.id },
        });
        if (challengeReservation) {
          fail("DNS_CHALLENGE_ALREADY_USED", "desafio DNS já foi consumido por outra reserva");
        }

        const active = await tx.originRecord.findUnique({ where: { domainHash: challenge!.domainHash } });
        if (active) fail("ORIGIN_ALREADY_ACTIVE", "domínio já possui origem ativa", active);

        let blocker = await tx.originReservation.findFirst({
          where: { blockingDomainHash: challenge!.domainHash },
        });
        if (blocker && blocker.holdUntil.getTime() <= now.getTime()) {
          blocker = await this.expireReservation(tx, blocker, now, `${requestId}:expire:${blocker.id}`);
        }
        if (blocker?.blockingDomainHash) {
          fail("ORIGIN_ALREADY_RESERVED", `domínio reservado para ${blocker.originNetworkId}`, {
            reservationId: blocker.id,
            originNetworkId: blocker.originNetworkId,
            holdUntil: blocker.holdUntil,
          });
        }

        const reservationId = randomUUID();
        const auditId = randomUUID();
        const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
        const expiresAt = new Date(now.getTime() + this.policy.reservationTtlMs);
        const base = {
          id: reservationId,
          domainHash: challenge!.domainHash,
          blockingDomainHash: challenge!.domainHash,
          domain: challenge!.domain,
          dnsChallengeId: challenge!.id,
          requesterId: challenge!.requesterId,
          originNetworkFamily: challenge!.originNetworkFamily,
          originNetworkId: challenge!.originNetworkId,
          originNetworkHash: challenge!.originNetworkHash,
          originRegistryId: challenge!.originRegistryId,
          registrantAlgorithm: challenge!.registrantAlgorithm,
          registrantKey: challenge!.registrantKey,
          dnsEvidenceHash: challenge!.dnsValueHash,
          nonce,
          status: "RESERVED" as const,
          idempotencyKeyHash,
          requestHash,
          expiresAt,
          claimDeadline: null,
          holdUntil: expiresAt,
          createdAt: now,
          updatedAt: now,
        };
        const nextState = state({ ...base, lastAuditHash: `0x${"0".repeat(64)}` });
        const audit: ReservationAuditHashInput = {
          id: auditId,
          reservationId,
          domainHash: challenge!.domainHash,
          action: "RESERVATION_CREATED",
          previousState: null,
          nextState,
          actorType: "DNS_VERIFIER",
          actorIdHash: actorHash(input.requesterId),
          requestId,
          previousEventHash: null,
          createdAt: now,
        };
        const eventHash = hashReservationAuditEvent(audit);
        const reservation = await tx.originReservation.create({
          data: { ...base, lastAuditHash: eventHash },
        });
        await tx.originDnsChallenge.update({
          where: { id: challenge!.id },
          data: { status: "VERIFIED", verifiedAt: now },
        });
        await this.appendAudit(tx, audit, eventHash);
        return { reservation, created: true };
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      if (error instanceof OriginReservationError) throw error;
      if (knownCode(error) === "P2002") {
        const retry = await this.database.originReservation.findFirst({
          where: { requesterId: input.requesterId, idempotencyKeyHash },
        });
        if (retry) return this.resolveReservationRetry(retry, requestHash);
        const blocker = await this.database.originReservation.findFirst({
          where: { blockingDomainHash: initial!.domainHash },
        });
        if (blocker) {
          fail("ORIGIN_ALREADY_RESERVED", `domínio reservado para ${blocker.originNetworkId}`, blocker);
        }
      }
      if (knownCode(error) === "P2034") {
        fail("ORIGIN_RESERVATION_RETRY", "concorrência serializável; repetir a operação");
      }
      throw error;
    }
  }

  async issueOriginClaim(input: IssueOriginClaimInput): Promise<ClaimResult> {
    const now = validDate("now", input.now ?? new Date());
    const payloadHash = bytes32("payloadHash", input.payloadHash);
    if (payloadHash === ZERO32) fail("INVALID_RESERVATION_INPUT", "payloadHash não pode ser zero");
    const requestId = text("requestId", input.requestId, 160);
    const idempotencyKey = text("idempotencyKey", input.idempotencyKey, 256);
    if (!Number.isInteger(input.requesterId) || input.requesterId < 1) {
      fail("INVALID_RESERVATION_INPUT", "requesterId inválido");
    }
    const idempotencyKeyHash = hashSecret(`claim:${input.requesterId}:${idempotencyKey}`);
    const requestHash = hashJson({
      version: 1,
      reservationId: input.reservationId,
      requesterId: input.requesterId,
      payloadHash,
    });

    try {
      const result = await this.database.$transaction(async (tx) => {
        const reservation = await tx.originReservation.findUnique({ where: { id: input.reservationId } });
        if (!reservation || reservation.requesterId !== input.requesterId) {
          fail("ORIGIN_RESERVATION_NOT_FOUND", "reserva não encontrada");
        }

        const byIdempotency = await tx.originClaimIssuance.findFirst({ where: { idempotencyKeyHash } });
        if (byIdempotency && byIdempotency.reservationId !== reservation!.id) {
          fail("IDEMPOTENCY_MISMATCH", "chave de idempotência já usada por outra reserva");
        }
        const existing = await tx.originClaimIssuance.findUnique({
          where: { reservationId: reservation!.id },
        });
        if (existing) return {
          kind: "claim" as const,
          value: this.resolveClaimRetry(reservation!, existing, requestHash, payloadHash),
        };

        if (reservation!.holdUntil.getTime() <= now.getTime()) {
          await this.expireReservation(tx, reservation!, now, `${requestId}:expire`);
          return { kind: "expired" as const };
        }
        if (reservation!.status !== "RESERVED") {
          fail("ORIGIN_RESERVATION_STATE_INVALID", `reserva está em ${reservation!.status}`);
        }
        const active = await tx.originRecord.findUnique({ where: { domainHash: reservation!.domainHash } });
        if (active) fail("ORIGIN_ALREADY_ACTIVE", "domínio já possui origem ativa", active);

        const deadlineSeconds = BigInt(Math.floor((now.getTime() + this.policy.claimTtlMs) / 1000));
        if (deadlineSeconds > MAX_U64_SECONDS) fail("INVALID_RESERVATION_INPUT", "deadline fora de uint64");
        const deadline = new Date(Number(deadlineSeconds) * 1000);
        const finalityMargin = reservation!.originNetworkFamily === "EVM"
          ? this.policy.evmFinalityMarginMs
          : this.policy.solanaFinalityMarginMs;
        const holdUntil = new Date(deadline.getTime() + finalityMargin);
        const attestation: AttestationV1 = {
          kind: AttestationKind.ORIGIN_CLAIM,
          action: AttestationAction.REGISTER_ORIGIN,
          domainHash: reservation!.domainHash as Hex,
          originNetworkHash: reservation!.originNetworkHash as Hex,
          originRegistry: reservation!.originRegistryId as Hex,
          destinationNetworkHash: reservation!.originNetworkHash as Hex,
          destinationRegistry: reservation!.originRegistryId as Hex,
          globalDomainEpoch: 0n,
          originSequence: 0n,
          nonce: reservation!.nonce as Hex,
          deadline: deadlineSeconds,
          payloadHash,
          evidenceHash: reservation!.dnsEvidenceHash as Hex,
        };
        const encoded = encodeAttestationV1(attestation);
        const digest = hashAttestationV1(attestation);
        const issuanceId = randomUUID();
        const signed = await this.signer.signDigest(digest, {
          issuanceId,
          reservationId: reservation!.id,
        });
        if (!SECP256K1_SIGNATURE_PATTERN.test(signed.signature.toLowerCase())
          || !signed.keyId.trim()
          || !signed.keyVersion.trim()) {
          fail("ORIGIN_CLAIM_SIGNER_INVALID", "signer retornou assinatura ou metadados inválidos");
        }

        const auditId = randomUUID();
        const previousState = state(reservation!);
        const nextState: ReservationAuditState = {
          ...previousState,
          status: "CLAIM_ISSUED",
          claimDeadline: deadline.toISOString(),
          holdUntil: holdUntil.toISOString(),
        };
        const audit: ReservationAuditHashInput = {
          id: auditId,
          reservationId: reservation!.id,
          domainHash: reservation!.domainHash,
          action: "CLAIM_ISSUED",
          previousState,
          nextState,
          actorType: "ORIGIN_CLAIM_SIGNER",
          actorIdHash: actorHash(input.requesterId),
          requestId,
          previousEventHash: reservation!.lastAuditHash,
          createdAt: now,
        };
        const eventHash = hashReservationAuditEvent(audit);
        const claim = await tx.originClaimIssuance.create({
          data: {
            id: issuanceId,
            reservationId: reservation!.id,
            domainHash: reservation!.domainHash,
            codecVersion: 1,
            encoded,
            digest,
            signedBytesHash: digest,
            signature: signed.signature.toLowerCase(),
            signerKeyId: signed.keyId,
            signerKeyVersion: signed.keyVersion,
            nonce: reservation!.nonce,
            deadline,
            payloadHash,
            evidenceHash: reservation!.dnsEvidenceHash,
            idempotencyKeyHash,
            requestHash,
            status: "ISSUED",
            submittedAt: null,
            consumedAt: null,
            onChainTxFamily: null,
            onChainTxId: null,
            createdAt: now,
            updatedAt: now,
          },
        });
        const updated = await tx.originReservation.update({
          where: { id: reservation!.id },
          data: {
            status: "CLAIM_ISSUED",
            claimDeadline: deadline,
            holdUntil,
            lastAuditHash: eventHash,
          },
        });
        await this.appendAudit(tx, audit, eventHash);
        return { kind: "claim" as const, value: { reservation: updated, claim, created: true } };
      }, { isolationLevel: "Serializable" });
      if (result.kind === "expired") {
        fail("ORIGIN_RESERVATION_EXPIRED", "reserva expirou antes da emissão do claim");
      }
      return result.value;
    } catch (error) {
      if (error instanceof OriginReservationError) throw error;
      if (knownCode(error) === "P2002") {
        const existing = await this.database.originClaimIssuance.findUnique({
          where: { reservationId: input.reservationId },
        });
        const reservation = await this.database.originReservation.findUnique({ where: { id: input.reservationId } });
        if (existing && reservation) return this.resolveClaimRetry(reservation, existing, requestHash, payloadHash);
      }
      if (knownCode(error) === "P2034") {
        fail("ORIGIN_RESERVATION_RETRY", "concorrência serializável; repetir a operação");
      }
      throw error;
    }
  }

  async history(reservationId: string, limit = 100): Promise<OriginReservationAuditEventRow[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      fail("INVALID_RESERVATION_INPUT", "limit deve estar entre 1 e 500");
    }
    return this.database.originReservationAuditEvent.findMany({
      where: { reservationId },
      orderBy: { ordinal: "asc" },
      take: limit,
    });
  }

  private assertChallenge(
    challenge: OriginDnsChallengeRow | null,
    requesterId: number,
    token: string,
    now: Date,
  ): void {
    if (!challenge || challenge.requesterId !== requesterId) {
      fail("DNS_CHALLENGE_NOT_FOUND", "desafio DNS não encontrado");
    }
    if (challenge.expiresAt.getTime() <= now.getTime() || challenge.status === "EXPIRED") {
      fail("DNS_CHALLENGE_EXPIRED", "desafio DNS expirado");
    }
    if (!safeHashEqual(challenge.tokenHash, hashSecret(token))) {
      fail("DNS_CHALLENGE_TOKEN_INVALID", "token do desafio DNS inválido");
    }
  }

  private resolveReservationRetry(
    reservation: OriginReservationRow,
    requestHash: Hex,
  ): ReservationResult {
    if (reservation.requestHash !== requestHash) {
      fail("IDEMPOTENCY_MISMATCH", "chave de idempotência reutilizada com outro pedido");
    }
    return { reservation, created: false };
  }

  private resolveClaimRetry(
    reservation: OriginReservationRow,
    claim: OriginClaimIssuanceRow,
    requestHash: Hex,
    payloadHash: Hex,
  ): ClaimResult {
    if (claim.requestHash !== requestHash || claim.payloadHash !== payloadHash) {
      fail("IDEMPOTENCY_MISMATCH", "reserva já possui claim para outro payload");
    }
    return { reservation, claim, created: false };
  }

  private async expireReservation(
    tx: ReservationTransaction,
    reservation: OriginReservationRow,
    now: Date,
    requestId: string,
  ): Promise<OriginReservationRow> {
    const previousState = state(reservation);
    const nextState: ReservationAuditState = {
      ...previousState,
      status: "EXPIRED",
    };
    const audit: ReservationAuditHashInput = {
      id: randomUUID(),
      reservationId: reservation.id,
      domainHash: reservation.domainHash,
      action: "RESERVATION_EXPIRED",
      previousState,
      nextState,
      actorType: "CATALOG_EXPIRER",
      actorIdHash: null,
      requestId,
      previousEventHash: reservation.lastAuditHash,
      createdAt: now,
    };
    const eventHash = hashReservationAuditEvent(audit);
    const expired = await tx.originReservation.update({
      where: { id: reservation.id },
      data: {
        status: "EXPIRED",
        blockingDomainHash: null,
        lastAuditHash: eventHash,
      },
    });
    await tx.originClaimIssuance.updateMany({
      where: { reservationId: reservation.id, status: "ISSUED" },
      data: { status: "EXPIRED" },
    });
    await this.appendAudit(tx, audit, eventHash);
    return expired;
  }

  private async appendAudit(
    tx: ReservationTransaction,
    input: ReservationAuditHashInput,
    eventHash: Hex,
  ): Promise<void> {
    await tx.originReservationAuditEvent.create({
      data: {
        id: input.id,
        reservationId: input.reservationId,
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
              reservationId: input.reservationId,
              domainHash: input.domainHash,
              action: input.action,
              eventHash,
            },
          },
        },
      },
    });
  }
}
