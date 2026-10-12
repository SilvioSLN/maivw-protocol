import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AttachmentItem } from "../schemas/payload.js";
import { AttachmentProcessor } from "./email/AttachmentProcessor.js";
import { ResendAdapter } from "./email/adapters/ResendAdapter.js";
import { GenericSmtpAdapter } from "./email/adapters/GenericSmtpAdapter.js";
import type { EmailProviderAdapter, GenericSmtpConfig } from "./email/types.js";

/**
 * SmtpService — Orquestrador do Repasse e Leitura de E-mails Tradicionais (SMTP/APIs)
 * 
 * Implementa arquitetura em camadas (Provider Adapter Pattern):
 * - Resend API (com envio nativo de anexos até 25MB e fallback para cards SHA-256)
 * - Provedores genéricos de SMTP/cPanel (Google Workspace, Microsoft 365, Zoho, Hostinger, Locaweb, Umbler, cPanel)
 * - Teste em tempo real de conexão e disparo de e-mail de teste
 * - Inbound Sync para leitura e polling de e-mails
 */
export class SmtpService {
  private defaultAdapter: EmailProviderAdapter | null = null;
  private envApiKey: string | null = null;
  private prisma: PrismaClient | null = null;
  private masterKey: string;

  constructor(envApiKey?: string, prisma?: PrismaClient, masterKey?: string) {
    this.envApiKey = envApiKey || null;
    this.prisma = prisma || null;
    this.masterKey = masterKey || "";

    if (this.envApiKey) {
      this.defaultAdapter = new ResendAdapter(this.envApiKey);
      console.log("[SMTP] ✅ Provedor Resend inicializado a partir de variável de ambiente");
    } else {
      console.log("[SMTP] ℹ️ Inicializando SmtpService (chaves serão resolvidas dinamicamente via DB ou fallback)");
    }
  }

