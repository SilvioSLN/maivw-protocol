import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { MailDispatchService, type MailDispatchInput, type MailDispatchResult } from "../services/MailDispatchService.js";
import { DisputeExecutionService, type DisputeExecutionOptions } from "../services/DisputeExecutionService.js";
import { DurableOperations, OperationStateError, type OperationResult } from "./durableOperations.js";
import { DisputeRequestSchema } from "../schemas/payload.js";

export type MailAuthority = { kind: "mailbox"; userId: number; email: string } | { kind: "api-key"; domainId: number; apiKeyId: number };
export class MailOperations {
  constructor(private db: PrismaClient, private operations: DurableOperations, private dispatch: MailDispatchService) {}
  private async sender(authority: MailAuthority) {
    if (authority.kind === "mailbox") {
      const user = await this.db.user.findUnique({ where: { id: authority.userId } });
      if (!user || user.role !== "user" || user.email.toLowerCase() !== authority.email.toLowerCase()) throw new OperationStateError("SENDER_NOT_AUTHORIZED");
      const domain = authority.email.split("@")[1]?.toLowerCase();
      const mailbox = await this.db.emailAccount.findFirst({ where: { userId: user.id, localPart: authority.email.split("@")[0].toLowerCase(), isActive: true, domain: { domainName: domain, isVerified: true } } });
      if (!mailbox || !domain) throw new OperationStateError("SENDER_NOT_AUTHORIZED");
      return { domain, mailboxEmail: authority.email.toLowerCase() };
    }
    if (authority.kind !== "api-key" || !Number.isSafeInteger(authority.apiKeyId)) throw new OperationStateError("SENDER_NOT_AUTHORIZED");
    const key = await this.db.apiKey.findUnique({ where: { id: authority.apiKeyId }, include: { domain: true } });
    if (!key || key.domainId !== authority.domainId || !key.domain.isVerified) throw new OperationStateError("SENDER_NOT_AUTHORIZED");
    return { domain: key.domain.domainName.toLowerCase() };
  }
  async send(input: MailDispatchInput, authority: MailAuthority, idempotencyKey?: string): Promise<MailDispatchResult> {
    // Resolve again, so a credential revoked between HTTP authentication and execution cannot send.
    await this.sender(authority);
    const scope = authority.kind === "mailbox" ? `mailbox:${authority.userId}` : `api-key:${authority.apiKeyId}`;
    const id = await this.operations.prepare("MAIL", `${scope}:${idempotencyKey || randomUUID()}`, input.payload, authority);
    return this.run(id);
  }
  async run(id: string): Promise<OperationResult> {
    return this.operations.execute(id, "MAIL", async context => {
      const sender = await this.sender(context.authority as MailAuthority);
      return this.dispatch.execute({ payload: context.payload, sender, messageId: context.id, beforeTransport: context.beforeEffect });
    });
  }
}

export class DisputeOperations {
  private service: DisputeExecutionService;
  constructor(private db: PrismaClient, private operations: DurableOperations, private options: DisputeExecutionOptions) {
    this.service = new DisputeExecutionService(options);
  }
  async submit(input: unknown): Promise<OperationResult> {
    const parsed = DisputeRequestSchema.safeParse(input);
    if (!parsed.success) return { statusCode: 400, body: { error: "Invalid dispute payload" } };
    // Alias routes/reporter changes cannot produce a second punishment for the same signed evidence.
    const evidence = createHash("sha256").update(`${parsed.data.senderDomain.toLowerCase()}:${parsed.data.payload.signature.toLowerCase()}`).digest("hex");
    const id = await this.operations.prepare("DISPUTE", evidence, parsed.data, { source: "protocol-report" });
    return this.run(id);
  }
  async run(id: string): Promise<OperationResult> {
    return this.operations.execute(id, "DISPUTE", context => this.service.execute(context.payload, context), async checkpoint => {
      if (!/^0x[a-fA-F0-9]{64}$/.test(checkpoint.txHash) || !checkpoint.outcome) throw new OperationStateError("RECONCILIATION_REQUIRED");
      const receipt = await this.options.ledger.getClient().waitForTransactionReceipt({ hash: checkpoint.txHash, confirmations: 2, timeout: 60000 });
      if (receipt.status !== "success") return { statusCode: 422, body: { error: "On-chain action reverted", txHash: checkpoint.txHash } };
      return checkpoint.outcome as OperationResult;
    });
  }
}

export function operationReference(data: unknown): string {
  if (!data || typeof data !== "object" || (data as any).version !== 1 || typeof (data as any).operationId !== "string" || !/^[a-f0-9-]{36}$/i.test((data as any).operationId)
    || Object.keys(data).some(key => !["version", "operationId"].includes(key))) throw new OperationStateError("INVALID_DURABLE_JOB_REFERENCE");
  return (data as any).operationId;
}
export async function requireConfirmed(outcome: OperationResult) {
  if (outcome.statusCode < 200 || outcome.statusCode >= 300 || ["uncertain", "accepted_unrecorded"].includes(outcome.body.deliveryState)) throw new OperationStateError("OPERATION_NOT_CONFIRMED");
  // Keep queue results metadata-only; PostgreSQL owns full outcome/payload.
  return { status: "CONFIRMED", receipt: outcome.body.txHash || outcome.body.transportMessageId || outcome.body.messageId || null };
}
