import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ObjectMetadata,
  ObjectStorage,
  PutObjectInput,
  PutObjectResult,
  GetObjectResult,
  SignedDownloadUrlOptions,
  SignedUploadUrlOptions,
  SignedUploadUrlResult,
} from "./types.js";
import {
  StorageHashMismatchError,
  StorageInvalidKeyError,
  StorageSizeExceededError,
} from "./types.js";

export interface FilesystemStorageOptions {
  baseDir?: string;
  maxFileSizeBytes?: number;
  signedUrlSecret?: string;
  publicGatewayUrl?: string;
}

const DEFAULT_BASE_DIR = path.resolve(process.cwd(), "data/attachments");
const DEFAULT_MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const DEFAULT_URL_SECRET = "maivw-fs-signed-url-secret-2026";

export class FilesystemStorageAdapter implements ObjectStorage {
  readonly name = "FilesystemStorage";
  readonly driver = "filesystem" as const;

  private baseDir: string;
  private maxFileSizeBytes: number;
  private signedUrlSecret: string;
  private publicGatewayUrl: string;

  constructor(options: FilesystemStorageOptions = {}) {
    this.baseDir = path.resolve(options.baseDir || DEFAULT_BASE_DIR);
    this.maxFileSizeBytes = options.maxFileSizeBytes || DEFAULT_MAX_SIZE;
    this.signedUrlSecret = options.signedUrlSecret || process.env.JWT_SECRET || DEFAULT_URL_SECRET;
    this.publicGatewayUrl = (options.publicGatewayUrl || process.env.GATEWAY_PUBLIC_URL || "http://localhost:3001").replace(/\/$/, "");

    this.ensureBaseDir();
  }

