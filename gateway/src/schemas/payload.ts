import { z } from "zod";
import { MessageClassEnum } from "./taxonomy.js";

/**
 * Schema dos Headers do Protocolo MAIVW
 * 
 * Esses headers são enviados em toda requisição HTTP entre nós da rede.
 */
export const MaivwHeadersSchema = z.object({
  /** Domínio do remetente (ex: "empresaA.com") */
  "x-maivw-sender": z.string().min(1),

  /** Hash da transação na blockchain (prova de intenção registrada) */
  "x-maivw-intent-tx": z.string().regex(
    /^0x[a-fA-F0-9]{64}$/,
    "Hash de transação inválido"
  ),

  /** 
   * Sub-identidade do remetente real (opcional).
   * Usado quando o remetente é um Provedor Multi-Tenant.
   */
  "x-maivw-sub-identity": z.string().optional(),

  /** Raiz da Merkle Tree registrada na blockchain (Fase 6) */
  "x-maivw-intent-root": z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Root de Merkle inválida").optional(),

  /** Prova de inclusão de Merkle (JSON string com array de hashes hex) */
  "x-maivw-intent-proof": z.string().optional(),
});

export type MaivwHeaders = z.infer<typeof MaivwHeadersSchema>;

/**
 * Schema de um anexo criptográfico MAIVW
 */
export const AttachmentItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number(),
  mimeType: z.string(),
  sha256: z.string(),
  url: z.string(),
});

export type AttachmentItem = z.infer<typeof AttachmentItemSchema>;

/**
 * Schema do conteúdo da mensagem
 */
export const MessageContentSchema = z.object({
  /** Corpo em texto plano */
  text: z.string().min(1),

  /** Corpo em HTML (opcional) */
  html: z.string().optional(),

  /** Lista de anexos com verificação SHA-256 */
  attachments: z.array(AttachmentItemSchema).optional(),
});

export type MessageContent = z.infer<typeof MessageContentSchema>;

/**
 * Schema do Payload de Mensagem (Body do HTTP POST)
 * 
 * Este é o formato exato do JSON enviado via POST da Empresa A 
 * para a API da Empresa B no endpoint /api/v1/inbox.
 */
export const MessagePayloadSchema = z.object({
  /** Versão do envelope ("1.0" ou "2.0") */
  envelopeVersion: z.string().optional(),

  /** UUID único da mensagem */
  messageId: z.string().uuid(),

  /** Classificação da mensagem (taxonomia MAIVW) */
  msgClass: MessageClassEnum,

  /** E-mail do destinatário */
  to: z.string().email(),

  /** Assunto da mensagem */
  subject: z.string().min(1).max(998), // RFC 2822: max 998 chars

  /** Conteúdo da mensagem */
  content: MessageContentSchema,

  /** 
   * Assinatura criptográfica (EIP-191)
   * No v1: assina o content JSON
   * No v2: assina o envelope canônico com timestamp e hashes
   */
  signature: z.string().regex(
    /^0x[a-fA-F0-9]+$/,
    "Assinatura deve ser um hex string com prefixo 0x"
  ),

  /** Sub-identidade (obrigatória para provedores multi-tenant) */
  subIdentityId: z.string().optional(),

  /** Timestamp Unix em segundos (obrigatório para v2 replay protection) */
  timestamp: z.number().int().positive().optional(),

  /** Hash do conteúdo (v2) */
  contentHash: z.string().optional(),

  /** Hash dos anexos (v2) */
  attachmentsHash: z.string().optional(),

  /** Anexos da mensagem (opcional) */
  attachments: z.array(AttachmentItemSchema).optional(),
});

export type MessagePayload = z.infer<typeof MessagePayloadSchema>;

/**
 * Schema do Request de Envio (usado pelo endpoint POST /api/v1/send)
 */
export const SendRequestSchema = z.object({
  /** E-mail do destinatário principal */
  to: z.string().email(),

  /** Destinatários adicionais para envio em lote com Merkle Tree (Fase 6) */
  recipients: z.array(z.string().email()).optional(),

  /** Assunto da mensagem */
  subject: z.string().min(1).max(998),

  /** Conteúdo da mensagem */
  content: MessageContentSchema,

  /** Classificação da mensagem */
  msgClass: MessageClassEnum,

  /** E-mail completo do remetente (ex: contato@empresa.com) */
  from: z.string().optional(),
  senderEmail: z.string().optional(),

  /** Domínio do remetente (preenchido automaticamente se não informado) */
  senderDomain: z.string().optional(),

  /** Sub-identidade do remetente (Fase 7) */
  subIdentityId: z.string().optional(),
});

export type SendRequest = z.infer<typeof SendRequestSchema>;

/**
 * Schema para denúncias de Tag Spoofing / Disputas no Tribunal do Oráculo (Fase 8)
 */
export const DisputeRequestSchema = z.object({
  /** Domínio remetente denunciado */
  senderDomain: z.string().min(1),

  /** Payload original completo recebido, incluindo a assinatura */
  payload: MessagePayloadSchema,

  /** Endereço Ethereum do denunciante (para receber a recompensa de 20%) */
  reporterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Endereço Ethereum inválido"),

  /** Sub-identidade denunciada (se for provedor) */
  subIdentityId: z.string().optional(),
});

export type DisputeRequest = z.infer<typeof DisputeRequestSchema>;

/**
 * Schema de resposta do endpoint de envio
 */
export const SendResponseSchema = z.object({
  /** Indica se foi enviado com sucesso */
  success: z.boolean(),

  /** ID da mensagem enviada */
  messageId: z.string().uuid(),

  /** Rota utilizada: "web3" (protocolo nativo) ou "smtp" (fallback legado) */
  route: z.enum(["web3", "smtp"]),

  /** Domínio do destinatário */
  recipientDomain: z.string(),

  /** Mensagem descritiva */
  message: z.string(),
});

export type SendResponse = z.infer<typeof SendResponseSchema>;

// ============================================
//  Exemplo Visual (Mock JSON)
// ============================================

/**
 * Exemplo de requisição HTTP completa para enviar uma mensagem TX_CODE:
 * 
 * ```
 * POST /api/v1/inbox HTTP/1.1
 * Host: api.empresaB.com
 * Content-Type: application/json
 * x-maivw-sender: empresaA.com
 * x-maivw-intent-tx: 0xabc123...def456
 * 
 * {
 *   "messageId": "550e8400-e29b-41d4-a716-446655440000",
 *   "msgClass": "TX_CODE",
 *   "to": "joao@empresaB.com",
 *   "subject": "Seu código de verificação",
 *   "content": {
 *     "text": "Seu código de verificação é: 847291. Válido por 5 minutos.",
 *     "html": "<p>Seu código de verificação é: <strong>847291</strong>. Válido por 5 minutos.</p>"
 *   },
 *   "signature": "0x1234...abcd"
 * }
 * ```
 * 
 * Respostas possíveis:
 * - 202 Accepted: Mensagem validada e aceita para a caixa de entrada
 * - 401 Unauthorized: Assinatura criptográfica inválida
 * - 406 Not Acceptable: Categoria de mensagem bloqueada pelo destinatário
 * - 400 Bad Request: Payload mal formado
 */
