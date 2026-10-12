import { Resend } from "resend";
import type { PrismaClient } from "@prisma/client";
import type { EmailProviderAdapter, OutboundSendResult, PreparedEmailMessage } from "../types.js";

export class ResendAdapter implements EmailProviderAdapter {
  readonly id = "resend";
  private client: Resend;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new Resend(apiKey);
  }

  async sendEmail(message: PreparedEmailMessage): Promise<OutboundSendResult> {
    try {
      console.log(`[ResendAdapter] 🚀 Enviando e-mail via Resend API: De: ${message.from} -> Para: ${message.to}`);
      if (message.nativeAttachments.length > 0) {
        console.log(`[ResendAdapter] 📎 Incluindo ${message.nativeAttachments.length} anexo(s) nativo(s) MIME`);
      }
      if (message.largeAttachments.length > 0) {
        console.log(`[ResendAdapter] 🛡️ Incluindo ${message.largeAttachments.length} anexo(s) via Card MAIVW SHA-256`);
      }

      const resendAttachments = message.nativeAttachments.map((att) => ({
        filename: att.filename,
        content: att.content,
      }));

      const result = await this.client.emails.send({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html || undefined,
        attachments: resendAttachments.length > 0 ? resendAttachments : undefined,
      });

      if (result.error) {
        console.error(`[ResendAdapter] ❌ Erro Resend:`, result.error);
        return {
          success: false,
          provider: "resend",
          error: result.error.message || JSON.stringify(result.error),
        };
      }

      console.log(`[ResendAdapter] ✅ E-mail enviado com sucesso via Resend! ID: ${result.data?.id}`);
      return {
        success: true,
        provider: "resend",
        messageId: result.data?.id,
      };
    } catch (err: any) {
      console.error(`[ResendAdapter] ❌ Exceção ao enviar via Resend:`, err.message);
      return {
        success: false,
        provider: "resend",
        error: err.message || "Falha na comunicação com a API do Resend",
      };
    }
  }

  async testConnection(apiKey?: string): Promise<{ ok: boolean; provider: string; message: string }> {
    const keyToUse = apiKey || this.apiKey;
    try {
      const client = new Resend(keyToUse);
      const domains = await client.domains.list();

      if (domains.error) {
        return {
          ok: false,
          provider: "resend",
          message: `Erro na API do Resend: ${domains.error.message}`,
        };
      }

      return {
        ok: true,
        provider: "resend",
        message: `Conexão bem-sucedida! ${domains.data?.data?.length || 0} domínio(s) encontrado(s) no Resend.`,
      };
    } catch (err: any) {
      return {
        ok: false,
        provider: "resend",
        message: `Falha na conexão: ${err.message}`,
      };
    }
  }

  /**
   * Sincroniza e-mails recebidos do Resend (Inbound) diretamente da API
   */
  async syncInboundEmailsWithPrisma(prisma: PrismaClient, domainId?: number): Promise<number> {
    let syncedCount = 0;
    try {
      const resp = await fetch("https://api.resend.com/emails/receiving", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!resp.ok) return 0;
      const list = (await resp.json()) as any;
      if (!list || !list.data || !Array.isArray(list.data)) return 0;

      for (const item of list.data) {
        const exists = await prisma.message.findUnique({
          where: { messageId: item.id },
        });

        if (!exists) {
          let body = "";
          let from = item.from;
          let to = Array.isArray(item.to) ? item.to.join(", ") : (item.to || "");
          let subject = item.subject || "(Sem assunto)";
          let receivedAt = new Date(item.created_at || Date.now());

          try {
            const detailResp = await fetch(`https://api.resend.com/emails/receiving/${item.id}`, {
              headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            if (detailResp.ok) {
              const detail = (await detailResp.json()) as any;
              if (detail.html && detail.text) {
                body = JSON.stringify({ text: detail.text, html: detail.html });
              } else if (detail.html) {
                body = JSON.stringify({ text: "", html: detail.html });
              } else {
                body = detail.text || "";
              }
              from = detail.from || from;
              to = Array.isArray(detail.to) ? detail.to.join(", ") : (detail.to || to);
              subject = detail.subject || subject;
              if (detail.created_at) receivedAt = new Date(detail.created_at);
            }
          } catch (detailErr: any) {
            console.warn(`[ResendAdapter-SYNC] Falha ao buscar detalhes do e-mail ${item.id}:`, detailErr.message);
          }

          await prisma.message.create({
            data: {
              messageId: item.id,
              from,
              to,
              subject,
              body,
              msgClass: "CONVERSATION",
              status: "received",
              isLegacy: true,
              domainId: domainId || null,
              receivedAt,
            },
          });
          syncedCount++;
          console.log(`[ResendAdapter-SYNC] 📬 Novo e-mail sincronizado do Resend: ${item.id} (${subject})`);
        }
      }
    } catch (err: any) {
      console.error(`[ResendAdapter-SYNC] Erro durante sincronização inbound:`, err.message);
    }

    return syncedCount;
  }
}
