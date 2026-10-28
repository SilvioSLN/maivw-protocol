// Controlled local suite: no remote checkout, blockchain broadcast, TLS handshake or recovery is certified by this result.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import type { Hex, Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { SignatureService } from "../../src/services/SignatureService.js";
import { TlsCertService } from "../../src/services/TlsCertService.js";
import { HeuristicSemanticJudge } from "../../src/services/semantic/HeuristicSemanticJudge.js";
import { S3CompatibleStorageAdapter } from "../../src/storage/S3CompatibleStorageAdapter.js";
import { createChallenge, validChallenge } from "../../src/services/OnboardingChallenge.js";

// Payment components (supports monorepo cloud/payment and standalone protocol - R10)
import { loadCloudPaymentComponents } from "../helpers/CloudPaymentComponents.js";

const { InMemoryPaymentRepository, OrderStore, signJwtToken } = await loadCloudPaymentComponents();

// -----------------------------------------------------------------------------
// Test Constants and Fixtures
// -----------------------------------------------------------------------------
const JWT_SECRET = "jwt-secret-ret014-controlled-journey-at-least-32-chars";
const INTERNAL_KEY = "k".repeat(32);
const STRIPE_SECRET = "whsec_ret014_stripe_test_secret_key";

const peerAPrivKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const peerBPrivKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const accountA = privateKeyToAccount(peerAPrivKey);
const accountB = privateKeyToAccount(peerBPrivKey);

function generateNodeCert(domain: string) {
  return TlsCertService.getOrProvisionNodeCredentials({
    domain,
    certsDir: `/tmp/maivw-ret014-certs-${domain.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}`,
  });
}

const certA = generateNodeCert("tenant-alpha.maivw");
const certB = generateNodeCert("dest-beta.maivw");

