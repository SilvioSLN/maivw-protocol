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
import { OriginCatalogService } from "./multichain/OriginCatalog.js";
import { MultichainRelayJobService, PrismaRelayJobRepository } from "./multichain/MultichainRelayJob.js";
import { MultichainMirrorJobCoordinator } from "./multichain/MultichainMirrorJobs.js";
import { createConfiguredLedgerAdapters } from "./services/ledger/LedgerAdapterFactory.js";
import { createAttestationSigner } from "./multichain/AttestationSigner.js";
import { OriginReservationService, QuorumDnsTxtVerifier } from "./multichain/OriginReservation.js";
import { OriginOnboardingCoordinator } from "./multichain/OriginOnboarding.js";
import type { SolanaNetworkDefinition } from "./multichain/NetworkModel.js";
import { SolanaRegistryIndexer, Web3SolanaIndexerClient } from "./multichain/SolanaRegistryIndexer.js";
import { MultichainTelemetry } from "./multichain/MultichainTelemetry.js";
import { MultichainAlertCollector, MultichainAlertService } from "./multichain/MultichainAlerts.js";
import { hasLoop, hasQueue, hasRouteGroup, runtimeProfile } from "./runtime/roles.js";
import { GracefulShutdownManager } from "./runtime/shutdown.js";
import { TlsCertService } from "./services/TlsCertService.js";
import {
  closeAllQueues,
  pauseAllQueues,
  drainQueues,
  getActiveJobsCount,
  listQueues,
  createJobQueue,
  DEFAULT_QUEUE_POLICIES,
  STANDARD_QUEUES,
  type MailSendJobData,
  type OracleDisputeJobData,
  type RelayerMirrorJobData,
} from "./queue/index.js";

// ============================================
//  Configuration
// ============================================
const config = loadConfig();
const profile = runtimeProfile(config.MAIVW_RUNTIME_ROLE);

const p2pTlsCredentials = profile.role === "p2p-ingress"
  ? TlsCertService.getOrProvisionNodeCredentials({
      certPath: config.TLS_CERT_PATH,
      keyPath: config.TLS_KEY_PATH,
      domain: config.SENDER_DOMAIN,
    })
  : null;
const app = Fastify({
  logger: { level: "info" },
  ...(p2pTlsCredentials ? {
    https: {
      cert: p2pTlsCredentials.certPem,
      key: p2pTlsCredentials.keyPem,
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2" as const,
    },
  } : {}),
});
const multichainTelemetry = new MultichainTelemetry(app.log);

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`${name} não foi inicializado para ${profile.role}`);
  return value;
}

// ============================================
//  Services & Database
// ============================================
const prisma = new PrismaClient();
const ledger = new LedgerService(config, createConfiguredLedgerAdapters(config));
const gatewayApiEnabled = hasRouteGroup(profile, "gateway-api");
const p2pIngressEnabled = hasRouteGroup(profile, "p2p-ingress");
const mailWorkerEnabled = hasRouteGroup(profile, "mail-worker");
const oracleWorkerEnabled = hasRouteGroup(profile, "oracle-worker");
const relayerWorkerEnabled = hasRouteGroup(profile, "relayer-worker");
const needsSigner = gatewayApiEnabled || p2pIngressEnabled || mailWorkerEnabled || oracleWorkerEnabled;
const needsSmtp = gatewayApiEnabled || mailWorkerEnabled;
const needsKms = gatewayApiEnabled || mailWorkerEnabled;
const needsReputation = gatewayApiEnabled || p2pIngressEnabled || oracleWorkerEnabled;
const needsOracle = gatewayApiEnabled || oracleWorkerEnabled || relayerWorkerEnabled;
const needsRouting = gatewayApiEnabled || p2pIngressEnabled || mailWorkerEnabled || hasLoop(profile, "routing-health");
const needsStealth = gatewayApiEnabled || p2pIngressEnabled || mailWorkerEnabled;

const kms = needsKms ? new KeyManagementService(prisma, config.MASTER_SECRET_KEY) : undefined;
const signer = needsSigner
  ? new SignatureService((config.COMPANY_A_PRIVATE_KEY || generatePrivateKey()) as Hex)
  : undefined;
const smtp = needsSmtp ? new SmtpService(
  config.RESEND_API_KEY,
  prisma,
  config.MASTER_SECRET_KEY,
  config.SES_ENABLED ? {
    region: config.SES_REGION,
    configurationSet: config.SES_CONFIGURATION_SET,
    fromEmail: config.SES_FROM_EMAIL,
  } : undefined,
) : undefined;
const reputation = needsReputation ? new ReputationService() : undefined;
const oracle = needsOracle ? await OracleService.create(config, ledger) : undefined;
const oracleReportService = oracleWorkerEnabled ? new OracleReportService() : undefined;
const eventListener = hasLoop(profile, "evm-indexer") ? new EventListenerService(ledger, prisma) : undefined;
const stealth = needsStealth ? new StealthRoutingService(prisma) : undefined;
const routingPool = needsRouting ? new RoutingPoolService(prisma, config.REDIS_URL) : undefined;
if (routingPool) {
  await routingPool.start({
    runHealthChecks: hasLoop(profile, "routing-health"),
    failFast: config.MAIVW_ENVIRONMENT !== "local",
  });
}
if (eventListener) eventListener.start();

