import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { generatePrivateKey } from "viem/accounts";
import { EnvSchema } from "../src/config.js";
import { OracleService } from "../src/services/OracleService.js";
import { DisputeExecutionService } from "../src/services/DisputeExecutionService.js";
import { SignatureService } from "../src/services/SignatureService.js";
import { createJobQueue } from "../src/queue/QueueFactory.js";
import { BullMQJobQueue } from "../src/queue/BullMQJobQueue.js";

test("slashing cannot synthesize success on broadcast, receipt timeout or reverted receipt", async () => {
  let mode = "broadcast-error", deactivated = 0, broadcasts = 0;
  const config = EnvSchema.parse({ JWT_SECRET: "x".repeat(32), MASTER_SECRET_KEY: "x".repeat(32), INTERNAL_SERVICE_KEY: "x".repeat(32), ORACLE_PRIVATE_KEY: generatePrivateKey() });
  const ledger: any = { getContractAddress: () => `0x${"11".repeat(20)}`, deactivateDemoDomain: () => deactivated++, getClient: () => ({ async waitForTransactionReceipt() {
    if (mode === "timeout") throw new Error("Synthetic receipt timeout"); return { status: mode === "reverted" ? "reverted" : "success" };
  } }) };
  const oracle = new OracleService(config, ledger);
  (oracle as any).walletClient = { async writeContract() { broadcasts++; if (mode === "broadcast-error") throw new Error("Synthetic failure"); return `0x${"22".repeat(32)}`; } };
  for (const state of ["broadcast-error", "timeout", "reverted"]) { mode = state; await assert.rejects(oracle.executeSlashing("synthetic.test", [])); assert.equal(deactivated, 0); }
  mode = "confirmed"; assert.equal((await oracle.executeSlashing("synthetic.test", [])).success, true); assert.equal(deactivated, 1); assert.equal(broadcasts, 4);
});

test("forged classification, legacy evidence and degraded AI cannot authorize punishment", async () => {
  const app = Fastify(); const signer = new SignatureService(generatePrivateKey()); let punishments = 0;
  const content = { text: "Synthetic proof" }, base = { version: "2.0" as const, messageId: randomUUID(), from: "synthetic.test", to: "recipient@example.test", subject: "Synthetic", msgClass: "CONVERSATION", timestamp: Math.floor(Date.now() / 1000), contentHash: SignatureService.computeContentHash(content), attachmentsHash: "" };
  let degraded = false;
  const oracle: any = { judgeSemanticViolationAsync: async () => ({ isSpoofed: true, reason: "Controlled", degraded }), executeSlashing: async () => { punishments++; return { success: true }; } };
  const service = new DisputeExecutionService({ logger: app.log, signer, oracle, reputation: {} as any, ledger: { getPublicKey: async () => signer.address, isProvider: async () => false } as any });
  const evidence = { senderDomain: base.from, reporterAddress: signer.address, payload: { ...base, content, envelopeVersion: "2.0", signature: await signer.signEnvelopeV2(base) } };
  try {
    assert.equal((await service.execute({ ...evidence, payload: { ...evidence.payload, msgClass: "TX_CODE" } })).statusCode, 400);
    assert.equal((await service.execute({ ...evidence, subIdentityId: "unsigned-victim" })).statusCode, 400);
    assert.equal((await service.execute({ ...evidence, payload: { ...evidence.payload, envelopeVersion: "1.0", signature: await signer.signPayload(content) } })).statusCode, 422);
    degraded = true; await assert.rejects(service.execute(evidence), /Judge unavailable/); assert.equal(punishments, 0);
  } finally { await app.close(); }
});

test("durable driver cannot silently fall back to memory or another Redis endpoint", () => {
  assert.throws(() => createJobQueue(`missing-${randomUUID()}`, { driver: "bullmq" }), /explicit Redis URL/);
  for (const redisUrl of ["invalid", "https://example.test"]) assert.throws(() => new BullMQJobQueue("synthetic", { redisUrl }), /Invalid Redis connection/);
});

test("Solana production indexer checks genesis before scanning finalized slots", async () => {
  const { Web3SolanaIndexerClient } = await import("../src/multichain/SolanaRegistryIndexer.js");
  const client = new Web3SolanaIndexerClient("http://127.0.0.1:1", "expected-genesis");
  let slotCalls = 0;
  (client as any).connection = { getGenesisHash: async () => "wrong-genesis", getSlot: async () => { slotCalls++; return 5; } };
  await assert.rejects(client.getSlot(), /genesis mismatch/); assert.equal(slotCalls, 0);
  (client as any).connection.getGenesisHash = async () => "expected-genesis";
  assert.equal(await client.getSlot(), 5n); assert.equal(slotCalls, 1);
});
