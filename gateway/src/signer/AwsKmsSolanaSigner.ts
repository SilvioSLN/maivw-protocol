import crypto, { createPublicKey } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { ISigner, SignerKeyRole, SignerMetadata, SignDigestOptions } from "./types.js";

const AWS_KMS_RAW_MESSAGE_MAX_BYTES = 4096;

export interface AwsKmsSolanaTransport {
  getPublicKey(keyId: string): Promise<Uint8Array | Buffer>;
  signRaw(keyId: string, message: Uint8Array): Promise<Uint8Array | Buffer>;
}

export interface AwsKmsSolanaSignerOptions {
  keyId: string;
  role?: SignerKeyRole;
  transport: AwsKmsSolanaTransport;
}

/** Solana-compatible Ed25519 signer backed by a non-exportable AWS KMS key. */
export class AwsKmsSolanaSigner implements ISigner {
  readonly metadata: SignerMetadata;
  private readonly transport: AwsKmsSolanaTransport;
  private cachedPublicKey: crypto.KeyObject | null = null;

  constructor(options: AwsKmsSolanaSignerOptions) {
    if (!options.keyId || !options.keyId.trim()) {
      throw new Error("AwsKmsSolanaSigner requires a valid keyId or ARN");
    }

    this.transport = options.transport;
    this.metadata = {
      role: options.role ?? "relayer",
      family: "SOLANA",
      provider: "aws-kms",
      keyId: options.keyId,
      address: "11111111111111111111111111111111",
    };
  }

  private async getPublicKeyObject(): Promise<crypto.KeyObject> {
    if (this.cachedPublicKey) return this.cachedPublicKey;

    const spkiBytes = await this.transport.getPublicKey(this.metadata.keyId);
    const keyObject = createPublicKey({
      key: Buffer.from(spkiBytes),
      format: "der",
      type: "spki",
    });
    const jwk = keyObject.export({ format: "jwk" });
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
      throw new Error("AWS KMS public key is not an Ed25519 key");
    }

    const rawPublicKey = Buffer.from(jwk.x, "base64url");
    if (rawPublicKey.length !== 32) {
      throw new Error(`Invalid Ed25519 public key length from AWS KMS: ${rawPublicKey.length}`);
    }

    const address = new PublicKey(rawPublicKey).toBase58();
    this.cachedPublicKey = keyObject;
    (this.metadata as { address: string }).address = address;
    return keyObject;
  }

  async getAddress(): Promise<string> {
    await this.getPublicKeyObject();
    return this.metadata.address;
  }

  private async signBytes(message: Uint8Array): Promise<string> {
    await this.getPublicKeyObject();
    if (message.byteLength > AWS_KMS_RAW_MESSAGE_MAX_BYTES) {
      throw new Error(
        `AWS KMS Ed25519 RAW message exceeds ${AWS_KMS_RAW_MESSAGE_MAX_BYTES} bytes: ${message.byteLength}`,
      );
    }

    const signature = Buffer.from(await this.transport.signRaw(this.metadata.keyId, message));
    if (signature.length !== 64) {
      throw new Error(`Invalid Ed25519 signature length from AWS KMS: ${signature.length}`);
    }
    return signature.toString("base64");
  }

  async signDigest(digest: Uint8Array | string, _options?: SignDigestOptions): Promise<string> {
    if (typeof digest === "string" && !/^0x[0-9a-fA-F]+$/.test(digest)) {
      throw new Error("Solana digest strings must be 0x-prefixed hexadecimal values");
    }
    const data = typeof digest === "string" ? Buffer.from(digest.slice(2), "hex") : Buffer.from(digest);
    return await this.signBytes(data);
  }

  async signMessage(message: string | Uint8Array, _options?: SignDigestOptions): Promise<string> {
    const data = typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
    return await this.signBytes(data);
  }

  async verify(messageOrDigest: string | Uint8Array, signature: string): Promise<boolean> {
    try {
      const publicKey = await this.getPublicKeyObject();
      const data = typeof messageOrDigest === "string" && messageOrDigest.startsWith("0x")
        ? Buffer.from(messageOrDigest.slice(2), "hex")
        : typeof messageOrDigest === "string"
          ? Buffer.from(messageOrDigest, "utf8")
          : Buffer.from(messageOrDigest);
      return crypto.verify(null, data, publicKey, Buffer.from(signature, "base64"));
    } catch {
      return false;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      role: this.metadata.role,
      family: this.metadata.family,
      provider: this.metadata.provider,
      keyId: this.metadata.keyId,
      address: this.metadata.address,
    };
  }
}
