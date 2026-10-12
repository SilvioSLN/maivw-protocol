import { healthRoutes } from "./routes/health.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { PrismaClient } from "@prisma/client";
import { loadConfig } from "./config.js";
import { LedgerService } from "./services/LedgerService.js";
import { SignatureService } from "./services/SignatureService.js";
import { SmtpService } from "./services/SmtpService.js";
import { OracleService } from "./services/OracleService.js";
import { ReputationService } from "./services/ReputationService.js";
import { KeyManagementService } from "./services/KeyManagementService.js";
import { sendRoutes } from "./routes/send.js";
import { inboxRoutes } from "./routes/inbox.js";
import { disputeRoutes } from "./routes/dispute.js";
import { authRoutes } from "./routes/auth.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { settingsRoutes } from "./routes/settings.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { economicsRoutes } from "./routes/economics.js";
import { oracleRoutes } from "./routes/oracle.js";
import { stealthRoutes } from "./routes/stealth.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { contactsRoutes } from "./routes/contacts.js";
import { multiChainRoutes } from "./routes/multichain.js";
import { routingRoutes } from "./routes/routing.js";
import { nodeRoutes } from "./routes/node.js";
import { EventListenerService } from "./services/EventListenerService.js";
import { StealthRoutingService } from "./services/StealthRoutingService.js";
import { OracleReportService } from "./services/OracleReportService.js";
import { RoutingPoolService } from "./services/RoutingPoolService.js";

// ============================================
//  Configuration
// ============================================
const config = loadConfig();

// ============================================
//  Services & Database
// ============================================
const prisma = new PrismaClient();
const kms = new KeyManagementService(prisma, config.MASTER_SECRET_KEY);
const ledger = new LedgerService(config);
const defaultSignerKey = (config.COMPANY_A_PRIVATE_KEY || generatePrivateKey()) as Hex;
const signer = new SignatureService(defaultSignerKey);
const smtp = new SmtpService(config.RESEND_API_KEY, prisma, config.MASTER_SECRET_KEY);
const reputation = new ReputationService();
const oracle = await OracleService.create(config, ledger);
const oracleReportService = new OracleReportService();
const eventListener = new EventListenerService(ledger, prisma);
eventListener.start();
const stealth = new StealthRoutingService(prisma);
const routingPool = new RoutingPoolService(prisma, config.REDIS_URL);
await routingPool.start();

// ============================================
//  Fastify App
// ============================================
const app = Fastify({
  logger: {
    level: "info",
  },
});

// ============================================
//  Register CORS
// ============================================
await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  credentials: true,
  maxAge: 86400,
  preflight: true,
  strictPreflight: false,
});

// ============================================
//  Health Check
// ============================================
await healthRoutes(app, {
  checks: {
    blockchain: () => ledger.checkBlockchainHealth(),
    redis: () => routingPool.checkRedisHealth(),
    database: () => prisma.$queryRaw`SELECT 1`,
  },
  oracleBalance: () => oracle.getBalance(),
  oracleMinBalance: config.ORACLE_MIN_BALANCE_WEI,
  metadata: () => ({
    smtp: smtp.getProviderInfo(),
    oracle: oracle.getOracleAddress(),
    oracleSignerType: oracle.getSignerType(),
    contractAddress: config.REGISTRY_CONTRACT_ADDRESS || "not deployed",
  }),
});

// ============================================
//  API Status
// ============================================
app.get("/api/v1/status", async () => {
  const totalRegistered = await ledger.getTotalRegistered();
  const smtpInfo = smtp.getProviderInfo();
  return {
    message: "MAIVW Gateway is running",
    version: "0.4.0",
    senderDomain: config.SENDER_DOMAIN,
    signerAddress: signer.address,
    oracleAddress: oracle.getOracleAddress(),
    contractAddress: config.REGISTRY_CONTRACT_ADDRESS || "not deployed",
    totalRegisteredDomains: totalRegistered,
    smtp: smtpInfo,
  };
});

// ============================================
//  Companies API — Whois Criptográfico sob demanda
// ============================================
app.get("/api/v1/companies/stats", async () => {
  try {
    const total = await ledger.getTotalRegistered();
    return { totalRegistered: total, estimatedStake: `${total * 1} ETH` };
  } catch (err) {
    return { totalRegistered: 0, estimatedStake: "0 ETH" };
  }
});

