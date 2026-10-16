import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { keccak256, stringToHex, type Hex } from "viem";
import type { ReconciliationFindingRow } from "./MultichainReconciliation.js";
import type { RelaySubmissionGate } from "./RelaySubmission.js";

export type RelayCircuitStatus = "CLOSED" | "OPEN";
export type RelayCircuitScopeKind = "GLOBAL" | "DOMAIN" | "DEPLOYMENT" | "DOMAIN_DEPLOYMENT";
export type RelayCircuitSignalKind =
  | "ORIGIN_CONFLICT" | "STATE_DRIFT" | "RPC_DIVERGENCE" | "LOW_BALANCE"
  | "RELAY_FAILURE" | "RELAY_SUCCESS" | "MANUAL_RESET";
export type RelayCircuitEventAction =
  | "SIGNAL_RECORDED" | "TRIPPED" | "FAILURE_COUNTER_RESET" | "MANUAL_RESET";

export interface RelayCircuitScope {
  kind: RelayCircuitScopeKind;
  domainHash?: string;
  networkId?: string;
  registryId?: string;
}

export interface RelayCircuitContext {
  domainHash?: string;
  networkId?: string;
  registryId?: string;
}

export type RelayCircuitSignal =
  | { kind: "ORIGIN_CONFLICT" | "STATE_DRIFT" | "RPC_DIVERGENCE"; evidence: Record<string, string> }
  | { kind: "LOW_BALANCE"; asset: string; available: bigint; required: bigint }
  | { kind: "RELAY_FAILURE"; error: string }
  | { kind: "RELAY_SUCCESS" };

export interface RelayCircuitBreakerRow {
  id: string;
  scopeKey: string;
  scopeKind: RelayCircuitScopeKind;
  domainHash: string | null;
  networkId: string | null;
  registryId: string | null;
  status: RelayCircuitStatus;
  triggerSignal: RelayCircuitSignalKind | null;
  reason: string | null;
  consecutiveFailures: number;
  failureThreshold: number;
  version: number;
  openedAt: Date | null;
  resetAt: Date | null;
  lastAuditHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RelayCircuitEventRow {
  id: string;
  breakerId: string;
  requestId: string;
  requestHash: string;
  signalKind: RelayCircuitSignalKind;
  action: RelayCircuitEventAction;
  reason: string;
  details: Record<string, unknown>;
  resultingStatus: RelayCircuitStatus;
  consecutiveFailures: number;
  previousAuditHash: string | null;
  auditHash: string;
  actor: string | null;
  createdAt: Date;
}

export interface RelayCircuitBreakerRepository {
  transaction<T>(operation: (repository: RelayCircuitBreakerRepository) => Promise<T>): Promise<T>;
  findBreaker(scopeKey: string): Promise<RelayCircuitBreakerRow | null>;
  findOpenBreakers(scopeKeys: readonly string[]): Promise<RelayCircuitBreakerRow[]>;
  findEvent(scopeKey: string, requestId: string): Promise<RelayCircuitEventRow | null>;
  createBreaker(row: RelayCircuitBreakerRow): Promise<void>;
  updateBreaker(
    id: string,
    expectedVersion: number,
    next: Pick<RelayCircuitBreakerRow,
      "status" | "triggerSignal" | "reason" | "consecutiveFailures" | "openedAt" | "resetAt" | "lastAuditHash"
    >,
    at: Date,
  ): Promise<boolean>;
  createEvent(row: RelayCircuitEventRow): Promise<void>;
}

type PrismaLike = Record<string, any> & {
  $transaction<T>(operation: (tx: Record<string, any>) => Promise<T>): Promise<T>;
};

export class PrismaRelayCircuitBreakerRepository implements RelayCircuitBreakerRepository {
  constructor(private readonly client: PrismaClient | PrismaLike) {}

