import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import Fastify from "fastify";
import jwt from "jsonwebtoken";

import {
  FilesystemStorageAdapter,
  S3CompatibleStorageAdapter,
  createObjectStorage,
  getStorage,
  setStorage,
  StorageError,
  StorageFileNotFoundError,
  StorageHashMismatchError,
  StorageInvalidKeyError,
  StorageSizeExceededError,
} from "../src/storage/index.js";
import { attachmentRoutes } from "../src/routes/attachments.js";

const JWT_SECRET = "test-object-storage-jwt-secret";
const authClaims = { id: 1, email: "storage-test@example.com", role: "admin" };
const authHeaders = { authorization: `Bearer ${jwt.sign(authClaims, JWT_SECRET)}` };

test("FilesystemStorageAdapter: CRUD, metadata, hash verification and limits", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maivw-fs-storage-test-"));

  try {
    const storage = new FilesystemStorageAdapter({
      baseDir: tmpDir,
      maxFileSizeBytes: 1024 * 1024, // 1 MB limit for test
      signedUrlSecret: "test-secret-key-12345",
      publicGatewayUrl: "http://localhost:3001",
    });

    assert.equal(storage.name, "FilesystemStorage");
    assert.equal(storage.driver, "filesystem");

    // 1. Put object
    const sampleData = Buffer.from("Hello MAIVW Object Storage!");
    const expectedHash = crypto.createHash("sha256").update(sampleData).digest("hex");

    const putRes = await storage.put({
      key: "test-doc.txt",
      data: sampleData,
      mimeType: "text/plain",
      expectedSha256: expectedHash,
      customMetadata: { author: "alice", version: "1" },
    });

    assert.equal(putRes.key, "test-doc.txt");
    assert.equal(putRes.size, sampleData.length);
    assert.equal(putRes.sha256, expectedHash);

    // 2. Exists
    const exists = await storage.exists("test-doc.txt");
    assert.equal(exists, true);

    const notExists = await storage.exists("non-existent.txt");
    assert.equal(notExists, false);

    // 3. Get object
    const getRes = await storage.get("test-doc.txt");
    assert.ok(getRes);
    assert.equal(getRes.key, "test-doc.txt");
    assert.equal(getRes.data.toString("utf-8"), "Hello MAIVW Object Storage!");
    assert.equal(getRes.metadata.mimeType, "text/plain");
    assert.equal(getRes.metadata.sha256, expectedHash);
    assert.equal(getRes.metadata.customMetadata?.author, "alice");

    // 4. Get metadata
    const metaRes = await storage.getMetadata("test-doc.txt");
    assert.ok(metaRes);
    assert.equal(metaRes.size, sampleData.length);
    assert.equal(metaRes.sha256, expectedHash);
    assert.equal(metaRes.customMetadata?.version, "1");

    // 5. Hash mismatch throws StorageHashMismatchError
    await assert.rejects(
      async () => {
        await storage.put({
          key: "bad-hash.txt",
          data: sampleData,
          expectedSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        });
      },
      (err: any) => {
        assert.ok(err instanceof StorageHashMismatchError);
        assert.ok(err.message.includes("Integridade violada"));
        return true;
      }
    );

    // 6. Size limit exceeded throws StorageSizeExceededError
    await assert.rejects(
      async () => {
        const tooBig = Buffer.alloc(1024 * 1024 + 10, "x");
        await storage.put({
          key: "too-big.bin",
          data: tooBig,
        });
      },
      (err: any) => {
        assert.ok(err instanceof StorageSizeExceededError);
        assert.ok(err.message.includes("excede o limite"));
        return true;
      }
    );

    // 7. Path traversal attempt throws StorageInvalidKeyError
    await assert.rejects(
      async () => {
        await storage.put({
          key: "../../etc/passwd",
          data: Buffer.from("root"),
        });
      },
      (err: any) => {
        assert.ok(err instanceof StorageInvalidKeyError);
        return true;
      }
    );

    // 8. Delete object
    const deleted = await storage.delete("test-doc.txt");
    assert.equal(deleted, true);

    const getAfterDelete = await storage.get("test-doc.txt");
    assert.equal(getAfterDelete, null);

    const existsAfterDelete = await storage.exists("test-doc.txt");
    assert.equal(existsAfterDelete, false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("FilesystemStorageAdapter: Signed URLs and HMAC verification", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maivw-fs-signed-test-"));

  try {
    const storage = new FilesystemStorageAdapter({
      baseDir: tmpDir,
      signedUrlSecret: "my-signed-hmac-secret-1234567890",
      publicGatewayUrl: "http://localhost:3001",
    });

    // 1. Put an initial object
    const content = Buffer.from("Secure download content");
    await storage.put({
      key: "report.pdf",
      data: content,
      mimeType: "application/pdf",
    });

    // 2. Generate signed download URL
    const signedDownload = await storage.createSignedDownloadUrl("report.pdf", {
      expiresInSeconds: 300,
    });

    assert.ok(signedDownload.includes("/api/v1/attachments/signed-download-target?"));
    const dlUrl = new URL(signedDownload);
    const keyParam = dlUrl.searchParams.get("key");
    const expiresParam = dlUrl.searchParams.get("expires");
    const tokenParam = dlUrl.searchParams.get("token");

    assert.equal(keyParam, "report.pdf");
    assert.ok(expiresParam);
    assert.ok(tokenParam);

    // Verify valid token
    const valid = storage.verifyToken({
      key: "report.pdf",
      type: "download",
      expires: Number(expiresParam),
      token: tokenParam!,
    });
    assert.equal(valid, true);

    // Verify invalid token / tampered key
    const tampered = storage.verifyToken({
      key: "other.pdf",
      type: "download",
      expires: Number(expiresParam),
      token: tokenParam!,
    });
    assert.equal(tampered, false);

    // Verify expired token
    const expiredSig = storage.verifyToken({
      key: "report.pdf",
      type: "download",
      expires: Date.now() - 1000,
      token: tokenParam!,
    });
    assert.equal(expiredSig, false);

    // 3. Generate signed upload URL
    const signedUpload = await storage.createSignedUploadUrl("incoming.bin", {
      expiresInSeconds: 300,
      contentType: "application/octet-stream",
    });

    assert.equal(signedUpload.method, "PUT");
    const upUrl = new URL(signedUpload.uploadUrl);
    assert.ok(upUrl.pathname.includes("/api/v1/attachments/signed-upload-target"));
    assert.equal(upUrl.searchParams.get("key"), "incoming.bin");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("S3CompatibleStorageAdapter: AWS SigV4 requests against mock S3 server", async () => {
  const objects = new Map<string, { data: Buffer; headers: Record<string, string> }>();
  let lastAuthHeader = "";

  const server = http.createServer(async (req, res) => {
    lastAuthHeader = req.headers.authorization || "";
    const parsedUrl = new URL(req.url || "/", "http://localhost");
    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    const bucket = parts[0];
    const key = parts.slice(1).join("/");

    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        const savedHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") savedHeaders[k.toLowerCase()] = v;
        }
        objects.set(`${bucket}/${key}`, { data: body, headers: savedHeaders });
        res.writeHead(200, {
          "etag": `"${crypto.createHash("sha256").update(body).digest("hex")}"`,
          "content-length": "0",
        });
        res.end();
      });
      return;
    }

    if (req.method === "GET") {
      const obj = objects.get(`${bucket}/${key}`);
      if (!obj) {
        res.writeHead(404, { "content-type": "application/xml" });
        res.end("<Error><Code>NoSuchKey</Code></Error>");
        return;
      }
      res.writeHead(200, {
        "content-type": obj.headers["content-type"] || "application/octet-stream",
        "content-length": String(obj.data.length),
        "x-amz-meta-sha256": obj.headers["x-amz-meta-sha256"] || "",
        "x-amz-meta-author": obj.headers["x-amz-meta-author"] || "",
      });
      res.end(obj.data);
      return;
    }

    if (req.method === "HEAD") {
      const obj = objects.get(`${bucket}/${key}`);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": obj.headers["content-type"] || "application/octet-stream",
        "content-length": String(obj.data.length),
        "x-amz-meta-sha256": obj.headers["x-amz-meta-sha256"] || "",
      });
      res.end();
      return;
    }

    if (req.method === "DELETE") {
      objects.delete(`${bucket}/${key}`);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as any).port;
  const mockEndpoint = `http://127.0.0.1:${port}`;

  try {
    const s3Storage = new S3CompatibleStorageAdapter({
      endpoint: mockEndpoint,
      bucket: "maivw-test-bucket",
      region: "us-east-1",
      accessKeyId: "MOCK_ACCESS_KEY_ID",
      secretAccessKey: "MOCK_SECRET_ACCESS_KEY_1234567890",
      forcePathStyle: true,
      maxFileSizeBytes: 1024 * 1024,
    });

    assert.equal(s3Storage.name, "S3CompatibleStorage");
    assert.equal(s3Storage.driver, "s3");

    // 1. Put object
    const fileBytes = Buffer.from("Pure Node.js AWS SigV4 S3 Content");
    const sha = crypto.createHash("sha256").update(fileBytes).digest("hex");

    const putRes = await s3Storage.put({
      key: "contracts/lease.pdf",
      data: fileBytes,
      mimeType: "application/pdf",
      expectedSha256: sha,
      customMetadata: { author: "bob" },
    });

    assert.equal(putRes.key, "contracts/lease.pdf");
    assert.equal(putRes.sha256, sha);
    assert.ok(lastAuthHeader.startsWith("AWS4-HMAC-SHA256 Credential=MOCK_ACCESS_KEY_ID/"));

    // 2. Exists
    const exists = await s3Storage.exists("contracts/lease.pdf");
    assert.equal(exists, true);

    const notExists = await s3Storage.exists("contracts/ghost.pdf");
    assert.equal(notExists, false);

    // 3. Get object
    const getRes = await s3Storage.get("contracts/lease.pdf");
    assert.ok(getRes);
    assert.equal(getRes.data.toString(), "Pure Node.js AWS SigV4 S3 Content");
    assert.equal(getRes.metadata.mimeType, "application/pdf");
    assert.equal(getRes.metadata.customMetadata?.author, "bob");

    // 4. Get metadata
    const meta = await s3Storage.getMetadata("contracts/lease.pdf");
    assert.ok(meta);
    assert.equal(meta.size, fileBytes.length);
    assert.equal(meta.sha256, sha);

    // 5. Size limit check
    await assert.rejects(
      async () => {
        await s3Storage.put({
          key: "huge.bin",
          data: Buffer.alloc(1024 * 1024 + 50),
        });
      },
      (err: any) => err instanceof StorageSizeExceededError
    );

    // 6. Hash mismatch check
    await assert.rejects(
      async () => {
        await s3Storage.put({
          key: "bad-hash.bin",
          data: fileBytes,
          expectedSha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        });
      },
      (err: any) => err instanceof StorageHashMismatchError
    );

    // 7. Presigned URLs generation
    const presignedDownload = await s3Storage.createSignedDownloadUrl("contracts/lease.pdf", {
      expiresInSeconds: 300,
    });
    assert.ok(presignedDownload.includes("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
    assert.ok(presignedDownload.includes("X-Amz-Credential="));
    assert.ok(presignedDownload.includes("X-Amz-Signature="));

    const presignedUpload = await s3Storage.createSignedUploadUrl("incoming/data.bin", {
      expiresInSeconds: 600,
      contentType: "application/octet-stream",
    });
    assert.equal(presignedUpload.method, "PUT");
    assert.ok(presignedUpload.uploadUrl.includes("X-Amz-Signature="));

    // 8. Delete
    const deleted = await s3Storage.delete("contracts/lease.pdf");
    assert.equal(deleted, true);
    assert.equal(await s3Storage.exists("contracts/lease.pdf"), false);
  } finally {
    server.close();
  }
});

test("StorageFactory: factory and global singleton management", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maivw-factory-test-"));

  try {
    const fsStorage = createObjectStorage({
      driver: "filesystem",
      attachmentsDir: tmpDir,
    });
    assert.equal(fsStorage.driver, "filesystem");

    const s3Storage = createObjectStorage({
      driver: "s3",
      bucket: "sample-bucket",
      accessKeyId: "test-id",
      secretAccessKey: "test-key",
    });
    assert.equal(s3Storage.driver, "s3");

    // setStorage overrides singleton
    const prev = getStorage();
    setStorage(s3Storage);
    assert.equal(getStorage().driver, "s3");

    // restore
    setStorage(prev);
    assert.equal(getStorage().driver, "filesystem");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("Attachment routes: signed upload and download endpoints with validation", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "maivw-att-routes-test-"));
  const storage = new FilesystemStorageAdapter({
    baseDir: tmpDir,
    signedUrlSecret: "route-test-secret-12345",
    publicGatewayUrl: "http://localhost:3001",
  });

  const app = Fastify();
  await app.register(attachmentRoutes, {
    storage,
  });

  try {
    // 1. POST /api/v1/attachments/signed-upload (sem filename -> 400)
    const resBadSigned = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/signed-upload",
      payload: {},
    });
    assert.equal(resBadSigned.statusCode, 400);

    // 2. POST /api/v1/attachments/signed-upload (válido -> 200 com URL e key)
    const resSignedUp = await app.inject({
      method: "POST",
      url: "/api/v1/attachments/signed-upload",
      payload: {
        filename: "financial_report.pdf",
        mimeType: "application/pdf",
        expiresInSeconds: 600,
      },
    });
    assert.equal(resSignedUp.statusCode, 200);
    const signedJson = JSON.parse(resSignedUp.payload);
    assert.equal(signedJson.success, true);
    assert.equal(signedJson.method, "PUT");
    assert.ok(signedJson.uploadUrl);
    assert.ok(signedJson.key);
    assert.ok(signedJson.id);

    // 3. Executar o upload binário direto na URL assinada retornada
    const sampleBytes = Buffer.from("Financial Report PDF binary content 2026");
    const uploadUrlParsed = new URL(signedJson.uploadUrl);

    const resTargetUpload = await app.inject({
      method: "PUT",
      url: `${uploadUrlParsed.pathname}${uploadUrlParsed.search}`,
      headers: { "content-type": "application/pdf" },
      payload: sampleBytes,
    });
    assert.equal(resTargetUpload.statusCode, 201);
    const targetJson = JSON.parse(resTargetUpload.payload);
    assert.equal(targetJson.success, true);
    assert.equal(targetJson.size, sampleBytes.length);

    // 4. GET /api/v1/attachments/:id/signed-download
    const resSignedDl = await app.inject({
      method: "GET",
      url: `/api/v1/attachments/${signedJson.id}/signed-download`,
    });
    assert.equal(resSignedDl.statusCode, 200);
    const dlJson = JSON.parse(resSignedDl.payload);
    assert.equal(dlJson.success, true);
    assert.ok(dlJson.downloadUrl);

    // 5. Executar o download na URL assinada
    const dlUrlParsed = new URL(dlJson.downloadUrl);
    const resTargetDl = await app.inject({
      method: "GET",
      url: `${dlUrlParsed.pathname}${dlUrlParsed.search}`,
    });
    assert.equal(resTargetDl.statusCode, 200);
    assert.equal(resTargetDl.payload, sampleBytes.toString());
    assert.equal(resTargetDl.headers["x-content-type-options"], "nosniff");

    // 6. Tentativa com assinatura fraudada -> 403
    const fraudUrl = `${dlUrlParsed.pathname}${dlUrlParsed.search.replace(/token=[^&]+/, "token=invalid_hmac")}`;
    const resFraud = await app.inject({
      method: "GET",
      url: fraudUrl,
    });
    assert.equal(resFraud.statusCode, 403);
  } finally {
    await app.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
