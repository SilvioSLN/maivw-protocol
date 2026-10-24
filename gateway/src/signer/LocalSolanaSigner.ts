import crypto from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { ISigner, SignerKeyRole, SignerMetadata, SignDigestOptions } from "./types.js";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function ed25519PrivateKeyFromSeed(seed32: Uint8Array): crypto.KeyObject {
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed32)]),
    format: "der",
    type: "pkcs8",
  });
}

export function ed25519PublicKeyFromBytes(pubBytes32: Uint8Array): crypto.KeyObject {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubBytes32)]),
    format: "der",
    type: "spki",
  });
}

export class LocalSolanaSigner implements ISigner {
  readonly metadata: SignerMetadata;
  private readonly privateKeyObj: crypto.KeyObject;
  private readonly publicKeyObj: crypto.KeyObject;

  constructor(keypair: Keypair, role: SignerKeyRole = "relayer", keyId?: string) {
    const address = keypair.publicKey.toBase58();

    this.privateKeyObj = ed25519PrivateKeyFromSeed(keypair.secretKey.subarray(0, 32));
    this.publicKeyObj = ed25519PublicKeyFromBytes(keypair.publicKey.toBytes());

    this.metadata = {
      role,
      family: "SOLANA",
      provider: "solana-keypair",
      keyId: keyId ?? `local:solana:${address}`,
      address,
    };
  }

  static fromSecretKey(secretKey64: Uint8Array, role?: SignerKeyRole, keyId?: string): LocalSolanaSigner {
    const keypair = Keypair.fromSecretKey(secretKey64);
    return new LocalSolanaSigner(keypair, role, keyId);
  }

  static fromBase64(base64: string, role?: SignerKeyRole, keyId?: string): LocalSolanaSigner {
    const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    const secretKey = Uint8Array.from(decoded);
    return LocalSolanaSigner.fromSecretKey(secretKey, role, keyId);
  }

  async getAddress(): Promise<string> {
    return this.metadata.address;
  }

  async signDigest(digest: Uint8Array | string, _options?: SignDigestOptions): Promise<string> {
    const data = typeof digest === "string" ? Buffer.from(digest.replace(/^0x/, ""), "hex") : Buffer.from(digest);
    const signature = crypto.sign(null, data, this.privateKeyObj);
    return signature.toString("base64");
  }

  async signMessage(message: string | Uint8Array, options?: SignDigestOptions): Promise<string> {
    const data = typeof message === "string" ? Buffer.from(message, "utf8") : Buffer.from(message);
    return await this.signDigest(data, options);
  }

  async verify(messageOrDigest: string | Uint8Array, signature: string): Promise<boolean> {
    try {
      const data = typeof messageOrDigest === "string" ? Buffer.from(messageOrDigest, "utf8") : Buffer.from(messageOrDigest);
      const sigBytes = Buffer.from(signature, "base64");
      return crypto.verify(null, data, this.publicKeyObj, sigBytes);
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