  /**
   * Envia um e-mail real via provedor configurado com suporte híbrido inteligente a anexos
   */
  async sendEmail(
    to: string,
    subject: string,
    content: { text: string; html?: string; attachments?: AttachmentItem[] },
    senderDomain: string,
    fromName?: string,
    fromEmail?: string
  ): Promise<{ success: boolean; provider: string; messageId?: string; error?: string }> {
    let activeAdapter: EmailProviderAdapter | null = this.defaultAdapter;
    let resolvedFromName = fromName;
    let resolvedFromEmail = fromEmail;

    // 1. Tentar buscar configuração ativa no banco de dados (SmtpConfig)
    if (this.prisma) {
      try {
        let dbConfig = await this.prisma.smtpConfig.findFirst({
          where: {
            isActive: true,
            domain: { domainName: senderDomain },
          },
          include: { domain: true },
        });

        // Se não achou pelo senderDomain exato, busca a configuração mais recente ativa
        if (!dbConfig) {
          dbConfig = await this.prisma.smtpConfig.findFirst({
            where: { isActive: true },
            include: { domain: true },
            orderBy: { updatedAt: "desc" },
          });
        }

        if (dbConfig) {
          try {
            const decryptedKey = SmtpService.decryptApiKey(
              dbConfig.encryptedApiKey,
              dbConfig.iv,
              dbConfig.authTag,
              this.masterKey
            );

            if (decryptedKey && (decryptedKey.startsWith("re_") || dbConfig.provider === "resend")) {
              activeAdapter = new ResendAdapter(decryptedKey);
              if (!resolvedFromName && dbConfig.fromName) {
                resolvedFromName = dbConfig.fromName;
              }
              if (!resolvedFromEmail) {
                resolvedFromEmail = dbConfig.fromEmail || `contato@${dbConfig.domain.domainName}`;
              }
              console.log(`[SMTP] 🔑 Provedor Resend ativo via banco de dados para o domínio ${dbConfig.domain.domainName}`);
            } else if (decryptedKey) {
              // Provedores SMTP (Google Workspace, Microsoft, Zoho, Hostinger, Locaweb, Umbler, cPanel, etc.)
              try {
                const parsedSmtp = JSON.parse(decryptedKey);
                activeAdapter = new GenericSmtpAdapter({
                  host: parsedSmtp.host || parsedSmtp.smtpHost,
                  port: Number(parsedSmtp.port || parsedSmtp.smtpPort) || 465,
                  secure: parsedSmtp.secure !== undefined ? parsedSmtp.secure : parsedSmtp.smtpSecure,
                  user: parsedSmtp.user || parsedSmtp.smtpUser,
                  pass: parsedSmtp.pass || parsedSmtp.smtpPass,
                  fromName: resolvedFromName || dbConfig.fromName || parsedSmtp.fromName,
                  fromEmail: resolvedFromEmail || dbConfig.fromEmail || parsedSmtp.fromEmail,
                  imapHost: parsedSmtp.imapHost,
                  imapPort: parsedSmtp.imapPort,
                  imapSecure: parsedSmtp.imapSecure,
                  imapUser: parsedSmtp.imapUser,
                  imapPass: parsedSmtp.imapPass,
                });
                console.log(`[SMTP] 🏢 Provedor ${dbConfig.provider.toUpperCase()} (SMTP) carregado para o domínio ${dbConfig.domain.domainName}`);
              } catch (parseErr) {
                console.warn(`[SMTP] ⚠️ Formato de configuração SMTP inválido no banco:`, parseErr);
              }
            }
          } catch (decryptErr: any) {
            console.error(`[SMTP] ❌ Erro ao decriptar chave SMTP do banco:`, decryptErr.message);
          }
        }
      } catch (dbErr: any) {
        console.error(`[SMTP] ⚠️ Falha na busca de configuração SMTP no banco:`, dbErr.message);
      }
    }

    // 2. Resolver endereço de remetente (From)
    const fallbackEmail = `contato@${senderDomain}`;
    const effectiveEmail = resolvedFromEmail || fallbackEmail;
    const effectiveName = resolvedFromName || "MAIVW";
    const displayFrom = `${effectiveName} <${effectiveEmail}>`;

    // 3. Processar anexos com a estratégia híbrida inteligente (<=25MB nativo, >25MB card SHA-256)
    const prepared = await AttachmentProcessor.processMessage(to, displayFrom, subject, content);

    // 4. Executar envio através do adaptador ativo
    if (activeAdapter) {
      const sendResult = await activeAdapter.sendEmail(prepared);

      if (sendResult.success) {
        console.log("");
        console.log("╔══════════════════════════════════════════════════════════════╗");
        console.log(`║  ✅ [SMTP REAL] E-mail enviado com sucesso via ${sendResult.provider.toUpperCase()}!      ║`);
        console.log("╠══════════════════════════════════════════════════════════════╣");
        console.log(`║  De:      ${displayFrom}`);
        console.log(`║  Para:    ${to}`);
        console.log(`║  Assunto: ${subject}`);
        console.log(`║  Anexos:  Nativos: ${prepared.nativeAttachments.length} | Links: ${prepared.largeAttachments.length}`);
        console.log(`║  ID:      ${sendResult.messageId || "N/A"}`);
        console.log("╚══════════════════════════════════════════════════════════════╝");
        console.log("");
      }

      return sendResult;
    }

    // 5. Sem provedor configurado
    console.warn("[SMTP] ⚠️ Nenhum provedor de e-mail configurado (nem no banco nem no .env)");
    return {
      success: false,
      provider: "none",
      error: "Nenhum provedor de e-mail configurado. Adicione sua chave do Resend ou dados SMTP nas Configurações.",
    };
  }

