import type { FastifyInstance } from "fastify";
import type { StealthRoutingService } from "../services/StealthRoutingService.js";
import type { LedgerService } from "../services/LedgerService.js";

interface StealthRouteOptions {
  stealth: StealthRoutingService;
  ledger: LedgerService;
}

export async function stealthRoutes(app: FastifyInstance, options: StealthRouteOptions) {
  const { stealth, ledger } = options;

  /**
   * GET /api/v1/stealth/routes
   * Lista todas as rotas privadas bilaterais cadastradas para envio
   */
  app.get("/api/v1/stealth/routes", async (request, reply) => {
    try {
      const routes = await stealth.listRoutes();
      return { success: true, routes };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Erro ao listar rotas privadas",
        message: error.message,
      });
    }
  });

  /**
   * POST /api/v1/stealth/routes
   * Cadastra ou atualiza uma rota privada para um Dark Endpoint
   */
  app.post("/api/v1/stealth/routes", async (request, reply) => {
    const body = (request.body || {}) as {
      targetDomain?: string;
      privateEndpointUrl?: string;
      stealthToken?: string;
      notes?: string;
    };

    const { targetDomain, privateEndpointUrl, stealthToken, notes } = body;

    if (!targetDomain || !privateEndpointUrl) {
      return reply.status(400).send({
        error: "Campos 'targetDomain' e 'privateEndpointUrl' são obrigatórios.",
      });
    }

    try {
      const route = await stealth.setRoute(
        targetDomain,
        privateEndpointUrl,
        stealthToken,
        notes
      );

      return {
        success: true,
        message: `Rota privada para o domínio ${targetDomain} salva com sucesso.`,
        route,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao salvar rota privada",
        message: error.message,
      });
    }
  });

  /**
   * DELETE /api/v1/stealth/routes/:targetDomain
   * Remove uma rota privada de envio
   */
  app.delete("/api/v1/stealth/routes/:targetDomain", async (request, reply) => {
    const { targetDomain } = request.params as { targetDomain: string };

    try {
      const deleted = await stealth.deleteRoute(targetDomain);
      return { success: deleted, targetDomain };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao excluir rota privada",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/stealth/config/:domain
    * Retorna a configuração de Modo de Segurança / Stealth (Recepção) do domínio
    */
  app.get("/api/v1/stealth/config/:domain", async (request, reply) => {
    const { domain } = request.params as { domain: string };

    try {
      const config = await stealth.getStealthConfig(domain);
      const onChainProfile = await ledger.getCompanyProfile(domain);

      const isEndpointDarkOnChain =
        Boolean(onChainProfile?.endpointUrl) &&
        (onChainProfile!.endpointUrl.toUpperCase() === "PRIVATE" ||
          onChainProfile!.endpointUrl.toUpperCase() === "STEALTH" ||
          onChainProfile!.endpointUrl.startsWith("stealth://"));

      const resolvedMode =
        config?.mode ||
        (isEndpointDarkOnChain ? "dark" : config?.isStealthEnabled ? "dark" : "public");

      return {
        domain,
        mode: resolvedMode,
        isStealthEnabled: resolvedMode === "dark",
        inboundToken: config?.inboundToken || null,
        onChainEndpoint: onChainProfile?.endpointUrl || "",
        isEndpointDarkOnChain,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Erro ao obter configuração de stealth",
        message: error.message,
      });
    }
  });

  /**
   * PUT /api/v1/stealth/config/:domain
   * Configura o Modo de Segurança (Público, Híbrido ou Dark Total) e atualiza na blockchain se solicitado
   */
  app.put("/api/v1/stealth/config/:domain", async (request, reply) => {
    const { domain } = request.params as { domain: string };
    const body = (request.body || {}) as {
      mode?: "public" | "hybrid" | "dark";
      isStealthEnabled?: boolean;
      inboundToken?: string;
      endpointUrl?: string; // URL pública para sincronizar se não for dark
      syncOnChain?: boolean; // Se true, atualiza endpoint no Smart Contract
    };

    const targetMode: "public" | "hybrid" | "dark" =
      body.mode || (body.isStealthEnabled ? "dark" : "public");
    const isDark = targetMode === "dark";
    const inboundToken = body.inboundToken;

    try {
      const updated = await stealth.setStealthConfig(
        domain,
        isDark,
        inboundToken,
        targetMode
      );

      let onChainTxHash: string | null = null;
      if (body.syncOnChain) {
        let newEndpointValue = "PRIVATE";
        if (targetMode === "public" || targetMode === "hybrid") {
          newEndpointValue =
            body.endpointUrl?.trim() || "https://gateway/api/v1/inbox";
        }

        try {
          onChainTxHash = await ledger.updateEndpoint(domain, newEndpointValue);
        } catch (onChainErr: any) {
          app.log.warn(
            `[STEALTH] Não foi possível sincronizar endpoint on-chain automaticamente: ${onChainErr.message}`
          );
        }
      }

      const modeDescriptions = {
        public: "Modo Público (Clear Web P2P)",
        hybrid: "Modo Híbrido (Dual-Stack: Público + Canal VIP Stealth)",
        dark: "Modo Dark Total (Silent Drop 404 Estrito)",
      };

      return {
        success: true,
        message: `Configuração atualizada com sucesso para ${domain}: ${modeDescriptions[targetMode]}.`,
        config: updated,
        mode: targetMode,
        onChainTxHash,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao atualizar configuração de stealth",
        message: error.message,
      });
    }
  });
}
