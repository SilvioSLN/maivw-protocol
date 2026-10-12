import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ATTACHMENTS_DIR = path.resolve(process.cwd(), "data/attachments");

// Assegurar que a pasta de anexos existe
if (!fs.existsSync(ATTACHMENTS_DIR)) {
  fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
}

interface AttachmentMetadata {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  uploadedAt: string;
}

export async function attachmentRoutes(app: FastifyInstance) {
  /**
   * POST /api/v1/attachments/upload
   * Recebe um anexo em Base64, computa o hash criptográfico SHA-256 e persiste no storage
   */
  app.post("/api/v1/attachments/upload", {
    schema: {
      body: {
        type: "object",
        required: ["filename", "dataBase64"],
        properties: {
          filename: { type: "string" },
          mimeType: { type: "string" },
          dataBase64: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const { filename, mimeType, dataBase64 } = request.body as {
      filename: string;
      mimeType?: string;
      dataBase64: string;
    };

    if (!filename || !dataBase64) {
      return reply.status(400).send({ error: "Filename e dataBase64 são obrigatórios" });
    }

    try {
      // Limpar prefixo data:image/...;base64, caso venha de um FileReader
      const base64Clean = dataBase64.replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Clean, "base64");

      // Limite de segurança de 25MB
      if (buffer.length > 25 * 1024 * 1024) {
        return reply.status(413).send({ error: "Arquivo excede o limite máximo permitido de 25MB" });
      }

      // Hash de integridade criptográfica SHA-256
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const id = `att_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
      const storageFilename = `${id}__${safeFilename}`;
      const filePath = path.join(ATTACHMENTS_DIR, storageFilename);

      await fs.promises.writeFile(filePath, buffer);

      // Salvar metadados
      const metaPath = path.join(ATTACHMENTS_DIR, `${id}__meta.json`);
      const meta: AttachmentMetadata = {
        id,
        filename,
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
          filename,
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
  });

  /**
   * GET /api/v1/attachments/:id/download
   * Faz o download seguro do anexo persistido
   */
  app.get("/api/v1/attachments/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const files = await fs.promises.readdir(ATTACHMENTS_DIR);
      const targetFile = files.find((f) => f.startsWith(`${id}__`) && !f.endsWith("__meta.json"));

      if (!targetFile) {
        return reply.status(404).send({ error: "Anexo não encontrado" });
      }

      const filePath = path.join(ATTACHMENTS_DIR, targetFile);
      const metaPath = path.join(ATTACHMENTS_DIR, `${id}__meta.json`);

      let meta: AttachmentMetadata | null = null;
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(await fs.promises.readFile(metaPath, "utf-8"));
      }

      const originalName = meta?.filename || targetFile.replace(`${id}__`, "");
      const mime = meta?.mimeType || "application/octet-stream";

      const fileBuffer = await fs.promises.readFile(filePath);

      reply
        .header("Content-Type", mime)
        .header("Content-Disposition", `attachment; filename="${encodeURIComponent(originalName)}"`)
        .header("x-maivw-sha256", meta?.sha256 || "")
        .send(fileBuffer);
    } catch (err: any) {
      app.log.error(err, "[ATTACHMENTS] Erro ao baixar anexo:");
      return reply.status(500).send({ error: "Falha ao recuperar anexo" });
    }
  });
}
