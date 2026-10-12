import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { KeyManagementService } from "../services/KeyManagementService.js";
import { getCurrentUser } from "./auth.js";

const DEFAULT_ATTACHMENTS_DIR = path.resolve(process.cwd(), "data/attachments");

export interface AttachmentRouteOptions {
  prisma?: PrismaClient;
  kms?: KeyManagementService;
  attachmentsDir?: string;
}

interface AttachmentMetadata {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  uploadedAt: string;
}

async function requireAttachmentAuth(
  request: any,
  reply: any,
  prisma?: PrismaClient,
  kms?: KeyManagementService
): Promise<boolean> {
  if (!prisma || !kms) {
    return true;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Credencial de autenticação obrigatória para upload de anexos" });
    return false;
  }

  const rawToken = authHeader.slice(7).trim();

  // 1. Chave de API pública
  if (rawToken.startsWith("maivw_live_") || rawToken.startsWith("maivw_test_")) {
    const keyInfo = await kms.validateApiKey(rawToken);
    if (!keyInfo) {
      reply.status(401).send({ error: "Chave de API inválida ou revogada" });
      return false;
    }
    const domain = await prisma.domain.findUnique({ where: { id: keyInfo.domainId } });
    if (!domain?.isVerified) {
      reply.status(403).send({ error: "Domínio associado à API key não está verificado" });
      return false;
    }
    return true;
  }

  // 2. Sessão de usuário (admin ou mailbox)
  const user = await getCurrentUser(request, prisma);
  if (!user) {
    reply.status(401).send({ error: "Sessão de autenticação inválida ou expirada" });
    return false;
  }

  return true;
}

export async function attachmentRoutes(app: FastifyInstance, options: AttachmentRouteOptions = {}) {
  const { prisma, kms } = options;
  const ATTACHMENTS_DIR = options.attachmentsDir || process.env.ATTACHMENTS_DIR || DEFAULT_ATTACHMENTS_DIR;

  if (!fs.existsSync(ATTACHMENTS_DIR)) {
    fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  }

  /**
   * POST /api/v1/attachments/upload
   * Recebe anexo em Base64, computa SHA-256 e persiste no storage seguro.
   * Suporta até 25MB de arquivo binário (requer bodyLimit de 35MB para acomodar overhead do Base64).
   */
  app.post(
    "/api/v1/attachments/upload",
    {
      bodyLimit: 35 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["filename", "dataBase64"],
          properties: {
            filename: { type: "string", maxLength: 255 },
            mimeType: { type: "string", maxLength: 128 },
            dataBase64: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const isAuth = await requireAttachmentAuth(request, reply, prisma, kms);
      if (!isAuth) return;

      const { filename, mimeType, dataBase64 } = request.body as {
        filename: string;
        mimeType?: string;
        dataBase64: string;
      };

      if (!filename || !dataBase64) {
        return reply.status(400).send({ error: "Filename e dataBase64 são obrigatórios" });
      }

      try {
        const base64Clean = dataBase64.replace(/^data:[^;]+;base64,/, "");

        // Pre-check de tamanho do payload
        if (base64Clean.length > 35 * 1024 * 1024) {
          return reply.status(413).send({ error: "Arquivo excede o limite máximo permitido de 25MB" });
        }

        const buffer = Buffer.from(base64Clean, "base64");

        // Limite de segurança de 25MB para o arquivo binário decodificado
        if (buffer.length > 25 * 1024 * 1024) {
          return reply.status(413).send({ error: "Arquivo excede o limite máximo permitido de 25MB" });
        }

        // Hash de integridade criptográfica SHA-256
        const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
        const id = `att_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
        const storageFilename = `${id}__${safeFilename}`;
        const filePath = path.resolve(ATTACHMENTS_DIR, storageFilename);

        if (!filePath.startsWith(ATTACHMENTS_DIR)) {
          return reply.status(400).send({ error: "Nome de arquivo inválido" });
        }

        await fs.promises.writeFile(filePath, buffer);

        // Salvar metadados
        const metaPath = path.resolve(ATTACHMENTS_DIR, `${id}__meta.json`);
        const meta: AttachmentMetadata = {
          id,
          filename: path.basename(filename).replace(/[\r\n]/g, ""),
          size: buffer.length,
          mimeType: mimeType || "application/octet-stream",
          sha256,
          uploadedAt: new Date().toISOString(),
        };
        await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

        return reply.status(201).send({
          success: true,
          attachment: {
            id,
            filename: meta.filename,
            size: buffer.length,
            mimeType: meta.mimeType,
            sha256,
            url: `/api/v1/attachments/${id}/download`,
          },
        });
      } catch (err: any) {
        app.log.error(err, "[ATTACHMENTS] Erro no upload de anexo:");
        return reply.status(500).send({
          error: "Falha ao processar upload do anexo",
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /api/v1/attachments/:id/download
   * Faz o download seguro do anexo persistido com proteção contra path traversal.
   */
  app.get("/api/v1/attachments/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return reply.status(400).send({ error: "Identificador de anexo inválido" });
    }

    try {
      const files = await fs.promises.readdir(ATTACHMENTS_DIR);
      const targetFile = files.find((f) => f.startsWith(`${id}__`) && !f.endsWith("__meta.json"));

      if (!targetFile) {
        return reply.status(404).send({ error: "Anexo não encontrado" });
      }

      const filePath = path.resolve(ATTACHMENTS_DIR, targetFile);
      if (!filePath.startsWith(ATTACHMENTS_DIR)) {
        return reply.status(403).send({ error: "Acesso a anexo não autorizado" });
      }

      const metaPath = path.resolve(ATTACHMENTS_DIR, `${id}__meta.json`);

      let meta: AttachmentMetadata | null = null;
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(await fs.promises.readFile(metaPath, "utf-8"));
        } catch {
          // ignore corrupted metadata
        }
      }

      const originalName = meta?.filename || targetFile.replace(`${id}__`, "");
      const safeDownloadName = originalName.replace(/[\r\n"']/g, "_");
      const mime = meta?.mimeType || "application/octet-stream";

      const fileBuffer = await fs.promises.readFile(filePath);

      reply
        .header("Content-Type", mime)
        .header(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(safeDownloadName)}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`
        )
        .header("x-maivw-sha256", meta?.sha256 || "")
        .header("X-Content-Type-Options", "nosniff")
        .send(fileBuffer);
    } catch (err: any) {
      app.log.error(err, "[ATTACHMENTS] Erro ao baixar anexo:");
      return reply.status(500).send({ error: "Falha ao recuperar anexo" });
    }
  });
}
