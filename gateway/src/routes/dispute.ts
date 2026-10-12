import type { FastifyInstance } from "fastify";
import type { Hex, Address } from "viem";
import { DisputeRequestSchema } from "../schemas/payload.js";
import type { LedgerService } from "../services/LedgerService.js";
import type { SignatureService } from "../services/SignatureService.js";
import type { OracleService } from "../services/OracleService.js";
import type { ReputationService } from "../services/ReputationService.js";

import type { OracleReportService } from "../services/OracleReportService.js";

interface DisputeRouteOptions {
  ledger: LedgerService;
  signer: SignatureService;
  oracle: OracleService;
  reputation: ReputationService;
  reportService?: OracleReportService;
}

/**
 * Registra o endpoint do Tribunal do MAIVW: POST /api/v1/dispute (e alias /api/v1/report-spam)
 * Fases 5, 7 e 8: Moderação Semântica (LLM Juiz), Defesa Criptográfica e Slashing / Advertência On-Chain.
 */
export async function disputeRoutes(app: FastifyInstance, options: DisputeRouteOptions) {
  const { ledger, signer, oracle, reputation, reportService } = options;

  const handleDispute = async (request: any, reply: any) => {
    // 1. Validar schema da denúncia
    const parseResult = DisputeRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Invalid dispute payload",
        details: parseResult.error.flatten(),
      });
    }

    const { senderDomain, payload, reporterAddress, subIdentityId } = parseResult.data;
    const effectiveSubId = subIdentityId || payload.subIdentityId;

    app.log.info(
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
      return reply.status(404).send({
        error: "Domain not registered or already inactive",
        message: `O domínio ${senderDomain} não está ativo na rede MAIVW`,
      });
    }

    const isCryptoValid = await signer.verifyPayload(
      payload.content,
      payload.signature as Hex,
      senderPublicKey as Address
    );

    if (!isCryptoValid) {
      app.log.warn(`[TRIBUNAL] ❌ Denúncia descartada: Assinatura forjada contra ${senderDomain}`);
      return reply.status(400).send({
        error: "Invalid signature in evidence",
        message:
          "Fraude detectada na denúncia: A assinatura não corresponde à chave pública do remetente. O remetente está protegido.",
      });
    }

    app.log.info(`[TRIBUNAL] ✅ Assinatura criptográfica legítima comprovada`);

    // ============================================
    //  FILTRO 2: Validação Semântica (O Juiz IA)
    // ============================================
    const verdict = oracle.judgeSemanticViolation(payload.msgClass, payload.content.text);

    if (!verdict.isSpoofed) {
      app.log.info(`[TRIBUNAL] ⚖️ Denúncia improcedente: Conteúdo válido para ${payload.msgClass}`);
      return reply.status(200).send({
        verdict: "DISMISSED",
        isSpoofed: false,
        reason: verdict.reason,
        message: "Nenhuma violação semântica ou Tag Spoofing identificada no texto.",
      });
    }

    app.log.warn(`[TRIBUNAL] 🚨 VIOLAÇÃO DETECTADA: ${verdict.reason}`);

    // ============================================
    //  FILTRO 3: Execução do Veredito On-Chain
    // ============================================
    const isProvider = await ledger.isProvider(senderDomain);

    if (isProvider) {
      // PROVEDOR MULTI-TENANT: Advertência (Warning Ticket) e Bloqueio Granular Local
      app.log.info(`[TRIBUNAL] Remetente é Provedor. Emitindo Warning Ticket para #${effectiveSubId || "default"}...`);

      // 1. Registra no banco local Postgres
      await reputation.recordViolation(senderDomain, effectiveSubId, verdict.reason);

      // 2. Transação on-chain de Advertência via Oráculo
      let txHash: string | undefined;
      try {
        const txResult = await oracle.executeWarning(senderDomain, effectiveSubId || "default");
        txHash = txResult.txHash;
      } catch (err: any) {
        app.log.error(`[TRIBUNAL] Erro ao emitir warning ticket on-chain: ${err.message}`);
      }

      return reply.status(200).send({
        verdict: "GUILTY_PROVIDER_WARNING",
        isSpoofed: true,
        reason: verdict.reason,
        action: "Warning Ticket emitido on-chain e sub-identidade penalizada na reputação local.",
        providerDomain: senderDomain,
        subIdentity: effectiveSubId || "default",
        txHash,
      });
    } else {
      // DOMÍNIO COMUM: Slashing Total (20% Recompensa, 80% Queima)
      app.log.info(`[TRIBUNAL] Domínio comum culpado. Executando Slashing On-Chain...`);

      try {
        const txResult = await oracle.executeSlashing(senderDomain, [reporterAddress as Address]);

        return reply.status(200).send({
          verdict: "GUILTY_SLASHED",
          isSpoofed: true,
          reason: verdict.reason,
          action: "Domínio banido. Stake original confiscado: 20% pago ao denunciante e 80% queimado.",
          slashedDomain: senderDomain,
          reporter: reporterAddress,
          txHash: txResult.txHash,
          burnAddress: "0x000000000000000000000000000000000000dEaD",
        });
      } catch (err: any) {
        app.log.error(`[TRIBUNAL] Falha na transação de Slashing: ${err.message}`);
        return reply.status(500).send({
          error: "On-chain execution failed",
          message: err.message,
        });
      }
    }
  };

  // Endpoints
  app.post("/api/v1/dispute", handleDispute);
  app.post("/api/v1/report-spam", handleDispute);

  // Endpoint auxiliar para gerar prova de reciclagem de domínio banido (Fase 5)
  app.post("/api/v1/oracle/reclaim-proof", async (request, reply) => {
    const body = request.body as any;
    const { domain, newPublicKey, requesterAddress } = body || {};

    if (!domain || !newPublicKey || !requesterAddress) {
      return reply.status(400).send({
        error: "Missing parameters",
        message: "domain, newPublicKey and requesterAddress are required",
      });
    }

    try {
      const proof = await oracle.generateReclaimProof(
        domain,
        newPublicKey as Address,
        requesterAddress as Address
      );

      return reply.status(200).send({
        domain,
        newPublicKey,
        requesterAddress,
        oracleProof: proof,
        oracleNode: oracle.getOracleAddress(),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });
}
