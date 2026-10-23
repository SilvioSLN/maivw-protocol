import {
  type Address,
  type Hex,
  hashMessage,
  recoverAddress,
  verifyMessage,
} from "viem";
import { GcpKmsOracleSigner, type GcpKmsAccountOptions } from "../services/GcpKmsAccount.js";
import type { ISigner, SignerKeyRole, SignerMetadata, SignDigestOptions } from "./types.js";

export class GcpKmsEvmSigner implements ISigner {
  readonly metadata: SignerMetadata;
  private readonly backend: GcpKmsOracleSigner;
  private cachedAddress: Address | null = null;

  constructor(options: GcpKmsAccountOptions, role: SignerKeyRole = "oracle") {
    this.backend = new GcpKmsOracleSigner(options);
    const meta = this.backend.getKeyMetadata();
    this.metadata = {
      role,
      family: "EVM",
      provider: "gcp-kms",
      keyId: meta.keyId,
      keyVersion: meta.keyVersion,
      address: "0x0000000000000000000000000000000000000000",
    };
  }

  async getAddress(): Promise<string> {
    if (this.cachedAddress) return this.cachedAddress;
    const address = await this.backend.getAddress();
    this.cachedAddress = address;
    (this.metadata as any).address = address;
    return address;
  }

  async signDigest(digest: Hex | Uint8Array, _options?: SignDigestOptions): Promise<Hex> {
    const digestHex = typeof digest === "string" ? digest : (`0x${Buffer.from(digest).toString("hex")}` as Hex);
    return await this.backend.signDigest(digestHex);
  }

  async signMessage(message: string | Uint8Array, options?: SignDigestOptions): Promise<Hex> {
    const msg = typeof message === "string" ? message : { raw: message };
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
      keyVersion: this.metadata.keyVersion,
      address: this.metadata.address,
    };
  }
}
