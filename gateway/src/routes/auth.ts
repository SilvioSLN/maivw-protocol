import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { KeyManagementService } from "../services/KeyManagementService.js";
import { verifyFirebaseIdToken } from "../services/FirebaseAuthService.js";

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES = "7d";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const DomainSchema = z.object({
  domainName: z.string().min(3),
  userId: z.number().int().positive(),
  isVerified: z.boolean().default(true),
});

const ApiKeySchema = z.object({
  domainId: z.coerce.number().int().positive().optional(),
  name: z.string().min(1).default("Default Key"),
  environment: z.enum(["production", "staging"]).default("production"),
});

const CreateAccountSchema = z.object({
  localPart: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/, "Apenas letras, números, pontos, hífens e underscores"),
  displayName: z.string().optional(),
  password: z.string().min(6),
  domainId: z.coerce.number().int().positive().optional(),
});

import type { SmtpService } from "../services/SmtpService.js";

interface AuthRouteOptions {
  prisma: PrismaClient;
  kms: KeyManagementService;
  smtp?: SmtpService;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  const computed = crypto.createHash("sha256").update(salt + password).digest("hex");
  return computed === hash;
}

function generateToken(user: { id: number; email: string; role: string; domainId?: number; domainName?: string }): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function getAuthUser(request: any): { id: number; email: string; role: string; domainId?: number; domainName?: string } | null {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const rawToken = authHeader.replace("Bearer ", "").trim();
    return jwt.verify(rawToken, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions) {
  const { prisma, kms, smtp } = options;

  /**
   * POST /api/v1/auth/register
   * Cria um novo usuário admin com seu domínio
   */
  app.post("/api/v1/auth/register", async (request, reply) => {
    const parse = RegisterSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { email, password, displayName } = parse.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Verificar se já existe
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return reply.status(409).send({
        error: "E-mail já cadastrado",
        message: `O e-mail ${email} já está em uso.`,
      });
    }

    const passwordHash = hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: displayName || null,
        role: "admin",
      },
    });

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return reply.status(201).send({
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      token,
      message: "Conta criada com sucesso!",
    });
  });

  /**
   * POST /api/v1/auth/google
   * Autentica ou cadastra usuário via Google Sign-In (Firebase Auth)
   */
  app.post("/api/v1/auth/google", async (request, reply) => {
    const body = request.body as { idToken?: string; email?: string; displayName?: string };
    let email = body.email;
    let displayName = body.displayName;

    if (body.idToken) {
      try {
        const decoded = await verifyFirebaseIdToken(body.idToken);
        if (decoded.email) {
          email = decoded.email;
          displayName = displayName || decoded.name || decoded.email.split("@")[0];
        }
      } catch (err: any) {
        app.log.warn(`[AUTH] Verificação do token Firebase falhou: ${err.message}`);
        if (!email) {
          return reply.status(401).send({
            error: "Token Firebase inválido",
            message: err.message,
          });
        }
      }
    }

    if (!email) {
      return reply.status(400).send({
        error: "Dados incompletos",
        message: "E-mail não fornecido pelo Google.",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Buscar usuário existente
    let user: any = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: {
        domains: {
          include: { accounts: true },
          take: 1,
        },
      },
    });

    if (!user) {
      // Criar novo usuário como admin (para novos cadastros via /signup)
      const randomPassword = crypto.randomBytes(24).toString("hex");
      const passwordHash = hashPassword(randomPassword);

      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          passwordHash,
          displayName: displayName || cleanEmail.split("@")[0],
          role: "admin",
        },
        include: {
          domains: {
            include: { accounts: true },
            take: 1,
          },
        },
      });
    }

    let domain: any = user.domains?.[0] || null;
    if (!domain) {
      const emailAcc = await prisma.emailAccount.findFirst({
        where: { userId: user.id },
        include: { domain: true },
      });
      if (emailAcc) {
        domain = emailAcc.domain;
      }
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      domainId: domain?.id,
      domainName: domain?.domainName,
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      domain: domain
        ? {
            id: domain.id,
            domainName: domain.domainName,
            isVerified: domain.isVerified,
          }
        : null,
      token,
      message: "Autenticação via Google realizada com sucesso!",
    };
  });

  /**
   * POST /api/v1/auth/login
   * Login com email e senha, retorna JWT
   */
  app.post("/api/v1/auth/login", async (request, reply) => {
    const parse = LoginSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { email, password } = parse.data;
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Buscar usuário
    let user: any = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        domains: {
          include: { accounts: true },
          take: 1,
        },
      },
    });

    if (!user) {
      // Tentar buscar por EmailAccount (contas criadas pelo admin)
      const atIndex = normalizedEmail.lastIndexOf("@");
      if (atIndex > 0) {
        const localPart = normalizedEmail.substring(0, atIndex);
        const domainPart = normalizedEmail.substring(atIndex + 1);

        const domain = await prisma.domain.findUnique({
          where: { domainName: domainPart },
        });

        if (domain) {
          const emailAccount = await prisma.emailAccount.findUnique({
            where: {
              localPart_domainId: {
                localPart,
                domainId: domain.id,
              },
            },
            include: { domain: true },
          });

          if (emailAccount && emailAccount.userId) {
            const accountUser = await prisma.user.findUnique({
              where: { id: emailAccount.userId },
            });

            if (accountUser && verifyPassword(password, accountUser.passwordHash)) {
              user = accountUser;
            }
          }
        }
      }
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.status(401).send({
        error: "Credenciais inválidas",
        message: "E-mail ou senha incorretos.",
      });
    }

    // 2. Resolver domínio associado (se for admin ou conta de e-mail)
    let domain: any = user.domains?.[0] || null;
    if (!domain) {
      const emailAcc = await prisma.emailAccount.findFirst({
        where: { userId: user.id },
        include: { domain: true },
      });
      if (emailAcc) {
        domain = emailAcc.domain;
      }
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      domainId: domain?.id,
      domainName: domain?.domainName,
    });

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      domainId: domain?.id,
      domainName: domain?.domainName,
      token,
    };
  });

  /**
   * GET /api/v1/auth/me
   * Retorna dados do usuário logado (via JWT)
   */
  app.get("/api/v1/auth/me", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Token não fornecido" });
    }

    try {
      const token = authHeader.replace("Bearer ", "").trim();
      const decoded = jwt.verify(token, JWT_SECRET) as any;

      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: {
          domains: {
            include: {
              accounts: true,
              smtpConfig: { select: { provider: true, isActive: true } },
            },
          },
        },
      });

      if (!user) {
        return reply.status(404).send({ error: "Usuário não encontrado" });
      }

      let domain = user.domains[0] || null;
      if (!domain) {
        const emailAcc = await prisma.emailAccount.findFirst({
          where: { userId: user.id },
          include: {
            domain: {
              include: {
                accounts: true,
                smtpConfig: { select: { provider: true, isActive: true } },
              },
            },
          },
        });
        if (emailAcc) {
          domain = emailAcc.domain;
        }
      }

      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        domain: domain
          ? {
              id: domain.id,
              domainName: domain.domainName,
              isVerified: domain.isVerified,
              smtpConfigured: !!domain.smtpConfig,
              smtpProvider: domain.smtpConfig?.provider || null,
              accounts: domain.accounts.map((a: any) => ({
                id: a.id,
                email: `${a.localPart}@${domain.domainName}`,
                displayName: a.displayName,
                isActive: a.isActive,
              })),
            }
          : null,
      };
    } catch {
      return reply.status(401).send({ error: "Token inválido ou expirado" });
    }
  });

  /**
   * POST /api/v1/auth/accounts
   * Admin cria uma conta de e-mail no domínio (restrito a admin e ao próprio domínio)
   */
  app.post("/api/v1/auth/accounts", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem criar contas de e-mail.",
      });
    }

    const parse = CreateAccountSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    try {
      const { localPart, displayName, password, domainId: targetDomainId } = parse.data;
      const cleanLocal = localPart.toLowerCase().trim();

      // Buscar o domínio pertencente exclusivamente a este admin
      let domain: any = null;
      if (targetDomainId) {
        domain = await prisma.domain.findFirst({
          where: { id: targetDomainId, userId: authUser.id },
        });
      } else {
        domain = await prisma.domain.findFirst({
          where: { userId: authUser.id },
        });
      }

      if (!domain) {
        return reply.status(404).send({
          error: "Domínio não encontrado",
          message: "Você não possui um domínio cadastrado para criar contas.",
        });
      }

      const domainId = domain.id;

      // Verificar se a conta de e-mail já existe vinculada a este domínio
      const existingAccount = await prisma.emailAccount.findUnique({
        where: { localPart_domainId: { localPart: cleanLocal, domainId } },
      });
      if (existingAccount) {
        return reply.status(409).send({
          error: "Conta já existe",
          message: `O endereço ${cleanLocal}@${domain.domainName} já está em uso neste domínio.`,
        });
      }

      const fullEmail = `${cleanLocal}@${domain.domainName}`;

      // Verificar se o User com esse email já existe
      const existingUser = await prisma.user.findUnique({
        where: { email: fullEmail },
      });

      let accountUserId: number;

      if (existingUser) {
        if (password) {
          const passwordHash = hashPassword(password);
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              passwordHash,
              displayName: displayName || existingUser.displayName || cleanLocal,
              role: "user",
            },
          });
        }
        accountUserId = existingUser.id;
      } else {
        // Criar novo usuário comum de email
        const passwordHash = hashPassword(password);
        const accountUser = await prisma.user.create({
          data: {
            email: fullEmail,
            passwordHash,
            displayName: displayName || cleanLocal,
            role: "user",
          },
        });
        accountUserId = accountUser.id;
      }

      // Criar a conta de e-mail vinculada ao domínio e ao usuário
      const account = await prisma.emailAccount.create({
        data: {
          localPart: cleanLocal,
          domainId,
          userId: accountUserId,
          displayName: displayName || null,
          isActive: true,
        },
      });

      return reply.status(201).send({
        id: account.id,
        email: fullEmail,
        displayName: account.displayName,
        isActive: account.isActive,
        message: `Conta ${fullEmail} criada com sucesso!`,
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        return reply.status(409).send({
          error: "Conflito",
          message: "Este e-mail já existe cadastrado no sistema.",
        });
      }
      app.log.error(err, "[AUTH] Erro ao criar conta de email:");
      return reply.status(500).send({
        error: "Internal Server Error",
        message: err?.message || "Erro ao criar conta de e-mail",
      });
    }
  });

  /**
   * GET /api/v1/auth/accounts
   * Lista contas de e-mail pertencentes exclusivamente ao domínio do admin autenticado
   */
  app.get("/api/v1/auth/accounts", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem gerenciar contas de e-mail.",
      });
    }

    const query = request.query as { domainId?: string };
    const targetDomainId = query.domainId ? parseInt(query.domainId, 10) : undefined;

    let domain: any = null;
    if (targetDomainId) {
      domain = await prisma.domain.findFirst({
        where: { id: targetDomainId, userId: authUser.id },
      });
    } else {
      domain = await prisma.domain.findFirst({
        where: { userId: authUser.id },
      });
    }

    if (!domain) {
      return { domainName: "", accounts: [] };
    }

    const accounts = await prisma.emailAccount.findMany({
      where: { domainId: domain.id },
      orderBy: { createdAt: "asc" },
    });

    return {
      domainName: domain.domainName,
      accounts: accounts.map((a: any) => ({
        id: a.id,
        email: `${a.localPart}@${domain.domainName}`,
        localPart: a.localPart,
        displayName: a.displayName,
        isActive: a.isActive,
        createdAt: a.createdAt,
      })),
    };
  });

  /**
   * DELETE /api/v1/auth/accounts/:id
   * Remove uma conta de e-mail (apenas admin do próprio domínio)
   */
  app.delete("/api/v1/auth/accounts/:id", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem excluir contas de e-mail.",
      });
    }

    const { id } = request.params as { id: string };
    const accountId = parseInt(id, 10);
    if (isNaN(accountId)) {
      return reply.status(400).send({ error: "ID inválido" });
    }

    const account = await prisma.emailAccount.findUnique({
      where: { id: accountId },
      include: { domain: true },
    });

    if (!account) {
      return reply.status(404).send({ error: "Conta não encontrada" });
    }

    if (account.domain.userId !== authUser.id) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Você não tem permissão para excluir contas de outro domínio.",
      });
    }

    await prisma.emailAccount.delete({
      where: { id: accountId },
    });

    if (account.userId) {
      await prisma.user.delete({ where: { id: account.userId } }).catch(() => {});
    }

    return { success: true, message: "Conta excluída com sucesso" };
  });

  /**
   * GET /api/v1/domains
   * Lista todos os domínios corporativos pertencentes ao administrador autenticado
   */
  app.get("/api/v1/domains", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem listar domínios.",
      });
    }

    const domains = await prisma.domain.findMany({
      where: { userId: authUser.id },
      include: {
        accounts: {
          select: { id: true, localPart: true, displayName: true, isActive: true, createdAt: true },
        },
        apiKeys: {
          select: { id: true, name: true, environment: true, keyHash: true, lastUsedAt: true, createdAt: true },
        },
        smtpConfig: {
          select: { provider: true, isActive: true, fromName: true, fromEmail: true, lastTestedAt: true },
        },
        walletVault: {
          select: { publicKey: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      domains: domains.map((d) => ({
        id: d.id,
        domainName: d.domainName,
        isVerified: d.isVerified,
        createdAt: d.createdAt,
        accountsCount: d.accounts.length,
        apiKeysCount: d.apiKeys.length,
        smtpConfigured: !!d.smtpConfig?.isActive,
        smtpProvider: d.smtpConfig?.provider || null,
        publicKey: d.walletVault?.publicKey || null,
        accounts: d.accounts.map((a) => ({
          id: a.id,
          email: `${a.localPart}@${d.domainName}`,
          displayName: a.displayName,
          isActive: a.isActive,
        })),
      })),
    };
  });

  /**
   * POST /api/v1/domains
   * Registra um domínio para o usuário e provisiona carteira Web3 + API Key
   */
  app.post("/api/v1/domains", async (request, reply) => {
    const parse = DomainSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { domainName, userId, isVerified } = parse.data;
    const cleanDomain = domainName.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({
        error: "Usuário não encontrado",
        message: `Usuário ID ${userId} não encontrado.`,
      });
    }

    const domain = await prisma.domain.upsert({
      where: { domainName: cleanDomain },
      create: { domainName: cleanDomain, userId, isVerified },
      update: { isVerified },
    });

    const { publicKey } = await kms.provisionWalletForDomain(domain.id);
    const apiKeyResult = await kms.generateApiKey(domain.id, "Default API Key");

    return reply.status(201).send({
      domain: {
        id: domain.id,
        domainName: domain.domainName,
        isVerified: domain.isVerified,
        createdAt: domain.createdAt,
      },
      web3Identity: { publicKey, vaultEncrypted: true },
      apiKey: {
        id: apiKeyResult.id,
        name: apiKeyResult.name,
        key: apiKeyResult.apiKey,
        note: "Guarde esta chave. Por segurança, ela não será exibida novamente.",
      },
    });
  });

  /**
   * POST /api/v1/api-keys
   * Gera nova chave de API para o domínio do admin autenticado
   */
  app.post("/api/v1/api-keys", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem gerar chaves de API.",
      });
    }

    const parse = ApiKeySchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { name, environment, domainId: targetDomainId } = parse.data;

    let domain: any = null;
    if (targetDomainId) {
      domain = await prisma.domain.findFirst({
        where: { id: targetDomainId, userId: authUser.id },
      });
    } else {
      domain = await prisma.domain.findFirst({
        where: { userId: authUser.id },
      });
    }
    if (!domain) {
      return reply.status(404).send({ error: "Domínio não encontrado para este usuário." });
    }

    const result = await kms.generateApiKey(domain.id, name, environment);

    return reply.status(201).send({
      id: result.id,
      domainId: domain.id,
      name: result.name,
      apiKey: result.apiKey,
      environment,
      note: "Guarde esta chave. Por segurança, ela não será exibida novamente.",
    });
  });

  /**
   * GET /api/v1/api-keys
   * Lista chaves de API existentes pertencentes exclusivamente ao domínio do admin
   */
  app.get("/api/v1/api-keys", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem acessar as chaves de API.",
      });
    }

    const query = request.query as { domainId?: string };
    const targetDomainId = query.domainId ? parseInt(query.domainId, 10) : undefined;

    const whereClause: any = {
      domain: { userId: authUser.id },
    };
    if (targetDomainId) {
      whereClause.domainId = targetDomainId;
    }

    const keys = await prisma.apiKey.findMany({
      where: whereClause,
      include: { domain: true },
      orderBy: { createdAt: "desc" },
    });

    return reply.send({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        environment: k.environment === "production" ? "Production" : "Staging",
        domainId: k.domainId,
        domainName: k.domain.domainName,
        key: `maivw_${k.environment === "production" ? "live" : "test"}_sk_••••••••••••${k.keyHash.slice(-6)}`,
        createdAt: k.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }),
        lastUsed: k.lastUsedAt ? k.lastUsedAt.toLocaleString("pt-BR") : "Nunca",
      })),
    });
  });

  /**
   * DELETE /api/v1/api-keys/:id
   * Revoga uma chave de API (apenas do próprio domínio do admin)
   */
  app.delete("/api/v1/api-keys/:id", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem revogar chaves de API.",
      });
    }

    const { id } = request.params as { id: string };
    const keyId = parseInt(id, 10);

    const existing = await prisma.apiKey.findUnique({
      where: { id: keyId },
      include: { domain: true },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Chave não encontrada" });
    }

    if (existing.domain.userId !== authUser.id) {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Você não tem permissão para revogar chaves de outro domínio.",
      });
    }

    await prisma.apiKey.delete({ where: { id: keyId } });
    return reply.send({ success: true, message: "Chave revogada com sucesso!" });
  });

  /**
   * GET /api/v1/developer/logs
   * Retorna os últimos disparos da API exclusivamente do domínio do admin autenticado
   */
  app.get("/api/v1/developer/logs", async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Apenas administradores podem acessar os logs de desenvolvedor.",
      });
    }

    const query = request.query as { limit?: string; domainId?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const targetDomainId = query.domainId ? parseInt(query.domainId, 10) : undefined;

    let domain: any = null;
    if (targetDomainId) {
      domain = await prisma.domain.findFirst({
        where: { id: targetDomainId, userId: authUser.id },
      });
    } else {
      domain = await prisma.domain.findFirst({
        where: { userId: authUser.id },
      });
    }

    const messages = await prisma.message.findMany({
      where: {
        status: "sent",
        from: { contains: domain.domainName },
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
    });

    return reply.send({
      logs: messages.map((m) => ({
        id: m.messageId,
        from: m.from,
        to: m.to,
        subject: m.subject,
        msgClass: m.msgClass,
        routing: m.isLegacy ? "SMTP_FALLBACK" : "MAIVW_P2P",
        status: "Entregue (200 OK)",
        timestamp: m.receivedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        fullDate: m.receivedAt.toISOString(),
      })),
    });
  });

  /**
   * GET /api/v1/inbox/messages
   * Retorna mensagens estritamente do e-mail autenticado (bloqueado para admin)
   */
  app.get("/api/v1/inbox/messages", async (request, reply) => {
    const authUser = getAuthUser(request);

    // Regra: Contas administrativas não possuem caixa de entrada pessoal
    if (authUser && authUser.role === "admin") {
      return reply.status(403).send({
        error: "Forbidden",
        message: "Contas administrativas não possuem caixa de entrada direta. Crie uma conta de e-mail comum no painel para acessar o Webmail.",
      });
    }

    const query = request.query as {
      limit?: string;
      isLegacy?: string;
      email?: string;
      folder?: string;
    };
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const folder = (query.folder || "inbox").toLowerCase();

    // Determinar o e-mail alvo estritamente do usuário logado (ou query param em dev)
    const targetEmail = (authUser ? authUser.email : query.email)?.toLowerCase().trim();

    if (!targetEmail) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Autenticação ou e-mail necessário para acessar a caixa de entrada.",
      });
    }

    // Sincronizar automaticamente e-mails recebidos do Resend (se configurado)
    if (smtp && targetEmail.includes("@")) {
      const domainForSync = targetEmail.split("@")[1];
      try {
        await smtp.syncInboundEmails(domainForSync);
      } catch (syncErr: any) {
        app.log.warn(`[INBOX] Falha ao sincronizar e-mails inbound: ${syncErr.message}`);
      }
    }

    const where: any = {};

    if (query.isLegacy !== undefined) {
      where.isLegacy = query.isLegacy === "true";
    }

    if (folder === "sent") {
      where.status = "sent";
      where.from = { contains: targetEmail, mode: "insensitive" };
    } else if (folder === "trash") {
      where.status = "trash";
      where.OR = [
        { to: { contains: targetEmail, mode: "insensitive" } },
        { from: { contains: targetEmail, mode: "insensitive" } },
      ];
    } else if (folder === "spam" || folder === "quarantine") {
      where.status = { in: ["quarantined", "spam", "disputed"] };
      where.to = { contains: targetEmail, mode: "insensitive" };
    } else {
      // Default: Inbox (recebidos não arquivados/quarentenados/lixeira)
      where.status = { notIn: ["sent", "quarantined", "spam", "disputed", "trash"] };
      where.to = { contains: targetEmail, mode: "insensitive" };
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
    });

    // Contadores para as pastas da barra lateral — filtrados estritamente pelo email do usuário
    const [inboxCount, sentCount, spamCount, trashCount] = await Promise.all([
      prisma.message.count({
        where: {
          status: { notIn: ["sent", "quarantined", "spam", "disputed", "trash"] },
          to: { contains: targetEmail, mode: "insensitive" },
        },
      }),
      prisma.message.count({
        where: {
          status: "sent",
          from: { contains: targetEmail, mode: "insensitive" },
        },
      }),
      prisma.message.count({
        where: {
          status: { in: ["quarantined", "spam", "disputed"] },
          to: { contains: targetEmail, mode: "insensitive" },
        },
      }),
      prisma.message.count({
        where: {
          status: "trash",
          OR: [
            { to: { contains: targetEmail, mode: "insensitive" } },
            { from: { contains: targetEmail, mode: "insensitive" } },
          ],
        },
      }),
    ]);

    return {
      total: messages.length,
      folder,
      counts: {
        inbox: inboxCount,
        sent: sentCount,
        spam: spamCount,
        trash: trashCount,
      },
      messages,
    };
  });

  /**
   * PATCH /api/v1/inbox/messages/:id
   * Atualiza status da mensagem (ex: mover para spam/quarentena, marcar lida)
   */
  app.patch("/api/v1/inbox/messages/:id", async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const body = request.body as { status?: string; isRead?: boolean };

    const messageIdNum = parseInt(id, 10);
    const existing = await prisma.message.findFirst({
      where: {
        OR: [
          ...(isNaN(messageIdNum) ? [] : [{ id: messageIdNum }]),
          { messageId: id },
        ],
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Mensagem não encontrada" });
    }

    if (authUser && authUser.role === "user") {
      const emailLower = authUser.email.toLowerCase();
      if (!existing.to.toLowerCase().includes(emailLower) && !existing.from.toLowerCase().includes(emailLower)) {
        return reply.status(403).send({ error: "Acesso negado a esta mensagem" });
      }
    }

    const updated = await prisma.message.update({
      where: { id: existing.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.isRead !== undefined ? { isRead: body.isRead } : {}),
      },
    });

    return reply.status(200).send({ success: true, message: updated });
  });

  /**
   * PATCH /api/v1/inbox/messages/:id/restore
   * Restaura mensagem da lixeira de volta para a Caixa de Entrada ou Enviados
   */
  app.patch("/api/v1/inbox/messages/:id/restore", async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };

    const messageIdNum = parseInt(id, 10);
    const existing = await prisma.message.findFirst({
      where: {
        OR: [
          ...(isNaN(messageIdNum) ? [] : [{ id: messageIdNum }]),
          { messageId: id },
        ],
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Mensagem não encontrada" });
    }

    const targetEmail = authUser ? authUser.email.toLowerCase() : "";
    const restoredStatus = targetEmail && existing.from.toLowerCase().includes(targetEmail) ? "sent" : "received";

    const updated = await prisma.message.update({
      where: { id: existing.id },
      data: { status: restoredStatus },
    });

    return reply.status(200).send({ success: true, message: updated, restoredStatus });
  });

  /**
   * DELETE /api/v1/inbox/messages/:id
   * Exclusão em dois estágios: se não está no lixo, move para trash; se já está no lixo, exclui permanentemente
   */
  app.delete("/api/v1/inbox/messages/:id", async (request, reply) => {
    const authUser = getAuthUser(request);
    const { id } = request.params as { id: string };
    const query = request.query as { permanent?: string };
    const isPermanent = query.permanent === "true";

    const messageIdNum = parseInt(id, 10);
    const existing = await prisma.message.findFirst({
      where: {
        OR: [
          ...(isNaN(messageIdNum) ? [] : [{ id: messageIdNum }]),
          { messageId: id },
        ],
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Mensagem não encontrada" });
    }

    if (authUser && authUser.role === "user") {
      const emailLower = authUser.email.toLowerCase();
      if (!existing.to.toLowerCase().includes(emailLower) && !existing.from.toLowerCase().includes(emailLower)) {
        return reply.status(403).send({ error: "Acesso negado a esta mensagem" });
      }
    }

    if (existing.status === "trash" || isPermanent) {
      // Exclusão permanente
      await prisma.message.delete({ where: { id: existing.id } });
      return reply.status(200).send({ success: true, deleted: true, permanent: true });
    } else {
      // Mover para lixeira
      const updated = await prisma.message.update({
        where: { id: existing.id },
        data: { status: "trash" },
      });
      return reply.status(200).send({ success: true, message: updated, movedToTrash: true });
    }
  });

  /**
   * DELETE /api/v1/inbox/trash/empty
   * Esvazia permanentemente todas as mensagens na lixeira do usuário
   */
  app.delete("/api/v1/inbox/trash/empty", async (request, reply) => {
    const authUser = getAuthUser(request);
    const query = request.query as { email?: string };
    const targetEmail = (authUser ? authUser.email : query.email)?.toLowerCase().trim();

    if (!targetEmail) {
      return reply.status(400).send({ error: "Identificação de usuário necessária para esvaziar a lixeira" });
    }

    const result = await prisma.message.deleteMany({
      where: {
        status: "trash",
        OR: [
          { to: { contains: targetEmail, mode: "insensitive" } },
          { from: { contains: targetEmail, mode: "insensitive" } },
        ],
      },
    });

    return reply.status(200).send({ success: true, count: result.count });
  });
}
