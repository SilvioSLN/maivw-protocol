import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { getAuthUser, getActiveMailbox } from "./auth.js";

interface ContactsRouteOptions {
  prisma: PrismaClient;
  jwtSecret: string;
}

export async function contactsRoutes(app: FastifyInstance, options: ContactsRouteOptions) {
  const { prisma } = options;

  /**
   * GET /api/v1/contacts/autocomplete
   * Retorna sugestões de contatos para o campo "Para":
   * 1. Colaboradores da própria empresa (mesmo domínio)
   * 2. Destinatários recentes de conversas anteriores
   */
  app.get("/api/v1/contacts/autocomplete", async (request, reply) => {
    if (!getAuthUser(request)) return reply.status(401).send({ error: "Autenticação obrigatória" });
    const authUser = await getActiveMailbox(request, prisma);
    if (!authUser) return reply.status(403).send({ error: "Caixa ativa obrigatória" });
    const { q, domain } = request.query as { q?: string; domain?: string };
    const queryTerm = (q || "").trim().toLowerCase();

    const userDomain = authUser.email.split("@")[1];
    if (domain && domain.toLowerCase() !== userDomain) return reply.status(403).send({ error: "Diretório pertence a outro domínio" });

    const results: Array<{ email: string; name?: string; isInternal: boolean }> = [];
    const seenEmails = new Set<string>();

    try {
      // 1. Contas internas do mesmo domínio
      if (userDomain) {
        const domainRecord = await prisma.domain.findFirst({
          where: { domainName: userDomain },
          include: { accounts: { where: { isActive: true } } },
        });

        if (domainRecord && domainRecord.accounts) {
          for (const acc of domainRecord.accounts) {
            const email = `${acc.localPart}@${domainRecord.domainName}`.toLowerCase();
            if (authUser && email === authUser.email.toLowerCase()) continue; // Não auto-sugerir
            if (!queryTerm || email.includes(queryTerm) || (acc.displayName && acc.displayName.toLowerCase().includes(queryTerm))) {
              if (!seenEmails.has(email)) {
                seenEmails.add(email);
                results.push({
                  email,
                  name: acc.displayName || acc.localPart,
                  isInternal: true,
                });
              }
            }
          }
        }
      }

      // 2. Destinatários recentes de mensagens enviadas ou recebidas
      if (authUser?.email) {
        const recentMessages = await prisma.message.findMany({
          where: {
            OR: [
              { from: { equals: authUser.email, mode: "insensitive" } },
              { to: { equals: authUser.email, mode: "insensitive" } },
            ],
          },
          orderBy: { receivedAt: "desc" },
          take: 30,
          select: { to: true, from: true },
        });

        for (const msg of recentMessages) {
          const candidateEmails = [msg.to, msg.from];
          for (const cand of candidateEmails) {
            // Extrair endereço de e-mail puro (caso venha "Nome <email@dominio.com>")
            const match = cand.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (match) {
              const email = match[1].toLowerCase();
              if (authUser && email === authUser.email.toLowerCase()) continue;
              if (!seenEmails.has(email)) {
                if (!queryTerm || email.includes(queryTerm)) {
                  seenEmails.add(email);
                  results.push({
                    email,
                    isInternal: userDomain ? email.endsWith(`@${userDomain}`) : false,
                  });
                }
              }
            }
          }
        }
      }

      return { contacts: results.slice(0, 10) };
    } catch (err: any) {
      app.log.error(err, "[CONTACTS] Erro ao buscar contatos:");
      return reply.status(500).send({ error: "Erro ao buscar contatos" });
    }
  });
}
