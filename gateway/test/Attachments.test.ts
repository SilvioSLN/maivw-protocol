import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import jwt from "jsonwebtoken";

const { attachmentRoutes } = await import("../src/routes/attachments.js");

const JWT_SECRET = "attachments-test-secret-12345";
process.env.JWT_SECRET = JWT_SECRET;

const authClaims = { id: 1, email: "user@example.com", role: "user" };
const authHeader = (claims: any) => ({
  authorization: `Bearer ${jwt.sign(claims, JWT_SECRET)}`,
});

function createMockPrisma() {
  const users = new Map<number, any>([
    [1, { id: 1, email: "user@example.com", role: "user" }],
  ]);
  const domains = [
    { id: 10, domainName: "example.com", isVerified: true },
    { id: 20, domainName: "unverified.com", isVerified: false },
  ];

  return {
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) || null,
    },
    domain: {
      findUnique: async ({ where }: any) => domains.find((d) => d.id === where.id) || null,
    },
  } as any;
}

function createMockKms() {
  return {
    validateApiKey: async (key: string) => {
      if (key === "maivw_live_valid_key") {
        return { domainId: 10, domainName: "example.com" };
      }
      if (key === "maivw_live_unverified_key") {
        return { domainId: 20, domainName: "unverified.com" };
      }
      return null;
    },
  } as any;
}

test("attachments: require auth, enforce 25MB limits, protect against path traversal and return secure download", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maivw-att-test-"));
  const prisma = createMockPrisma();
  const kms = createMockKms();

  const app = Fastify();
  await app.register(attachmentRoutes, {
    prisma,
    kms,
    attachmentsDir: tempDir,
  });

  try {
    // 1. Upload anônimo -> 401
    const resAnon = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/upload",
      payload: { filename: "test.txt", dataBase64: Buffer.from("hello").toString("base64") },
    });
    assert.equal(resAnon.statusCode, 401);

    // 2. Upload com API key inválida -> 401
    const resBadKey = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/upload",
      headers: { authorization: "Bearer maivw_live_invalid" },
      payload: { filename: "test.txt", dataBase64: Buffer.from("hello").toString("base64") },
    });
    assert.equal(resBadKey.statusCode, 401);

    // 3. Upload com API key de domínio não verificado -> 403
    const resUnverified = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/upload",
      headers: { authorization: "Bearer maivw_live_unverified_key" },
      payload: { filename: "test.txt", dataBase64: Buffer.from("hello").toString("base64") },
    });
    assert.equal(resUnverified.statusCode, 403);

    // 4. Upload com sessão JWT válida -> 201
    const sampleContent = "Hello MAIVW Secure Attachments!";
    const resJwt = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/upload",
      headers: authHeader(authClaims),
      payload: {
        filename: "document.pdf",
        mimeType: "application/pdf",
        dataBase64: Buffer.from(sampleContent).toString("base64"),
      },
    });
    assert.equal(resJwt.statusCode, 201);
    const json = JSON.parse(resJwt.payload);
    assert.equal(json.success, true);
    assert.ok(json.attachment.id);
    assert.equal(json.attachment.filename, "document.pdf");
    assert.equal(json.attachment.size, Buffer.byteLength(sampleContent));

    const attId = json.attachment.id;

    // 5. Download legítimo
    const resDownload = await app.inject({
      method: "GET",
      url: `/api/v1/attachments/${attId}/download`,
    });
    assert.equal(resDownload.statusCode, 200);
    assert.equal(resDownload.headers["content-type"], "application/pdf");
    assert.equal(resDownload.headers["x-content-type-options"], "nosniff");
    assert.ok(resDownload.headers["content-disposition"]?.includes("document.pdf"));
    assert.equal(resDownload.payload, sampleContent);

    // 6. Path traversal e IDs malformados -> 400
    const resTraversal = await app.inject({
      method: "GET",
      url: "/api/v1/attachments/..%2F..%2Fetc%2Fpasswd/download",
    });
    assert.equal(resTraversal.statusCode, 400);

    const resNonExistent = await app.inject({
      method: "GET",
      url: "/api/v1/attachments/att_123456789_nonexistent/download",
    });
    assert.equal(resNonExistent.statusCode, 404);

    // 7. Limite de tamanho excedido (> 25MB) -> 413
    // Cria um payload falso com tamanho > 25MB simulado
    const largeBuffer = Buffer.alloc(26 * 1024 * 1024, "a");
    const largeBase64 = largeBuffer.toString("base64");
    const resTooLarge = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/upload",
      headers: authHeader(authClaims),
      payload: {
        filename: "huge.bin",
        dataBase64: largeBase64,
      },
    });
    assert.equal(resTooLarge.statusCode, 413);
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