  async transaction<T>(operation: (repository: RelayCircuitBreakerRepository) => Promise<T>): Promise<T> {
    return (this.client as PrismaLike).$transaction((tx) =>
      operation(new PrismaRelayCircuitBreakerRepository(tx as PrismaLike)));
  }
  async findBreaker(scopeKey: string): Promise<RelayCircuitBreakerRow | null> {
    return (this.client as any).multichainRelayCircuitBreaker.findUnique({ where: { scopeKey } });
  }
  async findOpenBreakers(scopeKeys: readonly string[]): Promise<RelayCircuitBreakerRow[]> {
    return (this.client as any).multichainRelayCircuitBreaker.findMany({
      where: { scopeKey: { in: [...scopeKeys] }, status: "OPEN" },
      orderBy: { scopeKey: "asc" },
    });
  }
  async findEvent(scopeKey: string, requestId: string): Promise<RelayCircuitEventRow | null> {
    return (this.client as any).multichainRelayCircuitEvent.findFirst({
      where: { requestId, breaker: { scopeKey } },
    });
  }
  async createBreaker(row: RelayCircuitBreakerRow): Promise<void> {
    await (this.client as any).multichainRelayCircuitBreaker.create({ data: row });
  }
  async updateBreaker(
    id: string,
    expectedVersion: number,
    next: Pick<RelayCircuitBreakerRow,
      "status" | "triggerSignal" | "reason" | "consecutiveFailures" | "openedAt" | "resetAt" | "lastAuditHash"
    >,
    at: Date,
  ): Promise<boolean> {
    const result = await (this.client as any).multichainRelayCircuitBreaker.updateMany({
      where: { id, version: expectedVersion },
      data: { ...next, version: { increment: 1 }, updatedAt: at },
    });
    return result.count === 1;
  }
  async createEvent(row: RelayCircuitEventRow): Promise<void> {
    await (this.client as any).multichainRelayCircuitEvent.create({ data: row });
  }
}

export class RelayCircuitBreakerError extends Error {
  constructor(
    readonly code: "INVALID_CIRCUIT" | "CIRCUIT_OPEN" | "CIRCUIT_CONFLICT",
    message: string,
    readonly openBreakers: readonly RelayCircuitBreakerRow[] = [],
  ) {
    super(message);
    this.name = "RelayCircuitBreakerError";
  }
}

function fail(
  code: RelayCircuitBreakerError["code"],
  message: string,
  openBreakers: readonly RelayCircuitBreakerRow[] = [],
): never {
  throw new RelayCircuitBreakerError(code, message, openBreakers);
}

function text(name: string, value: string, max = 1_000): string {
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!normalized || normalized.length > max) fail("INVALID_CIRCUIT", `${name} inválido`);
  return normalized;
}

function date(name: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail("INVALID_CIRCUIT", `${name} inválido`);
  return value;
}

function bytes32(name: string, value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) fail("INVALID_CIRCUIT", `${name} inválido`);
  return value.toLowerCase();
}

function hash(value: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(value)));
}

interface NormalizedScope {
  key: string;
  kind: RelayCircuitScopeKind;
  domainHash: string | null;
  networkId: string | null;
  registryId: string | null;
}

function normalizeScope(scope: RelayCircuitScope): NormalizedScope {
  const domainHash = scope.domainHash ? bytes32("domainHash", scope.domainHash) : null;
  const networkId = scope.networkId ? text("networkId", scope.networkId, 256) : null;
  const registryId = scope.registryId ? bytes32("registryId", scope.registryId) : null;
  if (scope.kind === "GLOBAL") {
    if (domainHash || networkId || registryId) fail("INVALID_CIRCUIT", "escopo GLOBAL não aceita identificadores");
    return { key: "global", kind: scope.kind, domainHash, networkId, registryId };
  }
  if (scope.kind === "DOMAIN") {
    if (!domainHash || networkId || registryId) fail("INVALID_CIRCUIT", "escopo DOMAIN exige somente domainHash");
    return { key: `domain:${domainHash}`, kind: scope.kind, domainHash, networkId, registryId };
  }
  if (scope.kind === "DEPLOYMENT") {
    if (domainHash || !networkId || !registryId) {
      fail("INVALID_CIRCUIT", "escopo DEPLOYMENT exige networkId e registryId");
    }
    return {
      key: `deployment:${networkId}:${registryId}`, kind: scope.kind, domainHash, networkId, registryId,
    };
  }
  if (!domainHash || !networkId || !registryId) {
    fail("INVALID_CIRCUIT", "escopo DOMAIN_DEPLOYMENT exige domínio e deployment");
  }
  return {
    key: `domain-deployment:${domainHash}:${networkId}:${registryId}`,
    kind: scope.kind, domainHash, networkId, registryId,
  };
}

