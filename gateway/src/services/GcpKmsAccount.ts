import { KeyManagementServiceClient } from "@google-cloud/kms";
import {
  type Address,
  type Account,
  type Hex,
  hashMessage,
  hashTypedData,
  keccak256,
  recoverAddress,
  serializeTransaction,
} from "viem";
import { toAccount } from "viem/accounts";
import { createPublicKey } from "node:crypto";

const SECP256K1_N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
const SECP256K1_N_DIV_2 = SECP256K1_N / 2n;

export interface GcpKmsAccountOptions {
  keyVersionName: string;
  credentialsJsonBase64?: string;
  client?: KeyManagementServiceClient;
}

export interface KmsKeyMetadata {
  keyId: string;
  keyVersion: string;
}

/**
 * Decodifica uma assinatura ASN.1 DER ECDSA em (r, s).
 * O Cloud KMS retorna assinaturas codificadas em ASN.1 DER (RFC 3279 / ANSI X9.62):
 * 0x30 [total-length]
 *   0x02 [r-length] [r-bytes]
 *   0x02 [s-length] [s-bytes]
 */
export function parseDerSignature(der: Uint8Array): { rHex: string; sHex: string } {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error("Assinatura DER inválida: cabeçalho SEQUENCE (0x30) ausente");
  }

  let pos = 2;
  // Trata formato de comprimento longo ASN.1 se presente
  if (der[1] & 0x80) {
    const lenBytes = der[1] & 0x7f;
    pos = 2 + lenBytes;
  }

  // Extrai R
  if (der[pos] !== 0x02) {
    throw new Error("Assinatura DER inválida: marcador INTEGER R (0x02) ausente");
  }
  const rLen = der[pos + 1];
  let rBytes = der.subarray(pos + 2, pos + 2 + rLen);
  pos = pos + 2 + rLen;

  // Extrai S
  if (der[pos] !== 0x02) {
    throw new Error("Assinatura DER inválida: marcador INTEGER S (0x02) ausente");
  }
  const sLen = der[pos + 1];
  let sBytes = der.subarray(pos + 2, pos + 2 + sLen);

  // Remove byte 0x00 de preenchimento (adicionado pelo ASN.1 quando o bit mais significativo é 1)
  if (rBytes.length === 33 && rBytes[0] === 0x00) {
    rBytes = rBytes.subarray(1);
  }
  if (sBytes.length === 33 && sBytes[0] === 0x00) {
    sBytes = sBytes.subarray(1);
  }

  const rHex = Buffer.from(rBytes).toString("hex").padStart(64, "0");
  const sHex = Buffer.from(sBytes).toString("hex").padStart(64, "0");

  return { rHex, sHex };
}

/**
 * Classe responsável por interagir diretamente com a API do Google Cloud KMS (Cloud HSM)
 * para realizar assinaturas ECDSA secp256k1 e derivar o endereço Ethereum.
 */
export class GcpKmsOracleSigner {
  private client: KeyManagementServiceClient;
  private keyVersionName: string;
  private cachedAddress: Address | null = null;

  constructor(options: GcpKmsAccountOptions) {
    if (!options.keyVersionName.includes("/cryptoKeyVersions/")) {
      throw new Error("GCP KMS key version deve terminar em /cryptoKeyVersions/{version}");
    }
    this.keyVersionName = options.keyVersionName;

    if (options.client) {
      this.client = options.client;
    } else if (options.credentialsJsonBase64) {
      try {
        const decodedJson = Buffer.from(options.credentialsJsonBase64, "base64").toString("utf8");
        const credentials = JSON.parse(decodedJson);
        this.client = new KeyManagementServiceClient({ credentials });
      } catch (err: any) {
        throw new Error(`Falha ao decodificar GCP_KMS_CREDENTIALS_BASE64: ${err.message}`);
      }
    } else {
      // Usa Application Default Credentials (ADC) nativo do Google Cloud (Workload Identity, etc.)
      this.client = new KeyManagementServiceClient();
    }
  }

  /** Identifica a chave auditável sem retornar credenciais ou material criptográfico privado. */
  getKeyMetadata(): KmsKeyMetadata {
    const marker = "/cryptoKeyVersions/";
    const markerOffset = this.keyVersionName.lastIndexOf(marker);
    const keyId = this.keyVersionName.slice(0, markerOffset);
    const keyVersion = this.keyVersionName.slice(markerOffset + marker.length);
    if (!keyId || !keyVersion || keyVersion.includes("/")) {
      throw new Error("GCP KMS key version possui resource name inválido");
    }
    return { keyId, keyVersion };
  }