const originCatalog = relayerWorkerEnabled ? new OriginCatalogService(prisma) : undefined;
const relayJobs = relayerWorkerEnabled
  ? new MultichainRelayJobService(new PrismaRelayJobRepository(prisma))
  : undefined;
const mirrorJobs = originCatalog && relayJobs
  ? new MultichainMirrorJobCoordinator(originCatalog, ledger, relayJobs)
  : undefined;
const solanaOriginNetwork = ledger.listAdapters()
  .map((adapter) => adapter.network)
  .find((network): network is SolanaNetworkDefinition => network.family === "SOLANA" && network.capabilities.origin);
const originOnboarding = gatewayApiEnabled && solanaOriginNetwork && solanaOriginNetwork.asset.kind === "SPL"
  ? new OriginOnboardingCoordinator(
      new OriginReservationService(
        prisma,
        new QuorumDnsTxtVerifier(),
        await createAttestationSigner(config, undefined, (error) => {
          if (config.ORACLE_SIGNER_TYPE === "gcp-kms" || config.ORACLE_SIGNER_TYPE === "aws-kms") {
            multichainTelemetry.record("kms.failed", {}, {
              signerType: config.ORACLE_SIGNER_TYPE,
              errorType: error instanceof Error ? error.name : "UnknownError",
            }, "error");
          }
        }),
      ),
      [{ network: solanaOriginNetwork, standardFee: config.SOLANA_STANDARD_FEE_BASE_UNITS }],
    )
  : undefined;

const multichainAlerts = relayerWorkerEnabled ? new MultichainAlertService() : undefined;
const multichainAlertCollector = relayerWorkerEnabled
  ? new MultichainAlertCollector(prisma, multichainTelemetry, config.MULTICHAIN_ALERT_INDEXER_LAG_SLOTS)
  : undefined;
let solanaIndexer: SolanaRegistryIndexer | undefined;
if (hasLoop(profile, "solana-indexer") && config.SOLANA_ENABLED
  && solanaOriginNetwork && config.SOLANA_RPC_URL && config.SOLANA_PROGRAM_ID) {
  const indexerClient = new Web3SolanaIndexerClient(config.SOLANA_RPC_URL);
  solanaIndexer = new SolanaRegistryIndexer(prisma, indexerClient, indexerClient, {
    networkId: solanaOriginNetwork.networkId,
    programId: config.SOLANA_PROGRAM_ID,
    commitment: "finalized",
    startSlot: config.SOLANA_OBSERVER_START_SLOT,
    pageSize: config.SOLANA_OBSERVER_PAGE_SIZE,
    maxPagesPerPoll: config.SOLANA_OBSERVER_MAX_PAGES,
  });
  solanaIndexer.start(config.SOLANA_OBSERVER_POLL_INTERVAL_MS, (error) => {
    multichainTelemetry.record("solana.indexer.failed", { networkId: solanaOriginNetwork.networkId }, { error }, "error");
    app.log.error({ error }, "Solana Registry indexer poll failed");
  }, (result) => {
    multichainTelemetry.record("solana.indexer.polled", { networkId: solanaOriginNetwork.networkId }, {
      observedSlot: result.observedSlot, transactions: result.persistedTransactions, events: result.persistedEvents,
    });
  });
}
const activeLoops = profile.loops.filter((loop) => loop !== "solana-indexer" || solanaIndexer !== undefined);

// ============================================
//  Durable Queues & Asynchronous Workers
// ============================================
if (hasQueue(profile, STANDARD_QUEUES.MAIL_SEND)) {
  const mailQueue = createJobQueue<MailSendJobData>(STANDARD_QUEUES.MAIL_SEND, {
    driver: config.QUEUE_DRIVER,
    redisUrl: config.REDIS_URL,
    defaultRetry: DEFAULT_QUEUE_POLICIES[STANDARD_QUEUES.MAIL_SEND],
  });
  mailQueue.process(async (job) => {
    app.log.info({ jobId: job.id, recipient: job.data.recipient }, "Processing queued mail dispatch");
    return { delivered: true, timestamp: new Date().toISOString() };
  }, { concurrency: config.QUEUE_CONCURRENCY });
}

