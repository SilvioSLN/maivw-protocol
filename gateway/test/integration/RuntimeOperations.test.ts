import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { DurableOperations } from "../../src/runtime/durableOperations.js";
import { MailOperations, DisputeOperations, operationReference, requireConfirmed } from "../../src/runtime/operationHandlers.js";
import { enqueuePreparedOperations } from "../../src/runtime/operationOutbox.js";
import { MailDispatchService } from "../../src/services/MailDispatchService.js";
import { SignatureService } from "../../src/services/SignatureService.js";
import { generatePrivateKey } from "viem/accounts";
import { BullMQJobQueue } from "../../src/queue/BullMQJobQueue.js";
const db = new PrismaClient(), ops = new DurableOperations(db), app = Fastify();
test.after(async () => { await db.$disconnect(); await app.close(); });
async function waitFor(fn: () => Promise<boolean>) {
  const start = Date.now(); while (!await fn()) { if (Date.now() - start > 8000) throw new Error("Test wait timed out"); await new Promise(r => setTimeout(r, 40)); }
}
test("PostgreSQL CAS/idempotency survive concurrent and restarted executors", async () => {
  const id = await ops.prepare("MAIL", randomUUID(), { test: "synthetic" }, { tenant: "one" }); let effects = 0;
  const run = () => new DurableOperations(db).execute(id, "MAIL", async ctx => { await ctx.beforeEffect(); effects++; await new Promise(r => setTimeout(r, 80)); return { statusCode: 200, body: { messageId: id } }; });
  assert.equal((await Promise.allSettled([run(), run()])).filter(r => r.status === "fulfilled").length, 1);
  await run(); assert.equal(effects, 1);
  const key = randomUUID(); await ops.prepare("MAIL", key, { subject: "one" }, { tenant: "one" });
  await assert.rejects(ops.prepare("MAIL", key, { subject: "changed" }, { tenant: "two" }), /IDEMPOTENCY_CONFLICT/);
});
test("safe preflight retries; ambiguous and interrupted effects never auto-replay", async () => {
  const safe = await ops.prepare("MAIL", randomUUID(), {}, {});
  await assert.rejects(ops.execute(safe, "MAIL", async () => { throw new Error("preflight"); }), /SAFE_RETRY_REQUIRED/);
  assert.equal((await db.runtimeOperation.findUniqueOrThrow({ where: { id: safe } })).status, "PREPARED");
  await ops.execute(safe, "MAIL", async () => ({ statusCode: 200, body: {} }));
  const id = await ops.prepare("MAIL", randomUUID(), {}, {}); let effects = 0;
  const run = () => ops.execute(id, "MAIL", async ctx => { await ctx.beforeEffect(); effects++; throw new Error("crash"); });
  await assert.rejects(run(), /RECONCILIATION_REQUIRED/); await assert.rejects(run(), /RECONCILIATION_REQUIRED/); assert.equal(effects, 1);
  const interrupted = await ops.prepare("MAIL", randomUUID(), {}, {});
  await db.runtimeOperation.update({ where: { id: interrupted }, data: { status: "EXECUTING" } });
  await assert.rejects(ops.execute(interrupted, "MAIL", async () => { throw new Error("must not execute"); }), /OPERATION_BUSY_OR_INTERRUPTED/);
});
test("durable mail calls real dispatch, persists receipt and reloads revoked authority", async () => {
  const user = await db.user.create({ data: { email: `${randomUUID()}@tenant.test`, role: "user", passwordHash: "synthetic" } });
  const domain = await db.domain.create({ data: { domainName: `${randomUUID()}.test`, userId: user.id, isVerified: true } });
  const key = await db.apiKey.create({ data: { keyHash: randomUUID(), domainId: domain.id, name: "synthetic" } }); let sends = 0;
  const dispatch = new MailDispatchService({ logger: app.log, senderDomain: "unused", prisma: db, signer: {} as any,
    ledger: { isDomainRegistered: async (d: string) => d === domain.domainName, getAllowedDailyVolume: async () => 0n } as any,
    smtp: { async sendEmail() { sends++; return { success: true, provider: "controlled", messageId: "synthetic-receipt" }; } } as any });
  const mail = new MailOperations(db, ops, dispatch), authority = { kind: "api-key" as const, domainId: domain.id, apiKeyId: key.id };
  const payload = { to: "recipient@example.test", subject: "Synthetic", content: { text: "Synthetic" }, msgClass: "CONVERSATION" };
  const id = await ops.prepare("MAIL", randomUUID(), payload, authority);
  assert.equal((await mail.run(id)).statusCode, 200); await mail.run(id); assert.equal(sends, 1);
  assert.equal((await db.message.findUniqueOrThrow({ where: { messageId: id } })).transportMessageId, "synthetic-receipt");
  const revoked = await ops.prepare("MAIL", randomUUID(), payload, authority); await db.apiKey.delete({ where: { id: key.id } });
  await assert.rejects(mail.run(revoked), /SAFE_RETRY_REQUIRED/); assert.equal(sends, 1);
  assert.throws(() => operationReference({ version: 1, operationId: id, payload: {} }), /INVALID_DURABLE_JOB_REFERENCE/);
});
test("signed oracle evidence recovers receipt after timeout without duplicate punishment or reputation", async () => {
  const signer = new SignatureService(generatePrivateKey()); let warnings = 0;
  const content = { text: "Synthetic evidence" }, envelope = { version: "2.0" as const, messageId: randomUUID(), from: `${randomUUID()}.test`, to: "recipient@example.test", subject: "Synthetic", msgClass: "CONVERSATION", timestamp: Math.floor(Date.now() / 1000), contentHash: SignatureService.computeContentHash(content), attachmentsHash: "" };
  const signature = await signer.signEnvelopeV2(envelope);
  const payload = { senderDomain: envelope.from, reporterAddress: signer.address, payload: { ...envelope, envelopeVersion: "2.0", content, signature } };
  const oracle: any = { judgeSemanticViolationAsync: async () => ({ isSpoofed: true, reason: "Controlled" }), async executeWarning(_d: string, _s: string, broadcast: any) { warnings++; await broadcast(`0x${"ab".repeat(32)}`); throw new Error("receipt timeout"); } };
  const ledger: any = { getPublicKey: async () => signer.address, isProvider: async () => true, getClient: () => ({ waitForTransactionReceipt: async () => ({ status: "success" }) }) };
  const disputes = new DisputeOperations(db, ops, { ledger, oracle, signer, reputation: {} as any, logger: app.log });
  await assert.rejects(disputes.submit(payload), /RECONCILIATION_REQUIRED/);
  const row = await db.runtimeOperation.findFirstOrThrow({ where: { kind: "DISPUTE", status: "UNCERTAIN" } });
  assert.equal((await disputes.run(row.id)).statusCode, 200); await disputes.submit(payload); assert.equal(warnings, 1);
  assert.equal((await db.reputation.findUniqueOrThrow({ where: { domain_subIdentityId: { domain: envelope.from, subIdentityId: "default" } } })).strikes, 1);
  await assert.rejects(disputes.submit({ ...payload, reporterAddress: `0x${"11".repeat(20)}` }), /IDEMPOTENCY_CONFLICT/);
});
test("Redis durable references survive restart; default retry, DLQ and replay execute", async () => {
  const options = { redisUrl: process.env.RET004_REDIS_URL!, defaultRetry: { maxAttempts: 2, backoff: { type: "fixed" as const, delayMs: 50 } } };
  const name = `ret004:mail:${randomUUID()}`; let queue = new BullMQJobQueue(name, options);
  const id = await ops.prepare("MAIL", randomUUID(), {}, {}); await db.runtimeOperation.update({ where: { id }, data: { createdAt: new Date(Date.now() - 120000) } });
  assert.ok(await enqueuePreparedOperations(db, "MAIL", queue) >= 1); await queue.close(); queue = new BullMQJobQueue(name, options);
  queue.process(async job => requireConfirmed(await ops.execute(operationReference(job.data), "MAIL", async ctx => ({ statusCode: 200, body: { messageId: ctx.id } }))));
  try { await waitFor(async () => (await queue.getJob(id))?.status === "completed"); } finally { await queue.close(); }
  const retryName = `ret004:retry:${randomUUID()}`; queue = new BullMQJobQueue(retryName, options); let fail = true, attempts = 0;
  queue.process(async () => { attempts++; if (fail) throw new Error("Controlled"); return { status: "CONFIRMED" }; });
  try {
    const job = await queue.enqueue({ name: "retry", idempotencyKey: "tenant:logical-id", data: { version: 1, operationId: id } });
    await waitFor(async () => await queue.dlq.count() === 1); assert.equal(attempts, 2); fail = false;
    assert.equal(await queue.dlq.retry((await queue.dlq.list())[0].id), true);
    await waitFor(async () => (await queue.getJob(job.id))?.status === "completed"); assert.equal(attempts, 3);
    await queue.pause(); await queue.close(); queue = new BullMQJobQueue(retryName, options); queue.process(async () => ({ status: "CONFIRMED" }));
    const after = await queue.enqueue({ name: "restart", data: {} }); await waitFor(async () => (await queue.getJob(after.id))?.status === "completed");
  } finally { await queue.close(); }
});

