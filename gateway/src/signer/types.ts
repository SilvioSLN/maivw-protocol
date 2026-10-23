import type { Hex } from "viem";

export type SignerKeyRole =
  | "operational"
  | "oracle"
  | "relayer"
  | "deployer"
  | "treasury"
  | "guardian";

export type KeyFamily = "EVM" | "SOLANA";

export type SignerProviderType =
  | "local"
  | "gcp-kms"
  | "aws-kms"
  | "solana-keypair"
  | "solana-envelope";

export interface SignerMetadata {
  readonly role: SignerKeyRole;
  readonly family: KeyFamily;
  readonly provider: SignerProviderType;
  readonly keyId: string;
  readonly keyVersion?: string;
  readonly address: string;
}

export interface SignDigestOptions {
  purpose?: string;
  operationId?: string;
}

export interface ISigner {
  readonly metadata: SignerMetadata;
  getAddress(): Promise<string>;
  signDigest(digest: Hex | Uint8Array, options?: SignDigestOptions): Promise<Hex | string>;
  signMessage(message: string | Uint8Array, options?: SignDigestOptions): Promise<Hex | string>;
  verify(messageOrDigest: string | Uint8Array | Hex, signature: Hex | string): Promise<boolean>;
  toJSON(): Record<string, unknown>;
}

export interface KeyIdentityPolicy {
  role: SignerKeyRole;
  description: string;
  allowedFamilies: readonly KeyFamily[];
  allowedProviders: readonly SignerProviderType[];
  canHoldPrivateMaterialInGateway: boolean;
}

export interface CanonicalTestVector {
  id: string;
  family: KeyFamily;
  description: string;
  publicKey: string;
  payload: string;
  digest: Hex | string;
  signature: Hex | string;
}