  private ensureBaseDir(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private resolveKeyPath(key: string): { filePath: string; metaPath: string } {
    if (!key || typeof key !== "string") {
      throw new StorageInvalidKeyError(key || "empty");
    }

    // Path traversal check and illegal characters check
    if (key.includes("..") || key.includes("\0") || path.isAbsolute(key)) {
      throw new StorageInvalidKeyError(key);
    }

    const cleanKey = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    const filePath = path.resolve(this.baseDir, cleanKey);

    if (!filePath.startsWith(this.baseDir)) {
      throw new StorageInvalidKeyError(key);
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const metaPath = path.resolve(dir, `${path.basename(cleanKey)}__meta.json`);
    return { filePath, metaPath };
  }

  private findExistingFile(key: string): { filePath: string; metaPath: string } | null {
    const { filePath, metaPath } = this.resolveKeyPath(key);
    if (fs.existsSync(filePath)) {
      const specificMeta = `${filePath}__meta.json`;
      const chosenMeta = fs.existsSync(specificMeta) ? specificMeta : metaPath;
      return { filePath, metaPath: chosenMeta };
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) return null;
    const baseName = path.basename(key);
    try {
      const files = fs.readdirSync(dir);
      const match = files.find((f) => (f === baseName || f.startsWith(`${baseName}__`)) && !f.endsWith("__meta.json"));
      if (match) {
        const matchedFilePath = path.resolve(dir, match);
        const specificMeta = path.resolve(dir, `${match}__meta.json`);
        const baseMeta = path.resolve(dir, `${baseName}__meta.json`);
        const matchedMetaPath = fs.existsSync(specificMeta)
          ? specificMeta
          : (fs.existsSync(baseMeta) ? baseMeta : specificMeta);
        return { filePath: matchedFilePath, metaPath: matchedMetaPath };
      }
    } catch {
      return null;
    }
    return null;
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const { key, data, mimeType, expectedSha256, customMetadata } = input;
    
    // If filename is in customMetadata and key doesn't already contain __, format storage name
    let storageKey = key;
    if (customMetadata?.filename && !key.includes("__")) {
      const safeFilename = path.basename(customMetadata.filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
      storageKey = `${key}__${safeFilename}`;
    }

    const { filePath, metaPath } = this.resolveKeyPath(storageKey);

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (buffer.length > this.maxFileSizeBytes) {
      throw new StorageSizeExceededError(buffer.length, this.maxFileSizeBytes);
    }

    const computedSha256 = crypto.createHash("sha256").update(buffer).digest("hex");

    if (expectedSha256 && expectedSha256.toLowerCase() !== computedSha256.toLowerCase()) {
      throw new StorageHashMismatchError(expectedSha256, computedSha256);
    }

    await fs.promises.writeFile(filePath, buffer);

    const metadata: ObjectMetadata = {
      key,
      size: buffer.length,
      mimeType: mimeType || "application/octet-stream",
      sha256: computedSha256,
      uploadedAt: new Date(),
      customMetadata,
    };

    // Also write meta under base key if key is an ID
    const baseMetaPath = this.resolveKeyPath(key).metaPath;
    const metaJson = JSON.stringify(metadata, null, 2);
    await fs.promises.writeFile(metaPath, metaJson, "utf-8");
    if (baseMetaPath !== metaPath) {
      await fs.promises.writeFile(baseMetaPath, metaJson, "utf-8").catch(() => {});
    }

    const idPrefix = key.includes("__") ? key.split("__")[0] : null;
    if (idPrefix) {
      const idMetaPath = this.resolveKeyPath(idPrefix).metaPath;
      if (idMetaPath !== metaPath && idMetaPath !== baseMetaPath) {
        await fs.promises.writeFile(idMetaPath, metaJson, "utf-8").catch(() => {});
      }
    }

    return {
      key,
      size: buffer.length,
      sha256: computedSha256,
      etag: `"${computedSha256}"`,
    };
  }

  async get(key: string): Promise<GetObjectResult | null> {
    const resolved = this.findExistingFile(key);
    if (!resolved) {
      return null;
    }
    const { filePath, metaPath } = resolved;

    const data = await fs.promises.readFile(filePath);

    let metadata: ObjectMetadata | null = null;
    if (fs.existsSync(metaPath)) {
      try {
        const raw = await fs.promises.readFile(metaPath, "utf-8");
        const parsed = JSON.parse(raw);
        metadata = {
          ...parsed,
          uploadedAt: new Date(parsed.uploadedAt),
        };
      } catch {
        // Fallback below if metadata file is damaged
      }
    }

    if (!metadata) {
      const stats = await fs.promises.stat(filePath);
      const sha256 = crypto.createHash("sha256").update(data).digest("hex");
      metadata = {
        key,
        size: stats.size,
        mimeType: "application/octet-stream",
        sha256,
        uploadedAt: stats.mtime,
      };
    }

    return {
      key,
      data,
      metadata,
    };
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    const resolved = this.findExistingFile(key);
    if (!resolved) {
      return null;
    }
    const { filePath, metaPath } = resolved;

    if (fs.existsSync(metaPath)) {
      try {
        const raw = await fs.promises.readFile(metaPath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          ...parsed,
          uploadedAt: new Date(parsed.uploadedAt),
        };
      } catch {
        // Fallback to stat
      }
    }

    const stats = await fs.promises.stat(filePath);
    const data = await fs.promises.readFile(filePath);
    const sha256 = crypto.createHash("sha256").update(data).digest("hex");

    return {
      key,
      size: stats.size,
      mimeType: "application/octet-stream",
      sha256,
      uploadedAt: stats.mtime,
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      return this.findExistingFile(key) !== null;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    const resolved = this.findExistingFile(key);
    if (!resolved) {
      return false;
    }
    const { filePath, metaPath } = resolved;
    let existed = false;

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      existed = true;
    }
    if (fs.existsSync(metaPath)) {
      await fs.promises.unlink(metaPath).catch(() => {});
    }

    // Also remove base meta if exists
    const baseMeta = this.resolveKeyPath(key).metaPath;
    if (baseMeta !== metaPath && fs.existsSync(baseMeta)) {
      await fs.promises.unlink(baseMeta).catch(() => {});
    }

    return existed;
  }

  private generateToken(payload: { key: string; type: "download" | "upload"; expires: number }): string {
    const data = `${payload.key}:${payload.type}:${payload.expires}`;
    return crypto.createHmac("sha256", this.signedUrlSecret).update(data).digest("hex");
  }

  verifyToken(payload: { key: string; type: "download" | "upload"; expires: number; token: string }): boolean {
    if (Date.now() > payload.expires) {
      return false;
    }
    const expected = this.generateToken({ key: payload.key, type: payload.type, expires: payload.expires });
    const bufExpected = Buffer.from(expected);
    const bufToken = Buffer.from(payload.token || "");
    if (bufExpected.length !== bufToken.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufExpected, bufToken);
  }

  async createSignedDownloadUrl(key: string, options: SignedDownloadUrlOptions = {}): Promise<string> {
    const expiresInSeconds = options.expiresInSeconds || 900;
    const expires = Date.now() + expiresInSeconds * 1000;
    const token = this.generateToken({ key, type: "download", expires });

    const params = new URLSearchParams({
      key,
      expires: String(expires),
      token,
    });

    if (options.downloadFilename) {
      params.set("filename", options.downloadFilename);
    }

    return `${this.publicGatewayUrl}/api/v1/attachments/signed-download-target?${params.toString()}`;
  }

  async createSignedUploadUrl(key: string, options: SignedUploadUrlOptions = {}): Promise<SignedUploadUrlResult> {
    const expiresInSeconds = options.expiresInSeconds || 900;
    const expires = Date.now() + expiresInSeconds * 1000;
    const token = this.generateToken({ key, type: "upload", expires });

    const params = new URLSearchParams({
      key,
      expires: String(expires),
      token,
    });

    const headers: Record<string, string> = {};
    if (options.contentType) {
      headers["Content-Type"] = options.contentType;
      params.set("contentType", options.contentType);
    }
    if (options.expectedSha256) {
      headers["x-maivw-sha256"] = options.expectedSha256;
      params.set("expectedSha256", options.expectedSha256);
    }

    return {
      uploadUrl: `${this.publicGatewayUrl}/api/v1/attachments/signed-upload-target?${params.toString()}`,
      method: "PUT",
      headers,
      expiresAt: new Date(expires),
    };
  }
}
