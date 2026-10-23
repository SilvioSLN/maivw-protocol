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
  StorageError,
  StorageHashMismatchError,
  StorageInvalidKeyError,
  StorageSizeExceededError,
} from "./types.js";

export interface S3StorageOptions {
  endpoint?: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  maxFileSizeBytes?: number;
}

const DEFAULT_REGION = "auto";
const DEFAULT_MAX_SIZE = 25 * 1024 * 1024; // 25 MB

function sha256Hex(data: string | Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
  const kDate = hmacSha256("AWS4" + key, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  const kSigning = hmacSha256(kService, "aws4_request");
  return kSigning;
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export class S3CompatibleStorageAdapter implements ObjectStorage {
  readonly name = "S3CompatibleStorage";
  readonly driver = "s3" as const;

  private endpoint: string;
  private bucket: string;
  private region: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private forcePathStyle: boolean;
  private maxFileSizeBytes: number;

  constructor(options: S3StorageOptions) {
    if (!options.bucket) {
      throw new StorageError("S3 bucket é obrigatório");
    }
    if (!options.accessKeyId || !options.secretAccessKey) {
      throw new StorageError("S3 accessKeyId e secretAccessKey são obrigatórios");
    }

    this.bucket = options.bucket;
    this.region = options.region || DEFAULT_REGION;
    this.accessKeyId = options.accessKeyId;
    this.secretAccessKey = options.secretAccessKey;
    this.forcePathStyle = options.forcePathStyle ?? true;
    this.maxFileSizeBytes = options.maxFileSizeBytes || DEFAULT_MAX_SIZE;

    const rawEndpoint = options.endpoint || `https://s3.${this.region === "auto" ? "us-east-1" : this.region}.amazonaws.com`;
    this.endpoint = rawEndpoint.replace(/\/$/, "");
  }

  private validateKey(key: string): string {
    if (!key || typeof key !== "string" || key.trim() === "") {
      throw new StorageInvalidKeyError(key || "empty");
    }
    if (key.includes("..") || key.includes("\0") || key.startsWith("/")) {
      throw new StorageInvalidKeyError(key);
    }
    return key.replace(/\\/g, "/");
  }

  private getObjectUrl(key: string): { url: URL; canonicalPath: string } {
    const cleanKey = this.validateKey(key);
    if (this.forcePathStyle) {
      const url = new URL(`${this.endpoint}/${this.bucket}/${cleanKey}`);
      return { url, canonicalPath: `/${this.bucket}/${cleanKey.split("/").map(rfc3986Encode).join("/")}` };
    } else {
      const hostUrl = new URL(this.endpoint);
      const url = new URL(`${hostUrl.protocol}//${this.bucket}.${hostUrl.host}/${cleanKey}`);
      return { url, canonicalPath: `/${cleanKey.split("/").map(rfc3986Encode).join("/")}` };
    }
  }

  private signRequest(params: {
    method: string;
    url: URL;
    canonicalPath: string;
    headers: Record<string, string>;
    payloadHash: string;
    date: Date;
  }): Record<string, string> {
    const { method, url, canonicalPath, headers, payloadHash, date } = params;

    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substring(0, 8);

    const signedHeadersList: Record<string, string> = {
      ...headers,
      host: url.host,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    };

    const headerKeys = Object.keys(signedHeadersList).map((k) => k.toLowerCase()).sort();
    const canonicalHeaders = headerKeys.map((k) => `${k}:${signedHeadersList[k].trim()}\n`).join("");
    const signedHeadersStr = headerKeys.join(";");

    // Canonical Query String
    const searchParams = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = searchParams.map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`).join("&");

    const canonicalRequest = [
      method.toUpperCase(),
      canonicalPath,
      canonicalQuery,
      canonicalHeaders,
      signedHeadersStr,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, "s3");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    return {
      ...signedHeadersList,
      Authorization: authorizationHeader,
    };
  }

  async put(input: PutObjectInput): Promise<PutObjectResult> {
    const { key, data, mimeType, expectedSha256, customMetadata } = input;
    const cleanKey = this.validateKey(key);

    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (buffer.length > this.maxFileSizeBytes) {
      throw new StorageSizeExceededError(buffer.length, this.maxFileSizeBytes);
    }

    const computedSha256 = sha256Hex(buffer);

    if (expectedSha256 && expectedSha256.toLowerCase() !== computedSha256.toLowerCase()) {
      throw new StorageHashMismatchError(expectedSha256, computedSha256);
    }

    const { url, canonicalPath } = this.getObjectUrl(cleanKey);
    const date = new Date();

    const headers: Record<string, string> = {
      "content-type": mimeType || "application/octet-stream",
      "content-length": String(buffer.length),
      "x-amz-meta-sha256": computedSha256,
      "x-amz-meta-uploaded-at": date.toISOString(),
    };

    if (customMetadata) {
      for (const [k, v] of Object.entries(customMetadata)) {
        headers[`x-amz-meta-${k.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`] = String(v);
      }
    }

    const signedHeaders = this.signRequest({
      method: "PUT",
      url,
      canonicalPath,
      headers,
      payloadHash: computedSha256,
      date,
    });

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: signedHeaders,
      body: buffer,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new StorageError(`Falha ao gravar objeto no S3/R2 (${res.status}): ${errText}`);
    }

    const etag = res.headers.get("etag") || `"${computedSha256}"`;

    return {
      key: cleanKey,
      size: buffer.length,
      sha256: computedSha256,
      etag,
    };
  }

  async get(key: string): Promise<GetObjectResult | null> {
    const cleanKey = this.validateKey(key);
    const { url, canonicalPath } = this.getObjectUrl(cleanKey);
    const date = new Date();

    const signedHeaders = this.signRequest({
      method: "GET",
      url,
      canonicalPath,
      headers: {},
      payloadHash: sha256Hex(""),
      date,
    });

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: signedHeaders,
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new StorageError(`Falha ao obter objeto do S3/R2 (${res.status}): ${errText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const data = Buffer.from(arrayBuf);
    const computedSha256 = sha256Hex(data);

    const metaSha = res.headers.get("x-amz-meta-sha256") || computedSha256;
    const uploadedAtStr = res.headers.get("x-amz-meta-uploaded-at") || res.headers.get("last-modified");

    const customMetadata: Record<string, string> = {};
    res.headers.forEach((value, header) => {
      if (header.startsWith("x-amz-meta-") && header !== "x-amz-meta-sha256" && header !== "x-amz-meta-uploaded-at") {
        customMetadata[header.replace("x-amz-meta-", "")] = value;
      }
    });

    const metadata: ObjectMetadata = {
      key: cleanKey,
      size: data.length,
      mimeType: res.headers.get("content-type") || "application/octet-stream",
      sha256: metaSha,
      uploadedAt: uploadedAtStr ? new Date(uploadedAtStr) : new Date(),
      customMetadata,
    };

    return {
      key: cleanKey,
      data,
      metadata,
    };
  }

  async getMetadata(key: string): Promise<ObjectMetadata | null> {
    const cleanKey = this.validateKey(key);
    const { url, canonicalPath } = this.getObjectUrl(cleanKey);
    const date = new Date();

    const signedHeaders = this.signRequest({
      method: "HEAD",
      url,
      canonicalPath,
      headers: {},
      payloadHash: sha256Hex(""),
      date,
    });

    const res = await fetch(url.toString(), {
      method: "HEAD",
      headers: signedHeaders,
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      throw new StorageError(`Falha ao consultar metadados do objeto no S3/R2 (${res.status})`);
    }

    const size = Number(res.headers.get("content-length") || "0");
    const metaSha = res.headers.get("x-amz-meta-sha256") || res.headers.get("etag")?.replace(/"/g, "") || "";
    const uploadedAtStr = res.headers.get("x-amz-meta-uploaded-at") || res.headers.get("last-modified");

    const customMetadata: Record<string, string> = {};
    res.headers.forEach((value, header) => {
      if (header.startsWith("x-amz-meta-") && header !== "x-amz-meta-sha256" && header !== "x-amz-meta-uploaded-at") {
        customMetadata[header.replace("x-amz-meta-", "")] = value;
      }
    });

    return {
      key: cleanKey,
      size,
      mimeType: res.headers.get("content-type") || "application/octet-stream",
      sha256: metaSha,
      uploadedAt: uploadedAtStr ? new Date(uploadedAtStr) : new Date(),
      customMetadata,
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      const meta = await this.getMetadata(key);
      return meta !== null;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    const cleanKey = this.validateKey(key);
    const { url, canonicalPath } = this.getObjectUrl(cleanKey);
    const date = new Date();

    const signedHeaders = this.signRequest({
      method: "DELETE",
      url,
      canonicalPath,
      headers: {},
      payloadHash: sha256Hex(""),
      date,
    });

    const res = await fetch(url.toString(), {
      method: "DELETE",
      headers: signedHeaders,
    });

    return res.status === 204 || res.status === 200;
  }

  async createSignedDownloadUrl(key: string, options: SignedDownloadUrlOptions = {}): Promise<string> {
    const cleanKey = this.validateKey(key);
    const { url, canonicalPath } = this.getObjectUrl(cleanKey);

    const expiresInSeconds = options.expiresInSeconds || 900;
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", `${this.accessKeyId}/${credentialScope}`);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    url.searchParams.set("X-Amz-SignedHeaders", "host");

    if (options.downloadFilename) {
      url.searchParams.set(
        "response-content-disposition",
        `attachment; filename="${encodeURIComponent(options.downloadFilename)}"`
      );
    }
    if (options.contentType) {
      url.searchParams.set("response-content-type", options.contentType);
    }

    const searchParams = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = searchParams.map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`).join("&");

    const canonicalHeaders = `host:${url.host}\n`;
    const canonicalRequest = [
      "GET",
      canonicalPath,
      canonicalQuery,
      canonicalHeaders,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, "s3");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    url.searchParams.set("X-Amz-Signature", signature);
    return url.toString();
  }

  async createSignedUploadUrl(key: string, options: SignedUploadUrlOptions = {}): Promise<SignedUploadUrlResult> {
    const cleanKey = this.validateKey(key);
    const { url, canonicalPath } = this.getObjectUrl(cleanKey);

    const expiresInSeconds = options.expiresInSeconds || 900;
    const date = new Date();
    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
    url.searchParams.set("X-Amz-Credential", `${this.accessKeyId}/${credentialScope}`);
    url.searchParams.set("X-Amz-Date", amzDate);
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

    const signedHeaders: Record<string, string> = { host: url.host };
    if (options.contentType) {
      signedHeaders["content-type"] = options.contentType;
    }
    if (options.expectedSha256) {
      signedHeaders["x-amz-meta-sha256"] = options.expectedSha256;
    }

    const headerKeys = Object.keys(signedHeaders).sort();
    url.searchParams.set("X-Amz-SignedHeaders", headerKeys.join(";"));

    const searchParams = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    const canonicalQuery = searchParams.map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`).join("&");

    const canonicalHeaders = headerKeys.map((k) => `${k}:${signedHeaders[k]}\n`).join("");
    const canonicalRequest = [
      "PUT",
      canonicalPath,
      canonicalQuery,
      canonicalHeaders,
      headerKeys.join(";"),
      "UNSIGNED-PAYLOAD",
    ].join("\n");

    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, "s3");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    url.searchParams.set("X-Amz-Signature", signature);

    const requestHeaders: Record<string, string> = {};
    if (options.contentType) {
      requestHeaders["Content-Type"] = options.contentType;
    }
    if (options.expectedSha256) {
      requestHeaders["x-amz-meta-sha256"] = options.expectedSha256;
    }

    return {
      uploadUrl: url.toString(),
      method: "PUT",
      headers: requestHeaders,
      expiresAt: new Date(date.getTime() + expiresInSeconds * 1000),
    };
  }
}
