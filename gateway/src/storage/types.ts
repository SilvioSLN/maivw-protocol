export interface ObjectMetadata {
  key: string;
  size: number;
  mimeType: string;
  sha256: string;
  uploadedAt: Date;
  customMetadata?: Record<string, string>;
}

export interface PutObjectInput {
  key: string;
  data: Buffer | Uint8Array;
  mimeType?: string;
  expectedSha256?: string;
  customMetadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  size: number;
  sha256: string;
  etag?: string;
}

export interface GetObjectResult {
  key: string;
  data: Buffer;
  metadata: ObjectMetadata;
}

export interface SignedDownloadUrlOptions {
  expiresInSeconds?: number;
  downloadFilename?: string;
  contentType?: string;
}

export interface SignedUploadUrlOptions {
  expiresInSeconds?: number;
  contentType?: string;
  maxSizeBytes?: number;
  expectedSha256?: string;
}

export interface SignedUploadUrlResult {
  uploadUrl: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectStorage {
  readonly name: string;
  readonly driver: "filesystem" | "s3";

  put(input: PutObjectInput): Promise<PutObjectResult>;
  get(key: string): Promise<GetObjectResult | null>;
  getMetadata(key: string): Promise<ObjectMetadata | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;

  createSignedDownloadUrl(key: string, options?: SignedDownloadUrlOptions): Promise<string>;
  createSignedUploadUrl(key: string, options?: SignedUploadUrlOptions): Promise<SignedUploadUrlResult>;

  close?(): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, public readonly statusCode: number = 500) {
    super(message);
    this.name = "StorageError";
  }
}

export class StorageFileNotFoundError extends StorageError {
  constructor(key: string) {
    super(`Objeto não encontrado no storage: ${key}`, 404);
    this.name = "StorageFileNotFoundError";
  }
}

export class StorageSizeExceededError extends StorageError {
  constructor(size: number, limit: number) {
    super(`Arquivo com ${size} bytes excede o limite máximo permitido de ${limit} bytes`, 413);
    this.name = "StorageSizeExceededError";
  }
}

export class StorageHashMismatchError extends StorageError {
  constructor(expected: string, actual: string) {
    super(`Integridade violada: hash SHA-256 esperado ${expected}, mas foi obtido ${actual}`, 400);
    this.name = "StorageHashMismatchError";
  }
}

export class StorageInvalidKeyError extends StorageError {
  constructor(key: string) {
    super(`Chave de objeto inválida ou insegura: ${key}`, 400);
    this.name = "StorageInvalidKeyError";
  }
}
