import type { KeyManagementServiceClient } from "@google-cloud/kms";
import { recoverAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { EnvConfig } from "../config.js";
import { GcpKmsOracleSigner, type KmsKeyMetadata } from "../services/GcpKmsAccount.js";
import {
  AttestationKind,
  encodeAttestationV1,
  hashAttestationV1,
  type AttestationV1,
} from "./AttestationCodec.js";
import type { OriginClaimSigner, OriginClaimSignerResult } from "./OriginReservation.js";

const DIGEST_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;

export type AttestationSigningPurpose = "ORIGIN_CLAIM" | "STATE_ATTESTATION";

export interface AttestationSigningContext {
  purpose: AttestationSigningPurpose;
  operationId: string;
}

export interface SignedAttestationV1 extends OriginClaimSignerResult {
  encoded: Hex;
  digest: Hex;
  signerAddress: Address;
}

export interface AttestationDigestBackend {
  getAddress(): Promise<Address>;
  getKeyMetadata(): KmsKeyMetadata;
  signDigest(digest: Hex): Promise<Hex>;
}

class LocalAttestationDigestBackend implements AttestationDigestBackend {
  private readonly account: PrivateKeyAccount;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  async getAddress(): Promise<Address> {
    return this.account.address;
  }

  getKeyMetadata(): KmsKeyMetadata {
    return {
      keyId: `local:${this.account.address.toLowerCase()}`,
      keyVersion: "development",
    };
  }

  async signDigest(digest: Hex): Promise<Hex> {
    return this.account.sign({ hash: digest });
  }
}

/**
 * Assina somente digests canônicos. O chamador nunca recebe a chave privada ou
 * o client KMS; recebe assinatura recuperável e identificadores auditáveis.
 */
export class AttestationSigner implements OriginClaimSigner {
  constructor(
    private readonly backend: AttestationDigestBackend,
    private readonly onBackendFailure?: (error: unknown) => void,
  ) {}

  async signDigest(
    digest: Hex,
    context: { issuanceId: string; reservationId: string } | AttestationSigningContext,
  ): Promise<OriginClaimSignerResult> {
    if (!DIGEST_PATTERN.test(digest)) throw new Error("attestation digest must be exactly 32 bytes");
    if ("purpose" in context) {
      if (!context.operationId.trim()) throw new Error("attestation signing operationId is required");
    } else if (!context.issuanceId.trim() || !context.reservationId.trim()) {
      throw new Error("origin claim signing context is incomplete");
    }

    let metadata: KmsKeyMetadata;
    let signerAddress: Address;
    let signature: Hex;
    try {
      metadata = this.backend.getKeyMetadata();
      signerAddress = await this.backend.getAddress();
      signature = await this.backend.signDigest(digest);
    } catch (error) {
      this.onBackendFailure?.(error);
      throw error;
    }
    if (!metadata.keyId.trim() || !metadata.keyVersion.trim()) {
      throw new Error("attestation signer metadata is incomplete");
    }
    if (!SIGNATURE_PATTERN.test(signature)) {
      throw new Error("attestation signer returned a non-canonical secp256k1 signature");
    }
    const recovered = await recoverAddress({ hash: digest, signature });
    if (recovered.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error("attestation signer returned a signature from an unexpected key");
    }
    return { signature, ...metadata };
  }

  async signAttestation(
    attestation: AttestationV1,
    context: AttestationSigningContext,
  ): Promise<SignedAttestationV1> {
    const expectedKind = context.purpose === "ORIGIN_CLAIM"
      ? AttestationKind.ORIGIN_CLAIM
      : AttestationKind.STATE_ATTESTATION;
    if (attestation.kind !== expectedKind) {
      throw new Error(`attestation kind does not match signing purpose ${context.purpose}`);
    }
    if (!context.operationId.trim()) throw new Error("attestation signing operationId is required");

    const encoded = encodeAttestationV1(attestation);
    const digest = hashAttestationV1(attestation);
    const signed = await this.signDigest(digest, context);
    return {
      encoded,
      digest,
      signerAddress: await this.backend.getAddress(),
      ...signed,
    };
  }
}

export type AttestationSignerConfig = Pick<
  EnvConfig,
  "ORACLE_SIGNER_TYPE" | "ORACLE_PRIVATE_KEY" | "GCP_KMS_KEY_VERSION" | "GCP_KMS_CREDENTIALS_BASE64"
>;

export async function createAttestationSigner(
  config: AttestationSignerConfig,
  kmsClient?: KeyManagementServiceClient,
  onBackendFailure?: (error: unknown) => void,
): Promise<AttestationSigner> {
  if (config.ORACLE_SIGNER_TYPE === "gcp-kms") {
    if (!config.GCP_KMS_KEY_VERSION) {
      throw new Error("GCP_KMS_KEY_VERSION is required for the attestation signer");
    }
    return new AttestationSigner(new GcpKmsOracleSigner({
      keyVersionName: config.GCP_KMS_KEY_VERSION,
      credentialsJsonBase64: config.GCP_KMS_CREDENTIALS_BASE64,
      client: kmsClient,
    }), onBackendFailure);
  }
  if (!config.ORACLE_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(config.ORACLE_PRIVATE_KEY)) {
    throw new Error("ORACLE_PRIVATE_KEY must be a 32-byte hex key for the local attestation signer");
  }
  return new AttestationSigner(new LocalAttestationDigestBackend(config.ORACLE_PRIVATE_KEY as Hex), onBackendFailure);
}
