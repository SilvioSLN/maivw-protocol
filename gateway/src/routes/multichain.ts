import type { FastifyInstance } from "fastify";
import type { Address } from "viem";
import type { LedgerService } from "../services/LedgerService.js";
import type { OracleService } from "../services/OracleService.js";
import type { PrismaClient } from "@prisma/client";
import { getActiveAdmin } from "./auth.js";

interface MultiChainRouteOptions {
  ledger: LedgerService;
  oracle: OracleService;
  prisma: PrismaClient;
  internalServiceKey?: string;
}

export async function multiChainRoutes(app: FastifyInstance, options: MultiChainRouteOptions) {
  const { ledger, oracle, prisma } = options;

  /**
   * GET /api/v1/multichain/networks
   * Retorna a lista de redes suportadas pelo protocolo MAIVW e parâmetros de espelhamento
   */
  app.get("/api/v1/multichain/networks", async () => {
    const networks = ledger.getSupportedNetworks();
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
      const networks = ledger.getSupportedNetworks();
      const cleanDomain = domain.toLowerCase().trim();

      // Verificar status do domínio na rede primária
      const profile = await ledger.getCompanyProfile(cleanDomain);
      const isPrimaryActive = profile?.isActive ?? false;

      // Verificar espelho
      const mirrorInfo = await ledger.getMirrorInfo(cleanDomain);

      const networkStatuses = networks.map((net) => {
        if (net.isPrimary) {
          return {
            ...net,
            status: isPrimaryActive ? (mirrorInfo.isMirror ? "MIRRORED" : "ACTIVE_PRIMARY") : "INACTIVE",
            isActive: isPrimaryActive,
            isOrigin: !mirrorInfo.isMirror && isPrimaryActive,
          };
        } else {
          return {
            ...net,
            status: mirrorInfo.isMirror ? "MIRRORED" : "NOT_MIRRORED",
            isActive: mirrorInfo.isMirror,
            isOrigin: false,
          };
        }
      });

      return {
        success: true,
        domain: cleanDomain,
        isPrimaryActive,
        mirrorInfo,
        networks: networkStatuses,
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
      targetChainId: number;
      callerAddress?: Address;
      executeRelayer?: boolean;
    };

    if (!body || !body.domain || !body.targetChainId) {
      return reply.status(400).send({
        error: "Campos obrigatórios ausentes: domain, targetChainId",
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
    if (body.executeRelayer) {
      return reply.status(503).send({ error: "Relayer de espelhamento suspenso até confirmar a transação real" });
    }

    try {
      // 1. Verificar se o domínio está ativo na rede de origem
      const profile = await ledger.getCompanyProfile(cleanDomain);
      if (!profile || !profile.isActive) {
        return reply.status(400).send({
          error: `Domínio "${cleanDomain}" não possui registro ativo na rede de origem para espelhamento.`,
        });
      }

      // 2. Determinar a rede de destino e origem
      const networks = ledger.getSupportedNetworks();
      const targetNet = networks.find((n) => n.id === body.targetChainId);
      if (!targetNet) {
        return reply.status(400).send({
          error: `Rede de destino chainId ${body.targetChainId} não suportada.`,
        });
      }

      const primaryNet = networks.find((n) => n.isPrimary) || networks[0];
      const originChainId = primaryNet.id;

      if (originChainId === body.targetChainId) {
        return reply.status(400).send({
          error: "A rede de destino não pode ser a mesma rede de origem.",
        });
      }

      const effectiveCallerAddress = (body.callerAddress || profile.publicKey || oracle.getOracleAddress()) as Address;
      const adminKey = ((profile as any).adminKey || profile.publicKey) as Address;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

      // 3. Gerar a Prova Criptográfica do Oráculo (ECDSA)
      const oracleProof = await oracle.generateMirrorProof(
        cleanDomain,
        profile.publicKey,
        originChainId,
        body.targetChainId,
        effectiveCallerAddress,
        adminKey,
        deadline
      );

      return {
        success: true,
        domain: cleanDomain,
        publicKey: profile.publicKey,
        endpointUrl: profile.endpointUrl,
        originChainId,
        targetChainId: body.targetChainId,
        targetNetworkName: targetNet.name,
        targetContractAddress: targetNet.contractAddress,
        mirrorFeeWei: targetNet.mirrorFeeWei,
        mirrorFeeFormatted: targetNet.mirrorFeeFormatted,
        oracleProof,
        adminKey,
        deadline: deadline.toString(),
        callerAddress: effectiveCallerAddress,
        oracleNodeAddress: oracle.getOracleAddress(),
        transaction: undefined,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Erro ao gerar atestação de espelhamento",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/multichain/fulfill-mirror
   * Rota interna para espelhamento por relayer
   */
  app.post("/api/v1/multichain/fulfill-mirror", async (_request, reply) => {
    return reply.status(503).send({
      error: "Relayer de espelhamento suspenso até vincular pedido autenticado e confirmação on-chain real",
    });
  });
}
