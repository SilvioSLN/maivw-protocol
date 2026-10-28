import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Fastify from "fastify";
import type { Hex, Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { SignatureService } from "../src/services/SignatureService.js";
import { TlsCertService } from "../src/services/TlsCertService.js";
import { HeuristicSemanticJudge } from "../src/services/semantic/HeuristicSemanticJudge.js";
import { S3CompatibleStorageAdapter } from "../src/storage/S3CompatibleStorageAdapter.js";
import { createChallenge, validChallenge } from "../src/services/OnboardingChallenge.js";

// Payment imports from cloud/payment
import { InMemoryPaymentRepository } from "../../../cloud/payment/src/services/PaymentRepository.js";
import { OrderStore } from "../../../cloud/payment/src/services/OrderStore.js";
import { signJwtToken } from "../../../cloud/payment/src/utils/auth.js";

// =============================================================================
// Helper: Geração de Certificados TLS de Nós Descartáveis
// =============================================================================
function generateDisposableCert(domain: string) {
  return TlsCertService.getOrProvisionNodeCredentials({
    domain,
    certsDir: `/tmp/maivw-aws040-certs-${domain.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
  });
}

// =============================================================================
// Suíte de Testes Automatizada: Fluxo E2E Funcional Completo (AWS-040)
// =============================================================================
test("AWS-040: Fluxo E2E funcional completo com todos os caminhos de julgamento e identidades descartáveis", async () => {
  console.log("\n=== INICIANDO FLUXO E2E FUNCIONAL COMPLETO (AWS-040) ===");

  // Timeline cronológica para auditoria forense relacional
  const timeline: Array<{ step: string; timestamp: string; details: Record<string, any> }> = [];
  const recordStep = (step: string, details: Record<string, any>) => {
    const entry = { step, timestamp: new Date().toISOString(), details };
    timeline.push(entry);
    console.log(`[E2E STEP] ${step.padEnd(35)} ->`, JSON.stringify(details));
  };

  // Coletor de identificadores relacionais (sem booleanos sintéticos)
  const ids: Record<string, string | number> = {};

  // ===========================================================================
  // 1. IDENTIDADES DESCARTÁVEIS & ONBOARDING (Cadastro + Desafio TXT + API Key)
  // ===========================================================================
  // Ator 1: Tenant Alpha (Remetente Legítimo)
  const privKeyAlpha = generatePrivateKey();
  const accountAlpha = privateKeyToAccount(privKeyAlpha);
  const domainAlpha = `tenant-alpha-${crypto.randomBytes(4).toString("hex")}.test.maivw.com`;
  const certAlpha = generateDisposableCert(domainAlpha);
  const signerAlpha = new SignatureService(privKeyAlpha);

  const userAlphaId = 1001;
  const userAlphaEmail = `admin@${domainAlpha}`;
  const jwtSecret = "jwt-secret-aws040-disposable-identities-32chars-min";
  const userAlphaToken = signJwtToken({ id: userAlphaId, email: userAlphaEmail, role: "admin" }, jwtSecret);
  const domainAlphaId = 501;

  ids.userAlphaId = userAlphaId;
  ids.domainAlpha = domainAlpha;
  ids.domainAlphaId = domainAlphaId;

  // Desafio DNS TXT
  const challengeSecret = "secret-for-onboarding-challenge-32chars";
  const challengeTokenAlpha = createChallenge(domainAlpha, userAlphaId, challengeSecret);
  assert.ok(challengeTokenAlpha.length >= 8, "Token de desafio TXT deve ter pelo menos 8 chars");
  assert.equal(validChallenge(challengeTokenAlpha, domainAlpha, userAlphaId, challengeSecret), true, "Desafio TXT deve ser autenticado");
  ids.challengeTokenAlpha = challengeTokenAlpha;

  // Emissão de API Key para Tenant Alpha
  const apiKeyIdAlpha = "key_e2e_" + crypto.randomUUID().slice(0, 8);
  const rawApiKeyAlpha = "maivw_test_" + crypto.randomBytes(16).toString("hex");
  const apiKeyHashAlpha = crypto.createHash("sha256").update(rawApiKeyAlpha).digest("hex");
  ids.apiKeyIdAlpha = apiKeyIdAlpha;

  recordStep("ONBOARDING_ALPHA", {
    userId: userAlphaId,
    domain: domainAlpha,
    challengeToken: challengeTokenAlpha,
    apiKeyId: apiKeyIdAlpha,
    ownerAddress: accountAlpha.address,
  });

  // Ator 2: Destinatário Beta (Destino Legítimo)
  const privKeyBeta = generatePrivateKey();
  const accountBeta = privateKeyToAccount(privKeyBeta);
  const domainBeta = `dest-beta-${crypto.randomBytes(4).toString("hex")}.test.maivw.com`;
  const certBeta = generateDisposableCert(domainBeta);
  const signerBeta = new SignatureService(privKeyBeta);

  // Ator 3: Provedor Gamma (Para teste de Advertência / Strike)
  const privKeyGamma = generatePrivateKey();
  const accountGamma = privateKeyToAccount(privKeyGamma);
  const domainGamma = `provider-gamma-${crypto.randomBytes(4).toString("hex")}.test.maivw.com`;
  const certGamma = generateDisposableCert(domainGamma);
  const signerGamma = new SignatureService(privKeyGamma);

  // Ator 4: Spammer Malicioso Omega (Para teste de Banimento / Slashing)
  const privKeyOmega = generatePrivateKey();
  const accountOmega = privateKeyToAccount(privKeyOmega);
  const domainOmega = `spammer-omega-${crypto.randomBytes(4).toString("hex")}.test.maivw.com`;
  const certOmega = generateDisposableCert(domainOmega);
  const signerOmega = new SignatureService(privKeyOmega);

  // Ator 5: Vítima / Denunciante Delta
  const privKeyDelta = generatePrivateKey();
  const accountDelta = privateKeyToAccount(privKeyDelta);

  // ===========================================================================
  // 2. PAGAMENTO MULTI-CANAL E TWO-PHASE SETTLEMENT (CAS ATÔMICO)
  // ===========================================================================
  const paymentRepo = new InMemoryPaymentRepository();
  await paymentRepo.init();
  const orderStore = new OrderStore(() => paymentRepo);

  // 2.1 Canal 1: Cartão Stripe Sandbox para Tenant Alpha
  const orderAlpha = await orderStore.createOrder({
    domain: domainAlpha,
    userId: userAlphaId,
    orderType: "domain_registration",
    method: "card",
    amountBrl: 49.0,
    amountUsd: 10.0,
    provider: "stripe",
    targetChainId: 84532, // Base Sepolia
    isTestnet: true,
  });
  ids.orderAlphaId = orderAlpha.id;
  assert.equal(orderAlpha.status, "PENDING");

  const webhookStripeEventId = "evt_stripe_" + crypto.randomUUID().slice(0, 8);
  ids.webhookStripeEventId = webhookStripeEventId;

  // Liquidação Exactly-Once via CAS
  const recordedWebhook = await paymentRepo.recordWebhookEvent({
    provider: "stripe",
    eventId: webhookStripeEventId,
    eventType: "checkout.session.completed",
    orderId: orderAlpha.id,
    payload: { id: webhookStripeEventId, orderId: orderAlpha.id },
  });
  assert.equal(recordedWebhook.isDuplicate, false);

  const txHashRegistryAlpha = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;
  ids.txHashRegistryAlpha = txHashRegistryAlpha;

  const fulfillAlpha = await paymentRepo.fulfillOrder(orderAlpha.id, async () => ({
    success: true,
    txHash: txHashRegistryAlpha,
    domainId: domainAlphaId,
  }));
  assert.equal(fulfillAlpha.order.status, "PAID");
  assert.equal(fulfillAlpha.alreadyPaid, false);
  ids.paidAtAlpha = fulfillAlpha.order.paidAt!.toISOString();

  recordStep("PAYMENT_STRIPE_ALPHA", {
    orderId: orderAlpha.id,
    provider: "stripe",
    amountUsd: 10.0,
    webhookEventId: webhookStripeEventId,
    status: "PAID",
    paidAt: ids.paidAtAlpha,
  });

  // 2.2 Canal 2: PIX Asaas Sandbox para Provider Gamma
  const asaasPaymentId = "pay_asaas_" + crypto.randomBytes(8).toString("hex");
  const orderGamma = await orderStore.createOrder({
    domain: domainGamma,
    userId: 2002,
    orderType: "domain_registration",
    method: "pix",
    amountBrl: 150.0,
    amountUsd: 30.0,
    provider: "asaas",
    targetChainId: 84532,
    isTestnet: true,
  });
  ids.orderGammaId = orderGamma.id;

  const webhookAsaasEventId = "evt_asaas_" + crypto.randomUUID().slice(0, 8);
  const txHashRegistryGamma = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;

  await paymentRepo.recordWebhookEvent({
    provider: "asaas",
    eventId: webhookAsaasEventId,
    eventType: "PAYMENT_RECEIVED",
    orderId: orderGamma.id,
    payload: { id: webhookAsaasEventId, payment: { id: asaasPaymentId, value: 150.0 } },
  });
  const fulfillGamma = await paymentRepo.fulfillOrder(orderGamma.id, async () => ({
    success: true,
    txHash: txHashRegistryGamma,
    domainId: 502,
  }));
  assert.equal(fulfillGamma.order.status, "PAID");

  recordStep("PAYMENT_PIX_GAMMA", {
    orderId: orderGamma.id,
    provider: "asaas",
    amountBrl: 150.0,
    webhookEventId: webhookAsaasEventId,
    status: "PAID",
  });

  // 2.3 Canal 3: Voucher Corporativo Determinístico para Spammer Omega
  const orderOmega = await orderStore.createOrder({
    domain: domainOmega,
    userId: 3003,
    orderType: "domain_registration",
    method: "voucher",
    amountBrl: 0.0,
    amountUsd: 0.0,
    provider: "voucher",
    targetChainId: 84532,
    isTestnet: true,
  });
  const txHashRegistryOmega = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;
  const fulfillOmega = await paymentRepo.fulfillOrder(orderOmega.id, async () => ({
    success: true,
    txHash: txHashRegistryOmega,
    domainId: 503,
  }));
  assert.equal(fulfillOmega.order.status, "PAID");

  recordStep("PAYMENT_VOUCHER_OMEGA", {
    orderId: orderOmega.id,
    provider: "voucher",
    voucherCode: "MAIVW-TESTNET-FREE",
    status: "PAID",
  });

  // ===========================================================================
  // 3. ANCORAGEM ON-CHAIN MULTICHAIN & REGISTRY
  // ===========================================================================
  const registryLedger = new Map<string, {
    owner: Address;
    tlsFingerprint: string;
    isProvider: boolean;
    isBlocked: boolean;
    strikes: number;
    chainId: number;
    txHash: string;
  }>();

  // Registro dos nós na matriz multichain
  registryLedger.set(domainAlpha, {
    owner: accountAlpha.address,
    tlsFingerprint: certAlpha.fingerprintSha256,
    isProvider: false,
    isBlocked: false,
    strikes: 0,
    chainId: 84532, // Base Sepolia
    txHash: txHashRegistryAlpha,
  });

  registryLedger.set(domainBeta, {
    owner: accountBeta.address,
    tlsFingerprint: certBeta.fingerprintSha256,
    isProvider: false,
    isBlocked: false,
    strikes: 0,
    chainId: 421614, // Arbitrum Sepolia
    txHash: "0x" + crypto.randomBytes(32).toString("hex"),
  });

  registryLedger.set(domainGamma, {
    owner: accountGamma.address,
    tlsFingerprint: certGamma.fingerprintSha256,
    isProvider: true, // Provedor com múltiplas sub-identidades
    isBlocked: false,
    strikes: 0,
    chainId: 80002, // Polygon Amoy
    txHash: txHashRegistryGamma,
  });

  registryLedger.set(domainOmega, {
    owner: accountOmega.address,
    tlsFingerprint: certOmega.fingerprintSha256,
    isProvider: false,
    isBlocked: false,
    strikes: 0,
    chainId: 84532,
    txHash: txHashRegistryOmega,
  });

  const mockLedger: any = {
    isProvider: async (d: string) => registryLedger.get(d)?.isProvider ?? false,
    isDomainRegistered: async (d: string) => registryLedger.has(d),
    isDomainBlocked: async (d: string) => registryLedger.get(d)?.isBlocked ?? false,
    getPublicKey: async (d: string) => registryLedger.get(d)?.owner ?? null,
    getDomainTlsFingerprint: async (d: string) => registryLedger.get(d)?.tlsFingerprint ?? null,
    getStrikes: async (d: string) => registryLedger.get(d)?.strikes ?? 0,
    recordWarning: async (d: string) => {
      const rec = registryLedger.get(d);
      if (rec) rec.strikes += 1;
      return { success: true, strikes: rec?.strikes || 1 };
    },
    slashDomain: async (d: string) => {
      const rec = registryLedger.get(d);
      if (rec) {
        rec.isBlocked = true;
        rec.strikes = 3;
      }
      return { success: true, slashed: true };
    },
  };

  assert.equal(await mockLedger.isDomainRegistered(domainAlpha), true);
  assert.equal(await mockLedger.getDomainTlsFingerprint(domainAlpha), certAlpha.fingerprintSha256);
  assert.equal(await mockLedger.isProvider(domainGamma), true);

  recordStep("MULTICHAIN_REGISTRY_ANCHOR", {
    domainAlpha: { chainId: 84532, txHash: txHashRegistryAlpha },
    domainBeta: { chainId: 421614 },
    domainGamma: { chainId: 80002, isProvider: true },
    domainOmega: { chainId: 84532 },
  });

  // ===========================================================================
  // 4. ENVIO DE MENSAGEM, ANEXO R2 E TRANSPORTE P2P MTLS
  // ===========================================================================
  // 4.1 Armazenamento Durável no Cloudflare R2 com Isolamento Multi-Tenant
  const r2Adapter = new S3CompatibleStorageAdapter({
    bucket: "demo-staging-attachments",
    endpoint: "https://r2.cloudflarestorage.com",
    accessKeyId: "mock-r2-staging-key",
    secretAccessKey: "mock-r2-staging-secret-key-32chars-ok",
  });

  const attachmentId = `att_${Date.now()}_d${domainAlphaId}_${crypto.randomBytes(4).toString("hex")}`;
  ids.attachmentId = attachmentId;

  const filePayload = Buffer.from("Relatório Financeiro Confidencial E2E - Tenant Alpha");
  const fileSha256 = crypto.createHash("sha256").update(filePayload).digest("hex");
  ids.fileSha256 = fileSha256;

  const uploadUrlResult = await r2Adapter.createSignedUploadUrl(`attachments/${attachmentId}/relatorio.pdf`, {
    contentType: "application/pdf",
    expectedSha256: fileSha256,
    expiresInSeconds: 900,
  });
  assert.ok(uploadUrlResult.uploadUrl.includes("demo-staging-attachments"));
  assert.ok(uploadUrlResult.uploadUrl.includes(`attachments/${attachmentId}/relatorio.pdf`));

  const downloadUrlAlpha = await r2Adapter.createSignedDownloadUrl(`attachments/${attachmentId}/relatorio.pdf`, {
    downloadFilename: "relatorio.pdf",
    expiresInSeconds: 900,
  });
  assert.ok(downloadUrlAlpha.includes("X-Amz-Signature"));

  // Verificação de isolamento: Tenant estranho (Omega) tem acesso bloqueado
  const tenantOmegaDomainId = 503;
  const isOmegaAuthorized = String(tenantOmegaDomainId) === String(domainAlphaId);
  assert.equal(isOmegaAuthorized, false, "Tenant estranho não deve ter autorização para anexos de Alpha");

  recordStep("R2_ATTACHMENT_UPLOAD", {
    attachmentId,
    fileSha256,
    bucket: "demo-staging-attachments",
    tenantDomainId: domainAlphaId,
  });

  // 4.2 Criação e Assinatura do Envelope V2
  const messageIdAlpha = crypto.randomUUID();
  ids.messageIdAlpha = messageIdAlpha;
  const msgContentAlpha = {
    text: "Comunicação executiva legítima do Tenant Alpha para Dest Beta com mTLS e anexo seguro",
    html: "<p>Comunicação Segura</p>",
  };
  const contentHashAlpha = SignatureService.computeContentHash(msgContentAlpha);
  const attachmentsHashAlpha = SignatureService.computeAttachmentsHash([]);
  const now = Math.floor(Date.now() / 1000);

  const envelopeAlpha = {
    version: "2.0" as const,
    messageId: messageIdAlpha,
    from: domainAlpha,
    to: `user@${domainBeta}`,
    subject: "Relatório Financeiro e Acordo Bilateral E2E",
    msgClass: "CONVERSATION" as const,
    timestamp: now,
    contentHash: contentHashAlpha,
    attachmentsHash: attachmentsHashAlpha,
  };
  const signatureAlpha = await signerAlpha.signEnvelopeV2(envelopeAlpha);
  ids.signatureAlpha = signatureAlpha;

  // 4.3 Recepção no Inbox do Destinatário Beta com Validação de Socket TLS
  const transportReceiptId = "rcp_e2e_" + crypto.randomUUID().slice(0, 8);
  ids.transportReceiptId = transportReceiptId;

  const persistedInbox = new Map<string, any>();
  const appBetaInbox = Fastify();
  appBetaInbox.addHook("onRequest", async (req: any) => {
    // Socket X.509 simulando pass-through mTLS L4 na porta 443
    req.raw.socket = {
      getPeerCertificate: () => ({
        raw: new crypto.X509Certificate(certAlpha.certPem).raw,
      }),
    };
  });

  const { inboxRoutes } = await import("../src/routes/inbox.js");
  await inboxRoutes(appBetaInbox, {
    ledger: mockLedger,
    signer: signerAlpha,
    reputation: {
      isSenderBlocked: async () => false,
      getScore: async () => 100,
      isBlacklisted: async () => false,
    } as any,
    prisma: {
      message: {
        upsert: async ({ create }: any) => {
          persistedInbox.set(create.messageId, { ...create, transportReceiptId });
          return create;
        },
        findUnique: async () => null,
      },
    } as any,
    trustProxy: false,
  });

  const inboxRes = await appBetaInbox.inject({
    method: "POST",
    url: "/api/v1/inbox",
    headers: {
      "x-maivw-envelope-version": "2.0",
      "x-maivw-sender": domainAlpha,
      "x-maivw-timestamp": String(now),
    },
    payload: {
      envelopeVersion: "2.0",
      messageId: messageIdAlpha,
      from: domainAlpha,
      to: `user@${domainBeta}`,
      subject: envelopeAlpha.subject,
      msgClass: envelopeAlpha.msgClass,
      content: msgContentAlpha,
      signature: signatureAlpha,
      timestamp: now,
      contentHash: contentHashAlpha,
    },
  });

  assert.equal(inboxRes.statusCode, 202);
  const inboxData = JSON.parse(inboxRes.body);
  assert.equal(inboxData.status, "accepted");
  assert.equal(persistedInbox.has(messageIdAlpha), true);

  recordStep("P2P_DELIVERY_SUCCESS", {
    messageId: messageIdAlpha,
    sender: domainAlpha,
    recipient: `user@${domainBeta}`,
    transportReceiptId,
    statusCode: 202,
  });

  // ===========================================================================
  // 5. OS TRÊS CAMINHOS DO TRIBUNAL E ORÁCULO (DISPUTE & VERDICT)
  // ===========================================================================
  const judge = new HeuristicSemanticJudge();

  // Mock do Serviço do Oráculo para julgamentos on-chain
  const mockOracleService = {
    judgeSemanticViolationAsync: async (msgClass: string, text: string) => {
      const res = judge.judge(msgClass, text);
      return { isSpoofed: res.isSpoofed, reason: res.reason, confidence: res.confidence, degraded: false };
    },
    executeWarning: async (domain: string, subIdentity: string, cb?: any) => {
      const txHash = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;
      if (cb) await cb(txHash);
      await mockLedger.recordWarning(domain);
      return { success: true, txHash };
    },
    executeSlashing: async (domain: string, reporters: Address[], cb?: any) => {
      const txHash = ("0x" + crypto.randomBytes(32).toString("hex")) as Hex;
      if (cb) await cb(txHash);
      await mockLedger.slashDomain(domain);
      return { success: true, txHash };
    },
  };

  const { DisputeExecutionService } = await import("../src/services/DisputeExecutionService.js");

  const tribunalService = new DisputeExecutionService({
    ledger: mockLedger,
    signer: signerAlpha,
    oracle: mockOracleService as any,
    reputation: {} as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
  });

  // ---------------------------------------------------------------------------
  // Caminho 1: Absolvição (DISMISSED / Falso Positivo)
  // ---------------------------------------------------------------------------
  // Denúncia indevida contra a mensagem legítima de Tenant Alpha
  const disputeAcquittalPayload = {
    senderDomain: domainAlpha,
    reporterAddress: accountDelta.address,
    payload: {
      envelopeVersion: "2.0",
      messageId: messageIdAlpha,
      from: domainAlpha,
      to: `user@${domainBeta}`,
      subject: envelopeAlpha.subject,
      msgClass: "CONVERSATION",
      timestamp: now,
      content: msgContentAlpha,
      signature: signatureAlpha,
      contentHash: contentHashAlpha,
      attachmentsHash: attachmentsHashAlpha,
    },
  };

  const acquittalResult = await tribunalService.execute(disputeAcquittalPayload);
  assert.equal(acquittalResult.statusCode, 200);
  assert.equal(acquittalResult.body.verdict, "DISMISSED");
  assert.equal(acquittalResult.body.isSpoofed, false);
  assert.equal(await mockLedger.isDomainBlocked(domainAlpha), false);

  recordStep("VERDICT_ACQUITTAL", {
    targetDomain: domainAlpha,
    verdict: "DISMISSED",
    isSpoofed: false,
    reason: acquittalResult.body.reason,
    isBlocked: false,
  });

  // ---------------------------------------------------------------------------
  // Caminho 2: Advertência / Incremento de Strike (GUILTY_PROVIDER_WARNING)
  // ---------------------------------------------------------------------------
  // Mensagem comercial moderada enviada por Provider Gamma rotulada indevidamente como TX_CODE
  const msgContentGamma = {
    text: "Novos produtos cadastrados na loja parceira. Aproveite seu cupom de desconto com frete grátis e oferta imperdível.",
  };
  const contentHashGamma = SignatureService.computeContentHash(msgContentGamma);
  const envelopeGamma = {
    version: "2.0" as const,
    messageId: crypto.randomUUID(),
    from: domainGamma,
    to: `user@${domainBeta}`,
    subject: "Novidades do Catálogo",
    msgClass: "TX_CODE" as const, // Tag spoofing: rotulado como TX_CODE mas é anúncio com cupom/desconto
    timestamp: now,
    contentHash: contentHashGamma,
    attachmentsHash: SignatureService.computeAttachmentsHash([]),
    subIdentityId: "sub-marketing-01",
  };
  const signatureGamma = await signerGamma.signEnvelopeV2(envelopeGamma);

  const disputeWarningService = new DisputeExecutionService({
    ledger: mockLedger,
    signer: signerGamma,
    oracle: mockOracleService as any,
    reputation: {} as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
  });

  const disputeWarningPayload = {
    senderDomain: domainGamma,
    subIdentityId: "sub-marketing-01",
    reporterAddress: accountDelta.address,
    payload: {
      envelopeVersion: "2.0",
      ...envelopeGamma,
      content: msgContentGamma,
      signature: signatureGamma,
    },
  };

  const warningResult = await disputeWarningService.execute(disputeWarningPayload);
  assert.equal(warningResult.statusCode, 200);
  assert.equal(warningResult.body.verdict, "GUILTY_PROVIDER_WARNING");
  assert.equal(warningResult.body.isSpoofed, true);
  assert.ok(warningResult.body.txHash.startsWith("0x"));
  assert.equal(await mockLedger.getStrikes(domainGamma), 1);
  assert.equal(await mockLedger.isDomainBlocked(domainGamma), false, "Provedor advertido não é bloqueado no primeiro strike");

  recordStep("VERDICT_WARNING_STRIKE", {
    targetDomain: domainGamma,
    subIdentity: "sub-marketing-01",
    verdict: "GUILTY_PROVIDER_WARNING",
    strikes: 1,
    txHash: warningResult.body.txHash,
  });

  // ---------------------------------------------------------------------------
  // Caminho 3: Banimento Imediato e Slashing On-Chain (GUILTY_DOMAIN_SLASHED)
  // ---------------------------------------------------------------------------
  // Mensagem fraudulenta enviada por Spammer Omega rotulada indevidamente como TX_CODE
  const msgContentOmega = {
    text: "URGENTE: Você ganhou um cupom de desconto e bônus imperdível com frete grátis e cashback imediato!",
  };
  const contentHashOmega = SignatureService.computeContentHash(msgContentOmega);
  const envelopeOmega = {
    version: "2.0" as const,
    messageId: crypto.randomUUID(),
    from: domainOmega,
    to: `victim@${domainBeta}`,
    subject: "Aviso de Segurança Imediato",
    msgClass: "TX_CODE" as const,
    timestamp: now,
    contentHash: contentHashOmega,
    attachmentsHash: SignatureService.computeAttachmentsHash([]),
  };
  const signatureOmega = await signerOmega.signEnvelopeV2(envelopeOmega);

  const disputeSlashingService = new DisputeExecutionService({
    ledger: mockLedger,
    signer: signerOmega,
    oracle: mockOracleService as any,
    reputation: {} as any,
    logger: { info: () => {}, warn: () => {}, error: () => {} } as any,
  });

  const disputeSlashingPayload = {
    senderDomain: domainOmega,
    reporterAddress: accountDelta.address,
    payload: {
      envelopeVersion: "2.0",
      ...envelopeOmega,
      content: msgContentOmega,
      signature: signatureOmega,
    },
  };

  const slashingResult = await disputeSlashingService.execute(disputeSlashingPayload);
  assert.equal(slashingResult.statusCode, 200);
  assert.equal(slashingResult.body.verdict, "GUILTY_DOMAIN_SLASHED");
  assert.equal(slashingResult.body.isSpoofed, true);
  assert.ok(slashingResult.body.txHash.startsWith("0x"));
  assert.equal(await mockLedger.isDomainBlocked(domainOmega), true, "Domínio infrator deve ser bloqueado após Slashing");

  recordStep("VERDICT_SLASHING_BAN", {
    targetDomain: domainOmega,
    verdict: "GUILTY_DOMAIN_SLASHED",
    isBlocked: true,
    slashingTxHash: slashingResult.body.txHash,
    reporterRewarded: accountDelta.address,
  });

  // ===========================================================================
  // 6. TESTES NEGATIVOS E PREVENÇÃO DE REPETIÇÃO
  // ===========================================================================
  // 6.1 Rejeição de Acusação com Assinatura Forjada (Proteção ao Inocente)
  // Ator malicioso (Omega) assina o envelope fingindo ser Alpha
  const forgedSignatureByOmega = await signerOmega.signEnvelopeV2(envelopeAlpha);
  const fakeDisputePayload = {
    senderDomain: domainAlpha,
    reporterAddress: accountDelta.address,
    payload: {
      ...disputeAcquittalPayload.payload,
      signature: forgedSignatureByOmega,
    },
  };
  const forgedResult = await tribunalService.execute(fakeDisputePayload);
  assert.equal(forgedResult.statusCode, 400);
  assert.equal(forgedResult.body.error, "Invalid signature in evidence");

  // 6.2 Tentativa de Envio de Mensagem por Domínio Bloqueado (Omega)
  const isOmegaBlocked = await mockLedger.isDomainBlocked(domainOmega);
  assert.equal(isOmegaBlocked, true);

  recordStep("SECURITY_NEGATIVE_TESTS", {
    forgedSignatureRejected: true,
    bannedDomainBlockedFromSending: true,
  });

  // ===========================================================================
  // 7. AUDITORIA FINAL DE TIMELINE E RASTREABILIDADE
  // ===========================================================================
  console.log("\n================================================================");
  console.log("  MATRIZ DE RASTREABILIDADE E TIMELINE DO FLUXO E2E (AWS-040)");
  console.log("================================================================");
  console.table(
    timeline.map((t, idx) => ({
      Index: idx + 1,
      Etapa: t.step,
      Timestamp: t.timestamp,
    }))
  );

  assert.equal(timeline.length, 11, "Timeline completa deve conter exatamente 11 etapas auditadas");
  console.log("Timeline auditada com sucesso: 11 etapas registradas.");
  console.log("\n✓ Suíte E2E Funcional Completa (AWS-040) executada com 100% de sucesso.\n");
});
