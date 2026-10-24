import type { FastifyInstance } from "fastify";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { KeyManagementService } from "../services/KeyManagementService.js";
import { getCurrentUser } from "./auth.js";
import type { ObjectStorage } from "../storage/types.js";
import {
  StorageError,
  StorageHashMismatchError,
  StorageInvalidKeyError,
  StorageSizeExceededError,
} from "../storage/types.js";
import { FilesystemStorageAdapter } from "../storage/FilesystemStorageAdapter.js";
import { getStorage } from "../storage/StorageFactory.js";

export interface AttachmentRouteOptions {
  prisma?: PrismaClient;
  kms?: KeyManagementService;
  attachmentsDir?: string;
  storage?: ObjectStorage;
  maxFileSizeBytes?: number;
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
  const maxFileSizeBytes = options.maxFileSizeBytes ?? 25 * 1024 * 1024;
  const clampExpiry = (value: unknown) => Math.min(900, Math.max(60, Number(value) || 900));

  const storage: ObjectStorage =
    options.storage ||
    (options.attachmentsDir
      ? new FilesystemStorageAdapter({
          baseDir: options.attachmentsDir,
          maxFileSizeBytes: options.maxFileSizeBytes,
        })
      : getStorage());

  /**
   * Content parser para permitir upload binário em requisições de presigned URL locais
   */
  if (!app.hasContentTypeParser("application/octet-stream")) {
    app.addContentTypeParser(
      ["application/octet-stream", "application/pdf", "image/png", "image/jpeg", "text/plain"],
      { parseAs: "buffer" },
      (_req, body, done) => {
        done(null, body);
      }
    );
  }

  /**
   * POST /api/v1/attachments/upload
   * Recebe anexo em Base64, computa SHA-256 e persiste via ObjectStorage.
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
            expectedSha256: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const isAuth = await requireAttachmentAuth(request, reply, prisma, kms);
      if (!isAuth) return;

      const { filename, mimeType, dataBase64, expectedSha256 } = request.body as {
        filename: string;
        mimeType?: string;
        dataBase64: string;
        expectedSha256?: string;
      };

      if (!filename || !dataBase64) {
        return reply.status(400).send({ error: "Filename e dataBase64 são obrigatórios" });
      }

      try {
        const base64Clean = dataBase64.replace(/^data:[^;]+;base64,/, "");

        // Pre-check de tamanho do payload base64
        if (base64Clean.length > 35 * 1024 * 1024) {
          return reply.status(413).send({ error: "Arquivo excede o limite máximo permitido de 25MB" });
        }

        const buffer = Buffer.from(base64Clean, "base64");

        // Limite de segurança de 25MB para o arquivo binário decodificado
        if (buffer.length > 25 * 1024 * 1024) {
          return reply.status(413).send({ error: "Arquivo excede o limite máximo permitido de 25MB" });
        }

        const id = `att_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
        const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
        const storageKey = `${id}__${safeFilename}`;

        const result = await storage.put({
          key: storageKey,
          data: buffer,
          mimeType: mimeType || "application/octet-stream",
          expectedSha256,
          customMetadata: {
            id,
            filename: path.basename(filename).replace(/[\r\n]/g, ""),
          },
        });

        return reply.status(201).send({
          success: true,
          attachment: {
            id,
            filename: safeFilename,
            size: result.size,
            mimeType: mimeType || "application/octet-stream",
            sha256: result.sha256,
            url: `/api/v1/attachments/${id}/download`,
          },
        });
      } catch (err: any) {
        if (err instanceof StorageSizeExceededError) {
          return reply.status(413).send({ error: err.message });
        }
        if (err instanceof StorageHashMismatchError || err instanceof StorageInvalidKeyError) {
          return reply.status(400).send({ error: err.message });
        }

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
   * Faz o download seguro do anexo persistido via ObjectStorage com proteção contra path traversal.
   */
  app.get("/api/v1/attachments/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return reply.status(400).send({ error: "Identificador de anexo inválido" });
    }

