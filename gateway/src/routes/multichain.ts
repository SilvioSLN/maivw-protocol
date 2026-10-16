import type { FastifyInstance } from "fastify";
import type { LedgerService } from "../services/LedgerService.js";
import type { OracleService } from "../services/OracleService.js";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getActiveAdmin } from "./auth.js";
import { OriginCatalogService } from "../multichain/OriginCatalog.js";
import { MultichainStatusService } from "../multichain/MultichainStatus.js";
import type { MultichainMirrorJobCoordinator } from "../multichain/MultichainMirrorJobs.js";
import { MultichainJobQuery } from "../multichain/MultichainJobQuery.js";
import { MultichainTimelineService } from "../multichain/MultichainTimeline.js";
import { catalogDomainHash } from "../multichain/OriginCatalog.js";
import {
  CanonicalDomainSchema,
  MirrorJobRequestBodySchema,
  invalidMultichainRequest,
  multichainApiError,
  multichainErrorBody,
} from "../multichain/MultichainApiSchema.js";

interface MultiChainRouteOptions {
  ledger: LedgerService;
  oracle: OracleService;
  prisma: PrismaClient;
  internalServiceKey?: string;
  multichainStatus?: MultichainStatusService;
  mirrorJobs?: MultichainMirrorJobCoordinator;
  jobQuery?: MultichainJobQuery;
  timeline?: MultichainTimelineService;
}

export async function multiChainRoutes(app: FastifyInstance, options: MultiChainRouteOptions) {
  const { ledger, oracle, prisma } = options;
  const multichainStatus = options.multichainStatus
    ?? new MultichainStatusService(new OriginCatalogService(prisma), ledger);
  const jobQuery = options.jobQuery ?? new MultichainJobQuery(prisma);
  const timeline = options.timeline ?? new MultichainTimelineService(prisma);

  /**
   * GET /api/v1/multichain/networks
   * Retorna a lista de redes suportadas pelo protocolo MAIVW e parâmetros de espelhamento
   */
  app.get("/api/v1/multichain/networks", async () => {
    const networks = await ledger.getMultichainNetworks();
    return {
      success: true,
      networks,
    };
  });

  /**
   * GET /api/v1/multichain/status/:domain
   * Retorna o status de presença multi-chain de um domínio
   */
  app.get("/api/v1/multichain/status/:domain", async (request, reply) => {
    const { domain } = request.params as { domain: string };
    const parsedDomain = CanonicalDomainSchema.safeParse(domain);
    if (!parsedDomain.success) {
      const error = invalidMultichainRequest("Domínio inválido");
      return reply.status(error.statusCode).send(multichainErrorBody(error));
    }

    try {
      const status = await multichainStatus.get(parsedDomain.data);
      return {
        success: true,
        ...status,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao consultar status multi-chain do domínio",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/multichain/attest-mirror
   * Gera a prova criptográfica do Oráculo para autorizar o registro do espelho on-chain
   */
  app.post("/api/v1/multichain/attest-mirror", async (request, reply) => {
    const parsed = MirrorJobRequestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const error = invalidMultichainRequest();
      return reply.status(error.statusCode).send(multichainErrorBody(error));
    }
    const body = parsed.data;

    const cleanDomain = body.domain.toLowerCase().trim();
    if (!request.headers.authorization?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Autenticação obrigatória" });
    }
    const admin = await getActiveAdmin(request, prisma);
    if (!admin) return reply.status(403).send({ error: "Administrador existente obrigatório" });
    const ownedDomain = await prisma.domain.findFirst({
      where: { domainName: cleanDomain, userId: admin.id, isVerified: true },
    });
    if (!ownedDomain) return reply.status(404).send({ error: "Domínio verificado não encontrado para esta conta" });
    if (!options.mirrorJobs) return reply.status(503).send({ error: "Pipeline multichain não configurado" });

    try {
      const destinationNetworkIds = body.destinationNetworkIds
        ?? (body.targetChainId ? [`evm:${body.targetChainId}`] : undefined);
      const job = await options.mirrorJobs.request({
        domain: cleanDomain,
        operation: body.operation,
        destinationNetworkIds,
      });
      return reply.status(202).send({
        success: true,
        job,
      });
    } catch (cause) {
      const error = multichainApiError(cause);
      return reply.status(error.statusCode).send(multichainErrorBody(error));
    }
  });

  app.get("/api/v1/multichain/jobs/:jobId", async (request, reply) => {
    if (!request.headers.authorization?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Autenticação obrigatória" });
    }
    const admin = await getActiveAdmin(request, prisma);
    if (!admin) return reply.status(403).send({ error: "Administrador existente obrigatório" });
    const { jobId } = request.params as { jobId: string };
    const parsed = z.string().uuid().safeParse(jobId);
    const query = z.object({ domain: CanonicalDomainSchema }).safeParse(request.query);
    if (!parsed.success || !query.success) {
      const error = invalidMultichainRequest("Job ou domínio inválido");
      return reply.status(error.statusCode).send(multichainErrorBody(error));
    }
    const ownedDomain = await prisma.domain.findFirst({
      where: { domainName: query.data.domain, userId: admin.id, isVerified: true },
    });
    if (!ownedDomain) return reply.status(404).send({ error: "Domínio verificado não encontrado para esta conta" });
    const job = await jobQuery.get(parsed.data);
    if (!job || job.domainHash.toLowerCase() !== catalogDomainHash(query.data.domain).toLowerCase()) {
      return reply.status(404).send({ error: "Job não encontrado" });
    }
    return { success: true, job };
  });

  app.get("/api/v1/multichain/timeline/:domain", async (request, reply) => {
    if (!request.headers.authorization?.startsWith("Bearer ")) return reply.status(401).send({ error: "Autenticação obrigatória" });
    const admin = await getActiveAdmin(request, prisma);
    if (!admin) return reply.status(403).send({ error: "Administrador existente obrigatório" });
    const parsed = CanonicalDomainSchema.safeParse((request.params as { domain: string }).domain);
    if (!parsed.success) return reply.status(400).send(multichainErrorBody(invalidMultichainRequest("Domínio inválido")));
    const ownedDomain = await prisma.domain.findFirst({ where: { domainName: parsed.data, userId: admin.id, isVerified: true } });
    if (!ownedDomain) return reply.status(404).send({ error: "Domínio verificado não encontrado para esta conta" });
    return { success: true, ...(await timeline.get(catalogDomainHash(parsed.data))) };
  });

  /**
   * POST /api/v1/multichain/fulfill-mirror
   * Rota interna para espelhamento por relayer
   */
  app.post("/api/v1/multichain/fulfill-mirror", async (request, reply) => {
    if (!options.internalServiceKey
      || request.headers["x-internal-service-key"] !== options.internalServiceKey) {
      return reply.status(403).send({ error: "Operador interno do relayer obrigatório" });
    }
    if (!options.mirrorJobs) return reply.status(503).send({ error: "Pipeline multichain não configurado" });
    const parsed = MirrorJobRequestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const error = invalidMultichainRequest();
      return reply.status(error.statusCode).send(multichainErrorBody(error));
    }
    const body = parsed.data;
    try {
      const destinationNetworkIds = body.destinationNetworkIds
        ?? (body.targetChainId ? [`evm:${body.targetChainId}`] : undefined);
      const job = await options.mirrorJobs.request({
        domain: body.domain,
        operation: body.operation,
        destinationNetworkIds,
      });
      return reply.status(202).send({ success: true, job });
    } catch (cause) {
      const error = multichainApiError(cause);
      return reply.status(error.statusCode).send(multichainErrorBody(error));
    }
  });
}
