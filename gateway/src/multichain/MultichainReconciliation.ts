import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { keccak256, stringToHex, type Hex } from "viem";
import type { CanonicalDomainState } from "./FinalizedStateReader.js";
import { hashMirrorStateV2 } from "./MirrorPayloadCodec.js";
import type { RelayNetworkFamily } from "./MultichainRelayJob.js";

export type ReconciliationFindingKind =
  | "IN_SYNC"
  | "MISSING_MIRROR"
  | "VERSION_BEHIND"
  | "VERSION_AHEAD"
  | "STATE_DRIFT"
  | "ORIGIN_CONFLICT"
  | "UNREADABLE";
export type ReconciliationRepairAction =
  | "NONE" | "REGISTER" | "SYNC" | "REVOKE" | "RETRY_READ" | "MANUAL_REVIEW";

export interface ReconciliationDeployment {
  family: RelayNetworkFamily;
  networkId: string;
  registryId: Hex;
}

export interface ReconciliationTarget extends ReconciliationDeployment {
  state?: CanonicalDomainState | null;
  readError?: string;
}

export interface ReconciliationInput {
  requestId: string;
  origin: ReconciliationDeployment;
  originState: CanonicalDomainState;
  targets: readonly ReconciliationTarget[];
  startedAt: Date;
  completedAt?: Date;
}

export interface ReconciliationFindingRow {
  id: string;
  runId: string;
  destinationNetworkFamily: RelayNetworkFamily;
  destinationNetworkId: string;
  destinationRegistryId: string;
  kind: ReconciliationFindingKind;
  repairAction: ReconciliationRepairAction;
  mirrorStateHash: string | null;
  mirrorGlobalDomainEpoch: bigint | null;
  mirrorOriginSequence: bigint | null;
  details: Record<string, unknown>;
  repair: Record<string, unknown>;
  auditHash: string;
  createdAt: Date;
}

export interface ReconciliationRunRow {
  id: string;
  requestId: string;
  requestHash: string;
  domainHash: string;
  originNetworkFamily: RelayNetworkFamily;
  originNetworkId: string;
  originRegistryId: string;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  originStateHash: string;
  status: "CLEAN" | "DRIFTED";
  previousAuditHash: string | null;
  auditHash: string;
  startedAt: Date;
  completedAt: Date;
  createdAt: Date;
}

export interface ReconciliationRepository {
  transaction<T>(operation: (repository: ReconciliationRepository) => Promise<T>): Promise<T>;
  findRunByRequestId(requestId: string): Promise<ReconciliationRunRow | null>;
  listFindings(runId: string): Promise<ReconciliationFindingRow[]>;
  lastRun(domainHash: string): Promise<ReconciliationRunRow | null>;
  createRun(run: ReconciliationRunRow, findings: readonly ReconciliationFindingRow[]): Promise<void>;
}

type PrismaLike = Record<string, any> & {
  $transaction<T>(operation: (tx: Record<string, any>) => Promise<T>): Promise<T>;
};

export class PrismaReconciliationRepository implements ReconciliationRepository {
  constructor(private readonly client: PrismaClient | PrismaLike) {}
  async transaction<T>(operation: (repository: ReconciliationRepository) => Promise<T>): Promise<T> {
    return (this.client as PrismaLike).$transaction((tx) => operation(new PrismaReconciliationRepository(tx as PrismaLike)));
  }
  async findRunByRequestId(requestId: string): Promise<ReconciliationRunRow | null> {
    return (this.client as any).multichainReconciliationRun.findUnique({ where: { requestId } });
  }
  async listFindings(runId: string): Promise<ReconciliationFindingRow[]> {
    return (this.client as any).multichainReconciliationFinding.findMany({
      where: { runId }, orderBy: [{ destinationNetworkId: "asc" }, { destinationRegistryId: "asc" }],
    });
  }
  async lastRun(domainHash: string): Promise<ReconciliationRunRow | null> {
    return (this.client as any).multichainReconciliationRun.findFirst({
      where: { domainHash }, orderBy: { completedAt: "desc" },
    });
  }
  async createRun(run: ReconciliationRunRow, findings: readonly ReconciliationFindingRow[]): Promise<void> {
    await (this.client as any).multichainReconciliationRun.create({
      data: {
        ...run,
        findings: { create: findings.map(({ runId: _runId, ...finding }) => finding) },
      },
    });
  }
}

export class ReconciliationError extends Error {
  constructor(readonly code: "INVALID_RECONCILIATION" | "RECONCILIATION_CONFLICT", message: string) {
    super(message);
    this.name = "ReconciliationError";
  }
}

function fail(code: ReconciliationError["code"], message: string): never {
  throw new ReconciliationError(code, message);
}

function cleanText(name: string, value: string, max = 1_000): string {
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!normalized || normalized.length > max) fail("INVALID_RECONCILIATION", `${name} inválido`);
  return normalized;
}