    try {
      const obj = await storage.get(id);
      if (!obj) {
        return reply.status(404).send({ error: "Anexo não encontrado" });
      }

      const originalName =
        obj.metadata.customMetadata?.filename ||
        (obj.key.includes("__") ? obj.key.split("__").slice(1).join("__") : obj.key);
      const safeDownloadName = originalName.replace(/[\r\n"']/g, "_");
      const mime = obj.metadata.mimeType || "application/octet-stream";

      reply
        .header("Content-Type", mime)
        .header(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(safeDownloadName)}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`
        )
        .header("x-maivw-sha256", obj.metadata.sha256 || "")
        .header("X-Content-Type-Options", "nosniff")
        .send(obj.data);
    } catch (err: any) {
      if (err instanceof StorageInvalidKeyError) {
        return reply.status(400).send({ error: err.message });
      }
      app.log.error(err, "[ATTACHMENTS] Erro ao baixar anexo:");
      return reply.status(500).send({ error: "Falha ao recuperar anexo" });
    }
  });

  /**
   * POST /api/v1/attachments/signed-upload
   * Gera uma URL pré-assinada para upload direto ao ObjectStorage (S3, R2 ou Filesystem).
   */
  app.post(
    "/api/v1/attachments/signed-upload",
    {
      schema: {
        body: {
          type: "object",
          required: ["filename"],
          properties: {
            filename: { type: "string", maxLength: 255 },
            mimeType: { type: "string", maxLength: 128 },
            expectedSha256: { type: "string", maxLength: 64 },
            expiresInSeconds: { type: "number" },
          },
        },
      },
    },
    async (request, reply) => {
      const isAuth = await requireAttachmentAuth(request, reply, prisma, kms);
      if (!isAuth) return;

      const { filename, mimeType, expectedSha256, expiresInSeconds } = request.body as {
        filename: string;
        mimeType?: string;
        expectedSha256?: string;
        expiresInSeconds?: number;
      };

      if (expectedSha256 && !/^[a-fA-F0-9]{64}$/.test(expectedSha256)) {
        return reply.status(400).send({ error: "expectedSha256 deve ser um SHA-256 hexadecimal" });
      }

      const id = `att_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
      const storageKey = `${id}__${safeFilename}`;

      const signedResult = await storage.createSignedUploadUrl(storageKey, {
        contentType: mimeType,
        expectedSha256,
        maxSizeBytes: maxFileSizeBytes,
        expiresInSeconds: clampExpiry(expiresInSeconds),
      });

      return reply.status(200).send({
        success: true,
        id,
        attachmentId: id,
        key: storageKey,
        uploadUrl: signedResult.uploadUrl,
        method: signedResult.method,
        headers: signedResult.headers,
        expiresAt: signedResult.expiresAt.toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/attachments/:id/signed-download
   * Gera uma URL pré-assinada temporária para download direto.
   */
  app.get("/api/v1/attachments/:id/signed-download", async (request, reply) => {
    const isAuth = await requireAttachmentAuth(request, reply, prisma, kms);
    if (!isAuth) return;

    const { id } = request.params as { id: string };
    const { key, filename, expiresInSeconds } = request.query as {
      key?: string;
      filename?: string;
      expiresInSeconds?: string;
    };

    const storageKey = key || id;
    if (!id || !/^att_[a-zA-Z0-9_-]+$/.test(id) || !storageKey.startsWith(`${id}__`)) {
      return reply.status(400).send({ error: "Identificador de anexo inválido" });
    }

    const metadata = await storage.getMetadata(storageKey);
    if (!metadata) return reply.status(404).send({ error: "Anexo não encontrado" });
    if (metadata.size > maxFileSizeBytes) {
      return reply.status(413).send({ error: "Anexo excede o limite configurado" });
    }

    const downloadUrl = await storage.createSignedDownloadUrl(storageKey, {
      downloadFilename: filename,
      expiresInSeconds: clampExpiry(expiresInSeconds),
    });

    return reply.status(200).send({
      success: true,
      attachmentId: id,
      downloadUrl,
    });
  });

  /**
   * PUT /api/v1/attachments/signed-upload-target
   * Endpoint de destino para uploads assinados no modo Filesystem
   */
  app.put("/api/v1/attachments/signed-upload-target", async (request, reply) => {
    const query = request.query as {
      key: string;
      expires: string;
      token: string;
      contentType?: string;
      expectedSha256?: string;
    };

    const { key, expires, token, contentType, expectedSha256 } = query;

    if (!key || !expires || !token) {
      return reply.status(400).send({ error: "Parâmetros de assinatura ausentes" });
    }

    if (storage instanceof FilesystemStorageAdapter) {
      const isValid = storage.verifyToken({
        key,
        type: "upload",
        expires: Number(expires),
        token,
      });
      if (!isValid) {
        return reply.status(403).send({ error: "URL de upload assinada inválida ou expirada" });
      }
    }

    const buffer = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body as any);

    try {
      const result = await storage.put({
        key,
        data: buffer,
        mimeType: contentType,
        expectedSha256,
      });

      return reply.status(201).send({
        success: true,
        key: result.key,
        size: result.size,
        sha256: result.sha256,
      });
    } catch (err: any) {
      if (err instanceof StorageSizeExceededError) {
        return reply.status(413).send({ error: err.message });
      }
      if (err instanceof StorageHashMismatchError || err instanceof StorageInvalidKeyError) {
        return reply.status(400).send({ error: err.message });
      }
      return reply.status(500).send({ error: "Falha ao gravar arquivo assinado" });
    }
  });

  /**
   * GET /api/v1/attachments/signed-download-target
   * Endpoint de destino para downloads assinados no modo Filesystem
   */
  app.get("/api/v1/attachments/signed-download-target", async (request, reply) => {
    const query = request.query as {
      key: string;
      expires: string;
      token: string;
      filename?: string;
    };

    const { key, expires, token, filename } = query;

    if (!key || !expires || !token) {
      return reply.status(400).send({ error: "Parâmetros de assinatura ausentes" });
    }

    if (storage instanceof FilesystemStorageAdapter) {
      const isValid = storage.verifyToken({
        key,
        type: "download",
        expires: Number(expires),
        token,
      });
      if (!isValid) {
        return reply.status(403).send({ error: "URL assinada inválida ou expirada" });
      }
    }

    const obj = await storage.get(key);
    if (!obj) {
      return reply.status(404).send({ error: "Anexo não encontrado" });
    }

    const originalName = filename || obj.metadata.customMetadata?.filename || path.basename(key);
    const safeDownloadName = originalName.replace(/[\r\n"']/g, "_");

    reply
      .header("Content-Type", obj.metadata.mimeType || "application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(safeDownloadName)}"; filename*=UTF-8''${encodeURIComponent(safeDownloadName)}`
      )
      .header("x-maivw-sha256", obj.metadata.sha256 || "")
      .header("X-Content-Type-Options", "nosniff")
      .send(obj.data);
  });
}
