import type { FastifyInstance } from "fastify";
import { getActiveMailbox } from "./auth.js";
import { MailDispatchService, type MailDispatchOptions } from "../services/MailDispatchService.js";

export type SendRouteOptions = Omit<MailDispatchOptions, "logger">;

export async function sendRoutes(app: FastifyInstance, options: SendRouteOptions) {
  const dispatch = new MailDispatchService({ ...options, logger: app.log });
  app.post("/api/v1/send", async (request, reply) => {
    const { prisma, kms } = options;
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return reply.status(401).send({ error: "Credencial de envio obrigatória" });
    if (!prisma || !kms) return reply.status(503).send({ error: "Serviço de identidade indisponível" });
    const rawToken = authHeader.slice(7).trim();
    let sender: { domain: string; mailboxEmail?: string };
    if (rawToken.startsWith("maivw_live_") || rawToken.startsWith("maivw_test_")) {
      const keyInfo = await kms.validateApiKey(rawToken);
      if (!keyInfo) return reply.status(401).send({ error: "Chave inválida ou revogada" });
      const domain = await prisma.domain.findUnique({ where: { id: keyInfo.domainId } });
      if (!domain?.isVerified || domain.domainName !== keyInfo.domainName) return reply.status(403).send({ error: "Domínio não verificado" });
      sender = { domain: domain.domainName.toLowerCase() };
    } else {
      const mailbox = await getActiveMailbox(request, prisma);
      if (!mailbox) return reply.status(401).send({ error: "Sessão de caixa ativa obrigatória" });
      sender = { domain: mailbox.email.split("@")[1], mailboxEmail: mailbox.email };
    }
    const outcome = await dispatch.execute({ payload: (request.body || {}) as Record<string, unknown>, sender });
    return reply.code(outcome.statusCode).send(outcome.body);
  });
}