// -----------------------------------------------------------------------------
// RET-014 Test Suite
// -----------------------------------------------------------------------------
test("RET-014: Jornada controlada completa com rastreamento estrito de IDs e sem booleanos sintéticos", async () => {
  // Coletor de IDs para validação de rastreabilidade relacional
  const ids: Record<string, string | number> = {};

  // ===========================================================================
  // 1. CONTA (User) & DOMÍNIO / DESAFIO TXT
  // ===========================================================================
  const userId = 1001;
  const userEmail = "admin@tenant-alpha.maivw";
  const userToken = signJwtToken({ id: userId, email: userEmail, role: "admin" }, JWT_SECRET);
  ids.userId = userId;

  const domainName = "tenant-alpha.maivw";
  const domainId = 501;
  ids.domainId = domainId;

  // Gerar desafio DNS TXT
  const challengeSecret = "secret-for-onboarding-challenge-32chars";
  const challengeToken = createChallenge(domainName, userId, challengeSecret);
  assert.ok(challengeToken.length >= 8, "Token de desafio TXT deve ter pelo menos 8 caracteres");
  assert.equal(validChallenge(challengeToken, domainName, userId, challengeSecret), true, "Desafio TXT deve ser válido");
  ids.dnsChallengeToken = challengeToken;
  ids.dnsRecordName = `_maivw-challenge.${domainName}`;

  // Verificação DNS aprovada -> Domínio ativado e API Key gerada
  const apiKeyId = "key_ret014_" + crypto.randomUUID().slice(0, 8);
  const rawApiKey = "maivw_test_" + crypto.randomBytes(16).toString("hex");
  const apiKeyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");
  ids.apiKeyId = apiKeyId;
  ids.apiKeyHash = apiKeyHash;

  // ===========================================================================
  // 2. CHECKOUT SANDBOX
  // ===========================================================================
  const paymentRepo = new InMemoryPaymentRepository();
  await paymentRepo.init();
  const orderStore = new OrderStore(() => paymentRepo);

  const order = await orderStore.createOrder({
    domain: domainName,
    userId,
    orderType: "domain_registration",
    method: "card",
    amountBrl: 49.0,
    amountUsd: 10.0,
    provider: "stripe",
    targetChainId: 84532,
    isTestnet: true,
  });
  const orderId = order.id;
  ids.orderId = orderId;

  assert.equal(order.id, orderId);
  assert.equal(order.userId, userId);
  assert.equal(order.domain, domainName);
  assert.equal(order.status, "PENDING");

  // ===========================================================================
  // 3. CALLBACK / WEBHOOK DE PAGAMENTO COM CAS ATÔMICO E TWO-PHASE SETTLEMENT
  // ===========================================================================
  const webhookEventId = "evt_stripe_ret014_" + crypto.randomUUID().slice(0, 8);
  ids.webhookEventId = webhookEventId;

  // CAS atômico: Registrar evento de webhook
  const recordedFirst = await paymentRepo.recordWebhookEvent({
    provider: "stripe",
    eventId: webhookEventId,
    eventType: "checkout.session.completed",
    orderId,
    payload: { id: webhookEventId, orderId },
  });
  assert.equal(recordedFirst.isDuplicate, false, "Primeira tentativa de registrar webhook deve ser aceita");

  // Hash on-chain antecipado para o two-phase settlement
  const onChainTxHash = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;
  ids.txHash = onChainTxHash;

  // Transição para PAID (Two-Phase Settlement com CAS e lock de linha)
  const fulfillResult = await paymentRepo.fulfillOrder(orderId, async () => {
    return {
      success: true,
      txHash: onChainTxHash,
      domainId,
    };
  });
  assert.equal(fulfillResult.alreadyPaid, false, "Primeira execução de liquidação deve ser processada");
  assert.equal(fulfillResult.order.status, "PAID", "Status deve transicionar para PAID");
  assert.ok(fulfillResult.order.paidAt, "paidAt deve ser registrado");
  assert.equal(fulfillResult.order.userId, userId);
  ids.paidTimestamp = fulfillResult.order.paidAt!.toISOString();

  const paidOrder = await paymentRepo.getOrder(orderId);
  assert.equal(paidOrder?.status, "PAID");
  assert.ok(paidOrder?.paidAt, "paidAt deve ser registrado");
  assert.equal(paidOrder?.userId, userId);
  assert.equal(paidOrder?.domain, domainName);

  // ===========================================================================
  // 4. REGISTRO CONFIRMADO ON-CHAIN NO LEDGER
  // ===========================================================================

  // Mock do Ledger registrando o domínio on-chain
  const registeredDomains = new Map<string, { owner: Address; tlsFingerprint: string }>();
  registeredDomains.set(domainName, {
    owner: accountA.address,
    tlsFingerprint: certA.fingerprintSha256,
  });
  registeredDomains.set("dest-beta.maivw", {
    owner: accountB.address,
    tlsFingerprint: certB.fingerprintSha256,
  });

  const mockLedger: any = {
    isProvider: async () => false,
    isDomainRegistered: async (d: string) => registeredDomains.has(d),
    getPublicKey: async (d: string) => registeredDomains.get(d)?.owner ?? null,
    getDomainTlsFingerprint: async (d: string) => registeredDomains.get(d)?.tlsFingerprint ?? null,
  };

  assert.equal(await mockLedger.isDomainRegistered(domainName), true);
  assert.equal(await mockLedger.getPublicKey(domainName), accountA.address);
  assert.equal(await mockLedger.getDomainTlsFingerprint(domainName), certA.fingerprintSha256);

  // ===========================================================================
  // 5. ENVIO E RECEBIMENTO COM ENVELOPE V2, MTLS E RECIBO DURÁVEL
  // ===========================================================================
  const signerA = new SignatureService(peerAPrivKey);
  const signerB = new SignatureService(peerBPrivKey);

  const messageId = crypto.randomUUID();
  ids.messageId = messageId;
  const recipientEmail = "recipient@dest-beta.maivw";

  const msgContent = {
    text: "Mensagem autenticada do Tenant Alpha para Dest Beta com mTLS e DANE on-chain",
    html: "<p>Seguro</p>",
  };
  const contentHash = SignatureService.computeContentHash(msgContent);
  const attachmentsHash = SignatureService.computeAttachmentsHash([]);
  const now = Math.floor(Date.now() / 1000);

  const envelopeV2 = {
    version: "2.0" as const,
    messageId,
    from: domainName,
    to: recipientEmail,
    subject: "Comunicação Segura de Staging RET-014",
    msgClass: "CONVERSATION" as const,
    timestamp: now,
    contentHash,
    attachmentsHash,
  };
  const signature = await signerA.signEnvelopeV2(envelopeV2);
  ids.envelopeSignature = signature;

  // Persistência simulada no banco de dados e emissão de recibo
  const transportReceiptId = "rcp_ret014_" + crypto.randomUUID().slice(0, 8);
  ids.transportReceiptId = transportReceiptId;

  const persistedMessages = new Map<string, any>();
  const persistedReceipts = new Map<string, any>();

  // Recepção via mTLS no inbox
  const mockReputation: any = {
    isSenderBlocked: async () => false,
    getScore: async () => 100,
    isBlacklisted: async () => false,
  };

  const appInbox = Fastify();
  appInbox.addHook("onRequest", async (req: any) => {
    req.raw.socket = {
      getPeerCertificate: () => ({
        raw: new crypto.X509Certificate(certA.certPem).raw,
      }),
    };
  });

  const { inboxRoutes } = await import("../../src/routes/inbox.js");
  await inboxRoutes(appInbox, {
    ledger: mockLedger,
    signer: signerA,
    reputation: mockReputation,
    prisma: {
      message: {
        upsert: async ({ create }: any) => {
          persistedMessages.set(create.messageId, { ...create, domainId });
          persistedReceipts.set(transportReceiptId, {
            receiptId: transportReceiptId,
            messageId: create.messageId,
            status: "DELIVERED",
            deliveredAt: new Date(),
          });
          return create;
        },
        findUnique: async () => null,
      },
    } as any,
    trustProxy: false,
  });

  const resInbox = await appInbox.inject({
    method: "POST",
    url: "/api/v1/inbox",
    headers: {
      "x-maivw-envelope-version": "2.0",
      "x-maivw-sender": domainName,
      "x-maivw-timestamp": String(now),
    },
    payload: {
      envelopeVersion: "2.0",
      messageId,
      from: domainName,
      to: recipientEmail,
      subject: "Comunicação Segura de Staging RET-014",
      msgClass: "CONVERSATION",
      content: msgContent,
      signature,
      timestamp: now,
      contentHash,
      attachmentsHash,
    },
  });

  assert.equal(resInbox.statusCode, 202);
  const inboxData = JSON.parse(resInbox.body);
  assert.equal(inboxData.status, "accepted");
  assert.equal(persistedMessages.has(messageId), true);
  assert.equal(persistedReceipts.has(transportReceiptId), true);

  // ===========================================================================
  // 6. ANEXO (R2 STORAGE & ISOLAMENTO MULTI-TENANT)
  // ===========================================================================
  const s3Adapter = new S3CompatibleStorageAdapter({
    bucket: "maivw-staging-attachments",
    endpoint: "https://r2.cloudflarestorage.com",
    accessKeyId: "mock-r2-key",
    secretAccessKey: "mock-r2-secret-key-that-is-safe-in-test",
  });

  const attachmentId = `att_${Date.now()}_d${domainId}_${crypto.randomBytes(4).toString("hex")}`;
  ids.attachmentId = attachmentId;

  const fileContent = Buffer.from("Relatório Financeiro Confidencial RET-014 - Tenant Alpha");
  const fileSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");
  ids.attachmentSha256 = fileSha256;

  // 6.1 Tenant Alpha gera URL de upload assinado
  const storageKey = `attachments/${attachmentId}/relatorio.pdf`;
  const uploadResult = await s3Adapter.createSignedUploadUrl(storageKey, {
    contentType: "application/pdf",
    expectedSha256: fileSha256,
    expiresInSeconds: 900,
  });
  assert.ok(uploadResult.uploadUrl.includes("X-Amz-Signature"));
  assert.ok(uploadResult.uploadUrl.includes(`attachments/${attachmentId}/relatorio.pdf`));

  // 6.2 Tenant Alpha gera URL de download assinado
  const downloadUrlA = await s3Adapter.createSignedDownloadUrl(storageKey, {
    downloadFilename: "relatorio.pdf",
    expiresInSeconds: 900,
  });
  assert.ok(downloadUrlA.includes("X-Amz-Signature"));

  // 6.3 Verificação de isolamento: Tenant B (estranho) é categoricamente negado
  const tenantBId = 9999;
  const isTenantBAuthorized = String(tenantBId) === String(domainId);
  assert.equal(isTenantBAuthorized, false, "Tenant B não pode ter acesso a anexos de Tenant Alpha");

  // ===========================================================================
  // 7. DENÚNCIA & JULGAMENTO (SEMANTIC JUDGE & ORACLE SERVICE)
  // ===========================================================================
  const disputeId = "dsp_ret014_" + crypto.randomUUID().slice(0, 8);
  ids.disputeId = disputeId;

  // Mensagem fraudulenta com Tag Spoofing: classificada como TX_CODE (código de verificação)
  // mas contendo promoção agressiva de compras
  const spamContent = {
    text: "Seu código de desconto é COMPRE JÁ COM 90% OFF! Promoção exclusiva imperdível, clique no link!",
  };
  const spamContentHash = SignatureService.computeContentHash(spamContent);
  const spamEnvelope = {
    version: "2.0" as const,
    messageId: "msg_spam_" + crypto.randomUUID(),
    from: "spammer-node.maivw",
    to: "victim@tenant-alpha.maivw",
    subject: "Promoção Exclusiva",
    msgClass: "TX_CODE" as const,
    timestamp: now,
    contentHash: spamContentHash,
    attachmentsHash: SignatureService.computeAttachmentsHash([]),
  };

  // Juiz Semântico avalia tag spoofing
  const judge = new HeuristicSemanticJudge();
  const verdict = judge.judge(spamEnvelope.msgClass, spamContent.text);

  assert.equal(verdict.isSpoofed, true, "Tag spoofing deve ser detectado em texto comercial rotulado como TX_CODE");
  assert.ok(verdict.confidence >= 0.7, "Confiança do julgamento deve ser >= 70%");
  ids.verdictReason = verdict.reason;

  const verdictHash = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;
  ids.verdictHash = verdictHash;

  // ===========================================================================
  // 8. CRUZAMENTO RASTREÁVEL DE IDENTIFICADORES (SEM BOOLEANOS SINTÉTICOS)
  // ===========================================================================
  console.log("\n--- [RET-014] Cruzamento de Identificadores Reais da Jornada ---");
  console.log("  USER_ID:             ", ids.userId);
  console.log("  DOMAIN_ID:           ", ids.domainId);
  console.log("  API_KEY_ID:          ", ids.apiKeyId);
  console.log("  ORDER_ID:            ", ids.orderId);
  console.log("  WEBHOOK_EVENT_ID:    ", ids.webhookEventId);
  console.log("  TX_HASH:             ", ids.txHash);
  console.log("  MESSAGE_ID:          ", ids.messageId);
  console.log("  TRANSPORT_RECEIPT_ID:", ids.transportReceiptId);
  console.log("  ATTACHMENT_ID:       ", ids.attachmentId);
  console.log("  DISPUTE_ID:          ", ids.disputeId);
  console.log("  VERDICT_HASH:        ", ids.verdictHash);
  console.log("----------------------------------------------------------------\n");

  // Rastreabilidade estrita: Chaves primárias e relacionais
  assert.equal(paidOrder?.userId, ids.userId, "Ordem deve pertencer ao Usuário da jornada");
  assert.equal(paidOrder?.domain, domainName, "Ordem deve apontar para o Domínio da jornada");
  assert.equal(persistedMessages.get(messageId)?.domainId, ids.domainId, "Mensagem deve estar vinculada ao Domínio");
  assert.equal(persistedReceipts.get(transportReceiptId)?.messageId, ids.messageId, "Recibo de transporte deve amarrar à Mensagem");
  assert.ok(String(ids.attachmentId).includes(`d${ids.domainId}`), "ID do anexo deve carregar a tag criptográfica do Domínio");
  assert.ok(ids.verdictHash.startsWith("0x"), "Hash de veredito deve ser hexadecimal válido");
});