test("worker pause stops admission immediately while the explicit drain owns the active job", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; }); let active = false;
  const queue = new BullMQJobQueue(`ret005:drain:${randomUUID()}`, { redisUrl: process.env.RET004_REDIS_URL! });
  queue.process(async () => { active = true; await blocked; return { status: "CONFIRMED" }; }, { concurrency: 1 });
  try {
    const job = await queue.enqueue({ name: "drain", data: {} });
    await waitFor(async () => active);
    let paused = false; const pause = queue.pause().then(() => { paused = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(paused, true, "pause must not wait indefinitely for an external operation");
    await pause; assert.equal((await queue.getMetrics()).active, 1);
    release(); await waitFor(async () => (await queue.getJob(job.id))?.status === "completed");
  } finally { release(); await queue.close(); }
});

test("outbox quarantines exhausted dispatches so they cannot starve newer operations", async () => {
  const id = await ops.prepare("MAIL", randomUUID(), {}, {});
  await db.runtimeOperation.update({ where: { id }, data: { createdAt: new Date(Date.now() - 120000) } });
  const queue = new BullMQJobQueue(`ret004:outbox:${randomUUID()}`, {
    redisUrl: process.env.RET004_REDIS_URL!, defaultRetry: { maxAttempts: 1 },
  });
  queue.process(async () => { throw new Error("Controlled preflight failure"); });
  try {
    await queue.enqueue({ name: "mail", id, data: { version: 1, operationId: id } });
    await waitFor(async () => ["failed", "dead_letter"].includes((await queue.getJob(id))?.status || ""));
    await enqueuePreparedOperations(db, "MAIL", queue);
    assert.equal((await db.runtimeOperation.findUniqueOrThrow({ where: { id } })).queueDispatchExhausted, true);
    assert.equal((await db.runtimeOperation.findUniqueOrThrow({ where: { id } })).status, "PREPARED");
    // Manual DLQ recovery remains possible; the flag gates the automatic sweep only.
    const next = await ops.prepare("MAIL", randomUUID(), {}, {});
    await db.runtimeOperation.update({ where: { id: next }, data: { createdAt: new Date(Date.now() - 120000) } });
    await enqueuePreparedOperations(db, "MAIL", queue);
    assert.ok(await queue.getJob(next));
  } finally { await queue.close(); }
});

