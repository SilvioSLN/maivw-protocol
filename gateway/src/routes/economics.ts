import type { FastifyInstance } from "fastify";
import type { LedgerService } from "../services/LedgerService.js";

const TIER_NAMES: Record<number, string> = {
  0: "NONE",
  1: "STARTUP (Tier 1)",
  2: "GROWTH (Tier 2)",
  3: "ENTERPRISE (Tier 3)",
};

interface EconomicsRouteOptions {
  ledger: LedgerService;
}

export async function economicsRoutes(app: FastifyInstance, options: EconomicsRouteOptions) {
  const { ledger } = options;

  /**
   * GET /api/v1/economics/governance
   * Retorna os dados consolidados de Governança, Tesouraria, Taxas e Carteiras do Contrato
   */
  app.get("/api/v1/economics/governance", async (request, reply) => {
    try {
      const data = await ledger.getGovernanceInfo();
      return data;
    } catch (error: any) {
      return reply.status(500).send({
        error: "Erro ao consultar dados de governança",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/economics/genesis
   * Retorna o status de uso da Cota Gênesis do Fundador
   */
  app.get("/api/v1/economics/genesis", async (request, reply) => {
    try {
      const status = await ledger.getGenesisStatus();
      const count = Number(status.count);
      const maxGenesis = Number(status.maxGenesis);
      return {
        genesisCount: count,
        maxGenesis,
        remainingVagas: Math.max(0, maxGenesis - count),
        percentUsed: ((count / maxGenesis) * 100).toFixed(1) + "%",
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Erro ao consultar Cota Gênesis",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/economics/provider/:domain
   * Retorna informações de Tier, saldo de caução e rate limit do provedor
   */
  app.get("/api/v1/economics/provider/:domain", async (request, reply) => {
    const { domain } = request.params as { domain: string };

    try {
      const info = await ledger.getProviderInfo(domain);
      if (!info) {
        return reply.status(404).send({
          error: "Provedor não encontrado",
          domain,
        });
      }

      const profile = await ledger.getCompanyProfile(domain);
      const dailyLimitNum = info.dailyLimit > 1000000000n ? "Ilimitado" : Number(info.dailyLimit);

      return {
        domain,
        endpointUrl: profile?.endpointUrl || "",
        tier: info.tier,
        tierName: TIER_NAMES[info.tier] || "DESCONHECIDO",
        balanceWei: info.balance.toString(),
        dailyLimit: dailyLimitNum,
        isActive: info.isActive,
        strikeCount: info.strikeCount,
        isSuspended: !info.isActive,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Erro ao consultar status do provedor",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/economics/tiers
   * Retorna a especificação dos 3 Tiers da rede MAIVW
   */
  app.get("/api/v1/economics/tiers", async () => {
    const standardFee = await ledger.getStandardRegistrationFee();
    return {
      standardRegistrationFeeWei: standardFee.toString(),
      tiers: [
        {
          tier: 1,
          name: "Startup SaaS",
          dailyLimit: 50000,
          toleranceStrikes: 20,
          description: "Para pequenos CRMs, Helpdesks e novos provedores testando a rede.",
        },
        {
          tier: 2,
          name: "Growth ESP",
          dailyLimit: 1000000,
          toleranceStrikes: 200,
          description: "Para provedores de médio porte e plataformas estabelecidas.",
        },
        {
          tier: 3,
          name: "Enterprise Big Tech",
          dailyLimit: "Ilimitado",
          toleranceStrikes: 2000,
          description: "Para gigantes de infraestrutura e grandes corporações.",
        },
      ],
    };
  });

  /**
   * POST /api/v1/economics/topup
   * Executa recarga de saldo de caução para reativar provedor suspenso (Fase 13)
   */
  app.post("/api/v1/economics/topup", async (request, reply) => {
    const body = (request.body || {}) as { domain?: string; amountEth?: string };
    const { domain, amountEth } = body;

    if (!domain) {
      return reply.status(400).send({ error: "O campo 'domain' é obrigatório para recarga." });
    }

    try {
      const result = await ledger.topUpBalance(domain, amountEth || "1");
      return {
        success: true,
        domain,
        txHash: result.txHash,
        newBalanceWei: result.newBalance.toString(),
        message: `Recarga de caução efetuada com sucesso para ${domain}. Se estava suspenso, foi reativado.`,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao executar recarga de caução",
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/v1/economics/endpoint
   * Atualiza a URL de endpoint P2P de um domínio on-chain
   */
  app.put("/api/v1/economics/endpoint", async (request, reply) => {
    const body = (request.body || {}) as { domain?: string; newEndpoint?: string; endpointUrl?: string; endpoint?: string };
    const domain = body.domain;
    const newEndpoint = body.newEndpoint || body.endpointUrl || body.endpoint;

    if (!domain || !newEndpoint) {
      return reply.status(400).send({ error: "Campos 'domain' e 'endpointUrl' (ou 'newEndpoint') são obrigatórios." });
    }

    try {
      const txHash = await ledger.updateEndpoint(domain, newEndpoint);
      return {
        success: true,
        domain,
        newEndpoint,
        txHash,
        message: `Endpoint do domínio ${domain} atualizado com sucesso on-chain!`,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao atualizar endpoint on-chain",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/economics/genesis-provider
   * Registra um provedor multi-tenant usufruindo da Cota Gênesis
   */
  app.post("/api/v1/economics/genesis-provider", async (request, reply) => {
    const body = (request.body || {}) as {
      domain?: string;
      endpoint?: string;
      publicKey?: string;
      tier?: number;
    };
    const { domain, endpoint, publicKey, tier } = body;

    if (!domain || !endpoint || !publicKey) {
      return reply.status(400).send({ error: "Campos 'domain', 'endpoint' e 'publicKey' são obrigatórios." });
    }

    try {
      const txHash = await ledger.registerGenesisProvider(
        domain,
        endpoint,
        publicKey as `0x${string}`,
        tier || 1
      );
      return {
        success: true,
        domain,
        tier: tier || 1,
        txHash,
        message: `Provedor Gênesis registrado com sucesso!`,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao registrar Provedor Gênesis",
        message: error.message,
      });
    }
  });
}
