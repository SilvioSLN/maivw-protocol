import {
  type Address,
  type Hex,
  recoverAddress,
  verifyMessage,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { ISigner, SignerKeyRole, SignerMetadata, SignDigestOptions } from "./types.js";

export class LocalEvmSigner implements ISigner {
  private readonly account: PrivateKeyAccount;
  readonly metadata: SignerMetadata;

  constructor(privateKey: Hex, role: SignerKeyRole = "operational", keyId?: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error("LocalEvmSigner requires a valid 32-byte hex private key");
    }

    this.account = privateKeyToAccount(privateKey);
    const address = this.account.address;
    this.metadata = {
      role,
      family: "EVM",
      provider: "local",
      keyId: keyId ?? `local:evm:${address.toLowerCase()}`,
      address,
    };
  }

  async getAddress(): Promise<string> {
    return this.metadata.address;
  }

  async signDigest(digest: Hex | Uint8Array, _options?: SignDigestOptions): Promise<Hex> {
    const hashHex = typeof digest === "string" ? digest : (`0x${Buffer.from(digest).toString("hex")}` as Hex);
    return await this.account.sign({ hash: hashHex });
  }

  async signMessage(message: string | Uint8Array, _options?: SignDigestOptions): Promise<Hex> {
    const msg = typeof message === "string" ? message : { raw: message };
    return await this.account.signMessage({ message: msg });
  }

  async verify(messageOrDigest: string | Uint8Array | Hex, signature: Hex | string): Promise<boolean> {
    const sigHex = signature as Hex;
    try {
      if (typeof messageOrDigest === "string" && messageOrDigest.startsWith("0x") && messageOrDigest.length === 66) {
        const recovered = await recoverAddress({ hash: messageOrDigest as Hex, signature: sigHex });
        return recovered.toLowerCase() === this.metadata.address.toLowerCase();
      }

      const msg = typeof messageOrDigest === "string" ? messageOrDigest : { raw: messageOrDigest };
      return await verifyMessage({
        address: this.metadata.address as Address,
        message: msg,
        signature: sigHex,
      });
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
