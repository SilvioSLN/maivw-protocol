import {
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { verifyMessage } from "viem";

/**
 * SignatureService — Assinatura e Verificação Criptográfica
 * 
 * Utiliza EIP-191 (personal_sign) para assinar e verificar mensagens.
 * A chave pública do remetente está registrada no Smart Contract,
 * permitindo que qualquer nó da rede verifique a autenticidade.
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

  /**
   * Assina o conteúdo de uma mensagem (hash do content)
   * 
   * @param content O conteúdo a ser assinado (será serializado e hashado)
   * @returns A assinatura em formato hex
   */
  async signPayload(content: { text: string; html?: string }): Promise<Hex> {
    // Criar uma representação determinística do conteúdo
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
   * Verifica se uma assinatura é válida para o conteúdo dado
   * 
   * @param content O conteúdo original que foi assinado
   * @param signature A assinatura a ser verificada
   * @param expectedAddress O endereço esperado do assinante (do Smart Contract)
   * @returns true se a assinatura é válida e pertence ao endereço esperado
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
