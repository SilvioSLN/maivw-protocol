import type { ObjectStorage } from "./types.js";
import { FilesystemStorageAdapter } from "./FilesystemStorageAdapter.js";
import { S3CompatibleStorageAdapter } from "./S3CompatibleStorageAdapter.js";

export interface StorageFactoryConfig {
  STORAGE_DRIVER?: "filesystem" | "s3";
  driver?: "filesystem" | "s3";
  ATTACHMENTS_DIR?: string;
  attachmentsDir?: string;
  STORAGE_MAX_FILE_SIZE_BYTES?: number;
  maxFileSizeBytes?: number;
  STORAGE_SIGNED_URL_EXPIRES_SECONDS?: number;
  signedUrlExpiresSeconds?: number;
  S3_ENDPOINT?: string;
  endpoint?: string;
  S3_BUCKET?: string;
  bucket?: string;
  S3_REGION?: string;
  region?: string;
  S3_ACCESS_KEY_ID?: string;
  accessKeyId?: string;
  S3_SECRET_ACCESS_KEY?: string;
  secretAccessKey?: string;
  S3_FORCE_PATH_STYLE?: boolean;
  forcePathStyle?: boolean;
  GATEWAY_PUBLIC_URL?: string;
  publicGatewayUrl?: string;
  JWT_SECRET?: string;
  signedUrlSecret?: string;
}

let activeStorage: ObjectStorage | null = null;

export function createObjectStorage(config?: StorageFactoryConfig): ObjectStorage {
  const driver = config?.STORAGE_DRIVER || config?.driver || (process.env.STORAGE_DRIVER as any) || "filesystem";

  if (driver === "s3") {
    const bucket = config?.S3_BUCKET || config?.bucket || process.env.S3_BUCKET;
    const accessKeyId = config?.S3_ACCESS_KEY_ID || config?.accessKeyId || process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = config?.S3_SECRET_ACCESS_KEY || config?.secretAccessKey || process.env.S3_SECRET_ACCESS_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error("S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY são obrigatórios para STORAGE_DRIVER=s3");
    }

    return new S3CompatibleStorageAdapter({
      endpoint: config?.S3_ENDPOINT || config?.endpoint || process.env.S3_ENDPOINT,
      bucket,
      region: config?.S3_REGION || config?.region || process.env.S3_REGION || "auto",
      accessKeyId,
      secretAccessKey,
      forcePathStyle: config?.S3_FORCE_PATH_STYLE ?? config?.forcePathStyle ?? (process.env.S3_FORCE_PATH_STYLE !== "false"),
      maxFileSizeBytes: config?.STORAGE_MAX_FILE_SIZE_BYTES || config?.maxFileSizeBytes,
    });
  }

  return new FilesystemStorageAdapter({
    baseDir: config?.ATTACHMENTS_DIR || config?.attachmentsDir || process.env.ATTACHMENTS_DIR,
    maxFileSizeBytes: config?.STORAGE_MAX_FILE_SIZE_BYTES || config?.maxFileSizeBytes,
    signedUrlSecret: config?.JWT_SECRET || config?.signedUrlSecret || process.env.JWT_SECRET,
    publicGatewayUrl: config?.GATEWAY_PUBLIC_URL || config?.publicGatewayUrl || process.env.GATEWAY_PUBLIC_URL,
  });
}

export function getStorage(config?: StorageFactoryConfig): ObjectStorage {
  if (!activeStorage) {
    activeStorage = createObjectStorage(config);
  }
  return activeStorage;
}

export function setStorage(storage: ObjectStorage | null): void {
  activeStorage = storage;
}