if (hasQueue(profile, STANDARD_QUEUES.ORACLE_DISPUTE)) {
  const oracleQueue = createJobQueue<OracleDisputeJobData>(STANDARD_QUEUES.ORACLE_DISPUTE, {
    driver: config.QUEUE_DRIVER,
    redisUrl: config.REDIS_URL,
    defaultRetry: DEFAULT_QUEUE_POLICIES[STANDARD_QUEUES.ORACLE_DISPUTE],
  });
  oracleQueue.process(async (job) => {
    app.log.info({ jobId: job.id, senderDomain: job.data.senderDomain }, "Processing queued oracle dispute evaluation");
    return { evaluated: true, timestamp: new Date().toISOString() };
  }, { concurrency: config.QUEUE_CONCURRENCY });
}

if (hasQueue(profile, STANDARD_QUEUES.RELAYER_MIRROR)) {
  const relayerQueue = createJobQueue<RelayerMirrorJobData>(STANDARD_QUEUES.RELAYER_MIRROR, {
    driver: config.QUEUE_DRIVER,
    redisUrl: config.REDIS_URL,
    defaultRetry: DEFAULT_QUEUE_POLICIES[STANDARD_QUEUES.RELAYER_MIRROR],
  });
  relayerQueue.process(async (job) => {
    app.log.info({ jobId: job.id, domain: job.data.domain }, "Processing queued multichain relay mirror");
    return { mirrored: true, timestamp: new Date().toISOString() };
  }, { concurrency: config.QUEUE_CONCURRENCY });
}

const shutdownManager = new GracefulShutdownManager({
  app,
  pauseQueues: async () => {
    await pauseAllQueues();
  },
  drainJobs: async (jobDrainTimeoutMs) => {
    return await drainQueues(jobDrainTimeoutMs);
  },
  closeQueues: async () => {
    await closeAllQueues();
  },
  stopLoops: () => {
    solanaIndexer?.stop();
    eventListener?.stop();
    routingPool?.destroy();
  },
  disconnectPrisma: async () => {
    await prisma.$disconnect();
  },
  log: app.log,
}, {
  timeoutMs: config.GRACEFUL_SHUTDOWN_TIMEOUT_MS,
});

if (process.env.NODE_ENV !== "test") {
  shutdownManager.bindSignals(["SIGTERM", "SIGINT"]);
}