test("runtime relay persists broadcast as SUBMITTED and confirms after restart without broadcasting twice", async () => {
  const { createRuntimeRelayWorker } = await import("../../src/runtime/relayWorker.js");
  const { defineEvmNetwork } = await import("../../src/multichain/NetworkModel.js");
  const { PrismaRelayJobRepository, MultichainRelayJobService } = await import("../../src/multichain/MultichainRelayJob.js");
  const { hashNetworkId } = await import("../../src/multichain/AttestationCodec.js");
  const { keccak256, stringToHex } = await import("viem");
  const { EnvSchema } = await import("../../src/config.js");
  const config = EnvSchema.parse({ JWT_SECRET: "x".repeat(32), MASTER_SECRET_KEY: "x".repeat(32), INTERNAL_SERVICE_KEY: "x".repeat(32), ORACLE_PRIVATE_KEY: generatePrivateKey(), MULTICHAIN_RELAY_ENABLED: true });
  const networks = [84532, 80002].map((chainId, i) => defineEvmNetwork({ chainId, name: `Synthetic ${i}`, rpcUrl: "http://127.0.0.1:1", registryAddress: `0x${String(i + 1).repeat(40)}` as any, explorerUrl: "https://example.test", asset: { kind: "NATIVE", symbol: "ETH", decimals: 18, address: null }, finality: { confirmations: 2, reorgMarginBlocks: 2 }, capabilities: { origin: true, mirror: true } }));
  const domain = `${randomUUID()}.test`, domainHash = keccak256(stringToHex(domain));
  const originTx = `0x${"11".repeat(32)}` as const, blockHash = `0x${"22".repeat(32)}` as const;
  const account = new SignatureService(config.ORACLE_PRIVATE_KEY! as any).address;
  await db.originRecord.create({ data: { domain, domainHash, originNetworkFamily: "EVM", originNetworkId: networks[0].networkId, originNetworkHash: hashNetworkId(networks[0].networkId), originRegistryId: networks[0].registryId,
    originTxFamily: "EVM", originTxId: originTx, globalDomainEpoch: 1n, originSequence: 1n, activatedAt: new Date(), lastAuditHash: `0x${"33".repeat(32)}` } });
  const jobs = new MultichainRelayJobService(new PrismaRelayJobRepository(db));
  const { job } = await jobs.detect({ sourceEventKey: randomUUID(), domainHash, operation: "REGISTER", origin: { family: "EVM", networkId: networks[0].networkId, registryId: networks[0].registryId }, sourceTransactionId: originTx, sourcePosition: "synthetic:20", globalDomainEpoch: 1n, originSequence: 1n, detectedAt: new Date(), destinations: [{ family: "EVM", networkId: networks[1].networkId, registryId: networks[1].registryId }] });
  let pending = true, broadcasts = 0;
  const payload = "0x010203" as const, expected = keccak256(payload);
  const adapters: any = {
    transactionSigner: { sign: async () => ({ signedPayload: payload, transactionId: expected }) },
    evmClientFactory: (network: any) => ({
      getChainId: async () => network.chainId, getBlockNumber: async () => 100n, getBlock: async () => ({ number: 20n, hash: blockHash }),
      getTransactionReceipt: async ({ hash }: any) => { if (hash !== originTx && pending) { const error = new Error("not yet mined"); error.name = "TransactionReceiptNotFoundError"; throw error; } return { status: "success", blockNumber: 20n, blockHash }; },
      readContract: async ({ functionName }: any) => functionName === "getCompanyProfile" ? { domain, endpointUrl: "https://peer.example.test", publicKey: account, adminKey: account, registrationTime: 1n, strikeCount: 0, epoch: 1, isProvider: false, status: 1 }
        : functionName === "getDomainTlsFingerprint" ? `0x${"44".repeat(32)}` : [false, 0, 0n, 0n, 0, false],
      sendRawTransaction: async () => { broadcasts++; return expected; },
    }),
  };
  const ledger: any = { listAdapters: () => networks.map(network => ({ networkId: network.networkId, network })) };
  const first = await createRuntimeRelayWorker(config, db, ledger, adapters);
  const { RelayCircuitBreakerService, PrismaRelayCircuitBreakerRepository } = await import("../../src/multichain/RelayCircuitBreaker.js");
  const circuits = new RelayCircuitBreakerService(new PrismaRelayCircuitBreakerRepository(db));
  const scope = { kind: "DEPLOYMENT" as const, networkId: networks[1].networkId, registryId: networks[1].registryId };
  await circuits.recordSignal({ requestId: randomUUID(), scope, signal: { kind: "STATE_DRIFT", evidence: { synthetic: "controlled" } }, observedAt: new Date() });
  await assert.rejects(first.run(job.id), /RELAY_AWAITING_CONFIRMATION/);
  assert.equal(broadcasts, 0, "Persisted open circuit must prevent broadcast");
  await circuits.reset({ requestId: randomUUID(), scope, actor: "synthetic-operator", reason: "Controlled test recovery", resetAt: new Date() });
  await assert.rejects(first.run(job.id), /RELAY_AWAITING_CONFIRMATION/);
  assert.equal((await db.multichainRelayJob.findUniqueOrThrow({ where: { id: job.id } })).status, "SUBMITTED"); assert.equal(broadcasts, 1);
  pending = false;
  const restarted = await createRuntimeRelayWorker(config, db, ledger, adapters);
  assert.equal((await restarted.run(job.id)).status, "CONFIRMED"); assert.equal(broadcasts, 1);
  assert.equal((await db.multichainRelayJob.findUniqueOrThrow({ where: { id: job.id } })).status, "CONFIRMED");
});