  /**
   * Testa conectividade com o provedor usando a API Key ou configuração SMTP completa,
   * permitindo opcionalmente enviar um e-mail de teste de verificação.
   */
  async testConnection(
    configOrKey?: string | any,
    testEmailDestination?: string,
    domainId?: number
  ): Promise<{ ok: boolean; provider: string; message: string }> {
    // 1. Se passou um objeto de configuração SMTP direto
    if (configOrKey && typeof configOrKey === "object") {
      const adapter = new GenericSmtpAdapter({
        host: configOrKey.host || configOrKey.smtpHost,
        port: Number(configOrKey.port || configOrKey.smtpPort) || 465,
        secure: configOrKey.secure !== undefined ? configOrKey.secure : configOrKey.smtpSecure,
        user: configOrKey.user || configOrKey.smtpUser,
        pass: configOrKey.pass || configOrKey.smtpPass,
        fromName: configOrKey.fromName,
        fromEmail: configOrKey.fromEmail,
      });
      return adapter.testConnection(undefined, testEmailDestination);
    }

    // 2. Se passou uma string de chave direta
    if (typeof configOrKey === "string" && configOrKey.trim().length > 0) {
      const trimmed = configOrKey.trim();
      if (trimmed.startsWith("re_")) {
        const adapter = new ResendAdapter(trimmed);
        return adapter.testConnection();
      }
      try {
        const parsed = JSON.parse(trimmed);
        const adapter = new GenericSmtpAdapter(parsed);
        return adapter.testConnection(undefined, testEmailDestination);
      } catch {
        const adapter = new ResendAdapter(trimmed);
        return adapter.testConnection();
      }
    }

    // 3. Tentar carregar do banco de dados pelo domainId
    if (this.prisma && domainId) {
      const dbConfig = await this.prisma.smtpConfig.findUnique({
        where: { domainId },
      });
      if (dbConfig) {
        try {
          const decrypted = SmtpService.decryptApiKey(
            dbConfig.encryptedApiKey,
            dbConfig.iv,
            dbConfig.authTag,
            this.masterKey
          );
          if (decrypted.startsWith("re_") || dbConfig.provider === "resend") {
            const adapter = new ResendAdapter(decrypted);
            return adapter.testConnection();
          } else {
            const parsed = JSON.parse(decrypted);
            const adapter = new GenericSmtpAdapter(parsed);
            return adapter.testConnection(undefined, testEmailDestination);
          }
        } catch (e: any) {
          return { ok: false, provider: "error", message: `Erro ao decriptar chave do banco: ${e.message}` };
        }
      }
    }

    // 4. Fallback para env
    if (this.envApiKey) {
      const adapter = new ResendAdapter(this.envApiKey);
      return adapter.testConnection();
    }

    return {
      ok: false,
      provider: "none",
      message: "Nenhuma configuração ou chave de provedor encontrada para testar.",
    };
  }

  /**
   * Atualiza o cliente Resend com uma nova API Key (chamado quando o admin configura via UI)
   */
  updateApiKey(apiKey: string): void {
    this.defaultAdapter = new ResendAdapter(apiKey);
    this.envApiKey = apiKey;
    console.log("[SMTP] 🔄 Adaptador padrão atualizado com nova API key");
  }

  /**
   * Retorna informações do provedor atual (sem expor a chave)
   */
  getProviderInfo(): { provider: string; configured: boolean } {
    return {
      provider: this.defaultAdapter ? this.defaultAdapter.id : "mock",
      configured: !!this.defaultAdapter,
    };
  }

  /**
   * Sincroniza e-mails recebidos do Resend (Inbound) diretamente da API
   */
  async syncInboundEmails(domainName?: string): Promise<number> {
    if (!this.prisma) return 0;

    let syncedCount = 0;
    try {
      const where: any = { isActive: true };
      if (domainName) {
        where.domain = { domainName: domainName.toLowerCase().trim() };
      }

      const configs = await this.prisma.smtpConfig.findMany({
        where,
        include: { domain: true },
      });

      for (const config of configs) {
        let apiKey: string | null = null;
        if (this.masterKey && config.encryptedApiKey && config.iv && config.authTag) {
          try {
            apiKey = SmtpService.decryptApiKey(config.encryptedApiKey, config.iv, config.authTag, this.masterKey);
          } catch (e: any) {
            console.error(`[SMTP-SYNC] Erro ao decriptar chave para domínio ${config.domain.domainName}:`, e.message);
          }
        }
        if (!apiKey) apiKey = this.envApiKey || null;
        if (!apiKey || !apiKey.startsWith("re_")) continue;

        const adapter = new ResendAdapter(apiKey);
        const count = await adapter.syncInboundEmailsWithPrisma(this.prisma, config.domainId);
        syncedCount += count;
      }
    } catch (err: any) {
      console.error(`[SMTP-SYNC] Erro durante sincronização inbound:`, err.message);
    }

    return syncedCount;
  }

  // === Utilitários de criptografia para armazenar API keys no banco ===

  static encryptApiKey(apiKey: string, masterKey: string): { encrypted: string; iv: string; authTag: string } {
    const keyBuffer = crypto.createHash("sha256").update(masterKey).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

    let encrypted = cipher.update(apiKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    return {
      encrypted,
      iv: iv.toString("hex"),
      authTag,
    };
  }

  static decryptApiKey(encrypted: string, iv: string, authTag: string, masterKey: string): string {
    const keyBuffer = crypto.createHash("sha256").update(masterKey).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTag, "hex"));

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
}
