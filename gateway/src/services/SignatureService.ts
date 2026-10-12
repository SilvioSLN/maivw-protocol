import crypto from "node:crypto";
import {
  type Address,
  type Hex,
  verifyMessage,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export interface EnvelopeV2Payload {
  version: "2.0";
  messageId: string;
  from: string;
  to: string;
  subject: string;
  msgClass: string;
  timestamp: number;
  contentHash: string;
  attachmentsHash?: string;
  subIdentityId?: string;
}

/**
 * SignatureService — Assinatura e Verificação Criptográfica
 * 
 * Utiliza EIP-191 (personal_sign) para assinar e verificar mensagens.
 * A chave pública do remetente está registrada no Smart Contract,
 * permitindo que qualquer nó da rede verifique a autenticidade.
 * 
 * Suporta Envelope v1.0 (legado) e Envelope v2.0 (estruturado com proteção contra replay).
 */
export class SignatureService {
  private account: PrivateKeyAccount;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
    console.log(`[SIGNATURE] Initialized with address: ${this.account.address}`);
  }

  /**
   * Retorna o endereço público da chave configurada
   */
  get address(): Address {
    return this.account.address;
  }

  // ============================================
  // Helpers Estáticos para Envelope v2.0
  // ============================================

  static computeContentHash(content: { text: string; html?: string }): string {
    const canonicalContent = JSON.stringify({
      html: content.html || "",
      text: content.text || "",
    });
    return crypto.createHash("sha256").update(canonicalContent).digest("hex");
  }

  static computeAttachmentsHash(attachments?: Array<{ sha256?: string; id?: string }>): string {
    if (!attachments || attachments.length === 0) return "";
    const hashes = attachments
      .map((a) => a.sha256 || a.id || "")
      .filter(Boolean)
      .sort();
    return crypto.createHash("sha256").update(hashes.join(":")).digest("hex");
  }

  static canonicalizeEnvelopeV2(payload: EnvelopeV2Payload): string {
    return JSON.stringify({
      attachmentsHash: payload.attachmentsHash || "",
      contentHash: payload.contentHash,
      from: payload.from.toLowerCase().trim(),
      messageId: payload.messageId,
      msgClass: payload.msgClass,
      subIdentityId: payload.subIdentityId || "",
      subject: payload.subject,
      timestamp: payload.timestamp,
      to: payload.to.toLowerCase().trim(),
      version: "2.0",
    });
  }

  // ============================================
  // Envelope v2.0 Métodos de Assinatura
  // ============================================

  /**
   * Assina o Envelope v2.0 canônico (messageId, msgClass, to, subject, timestamp, contentHash, attachmentsHash)
   */
  async signEnvelopeV2(payload: EnvelopeV2Payload): Promise<Hex> {
    const canonical = SignatureService.canonicalizeEnvelopeV2(payload);
    return await this.account.signMessage({
      message: canonical,
    });
  }

  /**
   * Verifica se o Envelope v2.0 canônico foi assinado pelo endereço esperado registrado on-chain
   */
  async verifyEnvelopeV2(
    payload: EnvelopeV2Payload,
    signature: Hex,
    expectedAddress: Address
  ): Promise<boolean> {
    try {
      const canonical = SignatureService.canonicalizeEnvelopeV2(payload);
      return await verifyMessage({
        address: expectedAddress,
        message: canonical,
        signature,
      });
    } catch (error) {
      console.error("[SIGNATURE] Envelope v2 verification error:", error);
      return false;
    }
  }

  // ============================================
  // Envelope v1.0 Legado (Compatibilidade Retroativa)
  // ============================================

  /**
   * Assina o conteúdo simples de uma mensagem (Envelope v1 legado)
   */
  async signPayload(content: { text: string; html?: string }): Promise<Hex> {
    const contentString = JSON.stringify({
      text: content.text,
      html: content.html || "",
    });

    const signature = await this.account.signMessage({
      message: contentString,
    });

    return signature;
  }

  /**
   * Verifica assinatura do Envelope v1 legado
   */
  async verifyPayload(
    content: { text: string; html?: string },
    signature: Hex,
    expectedAddress: Address
  ): Promise<boolean> {
    try {
      const contentString = JSON.stringify({
        text: content.text,
        html: content.html || "",
      });

      const isValid = await verifyMessage({
        address: expectedAddress,
        message: contentString,
        signature,
      });

      return isValid;
    } catch (error) {
      console.error("[SIGNATURE] Verification error:", error);
      return false;
    }
  }
}
