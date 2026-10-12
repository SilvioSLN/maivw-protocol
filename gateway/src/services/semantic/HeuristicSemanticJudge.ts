import { ISemanticJudge, SemanticJudgeVerdict } from "./ISemanticJudge.js";

/**
 * Motor de Avaliação Heurística de Referência (Open Source).
 * 
 * Executa verificações baseadas em regras sintáticas e léxicas para
 * validação das classes restritas do protocolo MAIVW:
 * - TX_CODE: Códigos temporários de 2FA / autenticação.
 * - SUPPORT: Atendimento ao cliente e suporte operacional.
 * - TX_RECEIPT: Comprovantes fiscais e transacionais.
 */
export class HeuristicSemanticJudge implements ISemanticJudge {
  private promotionalKeywords: string[];

  constructor(customKeywords?: string[]) {
    this.promotionalKeywords = customKeywords || [
      "promoção",
      "promocao",
      "desconto",
      "oferta",
      "imperdível",
      "imperdivel",
      "compre agora",
      "compre já",
      "compre ja",
      "50% off",
      "black friday",
      "liquidação",
      "liquidacao",
      "frete grátis",
      "frete gratis",
      "cupom",
      "cashback",
      "compre",
      "assine já",
      "assine ja",
      "bônus",
      "bonus",
      "cassino",
      "giros grátis",
      "giros gratis",
      "ganhe",
    ];
  }

  judge(msgClass: string, text: string): SemanticJudgeVerdict {
    const normalizedText = (text || "").toLowerCase();
    const normalizedClass = (msgClass || "").toUpperCase();

    const detectedPromoWord = this.promotionalKeywords.find((kw) =>
      normalizedText.includes(kw)
    );

    // Regra 1: TX_CODE (2FA, senhas temporárias) NUNCA pode conter ofertas comerciais
    if (normalizedClass === "TX_CODE") {
      if (detectedPromoWord) {
        return {
          isSpoofed: true,
          reason: `Tag Spoofing detectado: Mensagem classificada como TX_CODE contém termos de marketing comercial ('${detectedPromoWord}'). Esta classe é restrita exclusivamente a códigos temporários de autenticação.`,
          confidence: 0.95,
          engine: "heuristic-rules",
        };
      }
    }

    // Regra 2: SUPPORT (atendimento ao cliente) não pode ser propaganda comercial fria
    if (normalizedClass === "SUPPORT") {
      if (
        detectedPromoWord &&
        (normalizedText.includes("compre") || normalizedText.includes("imperdível"))
      ) {
        return {
          isSpoofed: true,
          reason: `Tag Spoofing detectado: Mensagem classificada como SUPPORT contém linguagem promocional explícita ('${detectedPromoWord}').`,
          confidence: 0.88,
          engine: "heuristic-rules",
        };
      }
    }

    // Regra 3: TX_RECEIPT deve ser recibo financeiro, sem campanhas de marketing agressivo
    if (normalizedClass === "TX_RECEIPT") {
      if (
        detectedPromoWord &&
        (normalizedText.includes("liquidação") || normalizedText.includes("black friday"))
      ) {
        return {
          isSpoofed: true,
          reason: `Tag Spoofing detectado: Mensagem de recibo contém campanha de liquidação.`,
          confidence: 0.9,
          engine: "heuristic-rules",
        };
      }
    }

    return {
      isSpoofed: false,
      reason: "Conteúdo textual compatível com a categoria declarada.",
      confidence: 0.99,
      engine: "heuristic-rules",
    };
  }
}