app.get("/api/v1/companies/:domain", async (request, reply) => {
  const { domain } = request.params as { domain: string };
  const cleanDomain = domain ? domain.toLowerCase().trim() : "";

  if (!cleanDomain || cleanDomain.length < 3) {
    return reply.status(400).send({ error: "Domínio inválido para consulta" });
  }

  try {
    const profile = await ledger.getCompanyProfile(cleanDomain);
    if (!profile) {
      return {
        registered: false,
        domain: cleanDomain,
      };
    }

    const rep = await reputation.getReputation(cleanDomain);

    return {
      registered: true,
      domain: cleanDomain,
      company: {
        domain: profile.domain || cleanDomain,
        endpointUrl: profile.endpointUrl,
        publicKey: profile.publicKey,
        adminKey: profile.adminKey,
        registrationTime: Number(profile.registrationTime),
        isProvider: Boolean(profile.isProvider),
        isActive: Boolean(profile.isActive),
        strikeCount: Number(profile.strikeCount || 0),
        status: typeof (profile as any).status === "number" ? (profile as any).status : (profile.isActive ? 1 : 2),
      },
      reputation: rep,
    };
  } catch (error: any) {
    app.log.error(error, `[WHOIS] Erro ao consultar domínio ${cleanDomain}`);
    return reply.status(500).send({ error: "Falha ao consultar registro na blockchain" });
  }
});

app.get("/api/v1/companies", async () => {
  // Rota leve retrocompatível: retorna métricas sem disparar loop de 100 chamadas RPC
  const total = await ledger.getTotalRegistered();
  return { totalRegistered: total, companies: [] };
});

// ============================================
//  Reputation Query API (Fase 7)
// ============================================
app.get("/api/v1/reputation/:domain", async (request, reply) => {
  const { domain } = request.params as { domain: string };
  const query = request.query as { subIdentityId?: string };
  const rep = await reputation.getReputation(domain, query.subIdentityId);
  return { domain, subIdentityId: query.subIdentityId || "default", reputation: rep };
});

// ============================================
//  Routes
// ============================================
await sendRoutes(app, {
  ledger,
  signer,
  smtp,
  senderDomain: config.SENDER_DOMAIN,
  prisma,
  kms,
  eventListener,
  stealth,
  routingPool,
  config,
});

await inboxRoutes(app, {
  ledger,
  signer,
  reputation,
  prisma,
  stealth,
  routingPool,
  trustProxy: config.TRUST_PROXY,
});

await disputeRoutes(app, {
  ledger,
  signer,
  oracle,
  reputation,
  reportService: oracleReportService,
});

await authRoutes(app, {
  registrationToken: config.ADMIN_REGISTRATION_TOKEN,
  prisma,
  kms,
  smtp,
});

await webhookRoutes(app, {
  prisma,
  webhookSecret: config.LEGACY_WEBHOOK_SECRET,
});

await settingsRoutes(app, {
  prisma,
  smtp,
  masterKey: config.MASTER_SECRET_KEY,
  ledger,
  config,
});

await onboardingRoutes(app, {
  prisma,
  kms,
  oracle,
  ledger,
  config,
});

await economicsRoutes(app, {
  ledger,
  prisma,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

await oracleRoutes(app, {
  oracle,
  ledger,
  reportService: oracleReportService,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

await stealthRoutes(app, {
  stealth,
  ledger,
  prisma,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

await attachmentRoutes(app, {
  prisma,
  kms,
});

await contactsRoutes(app, {
  prisma,
  jwtSecret: config.JWT_SECRET,
});

await multiChainRoutes(app, {
  ledger,
  oracle,
  prisma,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

await routingRoutes(app, {
  prisma,
  routingPool,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

await nodeRoutes(app, {
  ledger,
  signer,
  reputation,
  prisma,
  config,
});

// ============================================
//  Start Server
// ============================================
const PORT = config.GATEWAY_PORT;
const HOST = config.GATEWAY_HOST;

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║   🚀 MAIVW Gateway v0.4.0 — Email Real + Auth      ║
  ║   📡 http://${HOST}:${PORT}                          ║
  ║                                                      ║
  ║   Auth:                                              ║
  ║   POST /api/v1/auth/register   → Cadastro Admin      ║
  ║   POST /api/v1/auth/login      → Login JWT            ║
  ║   GET  /api/v1/auth/me         → Dados do Usuário     ║
  ║   POST /api/v1/auth/accounts   → Criar Conta Email    ║
  ║                                                      ║
  ║   Email:                                             ║
  ║   POST /api/v1/send            → Envio Real/P2P      ║
  ║   POST /api/v1/inbox           → Recepção P2P        ║
  ║   GET  /api/v1/inbox/messages  → Caixa de Entrada    ║
  ║   POST /api/v1/webhooks/inbound-legacy → SMTP In     ║
  ║                                                      ║
  ║   Config:                                            ║
  ║   GET/PUT /api/v1/settings/smtp → Config Provedor    ║
  ║   POST /api/v1/settings/smtp/test → Teste Conexão   ║
  ║   POST /api/v1/dispute         → Tribunal IA         ║
  ╚══════════════════════════════════════════════════════╝
  `);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