  /**
   * Obtém a chave pública do Cloud HSM e deriva o endereço Ethereum (keccak256 dos 64 bytes da chave descompactada).
   */
  async getAddress(): Promise<Address> {
    if (this.cachedAddress) {
      return this.cachedAddress;
    }

    try {
      const [publicKey] = await this.client.getPublicKey({ name: this.keyVersionName });
      if (!publicKey.pem) {
        throw new Error("Chave pública retornada pelo GCP KMS não contém formato PEM válido");
      }

      // Converte o PEM SPKI para objeto Crypto nativo e exporta em formato JWK
      const keyObj = createPublicKey(publicKey.pem);
      const jwk = keyObj.export({ format: "jwk" });

      if (!jwk.x || !jwk.y) {
        throw new Error("Coordenadas X ou Y da curva elíptica secp256k1 ausentes na chave pública");
      }

      const x = Buffer.from(jwk.x, "base64url");
      const y = Buffer.from(jwk.y, "base64url");

      if (x.length !== 32 || y.length !== 32) {
        throw new Error(`Tamanho inesperado das coordenadas públicas secp256k1: x=${x.length}, y=${y.length}`);
      }

      // Concatena as coordenadas (X || Y) sem o prefixo 0x04 para obter os 64 bytes públicos não compactados
      const uncompressedPubKey = Buffer.concat([x, y]);
      const address = `0x${keccak256(uncompressedPubKey).slice(-40)}` as Address;

      this.cachedAddress = address;
      return address;
    } catch (err: any) {
      throw new Error(`[GCP-KMS] Falha ao derivar endereço Ethereum da chave ${this.keyVersionName}: ${err.message}`);
    }
  }

  /**
   * Assina um digest de 32 bytes no Cloud HSM e formata a assinatura no padrão Ethereum de 65 bytes (r, s, v).
   * Aplica conformidade EIP-2 para prevenir maleabilidade de assinatura (low-s) e calcula o recovery id (v).
   */
  async signDigest(digest: Hex): Promise<Hex> {
    const oracleAddress = await this.getAddress();
    const digestBytes = Buffer.from(digest.slice(2), "hex");

    if (digestBytes.length !== 32) {
      throw new Error(`Digest inválido para assinatura ECDSA: esperado 32 bytes, recebido ${digestBytes.length}`);
    }

    // Invoca a API do Google Cloud HSM
    let signResponse;
    try {
      const [response] = await this.client.asymmetricSign({
        name: this.keyVersionName,
        digest: {
          sha256: digestBytes,
        },
      });
      signResponse = response;
    } catch (err: any) {
      throw new Error(`[GCP-KMS] Erro na chamada asymmetricSign: ${err.message}`);
    }

    if (!signResponse.signature) {
      throw new Error("[GCP-KMS] Assinatura vazia retornada pelo Cloud KMS");
    }

    const rawSignatureBytes = Buffer.isBuffer(signResponse.signature)
      ? signResponse.signature
      : Buffer.from(signResponse.signature);

    // Decodifica a assinatura DER para R e S
    const { rHex, sHex } = parseDerSignature(rawSignatureBytes);

    // EIP-2: Normalização de S para a metade inferior da ordem da curva secp256k1
    let sBigInt = BigInt(`0x${sHex}`);
    if (sBigInt > SECP256K1_N_DIV_2) {
      sBigInt = SECP256K1_N - sBigInt;
    }
    const normalizedSHex = sBigInt.toString(16).padStart(64, "0");

    // Determina o valor de recuperação v (27 ou 28) testando a recuperação do endereço público
    let recoveredV: number | null = null;
    for (const candidateV of [27, 28]) {
      const candidateSig = `0x${rHex}${normalizedSHex}${candidateV.toString(16)}` as Hex;
      try {
        const recovered = await recoverAddress({
          hash: digest,
          signature: candidateSig,
        });
        if (recovered.toLowerCase() === oracleAddress.toLowerCase()) {
          recoveredV = candidateV;
          break;
        }
      } catch {
        // Tenta o próximo candidato
      }
    }

    if (recoveredV === null) {
      throw new Error(
        `[GCP-KMS] Falha ao recuperar ID de paridade (v) para o endereço esperado ${oracleAddress}`
      );
    }

    return `0x${rHex}${normalizedSHex}${recoveredV.toString(16)}` as Hex;
  }
}

/**
 * Cria uma conta viem de primeira classe respaldada pelo Google Cloud KMS (Cloud HSM).
 * Suporta signMessage, signTypedData (EIP-712) e signTransaction (EIP-1559/legado).
 */
export async function createGcpKmsAccount(
  options: GcpKmsAccountOptions
): Promise<Account> {
  const signer = new GcpKmsOracleSigner(options);
  const address = await signer.getAddress();

  return toAccount({
    address,

    async signMessage({ message }) {
      const hash = hashMessage(message);
      return signer.signDigest(hash);
    },

    async signTransaction(transaction, { serializer = serializeTransaction } = {}) {
      const signableTx = { ...transaction } as any;
      delete signableTx.sidecars;

      // Hash keccak256 da transação serializada não assinada
      const unsignedSerialized = (await serializer(signableTx)) as Hex;
      const hash = keccak256(unsignedSerialized);

      // Assina o hash no Cloud HSM
      const sig = await signer.signDigest(hash);

      const r = `0x${sig.slice(2, 66)}` as Hex;
      const s = `0x${sig.slice(66, 130)}` as Hex;
      const v = parseInt(sig.slice(130, 132), 16);
      const yParity = v === 27 ? 0 : 1;

      return serializer(transaction, {
        r,
        s,
        yParity,
        v: BigInt(v),
      });
    },

    async signTypedData(typedData) {
      const hash = hashTypedData(typedData as any);
      return signer.signDigest(hash);
    },
  });
}
