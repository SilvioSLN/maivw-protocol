import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type {
  EmailProviderAdapter,
  GenericSmtpConfig,
  OutboundSendResult,
  PreparedEmailMessage,
} from "../types.js";

/**
 * GenericSmtpAdapter — Conector real para servidores de e-mail próprios e corporativos
 * (Google Workspace, Microsoft 365, Zoho, Hostinger, Locaweb, Umbler, cPanel, Postfix, etc.)
 */
export class GenericSmtpAdapter implements EmailProviderAdapter {
  readonly id = "generic_smtp";
  private config: GenericSmtpConfig;
  private transporter: Transporter | null = null;

  constructor(config: GenericSmtpConfig) {
    this.config = config;
    if (config.host && config.user && config.pass) {
      const port = Number(config.port) || 465;
      const isSecure = config.secure !== undefined ? Boolean(config.secure) : port === 465;

      this.transporter = nodemailer.createTransport({
        host: config.host,
        port,
        secure: isSecure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        tls: {
          rejectUnauthorized: false, // Compatibilidade com certificados autoassinados de servidores VPS/cPanel
        },
      });
    }
  }

  async sendEmail(message: PreparedEmailMessage): Promise<OutboundSendResult> {
    try {
      if (!this.transporter) {
        return {
          success: false,
          provider: "generic_smtp",
          error: "Configurações de SMTP corporativo incompletas (Host, Usuário e Senha são obrigatórios).",
        };
      }

      console.log(`[GenericSmtpAdapter] 🚀 Disparando e-mail via SMTP ${this.config.host}:${this.config.port}`);
      console.log(`[GenericSmtpAdapter] De: ${message.from} -> Para: ${message.to}`);

      // Mapear anexos nativos para o formato Nodemailer
      const attachments = message.nativeAttachments.map((att) => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      }));

      if (attachments.length > 0) {
        console.log(`[GenericSmtpAdapter] 📎 Incluindo ${attachments.length} anexo(s) nativo(s) MIME`);
      }
      if (message.largeAttachments.length > 0) {
        console.log(`[GenericSmtpAdapter] 🛡️ Incluindo ${message.largeAttachments.length} anexo(s) via Card MAIVW SHA-256`);
      }

      const info = await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      console.log(`[GenericSmtpAdapter] ✅ E-mail enviado com sucesso via SMTP! ID: ${info.messageId}`);
      return {
        success: true,
        provider: "generic_smtp",
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error(`[GenericSmtpAdapter] ❌ Falha no envio SMTP:`, err.message);
      return {
        success: false,
        provider: "generic_smtp",
        error: err.message || "Erro de envio no servidor SMTP corporativo",
      };
    }
  }

  /**
   * Testa a conexão real e credenciais com o servidor SMTP (handshake TLS + autenticação)
   * e opcionalmente dispara um e-mail de teste de entrega.
   */
  async testConnection(
    config?: GenericSmtpConfig,
    testEmailDestination?: string
  ): Promise<{ ok: boolean; provider: string; message: string }> {
    const activeConfig = config || this.config;
    if (!activeConfig.host || !activeConfig.user || !activeConfig.pass) {
      return {
        ok: false,
        provider: "generic_smtp",
        message: "Host, Usuário e Senha são obrigatórios para validar a conexão SMTP.",
      };
    }

    try {
      const port = Number(activeConfig.port) || 465;
      const isSecure = activeConfig.secure !== undefined ? Boolean(activeConfig.secure) : port === 465;

      const testTransporter = nodemailer.createTransport({
        host: activeConfig.host,
        port,
        secure: isSecure,
        auth: {
          user: activeConfig.user,
          pass: activeConfig.pass,
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
        tls: {
          rejectUnauthorized: false,
        },
      });

      // 1. Validar handshake TLS e autenticação
      await testTransporter.verify();

      // 2. Se foi fornecido um e-mail de teste para validação de entrega real:
      if (testEmailDestination) {
        const fromAddr = activeConfig.fromEmail || activeConfig.user;
        const fromName = activeConfig.fromName || "MAIVW Admin";
        await testTransporter.sendMail({
          from: `${fromName} <${fromAddr}>`,
          to: testEmailDestination,
          subject: "✅ [MAIVW] Teste de Conexão SMTP Concluído",
          text: `Parabéns! Sua conexão com o servidor SMTP (${activeConfig.host}:${port}) foi validada e está funcionando perfeitamente na rede MAIVW.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
              <h2 style="color: #0284c7; margin-top: 0;">🛡️ Conexão SMTP Validada com Sucesso!</h2>
              <p style="color: #334155; font-size: 14px;">
                Este é um e-mail de teste automático enviado pelo nó corporativo <strong>MAIVW</strong>.
              </p>
              <div style="background: #ffffff; padding: 12px 16px; border-radius: 6px; border: 1px solid #cbd5e1; font-family: monospace; font-size: 13px; color: #0f172a;">
                <strong>Servidor:</strong> ${activeConfig.host}:${port}<br/>
                <strong>Criptografia:</strong> ${isSecure ? "SSL Direto (Porta 465)" : "STARTTLS (Porta 587)"}<br/>
                <strong>Usuário:</strong> ${activeConfig.user}<br/>
                <strong>Data/Hora:</strong> ${new Date().toLocaleString("pt-BR")}
              </div>
              <p style="font-size: 12px; color: #64748b; margin-top: 16px;">
                Seu domínio agora está apto a enviar e receber e-mails tradicionais com alta segurança e soberania.
              </p>
            </div>
          `,
        });

        return {
          ok: true,
          provider: "generic_smtp",
          message: `Conexão validada com sucesso! E-mail de teste enviado para ${testEmailDestination}.`,
        };
      }

      return {
        ok: true,
        provider: "generic_smtp",
        message: `Conexão e autenticação SMTP validadas com sucesso em ${activeConfig.host}:${port}!`,
      };
    } catch (err: any) {
      console.error("[GenericSmtpAdapter] ❌ Erro no teste de conexão:", err.message);
      return {
        ok: false,
        provider: "generic_smtp",
        message: `Falha na conexão SMTP (${err.code || "AUTH"}): ${err.message}`,
      };
    }
  }
}
