import fs from "node:fs";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import type { EnvConfig } from "../config.js";
import { LocalEvmSigner } from "./LocalEvmSigner.js";
import { GcpKmsEvmSigner } from "./GcpKmsEvmSigner.js";
import { AwsKmsEvmSigner, type AwsKmsTransport } from "./AwsKmsEvmSigner.js";
import { LocalSolanaSigner } from "./LocalSolanaSigner.js";
import { EnvelopeSolanaSigner } from "./EnvelopeSolanaSigner.js";
import type { ISigner, SignerKeyRole } from "./types.js";

export interface SignerFactoryOptions {
  awsKmsTransport?: AwsKmsTransport;
}

export class SignerFactory {
  static createLocalEvm(privateKey: Hex, role: SignerKeyRole = "operational", keyId?: string): ISigner {
    return new LocalEvmSigner(privateKey, role, keyId);
  }

  static createGcpKms(
    keyVersionName: string,
    credentialsJsonBase64?: string,
    role: SignerKeyRole = "oracle",
  ): ISigner {
    return new GcpKmsEvmSigner({ keyVersionName, credentialsJsonBase64 }, role);
  }

  static createAwsKms(
    keyId: string,
    transport: AwsKmsTransport,
    role: SignerKeyRole = "oracle",
  ): ISigner {
    return new AwsKmsEvmSigner({ keyId, transport, role });
  }

  static createSolanaLocal(keypairOrBase64: string | Uint8Array, role: SignerKeyRole = "relayer"): ISigner {
    if (typeof keypairOrBase64 === "string") {
      return LocalSolanaSigner.fromBase64(keypairOrBase64, role);
    }
    return LocalSolanaSigner.fromSecretKey(keypairOrBase64, role);
  }

  static createOperationalSigner(config: Pick<EnvConfig, "COMPANY_A_PRIVATE_KEY">): ISigner {
    const key = (config.COMPANY_A_PRIVATE_KEY || generatePrivateKey()) as Hex;
    return new LocalEvmSigner(key, "operational");
  }

  static createOracleSigner(
    config: Pick<EnvConfig, "ORACLE_SIGNER_TYPE" | "ORACLE_PRIVATE_KEY" | "GCP_KMS_KEY_VERSION" | "GCP_KMS_CREDENTIALS_BASE64" | "AWS_KMS_KEY_ID">,
    options?: SignerFactoryOptions,
  ): ISigner {
    if (config.ORACLE_SIGNER_TYPE === "gcp-kms") {
      if (!config.GCP_KMS_KEY_VERSION) {
        throw new Error("GCP_KMS_KEY_VERSION is required when ORACLE_SIGNER_TYPE is 'gcp-kms'");
      }
      return SignerFactory.createGcpKms(
        config.GCP_KMS_KEY_VERSION,
        config.GCP_KMS_CREDENTIALS_BASE64,
        "oracle",
      );
    }

    if (config.ORACLE_SIGNER_TYPE === "aws-kms") {
      if (!config.AWS_KMS_KEY_ID) {
        throw new Error("AWS_KMS_KEY_ID is required when ORACLE_SIGNER_TYPE is 'aws-kms'");
      }
      if (!options?.awsKmsTransport) {
        throw new Error("awsKmsTransport is required when ORACLE_SIGNER_TYPE is 'aws-kms'");
      }
      return SignerFactory.createAwsKms(
        config.AWS_KMS_KEY_ID,
        options.awsKmsTransport,
        "oracle",
      );
    }

    if (!config.ORACLE_PRIVATE_KEY) {
      throw new Error("ORACLE_PRIVATE_KEY is required when ORACLE_SIGNER_TYPE is 'local'");
    }
    return SignerFactory.createLocalEvm(config.ORACLE_PRIVATE_KEY as Hex, "oracle");
  }

  static createSolanaRelayerSigner(
    config: Pick<EnvConfig, "SOLANA_RELAYER_KEYPAIR_PATH" | "SOLANA_RELAYER_KEYPAIR_BASE64">,
  ): ISigner | undefined {
    if (config.SOLANA_RELAYER_KEYPAIR_BASE64) {
      return LocalSolanaSigner.fromBase64(config.SOLANA_RELAYER_KEYPAIR_BASE64, "relayer");
    }

    if (config.SOLANA_RELAYER_KEYPAIR_PATH && fs.existsSync(config.SOLANA_RELAYER_KEYPAIR_PATH)) {
      const content = fs.readFileSync(config.SOLANA_RELAYER_KEYPAIR_PATH, "utf8");
      const parsed = JSON.parse(content);
      const secretKey = Uint8Array.from(parsed);
      return LocalSolanaSigner.fromSecretKey(secretKey, "relayer");
    }

    return undefined;
  }
}
