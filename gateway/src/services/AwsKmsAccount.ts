import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms";
import {
  hashMessage,
  hashTypedData,
  keccak256,
  serializeTransaction,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { toAccount } from "viem/accounts";
import {
  AwsKmsEvmSigner,
  type AwsKmsTransport,
} from "../signer/AwsKmsEvmSigner.js";
import {
  AwsKmsSolanaSigner,
  type AwsKmsSolanaTransport,
} from "../signer/AwsKmsSolanaSigner.js";
import type { KmsKeyMetadata } from "./GcpKmsAccount.js";

export interface AwsKmsAccountOptions {
  keyId: string;
  role?: "oracle" | "relayer";
  region?: string;
  client?: KMSClient;
}

function createKmsClient(region?: string): KMSClient {
  return new KMSClient({ region, maxAttempts: 3 });
}

/** AWS SDK transport using the ECS task role credential chain. */
export class AwsSdkKmsTransport implements AwsKmsTransport {
  constructor(private readonly client: KMSClient) {}

  async getPublicKey(keyId: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (!response.PublicKey) throw new Error(`[AWS-KMS] Public key missing for ${keyId}`);
    if (response.KeySpec && response.KeySpec !== "ECC_SECG_P256K1") {
      throw new Error(`[AWS-KMS] Expected ECC_SECG_P256K1 for ${keyId}, received ${response.KeySpec}`);
    }
    if (response.KeyUsage && response.KeyUsage !== "SIGN_VERIFY") {
      throw new Error(`[AWS-KMS] Expected SIGN_VERIFY usage for ${keyId}, received ${response.KeyUsage}`);
    }
    return response.PublicKey;
  }

  async signDigest(keyId: string, digest: Uint8Array): Promise<Uint8Array> {
    const response = await this.client.send(new SignCommand({
      KeyId: keyId,
      Message: digest,
      MessageType: "DIGEST",
      SigningAlgorithm: "ECDSA_SHA_256",
    }));
    if (!response.Signature) throw new Error(`[AWS-KMS] Empty signature for ${keyId}`);
    return response.Signature;
  }
}

/** AWS SDK transport for Solana Ed25519 signing with an ECS task role. */
export class AwsSdkKmsSolanaTransport implements AwsKmsSolanaTransport {
  constructor(private readonly client: KMSClient) {}

  async getPublicKey(keyId: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (!response.PublicKey) throw new Error(`[AWS-KMS] Public key missing for ${keyId}`);
    if (response.KeySpec && response.KeySpec !== "ECC_NIST_EDWARDS25519") {
      throw new Error(`[AWS-KMS] Expected ECC_NIST_EDWARDS25519 for ${keyId}, received ${response.KeySpec}`);
    }
    if (response.KeyUsage && response.KeyUsage !== "SIGN_VERIFY") {
      throw new Error(`[AWS-KMS] Expected SIGN_VERIFY usage for ${keyId}, received ${response.KeyUsage}`);
    }
    if (response.SigningAlgorithms && !response.SigningAlgorithms.includes("ED25519_SHA_512")) {
      throw new Error(`[AWS-KMS] Key ${keyId} does not support ED25519_SHA_512`);
    }
    return response.PublicKey;
  }

  async signRaw(keyId: string, message: Uint8Array): Promise<Uint8Array> {
    const response = await this.client.send(new SignCommand({
      KeyId: keyId,
      Message: message,
      MessageType: "RAW",
      SigningAlgorithm: "ED25519_SHA_512",
    }));
    if (!response.Signature) throw new Error(`[AWS-KMS] Empty signature for ${keyId}`);
    return response.Signature;
  }
}

export class AwsKmsOracleSigner {
  private readonly signer: AwsKmsEvmSigner;

  constructor(options: AwsKmsAccountOptions) {
    const client = options.client ?? createKmsClient(options.region);
    this.signer = new AwsKmsEvmSigner({
      keyId: options.keyId,
      role: options.role ?? "oracle",
      transport: new AwsSdkKmsTransport(client),
    });
  }

  async getAddress(): Promise<Address> {
    return await this.signer.getAddress() as Address;
  }

  getKeyMetadata(): KmsKeyMetadata {
    return { keyId: this.signer.metadata.keyId, keyVersion: "current" };
  }

  async signDigest(digest: Hex): Promise<Hex> {
    return await this.signer.signDigest(digest);
  }
}

/** Creates a Solana signer backed by a non-exportable AWS KMS Ed25519 key. */
export function createAwsKmsSolanaSigner(options: AwsKmsAccountOptions): AwsKmsSolanaSigner {
  const client = options.client ?? createKmsClient(options.region);
  return new AwsKmsSolanaSigner({
    keyId: options.keyId,
    role: "relayer",
    transport: new AwsSdkKmsSolanaTransport(client),
  });
}

/** Creates a first-class viem account backed by a non-exportable AWS KMS key. */
export async function createAwsKmsAccount(options: AwsKmsAccountOptions): Promise<Account> {
  const signer = new AwsKmsOracleSigner(options);
  const address = await signer.getAddress();

  return toAccount({
    address,
    async signMessage({ message }) {
      return signer.signDigest(hashMessage(message));
    },
    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      const signableTx = { ...transaction } as any;
      delete signableTx.sidecars;
      const unsignedSerialized = (await serializer(signableTx)) as Hex;
      const signature = await signer.signDigest(keccak256(unsignedSerialized));
      const r = `0x${signature.slice(2, 66)}` as Hex;
      const s = `0x${signature.slice(66, 130)}` as Hex;
      const v = parseInt(signature.slice(130, 132), 16);
      return serializer(transaction, { r, s, yParity: v === 27 ? 0 : 1, v: BigInt(v) });
    },
    async signTypedData(typedData) {
      return signer.signDigest(hashTypedData(typedData as any));
    },
  });
}