function validDate(name: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail("INVALID_RECONCILIATION", `${name} inválido`);
  return value;
}

function deploymentKey(value: ReconciliationDeployment): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value.registryId)) {
    fail("INVALID_RECONCILIATION", "registryId inválido");
  }
  const networkId = cleanText("networkId", value.networkId, 256);
  if (!networkId.startsWith(value.family === "EVM" ? "evm:" : "solana:")) {
    fail("INVALID_RECONCILIATION", "family e networkId divergem");
  }
  return `${networkId}:${value.registryId.toLowerCase()}`;
}

function compareVersion(origin: CanonicalDomainState, mirror: CanonicalDomainState): number {
  if (mirror.globalDomainEpoch !== origin.globalDomainEpoch) {
    return mirror.globalDomainEpoch > origin.globalDomainEpoch ? 1 : -1;
  }
  if (mirror.originSequence !== origin.originSequence) return mirror.originSequence > origin.originSequence ? 1 : -1;
  return 0;
}

function stableHash(value: unknown): Hex {
  return keccak256(stringToHex(JSON.stringify(value)));
}

interface ClassifiedFinding {
  kind: ReconciliationFindingKind;
  repairAction: ReconciliationRepairAction;
  mirrorStateHash: Hex | null;
  details: Record<string, unknown>;
  repair: Record<string, unknown>;
}

function classify(origin: CanonicalDomainState, target: ReconciliationTarget): ClassifiedFinding {
  if (target.readError) {
    return {
      kind: "UNREADABLE", repairAction: "RETRY_READ", mirrorStateHash: null,
      details: { error: cleanText("readError", target.readError) },
      repair: { action: "RETRY_READ", reason: "destination state was not readable" },
    };
  }
  if (!target.state) {
    const repairAction = origin.status === "REVOKED" ? "MANUAL_REVIEW" : "REGISTER";
    return {
      kind: "MISSING_MIRROR", repairAction, mirrorStateHash: null,
      details: { expectedEpoch: origin.globalDomainEpoch.toString(), expectedSequence: origin.originSequence.toString() },
      repair: { action: repairAction, reason: origin.status === "REVOKED" ? "cannot register an already revoked projection" : "mirror is absent" },
    };
  }
  const mirror = target.state;
  const mirrorStateHash = hashMirrorStateV2(mirror);
  if (mirror.recordKind !== "MIRROR" || mirror.domainHash.toLowerCase() !== origin.domainHash.toLowerCase()
    || mirror.originNetworkHash.toLowerCase() !== origin.originNetworkHash.toLowerCase()
    || mirror.originRegistry.toLowerCase() !== origin.originRegistry.toLowerCase()) {
    return {
      kind: "ORIGIN_CONFLICT", repairAction: "MANUAL_REVIEW", mirrorStateHash,
      details: {
        recordKind: mirror.recordKind,
        mirrorOriginNetworkHash: mirror.originNetworkHash,
        mirrorOriginRegistry: mirror.originRegistry,
      },
      repair: { action: "MANUAL_REVIEW", reason: "immutable origin or record kind differs" },
    };
  }
  const ordering = compareVersion(origin, mirror);
  if (ordering < 0) {
    const repairAction = origin.status === "REVOKED" ? "REVOKE" : "SYNC";
    return {
      kind: "VERSION_BEHIND", repairAction, mirrorStateHash,
      details: {
        expectedEpoch: origin.globalDomainEpoch.toString(), expectedSequence: origin.originSequence.toString(),
        actualEpoch: mirror.globalDomainEpoch.toString(), actualSequence: mirror.originSequence.toString(),
      },
      repair: { action: repairAction, targetEpoch: origin.globalDomainEpoch.toString(), targetSequence: origin.originSequence.toString() },
    };
  }
  if (ordering > 0) {
    return {
      kind: "VERSION_AHEAD", repairAction: "MANUAL_REVIEW", mirrorStateHash,
      details: {
        expectedEpoch: origin.globalDomainEpoch.toString(), expectedSequence: origin.originSequence.toString(),
        actualEpoch: mirror.globalDomainEpoch.toString(), actualSequence: mirror.originSequence.toString(),
      },
      repair: { action: "MANUAL_REVIEW", reason: "destination is ahead of finalized origin" },
    };
  }
  const originStateHash = hashMirrorStateV2(origin);
  const differingFields = [
    ...(originStateHash !== mirrorStateHash ? ["mirrorStatePayload"] : []),
    ...(origin.originTransaction.toLowerCase() !== mirror.originTransaction.toLowerCase() ? ["originTransaction"] : []),
  ];
  if (differingFields.length > 0) {
    return {
      kind: "STATE_DRIFT", repairAction: "MANUAL_REVIEW", mirrorStateHash,
      details: { differingFields, expectedStateHash: originStateHash, actualStateHash: mirrorStateHash },
      repair: { action: "MANUAL_REVIEW", reason: "same version has different committed state" },
    };
  }
  return {
    kind: "IN_SYNC", repairAction: "NONE", mirrorStateHash,
    details: { epoch: origin.globalDomainEpoch.toString(), sequence: origin.originSequence.toString() },
    repair: { action: "NONE" },
  };
}

