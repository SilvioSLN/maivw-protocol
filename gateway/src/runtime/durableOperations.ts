import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export type OperationKind = "MAIL" | "DISPUTE";
export interface OperationResult { statusCode: number; body: Record<string, any>; localViolation?: { domain: string; subIdentity: string }; }
export interface OperationContext {
  id: string;
  payload: Record<string, any>;
  authority: Record<string, any>;
  beforeEffect(): Promise<void>;
  checkpoint(value: Record<string, any>): Promise<void>;
}
export type OperationHandler = (context: OperationContext) => Promise<OperationResult>;
export class OperationStateError extends Error { constructor(readonly code: string) { super(code); } }
const canonical = (value: any): string => value === null || typeof value !== "object" ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;

/** Durable authority/payload are loaded from PostgreSQL, never from untrusted queue fields. */
export class DurableOperations {
  constructor(private readonly db: PrismaClient) {}
  async prepare(kind: OperationKind, key: string, payload: Record<string, any>, authority: Record<string, any>) {
    if (!key || key.length > 512) throw new OperationStateError("INVALID_OPERATION_KEY");
    const inputHash = createHash("sha256").update(canonical({ kind, payload, authority })).digest("hex");
    const operationKey = createHash("sha256").update(`${kind}:${key}`).digest("hex");
    const row = await this.db.runtimeOperation.upsert({ where: { operationKey }, create: {
      id: randomUUID(), operationKey, kind, inputHash, payload, authority,
    }, update: {} });
    if (row.inputHash !== inputHash || row.kind !== kind) throw new OperationStateError("IDEMPOTENCY_CONFLICT");
    return row.id;
  }
  private async finish(id: string, expected: string[], outcome: OperationResult, ownerToken?: string) {
    const uncertain = outcome.body.deliveryState === "accepted_unrecorded" || outcome.body.deliveryState === "uncertain";
    const status = uncertain ? "UNCERTAIN" : outcome.statusCode >= 200 && outcome.statusCode < 300 ? "CONFIRMED" : "REJECTED";
    await this.db.$transaction(async tx => {
      const changed = await tx.runtimeOperation.updateMany({ where: { id, status: { in: expected }, ...(ownerToken ? { ownerToken } : {}) }, data: { status, result: outcome as any, ownerToken: null } });
      if (changed.count !== 1) throw new OperationStateError("OPERATION_BUSY_OR_INTERRUPTED");
      if (status === "CONFIRMED" && outcome.localViolation) {
        const where = { domain_subIdentityId: { domain: outcome.localViolation.domain.toLowerCase(), subIdentityId: outcome.localViolation.subIdentity } };
        const row = await tx.reputation.upsert({ where,
          create: { ...where.domain_subIdentityId, strikes: 1, reputationScore: 70, lastViolation: new Date() },
          update: { strikes: { increment: 1 }, reputationScore: { decrement: 30 }, lastViolation: new Date() },
        });
        await tx.reputation.update({ where, data: { isBlocked: row.strikes >= 3, reputationScore: Math.max(0, row.reputationScore) } });
      }
    });
  }
  async execute(id: string, kind: OperationKind, handler: OperationHandler,
    recover?: (checkpoint: Record<string, any>) => Promise<OperationResult>): Promise<OperationResult> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new OperationStateError("INVALID_OPERATION_ID");
    let row = await this.db.runtimeOperation.findUnique({ where: { id } });
    if (!row || row.kind !== kind) throw new OperationStateError("OPERATION_NOT_FOUND");
    if (["CONFIRMED", "REJECTED"].includes(row.status)) return row.result as unknown as OperationResult;
    if (row.status !== "PREPARED") {
      const checkpoint = row.checkpoint as Record<string, any> | null;
      if (recover && checkpoint?.txHash && ["EXECUTING", "UNCERTAIN"].includes(row.status)) {
        const outcome = await recover(checkpoint);
        await this.finish(id, ["EXECUTING", "UNCERTAIN"], outcome);
        return outcome;
      }
      throw new OperationStateError(row.status === "UNCERTAIN" ? "RECONCILIATION_REQUIRED" : "OPERATION_BUSY_OR_INTERRUPTED");
    }
    const ownerToken = randomUUID();
    if (!(await this.db.runtimeOperation.updateMany({ where: { id, status: "PREPARED" }, data: { status: "EXECUTING", ownerToken } })).count) {
      throw new OperationStateError("OPERATION_BUSY_OR_INTERRUPTED");
    }
    let effectStarted = false;
    const context: OperationContext = {
      id, payload: row.payload as Record<string, any>, authority: row.authority as Record<string, any>,
      beforeEffect: async () => {
        if (effectStarted) return;
        await this.db.runtimeOperation.update({ where: { id }, data: { checkpoint: { stage: "EXTERNAL_EFFECT_MAY_START" } } });
        effectStarted = true;
      },
      checkpoint: async value => { await this.db.runtimeOperation.update({ where: { id }, data: { checkpoint: value } }); },
    };
    try {
      const outcome = await handler(context);
      if (effectStarted && outcome.statusCode >= 500) outcome.body.deliveryState = "uncertain";
      await this.finish(id, ["EXECUTING"], outcome, ownerToken);
      return outcome;
    } catch {
      // No automatic replay after an ambiguous effect or interrupted execution.
      await this.db.runtimeOperation.updateMany({ where: { id, status: "EXECUTING", ownerToken }, data: {
        status: effectStarted ? "UNCERTAIN" : "PREPARED", ownerToken: null,
      } });
      throw new OperationStateError(effectStarted ? "RECONCILIATION_REQUIRED" : "SAFE_RETRY_REQUIRED");
    }
  }
}