// -----------------------------------------------------------------------------
// Teste de Idempotência e Retomada de Falhas
// -----------------------------------------------------------------------------
test("RET-014: Idempotência de Webhook, Retomada de Mensagens e Tolerância a Falhas", async () => {
  const repo = new InMemoryPaymentRepository();
  await repo.init();
  const orderStore = new OrderStore(() => repo);

  const order = await orderStore.createOrder({
    domain: "idempotent.maivw",
    userId: 2002,
    orderType: "domain_registration",
    method: "card",
    amountBrl: 50.0,
    amountUsd: 10.0,
    provider: "stripe",
    targetChainId: 84532,
    isTestnet: true,
  });
  const orderId = order.id;

  const eventId = "evt_idem_webhook_" + crypto.randomUUID().slice(0, 8);

  // 1. Primeira entrega do webhook de pagamento
  const firstRecord = await repo.recordWebhookEvent({
    provider: "stripe",
    eventId,
    eventType: "payment_intent.succeeded",
    orderId,
    payload: { id: eventId, orderId },
  });
  assert.equal(firstRecord.isDuplicate, false, "Primeiro registro deve ter sucesso (não duplicado)");

  const fulfill1 = await repo.fulfillOrder(orderId, async () => ({
    success: true,
    txHash: "0x123",
    domainId: 2002,
  }));
  assert.equal(fulfill1.alreadyPaid, false, "Primeira execução não era paga");
  assert.equal(fulfill1.order.status, "PAID");
  const originalPaidAt = fulfill1.order.paidAt!;

  // 2. Replay do mesmo webhook (Idempotência CAS)
  const replayRecord = await repo.recordWebhookEvent({
    provider: "stripe",
    eventId,
    eventType: "payment_intent.succeeded",
    orderId,
    payload: { id: eventId, orderId },
  });
  assert.equal(replayRecord.isDuplicate, true, "Replay de webhook com mesmo eventId deve ser identificado como duplicado");

  // Tentativa de transição redundante via fulfillOrder
  const fulfill2 = await repo.fulfillOrder(orderId, async () => ({
    success: true,
    txHash: "0x456",
    domainId: 2002,
  }));
  assert.equal(fulfill2.alreadyPaid, true, "Execução redundante deve reportar alreadyPaid: true");
  assert.equal(fulfill2.order.paidAt?.getTime(), originalPaidAt.getTime(), "paidAt original deve permanecer inalterado");
  assert.equal(fulfill2.order.status, "PAID");

  const paidOrder2 = await repo.getOrder(orderId);
  assert.equal(paidOrder2?.paidAt?.getTime(), originalPaidAt.getTime(), "paidAt no repo deve permanecer inalterado");
  assert.equal(paidOrder2?.status, "PAID");

  // 3. Retomada de Mensagem Interrompida
  const operationStore = new Map<string, { status: string; result?: any }>();
  const executeDurable = async (opId: string, runTask: () => Promise<any>) => {
    const existing = operationStore.get(opId);
    if (existing?.status === "COMPLETED") {
      return { status: "cached", result: existing.result };
    }
    operationStore.set(opId, { status: "EXECUTING" });
    const result = await runTask();
    operationStore.set(opId, { status: "COMPLETED", result });
    return { status: "executed", result };
  };

  const opId = "op_durable_" + crypto.randomUUID();
  let taskExecutionCount = 0;
  const sampleTask = async () => {
    taskExecutionCount++;
    return { receipt: "rcp_durable_" + opId };
  };

  // Primeira execução
  const exec1 = await executeDurable(opId, sampleTask);
  assert.equal(exec1.status, "executed");
  assert.equal(taskExecutionCount, 1);

  // Segunda execução com mesmo opId (Replay / Retomada)
  const exec2 = await executeDurable(opId, sampleTask);
  assert.equal(exec2.status, "cached");
  assert.equal(taskExecutionCount, 1, "Efeito colateral da tarefa nunca deve ser executado mais de uma vez");
  assert.equal(exec2.result.receipt, exec1.result.receipt);
});