function contextScopeKeys(context: RelayCircuitContext): string[] {
  const keys = ["global"];
  const domainHash = context.domainHash ? bytes32("domainHash", context.domainHash) : null;
  const networkId = context.networkId ? text("networkId", context.networkId, 256) : null;
  const registryId = context.registryId ? bytes32("registryId", context.registryId) : null;
  if ((networkId && !registryId) || (!networkId && registryId)) {
    fail("INVALID_CIRCUIT", "contexto de deployment incompleto");
  }
  if (domainHash) keys.push(`domain:${domainHash}`);
  if (networkId && registryId) keys.push(`deployment:${networkId}:${registryId}`);
  if (domainHash && networkId && registryId) {
    keys.push(`domain-deployment:${domainHash}:${networkId}:${registryId}`);
  }
  return keys;
}

function normalizeEvidence(evidence: Record<string, string>): Record<string, string> {
  const entries = Object.entries(evidence).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0 || entries.length > 32) fail("INVALID_CIRCUIT", "evidence inválida");
  return Object.fromEntries(entries.map(([key, value]) => [text("evidence key", key, 128), text("evidence value", value)]));
}

function normalizeSignal(signal: RelayCircuitSignal): { kind: RelayCircuitSignalKind; reason: string; details: Record<string, unknown> } {
  if (signal.kind === "LOW_BALANCE") {
    const asset = text("asset", signal.asset, 128);
    if (signal.available < 0n || signal.required <= 0n || signal.available >= signal.required) {
      fail("INVALID_CIRCUIT", "LOW_BALANCE exige saldo disponível menor que o necessário");
    }
    return {
      kind: signal.kind,
      reason: `insufficient ${asset} balance`,
      details: { asset, available: signal.available.toString(), required: signal.required.toString() },
    };
  }
  if (signal.kind === "RELAY_FAILURE") {
    const error = text("error", signal.error);
    return { kind: signal.kind, reason: "repeated relay failure", details: { error } };
  }
  if (signal.kind === "RELAY_SUCCESS") {
    return { kind: signal.kind, reason: "relay operation succeeded", details: {} };
  }
  const evidence = normalizeEvidence(signal.evidence);
  return { kind: signal.kind, reason: signal.kind.toLowerCase().replaceAll("_", " "), details: { evidence } };
}

const IMMEDIATE_SIGNALS = new Set<RelayCircuitSignalKind>([
  "ORIGIN_CONFLICT", "STATE_DRIFT", "RPC_DIVERGENCE", "LOW_BALANCE",
]);

export interface RecordRelayCircuitSignalInput {
  requestId: string;
  scope: RelayCircuitScope;
  signal: RelayCircuitSignal;
  observedAt: Date;
}

export interface ResetRelayCircuitInput {
  requestId: string;
  scope: RelayCircuitScope;
  actor: string;
  reason: string;
  resetAt: Date;
}

export class RelayCircuitBreakerService {
  readonly failureThreshold: number;

  constructor(
    private readonly repository: RelayCircuitBreakerRepository,
    options: { failureThreshold?: number } = {},
  ) {
    this.failureThreshold = options.failureThreshold ?? 3;
    if (!Number.isSafeInteger(this.failureThreshold) || this.failureThreshold < 1) {
      fail("INVALID_CIRCUIT", "failureThreshold inválido");
    }
  }

  async assertRelayAllowed(context: RelayCircuitContext): Promise<void> {
    const open = await this.repository.findOpenBreakers(contextScopeKeys(context));
    if (open.length > 0) fail("CIRCUIT_OPEN", "relayer pausado por circuit breaker", open);
  }

