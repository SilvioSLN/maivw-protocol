import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

interface ContactsRouteOptions {
  prisma: PrismaClient;
  jwtSecret: string;
}

export async function contactsRoutes(app: FastifyInstance, options: ContactsRouteOptions) {
  const { prisma, jwtSecret } = options;

  const getAuthUser = (request: any) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) return null;
      const token = authHeader.split(" ")[1];
      return jwt.verify(token, jwtSecret) as { id: number; email: string; role: string };
    } catch {
      return null;
    }
  };

  /**
   * GET /api/v1/contacts/autocomplete
   * Retorna sugestões de contatos para o campo "Para":
   * 1. Colaboradores da própria empresa (mesmo domínio)
   * 2. Destinatários recentes de conversas anteriores
   */
  app.get("/api/v1/contacts/autocomplete", async (request, reply) => {
    const authUser = getAuthUser(request);
    const { q, domain } = request.query as { q?: string; domain?: string };
    const queryTerm = (q || "").trim().toLowerCase();

    const userDomain = domain || (authUser?.email ? authUser.email.split("@")[1] : "");

    const results: Array<{ email: string; name?: string; isInternal: boolean }> = [];
    const seenEmails = new Set<string>();

    try {
      // 1. Contas internas do mesmo domínio
      if (userDomain) {
        const domainRecord = await prisma.domain.findFirst({
          where: { domainName: userDomain },
          include: { accounts: true },
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
              { from: { contains: authUser.email, mode: "insensitive" } },
              { to: { contains: authUser.email, mode: "insensitive" } },
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
