import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { LocalSolanaSigner } from "./LocalSolanaSigner.js";
import type { ISigner, SignerKeyRole, SignerMetadata, SignDigestOptions } from "./types.js";

export interface EncryptedKeyEnvelope {
  cipherText: string;
  iv: string;
  authTag: string;
}

export class EnvelopeSolanaSigner implements ISigner {
  readonly metadata: SignerMetadata;
  private readonly envelope: EncryptedKeyEnvelope;
  private readonly encryptionKey: Buffer;
  private readonly publicKeyBase58: string;

  constructor(
    envelope: EncryptedKeyEnvelope,
    masterSecret: string,
    publicKeyBase58: string,
    role: SignerKeyRole = "relayer",
    keyId?: string,
  ) {
    this.envelope = envelope;
    this.encryptionKey = crypto.createHash("sha256").update(masterSecret).digest();
    this.publicKeyBase58 = publicKeyBase58;

    this.metadata = {
      role,
      family: "SOLANA",
      provider: "solana-envelope",
      keyId: keyId ?? `envelope:solana:${publicKeyBase58}`,
      address: publicKeyBase58,
    };
  }

  static createEncrypted(
    keypair: Keypair,
    masterSecret: string,
    role?: SignerKeyRole,
    keyId?: string,
  ): { signer: EnvelopeSolanaSigner; envelope: EncryptedKeyEnvelope } {
    const encKey = crypto.createHash("sha256").update(masterSecret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);

    const secretKeyBase64 = Buffer.from(keypair.secretKey).toString("base64");
    let cipherText = cipher.update(secretKeyBase64, "utf8", "hex");
    cipherText += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const envelope: EncryptedKeyEnvelope = {
      cipherText,
      iv: iv.toString("hex"),
      authTag,
    };

    const signer = new EnvelopeSolanaSigner(
      envelope,
      masterSecret,
      keypair.publicKey.toBase58(),
      role,
      keyId,
    );

    return { signer, envelope };
  }

  private decryptKeypair(): Keypair {
    const iv = Buffer.from(this.envelope.iv, "hex");
    const authTag = Buffer.from(this.envelope.authTag, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(this.envelope.cipherText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    const secretKey = Buffer.from(decrypted, "base64");
    return Keypair.fromSecretKey(secretKey);
  }

  async getAddress(): Promise<string> {
    return this.publicKeyBase58;
  }

  async signDigest(digest: Uint8Array | string, options?: SignDigestOptions): Promise<string> {
    const keypair = this.decryptKeypair();
    const signer = new LocalSolanaSigner(keypair, this.metadata.role, this.metadata.keyId);
    return await signer.signDigest(digest, options);
  }

  async signMessage(message: string | Uint8Array, options?: SignDigestOptions): Promise<string> {
    const keypair = this.decryptKeypair();
    const signer = new LocalSolanaSigner(keypair, this.metadata.role, this.metadata.keyId);
    return await signer.signMessage(message, options);
  }

  async verify(messageOrDigest: string | Uint8Array, signature: string): Promise<boolean> {
    // Verification only needs the public key, no decryption needed!
    const { ed25519PublicKeyFromBytes } = await import("./LocalSolanaSigner.js");
    const { PublicKey } = await import("@solana/web3.js");
    try {
      const pubBytes = new PublicKey(this.publicKeyBase58).toBytes();
      const pubKeyObj = ed25519PublicKeyFromBytes(pubBytes);
      const data = typeof messageOrDigest === "string" ? Buffer.from(messageOrDigest, "utf8") : Buffer.from(messageOrDigest);
      const sigBytes = Buffer.from(signature, "base64");
      return crypto.verify(null, data, pubKeyObj, sigBytes);
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