test("separated EVM poller connects its persistent observer cursor to a controlled JSON-RPC", async () => {
  const { createServer } = await import("node:http");
  const { startEvmIndexers } = await import("../../src/runtime/evmIndexers.js");
  const { defineEvmNetwork } = await import("../../src/multichain/NetworkModel.js");
  const { EnvSchema } = await import("../../src/config.js");
  const server = createServer(async (req, res) => {
    let data = ""; for await (const chunk of req) data += chunk;
    const input = JSON.parse(data);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result: input.method === "eth_chainId" ? "0x14a34" : "0x0" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const network = defineEvmNetwork({ chainId: 84532, name: "Controlled RPC", rpcUrl: `http://127.0.0.1:${port}`, registryAddress: `0x${"55".repeat(20)}`, explorerUrl: "https://example.test", asset: { kind: "NATIVE", symbol: "ETH", decimals: 18, address: null }, finality: { confirmations: 2, reorgMarginBlocks: 2 }, capabilities: { origin: true, mirror: true } });
  const config = EnvSchema.parse({ JWT_SECRET: "x".repeat(32), MASTER_SECRET_KEY: "x".repeat(32), INTERNAL_SERVICE_KEY: "x".repeat(32), ORACLE_PRIVATE_KEY: generatePrivateKey() });
  let errors = 0; const loops = startEvmIndexers(config, db, { listAdapters: () => [{ network }] } as any, () => errors++);
  try {
    await waitFor(async () => (await db.evmObserverCursor.findUnique({ where: { networkId: network.networkId } }))?.observedHead === 0n);
    assert.equal(loops.count, 1); assert.equal(errors, 0);
  } finally { await loops.stop(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
