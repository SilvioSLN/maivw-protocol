import type { FastifyInstance } from "fastify";
import type { LedgerService } from "../services/LedgerService.js";
import type { OracleService } from "../services/OracleService.js";
import type { PrismaClient } from "@prisma/client";
import { getActiveAdmin } from "./auth.js";
import { OriginCatalogService } from "../multichain/OriginCatalog.js";
import { MultichainStatusService } from "../multichain/MultichainStatus.js";
import type { MultichainMirrorJobCoordinator } from "../multichain/MultichainMirrorJobs.js";

interface MultiChainRouteOptions {
  ledger: LedgerService;
  oracle: OracleService;
  prisma: PrismaClient;
  internalServiceKey?: string;
  multichainStatus?: MultichainStatusService;
  mirrorJobs?: MultichainMirrorJobCoordinator;
}

export async function multiChainRoutes(app: FastifyInstance, options: MultiChainRouteOptions) {
  const { ledger, oracle, prisma } = options;
  const multichainStatus = options.multichainStatus
    ?? new MultichainStatusService(new OriginCatalogService(prisma), ledger);

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
    if (!domain) {
      return reply.status(400).send({ error: "Parâmetro domain obrigatório" });
    }

    try {
      const status = await multichainStatus.get(domain);
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
    const body = request.body as {
      domain: string;
      operation?: "REGISTER" | "SYNC" | "REVOKE";
      destinationNetworkIds?: string[];
      targetChainId?: number;
    };

    if (!body || !body.domain) {
      return reply.status(400).send({
        error: "Campo obrigatório ausente: domain",
      });
    }

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
        operation: body.operation ?? "REGISTER",
        destinationNetworkIds,
      });
      return reply.status(202).send({
        success: true,
        job,
      });
    } catch (error: any) {
      return reply.status(400).send({
        error: "Não foi possível criar o job de espelhamento",
        code: error?.code ?? "MIRROR_JOB_FAILED",
      });
    }
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
    const body = (request.body ?? {}) as {
      domain?: string;
      operation?: "REGISTER" | "SYNC" | "REVOKE";
      destinationNetworkIds?: string[];
      targetChainId?: number;
    };
    if (!body.domain) return reply.status(400).send({ error: "Campo obrigatório ausente: domain" });
    try {
      const destinationNetworkIds = body.destinationNetworkIds
        ?? (body.targetChainId ? [`evm:${body.targetChainId}`] : undefined);
      const job = await options.mirrorJobs.request({
        domain: body.domain,
        operation: body.operation ?? "REGISTER",
        destinationNetworkIds,
      });
      return reply.status(202).send({ success: true, job });
    } catch (error: any) {
      return reply.status(400).send({
        error: "Não foi possível criar o job de espelhamento",
        code: error?.code ?? "MIRROR_JOB_FAILED",
      });
    }
  });
}