  async recordSignal(input: RecordRelayCircuitSignalInput): Promise<{
    breaker: RelayCircuitBreakerRow;
    event: RelayCircuitEventRow;
    created: boolean;
  }> {
    const requestId = text("requestId", input.requestId, 128);
    const scope = normalizeScope(input.scope);
    const observedAt = date("observedAt", input.observedAt);
    const signal = normalizeSignal(input.signal);
    const requestHash = hash({ version: 1, requestId, scopeKey: scope.key, ...signal, observedAt: observedAt.toISOString() });
    return this.repository.transaction(async (repository) => {
      const previousEvent = await repository.findEvent(scope.key, requestId);
      if (previousEvent) {
        if (previousEvent.requestHash !== requestHash) fail("CIRCUIT_CONFLICT", "requestId reutilizado com outro sinal");
        const current = await repository.findBreaker(scope.key);
        if (!current) fail("CIRCUIT_CONFLICT", "evento existe sem circuit breaker");
        return { breaker: current, event: previousEvent, created: false };
      }
      let breaker = await repository.findBreaker(scope.key);
      if (!breaker) {
        breaker = {
          id: randomUUID(), scopeKey: scope.key, scopeKind: scope.kind,
          domainHash: scope.domainHash, networkId: scope.networkId, registryId: scope.registryId,
          status: "CLOSED", triggerSignal: null, reason: null, consecutiveFailures: 0,
          failureThreshold: this.failureThreshold, version: 0, openedAt: null, resetAt: null,
          lastAuditHash: null, createdAt: observedAt, updatedAt: observedAt,
        };
        await repository.createBreaker(breaker);
      } else if (breaker.failureThreshold !== this.failureThreshold) {
        fail("CIRCUIT_CONFLICT", "failureThreshold diverge do circuit breaker persistido");
      }
      let consecutiveFailures = breaker.consecutiveFailures;
      let status = breaker.status;
      let triggerSignal = breaker.triggerSignal;
      let reason = breaker.reason;
      let openedAt = breaker.openedAt;
      let action: RelayCircuitEventAction = "SIGNAL_RECORDED";
      if (IMMEDIATE_SIGNALS.has(signal.kind)) {
        status = "OPEN";
        triggerSignal = signal.kind;
        reason = signal.reason;
        openedAt ??= observedAt;
        action = breaker.status === "OPEN" ? "SIGNAL_RECORDED" : "TRIPPED";
      } else if (signal.kind === "RELAY_FAILURE") {
        consecutiveFailures += 1;
        if (consecutiveFailures >= breaker.failureThreshold) {
          status = "OPEN";
          triggerSignal = signal.kind;
          reason = signal.reason;
          openedAt ??= observedAt;
          action = breaker.status === "OPEN" ? "SIGNAL_RECORDED" : "TRIPPED";
        }
      } else if (breaker.status === "CLOSED") {
        action = consecutiveFailures > 0 ? "FAILURE_COUNTER_RESET" : "SIGNAL_RECORDED";
        consecutiveFailures = 0;
      }
      const eventBase = {
        breakerId: breaker.id, requestId, requestHash, signalKind: signal.kind, action,
        reason: signal.reason, details: signal.details, resultingStatus: status,
        consecutiveFailures, previousAuditHash: breaker.lastAuditHash, actor: null, createdAt: observedAt,
      };
      const event: RelayCircuitEventRow = {
        id: randomUUID(), ...eventBase,
        auditHash: hash({ version: 1, scopeKey: scope.key, ...eventBase, createdAt: observedAt.toISOString() }),
      };
      const next = {
        status, triggerSignal, reason, consecutiveFailures, openedAt,
        resetAt: breaker.resetAt, lastAuditHash: event.auditHash,
      };
      if (!await repository.updateBreaker(breaker.id, breaker.version, next, observedAt)) {
        fail("CIRCUIT_CONFLICT", "circuit breaker mudou concorrentemente");
      }
      await repository.createEvent(event);
      return {
        breaker: { ...breaker, ...next, version: breaker.version + 1, updatedAt: observedAt },
        event,
        created: true,
      };
    });
  }

