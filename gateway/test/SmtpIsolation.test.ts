import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { SmtpService } from "../src/services/SmtpService.js";
import { MailDispatchService } from "../src/services/MailDispatchService.js";
const master = "smtp-test-master-key-32-characters";

test("SMTP resolves only sender tenant, never latest foreign configuration, with explicit platform fallback", async () => {
  const lookups: any[] = [], sends: string[] = [];
  const rows = ["a.example", "b.example"].map(domain => {
    const encrypted = SmtpService.encryptApiKey(`re_synthetic_${domain}`, master);
    return { isActive: true, domain: { domainName: domain }, provider: "resend", encryptedApiKey: encrypted.encrypted, iv: encrypted.iv, authTag: encrypted.authTag };
  });
  const prisma: any = { smtpConfig: { findFirst: async ({ where }: any) => {
    lookups.push(where); assert.ok(where.domain?.domainName, "every lookup must be tenant-scoped");
    return rows.find(row => row.domain.domainName === where.domain.domainName) ?? null;
  } } };
  const adapter = (tag: string) => ({ id: tag, async sendEmail() { sends.push(tag); return { success: true, provider: tag, messageId: "synthetic-receipt" }; } });
  const smtp = new SmtpService(undefined, prisma, master, undefined, { defaultAdapter: adapter("platform"), resend: key => adapter(key) });
  for (const domain of ["a.example", "b.example", "no-config.example"]) await smtp.sendEmail("receiver@example.test", "Synthetic", { text: "Synthetic" }, domain);
  assert.deepEqual(sends, ["re_synthetic_a.example", "re_synthetic_b.example", "platform"]);
  assert.equal(lookups.length, 3);
});

test("foreign, disabled and undecipherable SMTP configurations fail before any transport", async () => {
  for (const row of [
    { isActive: true, domain: { domainName: "foreign.example" } },
    { isActive: false, domain: { domainName: "a.example" } },
    { isActive: true, domain: { domainName: "a.example" }, encryptedApiKey: "invalid", iv: "invalid", authTag: "invalid" },
  ]) {
    let sends = 0;
    const smtp = new SmtpService(undefined, { smtpConfig: { findFirst: async () => row } } as any, master, undefined, {
      defaultAdapter: { id: "platform", async sendEmail() { sends++; return { success: true, provider: "platform" }; } },
    });
    assert.equal((await smtp.sendEmail("receiver@example.test", "Synthetic", { text: "Synthetic" }, "a.example")).success, false);
    assert.equal(sends, 0);
  }
  const missing = new SmtpService(undefined, { smtpConfig: { findFirst: async () => null } } as any, master);
  assert.equal((await missing.sendEmail("receiver@example.test", "Synthetic", { text: "Synthetic" }, "a.example")).success, false);
});

test("dispatch persists actual transport receipt and returns ambiguous state if acceptance cannot be recorded", async () => {
  const app = Fastify();
  const persisted: any[] = []; let fail = false; let calls = 0;
  const dispatch = new MailDispatchService({ logger: app.log, senderDomain: "unused", signer: {} as any,
    ledger: { isDomainRegistered: async (domain: string) => domain === "a.example", getAllowedDailyVolume: async () => 0n } as any,
    smtp: { async sendEmail() { calls++; return { success: true, provider: "synthetic", messageId: "actual-test-receipt" }; } } as any,
    prisma: { message: { async create(value: any) { if (fail) throw new Error("Synthetic DB failure"); persisted.push(value.data); } } } as any,
  });
  const input = { payload: { to: "receiver@example.test", subject: "Synthetic", msgClass: "CONVERSATION", content: { text: "Synthetic" } }, sender: { domain: "a.example", mailboxEmail: "alice@a.example" } };
  try {
    const accepted = await dispatch.execute(input);
    assert.equal(accepted.statusCode, 200); assert.equal(accepted.body.transportMessageId, "actual-test-receipt");
    assert.equal(persisted[0].transportProvider, "synthetic"); assert.equal(persisted[0].transportMessageId, "actual-test-receipt");
    const denied = await dispatch.execute({ ...input, payload: { ...input.payload, from: "attacker@b.example" } });
    assert.equal(denied.statusCode, 403); assert.equal(calls, 1);
    fail = true;
    const uncertain = await dispatch.execute(input);
    assert.equal(uncertain.statusCode, 503); assert.equal(uncertain.body.deliveryState, "accepted_unrecorded"); assert.equal(calls, 2);
  } finally { await app.close(); }
});