export class MultichainReconciliationService {
  constructor(private readonly repository: ReconciliationRepository) {}

  async reconcile(input: ReconciliationInput): Promise<{
    run: ReconciliationRunRow;
    findings: ReconciliationFindingRow[];
    created: boolean;
  }> {
    const requestId = cleanText("requestId", input.requestId, 128);
    if (input.originState.recordKind !== "ORIGIN") fail("INVALID_RECONCILIATION", "fonte deve ser ORIGIN");
    const originKey = deploymentKey(input.origin);
    if (input.targets.length === 0) fail("INVALID_RECONCILIATION", "reconciliação exige destinos");
    const sortedTargets = [...input.targets].sort((a, b) => deploymentKey(a).localeCompare(deploymentKey(b)));
    const keys = sortedTargets.map(deploymentKey);
    if (new Set(keys).size !== keys.length || keys.includes(originKey)) {
      fail("INVALID_RECONCILIATION", "destinos duplicados ou iguais à origem");
    }
    const startedAt = validDate("startedAt", input.startedAt);
    const completedAt = input.completedAt ? validDate("completedAt", input.completedAt) : new Date();
    if (completedAt < startedAt) fail("INVALID_RECONCILIATION", "completedAt anterior a startedAt");
    const originStateHash = hashMirrorStateV2(input.originState);
    const classified = sortedTargets.map((target) => ({ target, classified: classify(input.originState, target) }));
    const requestHash = stableHash({
      version: 1, requestId, originKey, domainHash: input.originState.domainHash,
      epoch: input.originState.globalDomainEpoch.toString(), sequence: input.originState.originSequence.toString(),
      originStateHash,
      targets: classified.map(({ target, classified: finding }) => ({
        key: deploymentKey(target), kind: finding.kind, stateHash: finding.mirrorStateHash,
        epoch: target.state?.globalDomainEpoch.toString() ?? null,
        sequence: target.state?.originSequence.toString() ?? null,
      })),
    });
    return this.repository.transaction(async (repository) => {
      const existing = await repository.findRunByRequestId(requestId);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          fail("RECONCILIATION_CONFLICT", "requestId já usado com outro snapshot");
        }
        return { run: existing, findings: await repository.listFindings(existing.id), created: false };
      }
      const previous = await repository.lastRun(input.originState.domainHash);
      const runId = randomUUID();
      const createdAt = completedAt;
      const findings: ReconciliationFindingRow[] = classified.map(({ target, classified: finding }) => {
        const base = {
          runId,
          destinationNetworkFamily: target.family,
          destinationNetworkId: target.networkId,
          destinationRegistryId: target.registryId.toLowerCase(),
          kind: finding.kind,
          repairAction: finding.repairAction,
          mirrorStateHash: finding.mirrorStateHash,
          mirrorGlobalDomainEpoch: target.state?.globalDomainEpoch ?? null,
          mirrorOriginSequence: target.state?.originSequence ?? null,
          details: finding.details,
          repair: finding.repair,
          createdAt,
        };
        return {
          id: randomUUID(),
          ...base,
          auditHash: stableHash({
            version: 1,
            ...base,
            mirrorGlobalDomainEpoch: base.mirrorGlobalDomainEpoch?.toString() ?? null,
            mirrorOriginSequence: base.mirrorOriginSequence?.toString() ?? null,
            createdAt: base.createdAt.toISOString(),
          }),
        };
      });
      const status = findings.every((finding) => finding.kind === "IN_SYNC") ? "CLEAN" : "DRIFTED";
      const runBase = {
        requestId,
        requestHash,
        domainHash: input.originState.domainHash.toLowerCase(),
        originNetworkFamily: input.origin.family,
        originNetworkId: input.origin.networkId,
        originRegistryId: input.origin.registryId.toLowerCase(),
        globalDomainEpoch: input.originState.globalDomainEpoch,
        originSequence: input.originState.originSequence,
        originStateHash,
        status: status as "CLEAN" | "DRIFTED",
        previousAuditHash: previous?.auditHash ?? null,
        startedAt,
        completedAt,
        createdAt,
      };
      const run: ReconciliationRunRow = {
        id: runId,
        ...runBase,
        auditHash: stableHash({
          version: 1,
          ...runBase,
          globalDomainEpoch: runBase.globalDomainEpoch.toString(),
          originSequence: runBase.originSequence.toString(),
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          createdAt: createdAt.toISOString(),
          findingHashes: findings.map((finding) => finding.auditHash),
        }),
      };
      await repository.createRun(run, findings);
      return { run, findings, created: true };
    });
  }
}
