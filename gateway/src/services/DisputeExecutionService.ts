import type { FastifyBaseLogger } from "fastify";
import type { Hex, Address } from "viem";
import { DisputeRequestSchema } from "../schemas/payload.js";
import type { LedgerService } from "./LedgerService.js";
import { SignatureService } from "./SignatureService.js";
import type { OracleService } from "./OracleService.js";
import type { ReputationService } from "./ReputationService.js";

import type { OracleReportService } from "./OracleReportService.js";

import type { OperationResult, OperationContext } from "../runtime/durableOperations.js";

export interface DisputeExecutionOptions {
  ledger: LedgerService;
  signer: SignatureService;
  oracle: OracleService;
  reputation: ReputationService;
  reportService?: OracleReportService;
  logger: FastifyBaseLogger;
}

const result = (statusCode: number, body: Record<string, any>): OperationResult => ({ statusCode, body });
export class DisputeExecutionService {
  constructor(private readonly options: DisputeExecutionOptions) {}
  async execute(input: unknown, context?: OperationContext): Promise<OperationResult> {
    const { ledger, signer, oracle, reputation, reportService, logger: log } = this.options;
    // 1. Validar schema da denúncia
    const parseResult = DisputeRequestSchema.safeParse(input);
    if (!parseResult.success) {
      return result(400, {
        error: "Invalid dispute payload",
        details: parseResult.error.flatten(),
      });
    }

    const { senderDomain, payload, reporterAddress, subIdentityId } = parseResult.data;
    const effectiveSubId = subIdentityId || payload.subIdentityId;

    log.info(
      `[TRIBUNAL] Denúncia recebida contra "${senderDomain}"${effectiveSubId ? ` (#${effectiveSubId})` : ""} por ${reporterAddress}`
    );

    // Registra denúncia no serviço de observabilidade em tempo real
    if (reportService) {
      reportService.registerReport({
        senderDomain,
        reporterAddress,
        msgClass: payload.msgClass,
        subject: (payload.content as any)?.subject || "Denúncia formal via API",
        bodySnippet: payload.content.text,
        source: "DISPUTE_API",
        subIdentity: effectiveSubId,
      });
    }

    // ============================================
    //  FILTRO 1: Validação Criptográfica (A Defesa de Ferro)
    // ============================================
    const senderPublicKey = await ledger.getPublicKey(senderDomain);
    if (!senderPublicKey) {
      return result(404, {
        error: "Domain not registered or already inactive",
        message: `O domínio ${senderDomain} não está ativo na rede MAIVW`,
      });
    }

    if (subIdentityId && subIdentityId !== payload.subIdentityId) return result(400, { error: "Subidentity does not match signed evidence" });
    let isCryptoValid = false;
    if (payload.envelopeVersion === "2.0" && payload.timestamp) {
      const contentHash = SignatureService.computeContentHash(payload.content);
      const attachmentsHash = SignatureService.computeAttachmentsHash(payload.content.attachments);
      isCryptoValid = payload.contentHash === contentHash && (!payload.attachmentsHash || payload.attachmentsHash === attachmentsHash)
        && await signer.verifyEnvelopeV2({ version: "2.0", messageId: payload.messageId, from: senderDomain,
          to: payload.to, subject: payload.subject, msgClass: payload.msgClass, timestamp: payload.timestamp,
          contentHash, attachmentsHash, subIdentityId: payload.subIdentityId }, payload.signature as Hex, senderPublicKey as Address);
    } else {
      isCryptoValid = await signer.verifyPayload(payload.content, payload.signature as Hex, senderPublicKey as Address);
    }

    if (!isCryptoValid) {
      log.warn(`[TRIBUNAL] ❌ Denúncia descartada: Assinatura forjada contra ${senderDomain}`);
      return result(400, {
        error: "Invalid signature in evidence",
        message:
          "Fraude detectada na denúncia: A assinatura não corresponde à chave pública do remetente. O remetente está protegido.",
      });
    }

    log.info(`[TRIBUNAL] ✅ Assinatura criptográfica legítima comprovada`);

    // ============================================
    //  FILTRO 2: Validação Semântica (O Juiz IA)
    // ============================================
    const verdict = await oracle.judgeSemanticViolationAsync(payload.msgClass, payload.content.text);

    if (verdict.degraded) throw new Error("Judge unavailable; punishment refused");

    if (!verdict.isSpoofed) {
      log.info(`[TRIBUNAL] ⚖️ Denúncia improcedente: Conteúdo válido para ${payload.msgClass}`);
      return result(200, {
        verdict: "DISMISSED",
        isSpoofed: false,
        reason: verdict.reason,
        message: "Nenhuma violação semântica ou Tag Spoofing identificada no texto.",
      });
    }

    log.warn(`[TRIBUNAL] 🚨 VIOLAÇÃO DETECTADA: ${verdict.reason}`);

    // ============================================
    //  FILTRO 3: Execução do Veredito On-Chain
    // ============================================
    // v1 signs content only and cannot authorize a punishment for classification.
    if (payload.envelopeVersion !== "2.0") return result(422, { error: "Legacy evidence cannot authorize punishment without a signed classification" });
    const isProvider = await ledger.isProvider(senderDomain);

    const confirmed = result(200, {
      verdict: isProvider ? "GUILTY_PROVIDER_WARNING" : "GUILTY_DOMAIN_SLASHED",
      isSpoofed: true, reason: verdict.reason, domain: senderDomain,
      subIdentity: effectiveSubId || "default", action: isProvider ? "Warning confirmed on-chain" : "Slashing confirmed on-chain",
    });
    if (isProvider) confirmed.localViolation = { domain: senderDomain, subIdentity: effectiveSubId || "default" };
    await context?.beforeEffect();
    const broadcast = async (txHash: string) => { await context?.checkpoint({ txHash, outcome: { ...confirmed, body: { ...confirmed.body, txHash } } }); };
    const tx = isProvider
      ? await oracle.executeWarning(senderDomain, effectiveSubId || "default", broadcast)
      : await oracle.executeSlashing(senderDomain, [reporterAddress as Address], broadcast);
    if (!tx.success) throw new Error("On-chain action not confirmed");
    confirmed.body.txHash = tx.txHash;
    return confirmed;

  }
}
