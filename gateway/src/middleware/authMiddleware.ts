import type { FastifyRequest, FastifyReply } from "fastify";
import type { KeyManagementService } from "../services/KeyManagementService.js";

declare module "fastify" {
  interface FastifyRequest {
    apiKeyContext?: {
      domainId: number;
      domainName: string;
      keyName: string;
    };
  }
}

/**
 * Middleware para autenticação via API Key (Fase 10)
 * Formato do header: `Authorization: Bearer maivw_live_[hash]` ou `maivw_test_[hash]`
 */
export function createAuthMiddleware(kms: KeyManagementService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Header Authorization no formato 'Bearer maivw_live_...' é obrigatório.",
      });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const validated = await kms.validateApiKey(token);

    if (!validated) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "API Key inválida ou inexistente.",
      });
    }

    request.apiKeyContext = validated;
  };
}