  async reset(input: ResetRelayCircuitInput): Promise<{
    breaker: RelayCircuitBreakerRow;
    event: RelayCircuitEventRow;
    created: boolean;
  }> {
    const requestId = text("requestId", input.requestId, 128);
    const scope = normalizeScope(input.scope);
    const actor = text("actor", input.actor, 256);
    const reason = text("reason", input.reason);
    const resetAt = date("resetAt", input.resetAt);
    const requestHash = hash({ version: 1, requestId, scopeKey: scope.key, actor, reason, resetAt: resetAt.toISOString() });
    return this.repository.transaction(async (repository) => {
      const previousEvent = await repository.findEvent(scope.key, requestId);
      if (previousEvent) {
        if (previousEvent.requestHash !== requestHash) fail("CIRCUIT_CONFLICT", "requestId reutilizado com outro reset");
        const current = await repository.findBreaker(scope.key);
        if (!current) fail("CIRCUIT_CONFLICT", "reset existe sem circuit breaker");
        return { breaker: current, event: previousEvent, created: false };
      }
      const breaker = await repository.findBreaker(scope.key);
      if (!breaker) fail("INVALID_CIRCUIT", "circuit breaker não existe");
      const eventBase = {
        breakerId: breaker.id, requestId, requestHash, signalKind: "MANUAL_RESET" as const,
        action: "MANUAL_RESET" as const, reason, details: {}, resultingStatus: "CLOSED" as const,
        consecutiveFailures: 0, previousAuditHash: breaker.lastAuditHash, actor, createdAt: resetAt,
      };
      const event: RelayCircuitEventRow = {
        id: randomUUID(), ...eventBase,
        auditHash: hash({ version: 1, scopeKey: scope.key, ...eventBase, createdAt: resetAt.toISOString() }),
      };
      const next = {
        status: "CLOSED" as const, triggerSignal: null, reason: null, consecutiveFailures: 0,
        openedAt: null, resetAt, lastAuditHash: event.auditHash,
      };
      if (!await repository.updateBreaker(breaker.id, breaker.version, next, resetAt)) {
        fail("CIRCUIT_CONFLICT", "circuit breaker mudou concorrentemente");
      }
      await repository.createEvent(event);
      return {
        breaker: { ...breaker, ...next, version: breaker.version + 1, updatedAt: resetAt },
        event,
        created: true,
      };
    });
  }
}

export interface RelayDestinationCircuitContextResolver {
  resolve(destinationId: string): Promise<RelayCircuitContext | null>;
}

/** Adapts persisted circuit scopes to the submission coordinator's destination gate. */
export class RelayCircuitSubmissionGate implements RelaySubmissionGate {
  constructor(
    private readonly circuits: RelayCircuitBreakerService,
    private readonly resolver: RelayDestinationCircuitContextResolver,
  ) {}

  async assertAllowed(destinationId: string): Promise<void> {
    const normalizedDestinationId = text("destinationId", destinationId, 128);
    const context = await this.resolver.resolve(normalizedDestinationId);
    if (!context) fail("INVALID_CIRCUIT", "destino não possui contexto para circuit breaker");
    await this.circuits.assertRelayAllowed(context);
  }
}

/** Converts safety-critical reconciliation findings into breaker signals. */
export function reconciliationCircuitSignals(
  runId: string,
  domainHash: string,
  findings: readonly ReconciliationFindingRow[],
): RecordRelayCircuitSignalInput[] {
  const normalizedRunId = text("runId", runId, 128);
  const normalizedDomainHash = bytes32("domainHash", domainHash);
  return findings.flatMap((finding) => {
    if (finding.kind !== "ORIGIN_CONFLICT" && finding.kind !== "STATE_DRIFT") return [];
    return [{
      requestId: `reconciliation:${normalizedRunId}:${finding.id}`,
      scope: {
        kind: "DOMAIN_DEPLOYMENT" as const,
        domainHash: normalizedDomainHash,
        networkId: finding.destinationNetworkId,
        registryId: finding.destinationRegistryId,
      },
      signal: {
        kind: finding.kind,
        evidence: { findingId: finding.id, runId: normalizedRunId, auditHash: finding.auditHash },
      },
      observedAt: finding.createdAt,
    }];
  });
}