app.addHook("onClose", async () => {
  if (!shutdownManager.isShuttingDown()) {
    await pauseAllQueues();
    await drainQueues(3000);
    await closeAllQueues();
    solanaIndexer?.stop();
    eventListener?.stop();
    routingPool?.destroy();
    await prisma.$disconnect();
  }
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
const roleNeedsBlockchain = profile.role === "all-in-one"
  || profile.role === "gateway-api"
  || profile.role === "oracle-worker"
  || profile.role === "relayer-worker"
  || profile.role === "evm-indexer"
  || profile.role === "solana-indexer";

await healthRoutes(app, {
  service: "maivw-gateway",
  role: profile.role,
  activeComponents: [...profile.routeGroups, ...activeLoops, ...profile.queues],
  checks: {
    ...(roleNeedsBlockchain ? {
      blockchain: () => profile.role === "solana-indexer" && solanaOriginNetwork
        ? ledger.checkNetworkHealth(solanaOriginNetwork.networkId)
        : ledger.checkBlockchainHealth(),
    } : {}),
    database: () => prisma.$queryRaw`SELECT 1`,
    ...(routingPool ? { redis: () => routingPool.checkRedisHealth() } : {}),
  },
  isShuttingDown: () => shutdownManager.isShuttingDown(),
  getDiagnostics: async () => {
    const queueMetrics: Record<string, unknown> = {};
    for (const q of listQueues()) {
      try {
        queueMetrics[q.name] = await q.getMetrics();
      } catch {
        queueMetrics[q.name] = "error";
      }
    }
    return {
      activeJobs: await getActiveJobsCount(),
      queues: queueMetrics,
      lifecycle: shutdownManager.getStatus(),
    };
  },
  oracleBalance: oracle ? () => oracle.getBalance() : undefined,
  oracleMinBalance: config.ORACLE_MIN_BALANCE_WEI,
  metadata: () => ({
    smtp: smtp?.getProviderInfo() ?? null,
    oracle: oracle?.getOracleAddress() ?? null,
    oracleSignerType: oracle?.getSignerType() ?? null,
    contractAddress: config.REGISTRY_CONTRACT_ADDRESS || "not deployed",
  }),
});

// ============================================
//  API Status
// ============================================
if (gatewayApiEnabled) {
app.get("/api/v1/status", async () => {
  const totalRegistered = await ledger.getTotalRegistered();
  const smtpInfo = required(smtp, "SmtpService").getProviderInfo();
  return {
    message: "MAIVW Gateway is running",
    version: "0.4.0",
    senderDomain: config.SENDER_DOMAIN,
    signerAddress: required(signer, "SignatureService").address,
    oracleAddress: required(oracle, "OracleService").getOracleAddress(),
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

    const rep = await required(reputation, "ReputationService").getReputation(cleanDomain);

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
  const rep = await required(reputation, "ReputationService").getReputation(domain, query.subIdentityId);
  return { domain, subIdentityId: query.subIdentityId || "default", reputation: rep };
});
}

// ============================================
//  Routes
// ============================================
if (mailWorkerEnabled) await sendRoutes(app, {
  ledger,
  signer: required(signer, "SignatureService"),
  smtp: required(smtp, "SmtpService"),
  senderDomain: config.SENDER_DOMAIN,
  prisma,
  kms: required(kms, "KeyManagementService"),
  eventListener,
  stealth: required(stealth, "StealthRoutingService"),
  routingPool: required(routingPool, "RoutingPoolService"),
  config,
});

if (p2pIngressEnabled) await inboxRoutes(app, {
  ledger,
  signer: required(signer, "SignatureService"),
  reputation: required(reputation, "ReputationService"),
  prisma,
  stealth: required(stealth, "StealthRoutingService"),
  routingPool: required(routingPool, "RoutingPoolService"),
  trustProxy: config.TRUST_PROXY,
});

if (oracleWorkerEnabled) await disputeRoutes(app, {
  ledger,
  signer: required(signer, "SignatureService"),
  oracle: required(oracle, "OracleService"),
  reputation: required(reputation, "ReputationService"),
  reportService: required(oracleReportService, "OracleReportService"),
});

if (gatewayApiEnabled) await authRoutes(app, {
  registrationToken: config.ADMIN_REGISTRATION_TOKEN,
  prisma,
  kms: required(kms, "KeyManagementService"),
  smtp: required(smtp, "SmtpService"),
});

if (gatewayApiEnabled) await webhookRoutes(app, {
  prisma,
  webhookSecret: config.LEGACY_WEBHOOK_SECRET,
});

if (gatewayApiEnabled) await settingsRoutes(app, {
  prisma,
  smtp: required(smtp, "SmtpService"),
  masterKey: config.MASTER_SECRET_KEY,
  ledger,
  config,
});

if (gatewayApiEnabled) await onboardingRoutes(app, {
  prisma,
  kms: required(kms, "KeyManagementService"),
  oracle: required(oracle, "OracleService"),
  ledger,
  config,
  originOnboarding,
  telemetry: multichainTelemetry,
});

if (gatewayApiEnabled) await economicsRoutes(app, {
  ledger,
  prisma,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

if (oracleWorkerEnabled) await oracleRoutes(app, {
  oracle: required(oracle, "OracleService"),
  ledger,
  reportService: required(oracleReportService, "OracleReportService"),
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

if (gatewayApiEnabled) await stealthRoutes(app, {
  stealth: required(stealth, "StealthRoutingService"),
  ledger,
  prisma,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

if (gatewayApiEnabled) await attachmentRoutes(app, {
  prisma,
  kms: required(kms, "KeyManagementService"),
});

if (gatewayApiEnabled) await contactsRoutes(app, {
  prisma,
  jwtSecret: config.JWT_SECRET,
});

if (relayerWorkerEnabled) await multiChainRoutes(app, {
  ledger,
  oracle: required(oracle, "OracleService"),
  prisma,
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
  mirrorJobs: required(mirrorJobs, "MultichainMirrorJobCoordinator"),
  telemetry: multichainTelemetry,
  alertService: required(multichainAlerts, "MultichainAlertService"),
  alertCollector: required(multichainAlertCollector, "MultichainAlertCollector"),
});

if (gatewayApiEnabled) await routingRoutes(app, {
  prisma,
  routingPool: required(routingPool, "RoutingPoolService"),
  internalServiceKey: config.INTERNAL_SERVICE_KEY,
});

if (gatewayApiEnabled) await nodeRoutes(app, {
  ledger,
  signer: required(signer, "SignatureService"),
  reputation: required(reputation, "ReputationService"),
  prisma,
  config,
});

// ============================================
//  Start Server
// ============================================
const PORT = profile.role === "p2p-ingress" ? config.P2P_PORT : config.GATEWAY_PORT;
const HOST = config.GATEWAY_HOST;
const protocol = profile.role === "p2p-ingress" ? "https" : "http";

try {
  await app.listen({ port: PORT, host: HOST });
  shutdownManager.setReady();
  app.log.info({
    role: profile.role,
    routeGroups: profile.routeGroups,
    loops: activeLoops,
    queues: profile.queues,
    address: `${protocol}://${HOST}:${PORT}`,
  }, "MAIVW runtime started");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app, shutdownManager };
