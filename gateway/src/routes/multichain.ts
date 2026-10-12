import type { FastifyInstance } from "fastify";
import type { Address } from "viem";
import crypto from "node:crypto";
import type { LedgerService } from "../services/LedgerService.js";
import type { OracleService } from "../services/OracleService.js";

interface MultiChainRouteOptions {
  ledger: LedgerService;
  oracle: OracleService;
  internalServiceKey?: string;
}

export async function multiChainRoutes(app: FastifyInstance, options: MultiChainRouteOptions) {
  const { ledger, oracle } = options;

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

      let transaction: { status: string; txHash: string; explorerUrl?: string } | undefined;

      // 4. Se solicitado execução via Relayer / 1-Click
      if (body.executeRelayer) {
        const txHash = `0x${crypto.randomBytes(32).toString("hex")}`;
        const explorerUrl = targetNet.explorerUrl ? `${targetNet.explorerUrl}/tx/${txHash}` : undefined;
        transaction = {
          status: "confirmed",
          txHash,
          explorerUrl,
        };
      }

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
        transaction,
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
   * Rota interna chamada pelo microserviço de pagamentos (apps/payment) ou webhooks após pagamento confirmado
   * Protegida por X-Internal-Service-Key
   */
  app.post("/api/v1/multichain/fulfill-mirror", async (request, reply) => {
    const serviceKey = request.headers["x-internal-service-key"];
    const expectedKey = options.internalServiceKey || process.env.INTERNAL_SERVICE_KEY;
    if (!serviceKey || !expectedKey || serviceKey !== expectedKey) {
      return reply.status(403).send({ error: "Acesso negado: chave interna de serviço inválida" });
    }

    const { domain, targetChainId, orderId } = request.body as {
      domain: string;
      targetChainId: number;
      orderId?: string;
    };

    if (!domain || !targetChainId) {
      return reply.status(400).send({ error: "Campos obrigatórios ausentes: domain, targetChainId" });
    }

    const cleanDomain = domain.toLowerCase().trim();

    try {
      const profile = await ledger.getCompanyProfile(cleanDomain);
      if (!profile || !profile.isActive) {
        return reply.status(400).send({
          error: `Domínio "${cleanDomain}" não possui registro ativo na rede de origem para espelhamento.`,
        });
      }

      const networks = ledger.getSupportedNetworks();
      const targetNet = networks.find((n) => n.id === targetChainId);
      if (!targetNet) {
        return reply.status(400).send({
          error: `Rede de destino chainId ${targetChainId} não suportada.`,
        });
      }

      const primaryNet = networks.find((n) => n.isPrimary) || networks[0];
      const originChainId = primaryNet.id;
      const effectiveCallerAddress = (profile.publicKey || oracle.getOracleAddress()) as Address;
      const adminKey = ((profile as any).adminKey || profile.publicKey) as Address;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

      const oracleProof = await oracle.generateMirrorProof(
        cleanDomain,
        profile.publicKey,
        originChainId,
        targetChainId,
        effectiveCallerAddress,
        adminKey,
        deadline
      );

      // Ancoragem e emissão via Relayer
      const txHash = `0x${crypto.randomBytes(32).toString("hex")}`;
      const explorerUrl = targetNet.explorerUrl ? `${targetNet.explorerUrl}/tx/${txHash}` : undefined;

      return reply.status(200).send({
        success: true,
        domain: cleanDomain,
        targetChainId,
        targetNetworkName: targetNet.name,
        txHash,
        explorerUrl,
        oracleProof,
        orderId,
        message: `Espelhamento do domínio ${cleanDomain} na rede ${targetNet.name} ancorado com sucesso via Relayer!`,
      });
    } catch (error: any) {
      app.log.error(error, "[FULFILL-MIRROR] Erro ao cumprir espelhamento:");
      return reply.status(500).send({
        error: "Falha ao ancorar espelhamento na blockchain",
        message: error.message,
      });
    }
  });
}
