import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { SmtpService } from "../services/SmtpService.js";
import { getAuthUser } from "./auth.js";
import { EMAIL_PROVIDER_PRESETS } from "../services/email/presets.js";

const SmtpConfigSchema = z.object({
  domainId: z.coerce.number().int().positive().optional(),
  provider: z.string().default("resend"),
  apiKey: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().optional(),
  imapSecure: z.boolean().optional(),
  imapUser: z.string().optional(),
  imapPass: z.string().optional(),
  fromName: z.string().optional(),
  fromEmail: z.string().email().optional(),
});

interface SettingsRouteOptions {
  prisma: PrismaClient;
  smtp: SmtpService;
  masterKey: string;
}

/**
 * Rotas de Configurações — Provedor SMTP, DNS e Domínio
 * Acesso estritamente restrito ao Administrador do próprio domínio
 */
export async function settingsRoutes(app: FastifyInstance, options: SettingsRouteOptions) {
  const { prisma, smtp, masterKey } = options;

  /**
   * GET /api/v1/settings/smtp/presets
   * Retorna os presets e configurações pré-prontas de provedores conhecidos
   */
  app.get("/api/v1/settings/smtp/presets", async (_request, reply) => {
    return reply.send({
      success: true,
      presets: EMAIL_PROVIDER_PRESETS,
    });
  });

  /**
   * GET /api/v1/settings/smtp
   * Retorna configuração do provedor SMTP pertencente ao domínio do admin (sem expor a senha)
   */
  app.get("/api/v1/settings/smtp", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem acessar as configurações de SMTP.",
      });
    }

    const query = request.query as { domainId?: string };
    const targetDomainId = query.domainId ? parseInt(query.domainId, 10) : undefined;

    let domain: any = null;
    if (targetDomainId) {
      domain = await prisma.domain.findFirst({
        where: { id: targetDomainId, userId: authUser.id },
        include: { smtpConfig: true },
      });
    } else {
      domain = await prisma.domain.findFirst({
        where: { userId: authUser.id },
        include: { smtpConfig: true },
      });
    }

    if (!domain) {
      return reply.status(404).send({
        error: "Domínio não encontrado",
        message: "Nenhum domínio configurado para este administrador.",
      });
    }

    if (domain.smtpConfig) {
      let decrypted = "";
      try {
        decrypted = SmtpService.decryptApiKey(
          domain.smtpConfig.encryptedApiKey,
          domain.smtpConfig.iv,
          domain.smtpConfig.authTag,
          masterKey
        );
      } catch (err: any) {
        app.log.warn(`[SETTINGS] Falha ao decriptar chave SMTP: ${err.message}`);
      }

      if (decrypted.startsWith("re_") || domain.smtpConfig.provider === "resend") {
        return {
          configured: true,
          provider: domain.smtpConfig.provider,
          fromName: domain.smtpConfig.fromName,
          fromEmail: domain.smtpConfig.fromEmail,
          isActive: domain.smtpConfig.isActive,
          lastTestedAt: domain.smtpConfig.lastTestedAt,
          domainName: domain.domainName,
          domainId: domain.id,
          hasPassword: Boolean(decrypted),
          authType: "apiKey",
        };
      }

      // Provedores SMTP genéricos (Google, Microsoft, Zoho, Hostinger, Locaweb, Umbler, cPanel, etc.)
      try {
        const parsed = JSON.parse(decrypted);
        return {
          configured: true,
          provider: domain.smtpConfig.provider,
          smtpHost: parsed.host || parsed.smtpHost || "",
          smtpPort: parsed.port || parsed.smtpPort || 465,
          smtpSecure: parsed.secure !== undefined ? parsed.secure : (parsed.smtpSecure !== undefined ? parsed.smtpSecure : true),
          smtpUser: parsed.user || parsed.smtpUser || "",
          imapHost: parsed.imapHost || "",
          imapPort: parsed.imapPort || 993,
          imapSecure: parsed.imapSecure !== undefined ? parsed.imapSecure : true,
          imapUser: parsed.imapUser || parsed.user || "",
          fromName: domain.smtpConfig.fromName || parsed.fromName,
          fromEmail: domain.smtpConfig.fromEmail || parsed.fromEmail,
          isActive: domain.smtpConfig.isActive,
          lastTestedAt: domain.smtpConfig.lastTestedAt,
          domainName: domain.domainName,
          domainId: domain.id,
          hasPassword: Boolean(parsed.pass || parsed.smtpPass),
          authType: "credentials",
        };
      } catch {
        return {
          configured: true,
          provider: domain.smtpConfig.provider,
          fromName: domain.smtpConfig.fromName,
          fromEmail: domain.smtpConfig.fromEmail,
          isActive: domain.smtpConfig.isActive,
          lastTestedAt: domain.smtpConfig.lastTestedAt,
          domainName: domain.domainName,
          domainId: domain.id,
          hasPassword: Boolean(decrypted),
          authType: "apiKey",
        };
      }
    }

    // Fallback: retorna info do provedor padrão (env) se ainda não configurou personalizado
    const info = smtp.getProviderInfo();
    return {
      configured: info.configured,
      provider: info.provider,
      fromName: null,
      fromEmail: null,
      isActive: info.configured,
      lastTestedAt: null,
      domainName: domain.domainName,
      domainId: domain.id,
      hasPassword: false,
      authType: "apiKey",
    };
  });

  /**
   * PUT & POST /api/v1/settings/smtp
   * Salva/atualiza a configuração SMTP exclusivamente para o domínio do admin
   */
  const handleSaveSmtp = async (request: any, reply: any) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem salvar configurações de SMTP.",
      });
    }

    const body = request.body as any;
    const parse = SmtpConfigSchema.safeParse(body);

    if (!parse.success) {
      return reply.status(400).send({
        error: "Validation Error",
        details: parse.error.flatten(),
      });
    }

    const {
      provider,
      apiKey,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPass,
      imapHost,
      imapPort,
      imapSecure,
      imapUser,
      imapPass,
      fromName,
      fromEmail,
      domainId: targetDomainId,
    } = parse.data;

    // Buscar domínio estritamente pertencente a este admin
    let domain: any = null;
    if (targetDomainId) {
      domain = await prisma.domain.findFirst({
        where: { id: targetDomainId, userId: authUser.id },
        include: { smtpConfig: true },
      });
    } else {
      domain = await prisma.domain.findFirst({
        where: { userId: authUser.id },
        include: { smtpConfig: true },
      });
    }

    if (!domain) {
      return reply.status(404).send({
        error: "Domínio não encontrado",
        message: "Nenhum domínio cadastrado para este administrador.",
      });
    }

    const domainId = domain.id;
    let rawSecretToEncrypt = "";

    // Se for provedor tipo API (Resend, SendGrid, SES)
    if (provider === "resend" || (apiKey && apiKey.startsWith("re_"))) {
      if (!apiKey && domain.smtpConfig) {
        // Manter chave existente se não forneceu nova
        try {
          rawSecretToEncrypt = SmtpService.decryptApiKey(
            domain.smtpConfig.encryptedApiKey,
            domain.smtpConfig.iv,
            domain.smtpConfig.authTag,
            masterKey
          );
        } catch {}
      } else {
        rawSecretToEncrypt = apiKey || "";
      }

      if (!rawSecretToEncrypt) {
        return reply.status(400).send({ error: "Chave de API do Resend é obrigatória" });
      }
    } else {
      // Provedores SMTP (Google, Microsoft, Zoho, Hostinger, Locaweb, Umbler, cPanel, Custom)
      let existingPass = "";
      if (domain.smtpConfig) {
        try {
          const dec = SmtpService.decryptApiKey(
            domain.smtpConfig.encryptedApiKey,
            domain.smtpConfig.iv,
            domain.smtpConfig.authTag,
            masterKey
          );
          const parsed = JSON.parse(dec);
          existingPass = parsed.pass || parsed.smtpPass || "";
        } catch {}
      }

      const finalPass = smtpPass || existingPass;
      if (!finalPass) {
        return reply.status(400).send({
          error: "Senha é obrigatória",
          message: "Informe a senha ou senha de app da conta de e-mail corporativo.",
        });
      }

      const smtpConfigPayload = {
        host: smtpHost || `mail.${domain.domainName}`,
        port: Number(smtpPort) || 465,
        secure: smtpSecure !== undefined ? smtpSecure : Number(smtpPort) === 465,
        user: smtpUser || fromEmail || `contato@${domain.domainName}`,
        pass: finalPass,
        imapHost: imapHost || smtpHost || `mail.${domain.domainName}`,
        imapPort: Number(imapPort) || 993,
        imapSecure: imapSecure !== undefined ? imapSecure : true,
        imapUser: imapUser || smtpUser || fromEmail || `contato@${domain.domainName}`,
        imapPass: imapPass || finalPass,
        fromName: fromName || "MAIVW",
        fromEmail: fromEmail || smtpUser || `contato@${domain.domainName}`,
      };

      rawSecretToEncrypt = JSON.stringify(smtpConfigPayload);
    }

    // Criptografar a configuração antes de persistir
    const { encrypted, iv, authTag } = SmtpService.encryptApiKey(rawSecretToEncrypt, masterKey);

    const config = await prisma.smtpConfig.upsert({
      where: { domainId },
      create: {
        domainId,
        provider,
        encryptedApiKey: encrypted,
        iv,
        authTag,
        fromName: fromName || "MAIVW",
        fromEmail: fromEmail || null,
        isActive: true,
      },
      update: {
        provider,
        encryptedApiKey: encrypted,
        iv,
        authTag,
        fromName: fromName || "MAIVW",
        fromEmail: fromEmail || null,
        isActive: true,
      },
    });

    if (provider === "resend" && apiKey) {
      smtp.updateApiKey(apiKey);
    }

    return {
      success: true,
      provider: config.provider,
      domainId: config.domainId,
      message: `Configurações do provedor ${provider.toUpperCase()} salvas com sucesso para ${domain.domainName}!`,
    };
  };

  app.put("/api/v1/settings/smtp", handleSaveSmtp);
  app.post("/api/v1/settings/smtp", handleSaveSmtp);

  /**
   * POST /api/v1/settings/smtp/test
   * Testa a conectividade com o provedor SMTP e opcionalmente envia um e-mail de teste real
   */
  app.post("/api/v1/settings/smtp/test", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem testar a conexão SMTP.",
      });
    }

    const body = (request.body as {
      apiKey?: string;
      domainId?: number;
      provider?: string;
      smtpHost?: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      smtpUser?: string;
      smtpPass?: string;
      testEmail?: string;
    }) || {};

    let domain: any = null;
    if (body.domainId) {
      domain = await prisma.domain.findFirst({
        where: { id: body.domainId, userId: authUser.id },
        include: { smtpConfig: true },
      });
    } else {
      domain = await prisma.domain.findFirst({
        where: { userId: authUser.id },
        include: { smtpConfig: true },
      });
    }

    // Se passou parâmetros SMTP manuais para teste antes de salvar
    if (body.smtpHost && body.smtpUser) {
      let finalPass = body.smtpPass;
      if (!finalPass && domain?.smtpConfig) {
        try {
          const dec = SmtpService.decryptApiKey(
            domain.smtpConfig.encryptedApiKey,
            domain.smtpConfig.iv,
            domain.smtpConfig.authTag,
            masterKey
          );
          const parsed = JSON.parse(dec);
          finalPass = parsed.pass || parsed.smtpPass;
        } catch {}
      }

      if (!finalPass) {
        return reply.status(400).send({
          ok: false,
          provider: body.provider || "smtp",
          message: "Senha do servidor SMTP é obrigatória para testar a conexão.",
        });
      }

      const result = await smtp.testConnection(
        {
          host: body.smtpHost,
          port: body.smtpPort || 465,
          secure: body.smtpSecure !== undefined ? body.smtpSecure : Number(body.smtpPort) === 465,
          user: body.smtpUser,
          pass: finalPass,
          fromName: "MAIVW Test",
          fromEmail: body.smtpUser,
        },
        body.testEmail
      );

      if (domain?.smtpConfig && result.ok) {
        await prisma.smtpConfig.update({
          where: { domainId: domain.id },
          data: { lastTestedAt: new Date() },
        });
      }

      return result;
    }

    // Se passou apiKey direta
    if (body.apiKey) {
      const result = await smtp.testConnection(body.apiKey);
      return result;
    }

    // Usar dados salvos no banco para o domínio
    const result = await smtp.testConnection(undefined, body.testEmail, domain?.id);

    if (domain?.smtpConfig && result.ok) {
      await prisma.smtpConfig.update({
        where: { domainId: domain.id },
        data: { lastTestedAt: new Date() },
      });
    }

    return result;
  });

  /**
   * GET /api/v1/settings/domain/:domainId
   * Retorna informações do domínio (apenas para o admin proprietário)
   */
  app.get("/api/v1/settings/domain/:domainId", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Acesso restrito a administradores.",
      });
    }

    const { domainId } = request.params as { domainId: string };
    const domain = await prisma.domain.findFirst({
      where: { id: parseInt(domainId, 10), userId: authUser.id },
      include: {
        smtpConfig: true,
        accounts: true,
      },
    });

    if (!domain) {
      return reply.status(404).send({
        error: "Domínio não encontrado",
        message: "Domínio não localizado ou não pertence à sua conta.",
      });
    }

    return {
      domainId: domain.id,
      domainName: domain.domainName,
      isVerified: domain.isVerified,
      smtpConfigured: !!domain.smtpConfig,
      smtpProvider: domain.smtpConfig?.provider || null,
      accountsCount: domain.accounts.length,
      createdAt: domain.createdAt,
    };
  });
}
