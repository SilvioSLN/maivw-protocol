import { v4 as uuidv4 } from "uuid";

export interface NormalizedLegacyMessage {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  msgClass: "UNVERIFIED_LEGACY";
  isLegacy: true;
  status: "received";
  signature: null;
}

/**
 * LegacyAdapterService — Fase 11
 * 
 * Implementa o Adapter Pattern para normalizar webhooks de entrada de provedores
 * legados (Resend, SendGrid, AWS SES, Mailgun, ou formato genérico SMTP Inbound)
 * para o formato unificado do MAIVW.
 * 
 * Marca categoricamente a mensagem como:
 * - isLegacy: true
 * - msgClass: "UNVERIFIED_LEGACY"
 * - signature: null (pois não possui garantia criptográfica Web3 on-chain)
 */
export class LegacyAdapterService {
  /**
   * Adapta um payload bruto de webhook de qualquer provedor para o formato interno do MAIVW.
   */
  adapt(rawPayload: any): NormalizedLegacyMessage {
    if (!rawPayload || typeof rawPayload !== "object") {
      throw new Error("Payload de webhook inválido: esperado um objeto JSON.");
    }

    let messageId: string = uuidv4();
    let from = "desconhecido@legado.com";
    let to = "inbox@maivw.local";
    let subject = "(Sem Assunto)";
    let body = "";

    const buildBody = (text?: string, html?: string, fallback?: string): string => {
      const cleanText = typeof text === "string" ? text : "";
      const cleanHtml = typeof html === "string" ? html : "";
      if (cleanHtml && cleanText) {
        return JSON.stringify({ text: cleanText, html: cleanHtml });
      } else if (cleanHtml) {
        return JSON.stringify({ text: "", html: cleanHtml });
      } else if (cleanText) {
        return cleanText;
      }
      return fallback || "";
    };

    // 1. Resend Inbound Webhook: { type: "email.received", data: { from, to, subject, text, html, id } }
    if (rawPayload.type === "email.received" && rawPayload.data) {
      const data = rawPayload.data;
      messageId = data.id || data.email_id || uuidv4();
      from = Array.isArray(data.from) ? data.from.join(", ") : (data.from || from);
      to = Array.isArray(data.to) ? data.to.join(", ") : (data.to || to);
      subject = data.subject || subject;
      body = buildBody(data.text, data.html);
    }
    // 2. SendGrid Inbound Parse Webhook: { from, to, subject, text, html }
    else if (rawPayload.from && rawPayload.to && (rawPayload.text !== undefined || rawPayload.html !== undefined)) {
      messageId = rawPayload.headers?.["message-id"] || rawPayload.messageId || uuidv4();
      from = rawPayload.from;
      to = rawPayload.to;
      subject = rawPayload.subject || subject;
      body = buildBody(rawPayload.text, rawPayload.html);
    }
    // 3. AWS SES Notification Inbound: { notificationType: "Received", mail: { source, destination, commonHeaders }, content }
    else if (rawPayload.notificationType === "Received" && rawPayload.mail) {
      const mail = rawPayload.mail;
      messageId = mail.messageId || uuidv4();
      from = mail.source || from;
      to = Array.isArray(mail.destination) ? mail.destination.join(", ") : (mail.destination || to);
      subject = mail.commonHeaders?.subject || subject;
      body = rawPayload.content || JSON.stringify(mail.commonHeaders || {});
    }
    // 4. Formato Genérico / Testes / Qualquer cliente SMTP bridge
    else {
      messageId = rawPayload.messageId || rawPayload.id || uuidv4();
      from = rawPayload.from || rawPayload.sender || from;
      to = Array.isArray(rawPayload.to) ? rawPayload.to.join(", ") : (rawPayload.to || rawPayload.recipient || to);
      subject = rawPayload.subject || subject;
      const genericText = typeof rawPayload.body === "string" ? rawPayload.body : (rawPayload.text || rawPayload.content?.text);
      const genericHtml = rawPayload.html || rawPayload.content?.html;
      body = buildBody(genericText, genericHtml, typeof rawPayload.body === "object" ? JSON.stringify(rawPayload.body) : "");
    }

    return {
      messageId: String(messageId).trim(),
      from: String(from).trim(),
      to: String(to).trim(),
      subject: String(subject).trim(),
      body: String(body).trim(),
      msgClass: "UNVERIFIED_LEGACY",
      isLegacy: true,
      status: "received",
      signature: null,
    };
  }

  /**
   * Valida a autenticidade do webhook através do segredo compartilhado ou headers assinados.
   */
  validateWebhookSecret(expectedSecret: string, providedSecret?: string): boolean {
    if (!expectedSecret) return true;
    if (!providedSecret) return false;
    return providedSecret.trim() === expectedSecret.trim();
  }
}
