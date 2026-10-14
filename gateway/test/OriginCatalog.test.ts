import test from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import {
  OriginCatalogError,
  OriginCatalogService,
  catalogDomainHash,
  verifyOriginAuditChain,
  type ActivateOriginInput,
} from "../src/multichain/OriginCatalog.js";

const EVM_REGISTRY = `0x${"0".repeat(24)}${"1".repeat(40)}` as Hex;
const SOLANA_REGISTRY = `0x${"2".repeat(64)}` as Hex;

function activation(overrides: Partial<ActivateOriginInput> = {}): ActivateOriginInput {
  return {
    domain: "Example.COM",
    origin: {
      family: "EVM",
      networkId: "evm:8453",
      registryId: EVM_REGISTRY,
    },
    transaction: { family: "EVM", id: `0x${"a".repeat(64)}` },
    globalDomainEpoch: 1n,
    originSequence: 1n,
    finalizedAt: new Date("2026-10-14T12:00:00.000Z"),
    actor: { type: "EVM_OBSERVER" },
    requestId: "activate-example-1",
    ...overrides,
  };
}

function memoryDatabase() {
  const records = new Map<string, any>();
  const audits: any[] = [];
  const outbox: any[] = [];

  const originRecord = {
    findUnique: async ({ where }: any) => records.get(where.domainHash) ?? null,
    create: async ({ data }: any) => {
      if (records.has(data.domainHash)) throw Object.assign(new Error("unique"), { code: "P2002" });
      const now = new Date();
      const row = { ...data, lastReconciledAt: data.lastReconciledAt ?? null, createdAt: now, updatedAt: now };
      records.set(row.domainHash, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = [...records.values()].find((candidate) => candidate.id === where.id);
      if (!row) throw new Error("record not found");
      const updated = { ...row, ...data, updatedAt: new Date() };
      records.set(updated.domainHash, updated);
      return updated;
    },
  };

  const originAuditEvent = {
    create: async ({ data }: any) => {
      if (audits.some((event) => event.domainHash === data.domainHash && event.requestId === data.requestId)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const { outboxEvent, ...eventData } = data;
      const event = {
        ordinal: BigInt(audits.length + 1),
        previousState: null,
        actorIdHash: null,
        previousEventHash: null,
        ...eventData,
      };
      audits.push(event);
      outbox.push({ auditEventId: event.id, status: "PENDING", ...outboxEvent.create });
      return event;
    },
    findMany: async ({ where, take }: any) => audits
      .filter((event) => event.domainHash === where.domainHash)
      .slice(0, take),
  };

  const database = {
    originRecord,
    originAuditEvent,
    $transaction: async (operation: (tx: any) => Promise<any>) => operation({ originRecord, originAuditEvent }),
  };
  return { database, records, audits, outbox };
}

test("ativa uma única origem e torna retry exato idempotente", async () => {
  const memory = memoryDatabase();
  const catalog = new OriginCatalogService(memory.database as any);

  const first = await catalog.activate(activation());
  const retry = await catalog.activate(activation({ requestId: "retry-com-outro-request-id" }));

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(first.record.id, retry.record.id);
  assert.equal(first.record.domain, "example.com");
  assert.equal(first.record.domainHash, catalogDomainHash("example.com"));
  assert.equal(memory.records.size, 1);
  assert.equal(memory.audits.length, 1);
  assert.equal(memory.outbox.length, 1);
  assert.equal(memory.audits[0].action, "ORIGIN_ACTIVATED");
  assert.equal(memory.outbox[0].auditEventId, memory.audits[0].id);
});

test("corrida EVM/Solana deixa exatamente um vencedor pelo domainHash", async () => {
  const memory = memoryDatabase();
  const catalog = new OriginCatalogService(memory.database as any);
  const evm = activation();
  const solana = activation({
    origin: {
      family: "SOLANA",
      networkId: "solana:11111111111111111111111111111111",
      registryId: SOLANA_REGISTRY,
    },
    transaction: { family: "SOLANA", id: "5HueCGU8rMjxEXxiPuD5BDuRa1R21ZiAWZiGkBr6Z" },
    actor: { type: "SOLANA_OBSERVER" },
    requestId: "activate-example-solana",
  });

  const results = await Promise.allSettled([catalog.activate(evm), catalog.activate(solana)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof OriginCatalogError);
  assert.equal(rejected.reason.code, "ORIGIN_ALREADY_ACTIVE");
  assert.equal(memory.records.size, 1);
  assert.equal(memory.audits.length, 1);
  assert.equal(memory.outbox.length, 1);
});

test("reconciliação é crescente e encadeia o histórico append-only", async () => {
  const memory = memoryDatabase();
  const catalog = new OriginCatalogService(memory.database as any);
  const activated = await catalog.activate(activation());
  const domainHash = activated.record.domainHash as Hex;
  const reconcileInput = {
    domainHash,
    origin: activation().origin,
    transaction: { family: "EVM" as const, id: `0x${"b".repeat(64)}` },
    globalDomainEpoch: 1n,
    originSequence: 2n,
    finalizedAt: new Date("2026-10-14T12:05:00.000Z"),
    actor: { type: "EVM_OBSERVER" },
    requestId: "reconcile-example-2",
  };

  const reconciled = await catalog.reconcile(reconcileInput);
  const retry = await catalog.reconcile({ ...reconcileInput, requestId: "retry-reconcile-example-2" });

  assert.equal(reconciled.changed, true);
  assert.equal(retry.changed, false);
  assert.equal(memory.audits.length, 2);
  assert.equal(memory.outbox.length, 2);
  assert.equal(memory.audits[1].action, "ORIGIN_RECONCILED");
  assert.equal(memory.audits[1].previousEventHash, memory.audits[0].eventHash);
  assert.equal(reconciled.record.lastAuditHash, memory.audits[1].eventHash);
  assert.deepEqual(verifyOriginAuditChain(memory.audits), {
    valid: true,
    lastEventHash: memory.audits[1].eventHash,
  });
  const tampered = memory.audits.map((event) => ({ ...event }));
  tampered[0].nextState = { ...tampered[0].nextState, originSequence: "99" };
  assert.deepEqual(verifyOriginAuditChain(tampered), {
    valid: false,
    eventId: tampered[0].id,
    reason: "INVALID_HASH",
  });
  await assert.rejects(
    catalog.reconcile({ ...reconcileInput, originSequence: 1n, requestId: "regression" }),
    (error: unknown) => error instanceof OriginCatalogError && error.code === "ORIGIN_VERSION_REGRESSION",
  );
  await assert.rejects(
    catalog.reconcile({
      ...reconcileInput,
      transaction: { family: "EVM", id: `0x${"c".repeat(64)}` },
      requestId: "same-version-other-transaction",
    }),
    (error: unknown) => error instanceof OriginCatalogError && error.code === "ORIGIN_REFERENCE_MISMATCH",
  );
});

test("rejeita domainHash que não corresponde ao domínio canônico", async () => {
  const catalog = new OriginCatalogService(memoryDatabase().database as any);
  await assert.rejects(
    catalog.activate(activation({ domainHash: `0x${"f".repeat(64)}` as Hex })),
    (error: unknown) => error instanceof OriginCatalogError && error.code === "INVALID_ORIGIN_INPUT",
  );
});
