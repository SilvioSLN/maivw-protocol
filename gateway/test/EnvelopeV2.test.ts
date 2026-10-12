import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { v4 as uuidv4 } from "uuid";
import { SignatureService } from "../src/services/SignatureService.js";
import { inboxRoutes } from "../src/routes/inbox.js";

// Chave privada de teste Anvil #0
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_SENDER_DOMAIN = "empresa-a.com";

function createMockPrisma() {
  const messages = new Map<string, any>();
  return {
    message: {
      findUnique: async ({ where }: any) => messages.get(where.messageId) || null,
      upsert: async ({ create }: any) => {
        messages.set(create.messageId, create);
        return create;
      },
    },
  } as any;
}

function createMockLedger(signerAddress: string) {
  return {
    isProvider: async () => false,
    getPublicKey: async (domain: string) => (domain === TEST_SENDER_DOMAIN ? signerAddress : null),
  } as any;
}

function createMockReputation() {
  return {
    isSenderBlocked: async () => false,
  } as any;
}

test("SignatureService: Envelope v2 signs canonical structured payload and detects tampering", async () => {
  const signer = new SignatureService(TEST_PRIVATE_KEY);
  const now = Math.floor(Date.now() / 1000);
  const content = { text: "Hello World", html: "<p>Hello World</p>" };
  const contentHash = SignatureService.computeContentHash(content);

  const payload = {
    version: "2.0" as const,
    messageId: uuidv4(),
    from: TEST_SENDER_DOMAIN,
    to: "user@empresa-b.com",
    subject: "Important Transaction",
    msgClass: "TX_CODE",
    timestamp: now,
    contentHash,
    attachmentsHash: "",
  };

  const sig = await signer.signEnvelopeV2(payload);
  assert.ok(sig.startsWith("0x"));

  // Verificação legítima
  const isValid = await signer.verifyEnvelopeV2(payload, sig, signer.address);
  assert.equal(isValid, true);

  // Adulteração de destinatário -> deve invalidar
  const tamperedTo = { ...payload, to: "attacker@evil.com" };
  assert.equal(await signer.verifyEnvelopeV2(tamperedTo, sig, signer.address), false);

  // Adulteração de assunto -> deve invalidar
  const tamperedSubject = { ...payload, subject: "Modified Subject" };
  assert.equal(await signer.verifyEnvelopeV2(tamperedSubject, sig, signer.address), false);

  // Adulteração de timestamp -> deve invalidar
  const tamperedTime = { ...payload, timestamp: now - 3600 };
  assert.equal(await signer.verifyEnvelopeV2(tamperedTime, sig, signer.address), false);

  // Adulteração de msgClass -> deve invalidar
  const tamperedClass = { ...payload, msgClass: "MARKETING" };
  assert.equal(await signer.verifyEnvelopeV2(tamperedClass, sig, signer.address), false);
});

test("inboxRoutes: Envelope v2 verification, replay protection and v1 backward compatibility", async () => {
  const signer = new SignatureService(TEST_PRIVATE_KEY);
  const prisma = createMockPrisma();
  const ledger = createMockLedger(signer.address);
  const reputation = createMockReputation();

  const app = Fastify();
  await app.register(inboxRoutes, {
    signer,
    ledger,
    reputation,
    prisma,
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const content = { text: "Envelope v2 Test", html: "<p>Envelope v2 Test</p>" };
    const contentHash = SignatureService.computeContentHash(content);
    const messageId = uuidv4();

    const v2SigningData = {
      version: "2.0" as const,
      messageId,
      from: TEST_SENDER_DOMAIN,
      to: "recipient@empresa-b.com",
      subject: "Test v2",
      msgClass: "TX_CODE",
      timestamp: now,
      contentHash,
      attachmentsHash: "",
    };

    const signature = await signer.signEnvelopeV2(v2SigningData);

    // 1. Envelope v2 válido sem fake x-maivw-intent-tx -> 202 Accepted
    const resV2Valid = await app.inject({
      method: "POST",
      url: "/api/v1/inbox",
      headers: {
        "x-maivw-envelope-version": "2.0",
        "x-maivw-sender": TEST_SENDER_DOMAIN,
        "x-maivw-timestamp": String(now),
      },
      payload: {
        envelopeVersion: "2.0",
        messageId,
        msgClass: "TX_CODE",
        to: "recipient@empresa-b.com",
        subject: "Test v2",
        content,
        signature,
        timestamp: now,
      },
    });
    assert.equal(resV2Valid.statusCode, 202);

    // 2. Proteção Anti-Replay: tentar enviar exatamente o mesmo messageId -> 409 Conflict
    const resReplay = await app.inject({
      method: "POST",
      url: "/api/v1/inbox",
      headers: {
        "x-maivw-envelope-version": "2.0",
        "x-maivw-sender": TEST_SENDER_DOMAIN,
        "x-maivw-timestamp": String(now),
      },
      payload: {
        envelopeVersion: "2.0",
        messageId, // mesmo ID
        msgClass: "TX_CODE",
        to: "recipient@empresa-b.com",
        subject: "Test v2",
        content,
        signature,
        timestamp: now,
      },
    });
    assert.equal(resReplay.statusCode, 409);

    // 3. Proteção Anti-Replay: timestamp expirado (> 15 minutos atrás) -> 400 ExpiredTimestamp
    const expiredId = uuidv4();
    const expiredTime = now - 1800; // 30 minutos atrás
    const expiredPayload = {
      ...v2SigningData,
      messageId: expiredId,
      timestamp: expiredTime,
    };
    const expiredSig = await signer.signEnvelopeV2(expiredPayload);

    const resExpired = await app.inject({
      method: "POST",
      url: "/api/v1/inbox",
      headers: {
        "x-maivw-envelope-version": "2.0",
        "x-maivw-sender": TEST_SENDER_DOMAIN,
        "x-maivw-timestamp": String(expiredTime),
      },
      payload: {
        envelopeVersion: "2.0",
        messageId: expiredId,
        msgClass: "TX_CODE",
        to: "recipient@empresa-b.com",
        subject: "Test v2",
        content,
        signature: expiredSig,
        timestamp: expiredTime,
      },
    });
    assert.equal(resExpired.statusCode, 400);

    // 4. Compatibilidade Retroativa Envelope v1: requer intent-tx e assinatura legado -> 202 Accepted
    const v1Id = uuidv4();
    const v1Content = { text: "Envelope v1 Legacy", html: "" };
    const v1Sig = await signer.signPayload(v1Content);

    const resV1 = await app.inject({
      method: "POST",
      url: "/api/v1/inbox",
      headers: {
        "x-maivw-sender": TEST_SENDER_DOMAIN,
        "x-maivw-intent-tx": "0x" + "11".repeat(32),
      },
      payload: {
        messageId: v1Id,
        msgClass: "MARKETING",
        to: "recipient@empresa-b.com",
        subject: "Legacy v1",
        content: v1Content,
        signature: v1Sig,
      },
    });
    assert.equal(resV1.statusCode, 202);
  } finally {
    await app.close();
  }
});
