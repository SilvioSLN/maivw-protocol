import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { LegacyAdapterService } from "../services/LegacyAdapterService.js";

interface WebhookRouteOptions {
  prisma: PrismaClient;
  webhookSecret: string;
}

/**
 * Rotas de Webhook Inbound para Provedores Legados (Fase 11)
 * 
 * Permite que respostas enviadas por usuários de SMTP tradicional (Gmail, Outlook, etc.)
 * sejam recebidas via webhooks de serviços como Resend, SendGrid ou AWS SES,
 * normalizadas pelo LegacyAdapterService e integradas diretamente na caixa de entrada unificada.
 */
export async function webhookRoutes(app: FastifyInstance, options: WebhookRouteOptions) {
  const { prisma, webhookSecret } = options;
  const adapter = new LegacyAdapterService();

  /**
   * POST /api/v1/webhooks/inbound-legacy
   * Rota pública para webhooks de provedores de e-mail legados
   */
  app.post("/api/v1/webhooks/inbound-legacy", async (request, reply) => {
    // 1. Validar autenticidade do webhook (segredo compartilhado ou token de webhook)
    const headerSecret = request.headers["x-webhook-secret"] as string | undefined;
    const querySecret = (request.query as { secret?: string })?.secret;
    const authHeader = request.headers.authorization;
    const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "").trim() : undefined;

    const providedSecret = headerSecret || querySecret || bearerSecret;

    if (webhookSecret && !adapter.validateWebhookSecret(webhookSecret, providedSecret)) {
      app.log.warn("[WEBHOOK] ❌ Tentativa de acesso com segredo de webhook inválido.");
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Assinatura ou segredo do webhook inválido. Forneça o header x-webhook-secret.",
      });
    }

    // 2. Adaptar o payload de qualquer formato (Resend, SendGrid, SES, Genérico)
    let normalized;
    try {
      normalized = adapter.adapt(request.body);
    } catch (err: any) {
      app.log.warn(`[WEBHOOK] ❌ Erro ao processar payload legado: ${err.message}`);
      return reply.status(400).send({
        error: "Bad Request",
        message: err.message,
      });
    }

    // 3. Persistir no banco de dados com a flag isLegacy e categoria UNVERIFIED_LEGACY
    try {
      const saved = await prisma.message.upsert({
        where: { messageId: normalized.messageId },
        create: {
          messageId: normalized.messageId,
          from: normalized.from,
          to: normalized.to,
          subject: normalized.subject,
          body: normalized.body,
          msgClass: normalized.msgClass,
          isLegacy: true,
          status: "received",
          signature: null,
        },
        update: {},
      });

      console.log("");
      console.log("╔══════════════════════════════════════════════════════════════╗");
      console.log("║  📬 [INBOUND WEBHOOK] E-mail Legado (Gmail/Outlook) Recebido ║");
      console.log("╠══════════════════════════════════════════════════════════════╣");
      console.log(`║  ID:        ${saved.messageId}`);
      console.log(`║  De:        ${saved.from}`);
      console.log(`║  Para:      ${saved.to}`);
      console.log(`║  Assunto:   ${saved.subject}`);
      console.log(`║  Classe:    ${saved.msgClass} (Sem Assinatura Web3)`);
      console.log(`║  Rota:      Ponte Legada SMTP → Webhook HTTP`);
      console.log("╚══════════════════════════════════════════════════════════════╝");
      console.log("");

      return reply.status(201).send({
        status: "processed",
        isLegacy: true,
        msgClass: saved.msgClass,
        messageId: saved.messageId,
        from: saved.from,
        to: saved.to,
        subject: saved.subject,
        receivedAt: saved.receivedAt,
        message: "E-mail legado (SMTP/Gmail/Outlook) recebido e indexado com sucesso na caixa de entrada unificada.",
      });
    } catch (err: any) {
      app.log.error(`[WEBHOOK] ❌ Erro ao persistir mensagem no banco: ${err.message}`);
      return reply.status(500).send({
        error: "Internal Server Error",
        message: "Falha ao gravar mensagem legada no banco de dados.",
      });
    }
  });
}
