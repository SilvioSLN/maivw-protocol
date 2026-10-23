import { createPublicKey } from "node:crypto";
import {
  type Address,
  type Hex,
  keccak256,
  recoverAddress,
  verifyMessage,
} from "viem";
import { parseDerSignature } from "../services/GcpKmsAccount.js";
import type { ISigner, SignerKeyRole, SignerMetadata, SignDigestOptions } from "./types.js";

const SECP256K1_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const SECP256K1_N_DIV_2 = SECP256K1_N / 2n;

export interface AwsKmsTransport {
  getPublicKey(keyId: string): Promise<Uint8Array | Buffer>;
  signDigest(keyId: string, digest: Uint8Array): Promise<Uint8Array | Buffer>;
}

export interface AwsKmsEvmSignerOptions {
  keyId: string;
  role?: SignerKeyRole;
  transport: AwsKmsTransport;
}

export class AwsKmsEvmSigner implements ISigner {
  readonly metadata: SignerMetadata;
  private readonly transport: AwsKmsTransport;
  private cachedAddress: Address | null = null;

  constructor(options: AwsKmsEvmSignerOptions) {
    if (!options.keyId || !options.keyId.trim()) {
      throw new Error("AwsKmsEvmSigner requires a valid keyId or ARN");
    }
    this.transport = options.transport;
    this.metadata = {
      role: options.role ?? "oracle",
      family: "EVM",
      provider: "aws-kms",
      keyId: options.keyId,
      address: "0x0000000000000000000000000000000000000000",
    };
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress;

    const spkiBytes = await this.transport.getPublicKey(this.metadata.keyId);
    const keyObj = createPublicKey({
      key: Buffer.from(spkiBytes),
      format: "der",
      type: "spki",
    });

    const jwk = keyObj.export({ format: "jwk" });
    if (!jwk.x || !jwk.y) {
      throw new Error("AWS KMS public key does not contain secp256k1 coordinates");
    }

    const x = Buffer.from(jwk.x, "base64url");
    const y = Buffer.from(jwk.y, "base64url");
    if (x.length !== 32 || y.length !== 32) {
      throw new Error(`Invalid EC coordinates length from AWS KMS: x=${x.length}, y=${y.length}`);
    }

    const uncompressed = Buffer.concat([x, y]);
    const address = `0x${keccak256(uncompressed).slice(-40)}` as Address;

    this.cachedAddress = address;
    (this.metadata as any).address = address;
    return address;
  }

  async signDigest(digest: Hex | Uint8Array, _options?: SignDigestOptions): Promise<Hex> {
    const address = await this.getAddress();
    const digestHex = typeof digest === "string" ? digest : (`0x${Buffer.from(digest).toString("hex")}` as Hex);
    const digestBytes = Buffer.from(digestHex.slice(2), "hex");

    if (digestBytes.length !== 32) {
      throw new Error(`Invalid digest length for secp256k1: expected 32 bytes, got ${digestBytes.length}`);
    }

    const derSignature = await this.transport.signDigest(this.metadata.keyId, digestBytes);
    const { rHex, sHex } = parseDerSignature(Buffer.from(derSignature));

    // EIP-2 low-S normalization
    let sBigInt = BigInt(`0x${sHex}`);
    if (sBigInt > SECP256K1_N_DIV_2) {
      sBigInt = SECP256K1_N - sBigInt;
    }
    const normalizedSHex = sBigInt.toString(16).padStart(64, "0");

    // Recover parity id v (27 or 28)
    let recoveredV: number | null = null;
    for (const candidateV of [27, 28]) {
      const candidateSig = `0x${rHex}${normalizedSHex}${candidateV.toString(16)}` as Hex;
      try {
        const recovered = await recoverAddress({ hash: digestHex, signature: candidateSig });
        if (recovered.toLowerCase() === address.toLowerCase()) {
          recoveredV = candidateV;
          break;
        }
      } catch {
        // try next
      }
    }

    if (recoveredV === null) {
      throw new Error(`[AWS-KMS] Failed to determine signature recovery id (v) for address ${address}`);
    }

    return `0x${rHex}${normalizedSHex}${recoveredV.toString(16)}` as Hex;
  }

  async signMessage(message: string | Uint8Array, options?: SignDigestOptions): Promise<Hex> {
    const msg = typeof message === "string" ? message : { raw: message };
    const { hashMessage } = await import("viem");
    const digest = hashMessage(msg);
    return await this.signDigest(digest, options);
  }

  async verify(messageOrDigest: string | Uint8Array | Hex, signature: Hex | string): Promise<boolean> {
    const address = (await this.getAddress()) as Address;
    const sigHex = signature as Hex;

    try {
      if (typeof messageOrDigest === "string" && messageOrDigest.startsWith("0x") && messageOrDigest.length === 66) {
        const recovered = await recoverAddress({ hash: messageOrDigest as Hex, signature: sigHex });
        return recovered.toLowerCase() === address.toLowerCase();
      }

      const msg = typeof messageOrDigest === "string" ? messageOrDigest : { raw: messageOrDigest };
      return await verifyMessage({ address, message: msg, signature: sigHex });
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
