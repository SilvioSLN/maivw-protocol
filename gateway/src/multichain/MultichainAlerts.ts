import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { MultichainTelemetry } from "./MultichainTelemetry.js";

export type MultichainAlertCode = "ORIGIN_CONFLICT" | "INDEXER_LAG" | "REORG_PENDING" | "LOW_BALANCE" | "RELAYER_PAUSED" | "KMS_FAILURE" | "STATE_DRIFT";
export interface MultichainOperationalSignal {
  code: MultichainAlertCode;
  scope: string;
  value: number;
  threshold: number;
  details?: Record<string, string | number | boolean | null>;
}

const RULES: Record<MultichainAlertCode, { severity: "warning" | "critical"; summary: string; anchor: string }> = {
  ORIGIN_CONFLICT: { severity: "critical", summary: "Referências de origem conflitantes", anchor: "origin-conflict" },
  INDEXER_LAG: { severity: "warning", summary: "Indexador Solana acima do limite de lag", anchor: "indexer-lag" },
  REORG_PENDING: { severity: "critical", summary: "Reorg exige compensação operacional", anchor: "reorg" },
  LOW_BALANCE: { severity: "warning", summary: "Saldo do relayer insuficiente", anchor: "low-balance" },
  RELAYER_PAUSED: { severity: "critical", summary: "Relayer pausado por circuit breaker", anchor: "relayer-paused" },
  KMS_FAILURE: { severity: "critical", summary: "Falha ao assinar com KMS", anchor: "kms-failure" },
  STATE_DRIFT: { severity: "critical", summary: "Estado de mirror diverge da origem", anchor: "state-drift" },
};

export class MultichainAlertService {
  evaluate(signals: readonly MultichainOperationalSignal[]) {
    return signals.filter((signal) => signal.value >= signal.threshold).map((signal) => {
      const rule = RULES[signal.code];
      const fingerprint = createHash("sha256").update(`${signal.code}:${signal.scope}`).digest("hex").slice(0, 24);
      return {
        id: `${signal.code.toLowerCase()}:${fingerprint}`,
        code: signal.code,
        severity: rule.severity,
        status: "FIRING" as const,
        summary: rule.summary,
        scope: signal.scope,
        value: signal.value,
        threshold: signal.threshold,
        details: signal.details ?? {},
        runbook: `specs/multichain/RUNBOOK_MULTICHAIN_ALERTS_V1.md#${rule.anchor}`,
      };
    }).sort((left, right) => left.code.localeCompare(right.code) || left.scope.localeCompare(right.scope));
  }
}

type PrismaLike = PrismaClient | Record<string, any>;

export class MultichainAlertCollector {
  constructor(
    private readonly prisma: PrismaLike,
    private readonly telemetry: MultichainTelemetry,
    private readonly indexerLagThresholdSlots = 128,
  ) {}

  async collect(): Promise<MultichainOperationalSignal[]> {
    const [breakers, cursors, pendingCompensations] = await Promise.all([
      (this.prisma as any).multichainRelayCircuitBreaker.findMany({ where: { status: "OPEN" } }),
      (this.prisma as any).solanaObserverCursor.findMany(),
      (this.prisma as any).multichainRelayCompensation.count({ where: { status: "PENDING" } }),
    ]);
    const signals: MultichainOperationalSignal[] = [];
    for (const cursor of cursors) {
      const lag = cursor.observedSlot !== null && cursor.lastSlot !== null ? cursor.observedSlot - cursor.lastSlot : 0n;
      signals.push({
        code: "INDEXER_LAG", scope: cursor.networkId, value: Number(lag > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : lag),
        threshold: this.indexerLagThresholdSlots, details: { observedSlot: cursor.observedSlot?.toString() ?? null, indexedSlot: cursor.lastSlot?.toString() ?? null },
      });
    }
    if (pendingCompensations > 0) signals.push({ code: "REORG_PENDING", scope: "global", value: pendingCompensations, threshold: 1 });
    for (const breaker of breakers) {
      const scope = breaker.scopeKey;
      signals.push({ code: "RELAYER_PAUSED", scope, value: 1, threshold: 1, details: { trigger: breaker.triggerSignal } });
      if (breaker.triggerSignal === "ORIGIN_CONFLICT") signals.push({ code: "ORIGIN_CONFLICT", scope, value: 1, threshold: 1 });
      if (breaker.triggerSignal === "STATE_DRIFT") signals.push({ code: "STATE_DRIFT", scope, value: 1, threshold: 1 });
      if (breaker.triggerSignal === "LOW_BALANCE") signals.push({ code: "LOW_BALANCE", scope, value: 1, threshold: 1 });
    }
    const kmsFailures = this.telemetry.snapshot().counters
      .filter((counter) => counter.metric.includes("event=kms.failed"))
      .reduce((sum, counter) => sum + counter.value, 0);
    if (kmsFailures > 0) signals.push({ code: "KMS_FAILURE", scope: "oracle-signer", value: kmsFailures, threshold: 1 });
    return signals;
  }
}
