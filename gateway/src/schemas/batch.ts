import { z } from "zod";
import { MessageClassEnum } from "./taxonomy.js";

/**
 * Schema do Registro de Intenção (Public Batch)
 * 
 * Antes de enviar mensagens, a empresa agrupa seus envios em um "batch"
 * e registra a intenção na blockchain. Isso cria uma prova pública de
 * que a empresa "avisou o Cartório" antes de enviar.
 * 
 * No MVP, recipientDomains é uma lista simples. Na versão final,
 * será substituído por um Merkle Root para privacidade.
 */
export const IntentBatchSchema = z.object({
  /** UUID único do batch */
  batchId: z.string().uuid(),

  /** Domínio do remetente */
  senderDomain: z.string().min(1).regex(
    /^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}$/,
    "Domínio inválido"
  ),

  /** Categoria das mensagens neste batch */
  messageClass: MessageClassEnum,

  /** Lista de domínios destinatários */
  recipientDomains: z.array(
    z.string().min(1).regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}$/)
  ).min(1),

  /** Timestamp ISO 8601 do registro */
  timestamp: z.string().datetime(),
});

export type IntentBatch = z.infer<typeof IntentBatchSchema>;
