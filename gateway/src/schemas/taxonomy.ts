import { z } from "zod";

/**
 * Taxonomia de Classificação de Mensagens do Protocolo MAIVW
 * 
 * Cada mensagem na rede DEVE ser categorizada em uma dessas classes.
 * O destinatário pode bloquear categorias específicas, resultando em
 * Soft Bounce (406 Not Acceptable).
 */
export const MessageClassEnum = z.enum([
  /** Segurança — OTP, 2FA, códigos de verificação */
  "TX_CODE",
  /** Financeiro — Recibos, notas fiscais, cobranças */
  "TX_RECEIPT",
  /** Atendimento — Tickets de suporte, follow-ups */
  "SUPPORT",
  /** Conversacional — Mensagens humanas diretas */
  "CONVERSATION",
  /** Marketing — Promoções, newsletters, campanhas */
  "MARKETING",
  /** Prospecção — Cold outreach, vendas B2B */
  "COLD_OUTREACH",
]);

export type MessageClass = z.infer<typeof MessageClassEnum>;

/**
 * Mapeamento de MessageClass para descrição legível
 */
export const MESSAGE_CLASS_LABELS: Record<MessageClass, string> = {
  TX_CODE: "Segurança (OTP/2FA)",
  TX_RECEIPT: "Financeiro (Recibos)",
  SUPPORT: "Atendimento",
  CONVERSATION: "Conversacional",
  MARKETING: "Marketing",
  COLD_OUTREACH: "Prospecção",
};

/**
 * Classes que são tipicamente bloqueáveis pelo destinatário.
 * TX_CODE e TX_RECEIPT geralmente NÃO devem ser bloqueáveis.
 */
export const BLOCKABLE_CLASSES: MessageClass[] = [
  "SUPPORT",
  "CONVERSATION",
  "MARKETING",
  "COLD_OUTREACH",
];

/**
 * Classes transacionais (alta prioridade, não-bloqueáveis por padrão)
 */
export const TRANSACTIONAL_CLASSES: MessageClass[] = [
  "TX_CODE",
  "TX_RECEIPT",
];
