import { DisputeExecutionService } from "../services/DisputeExecutionService.js";
import type { OperationResult } from "../runtime/durableOperations.js";
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
  executeDurably?: (input: unknown) => Promise<OperationResult>;
  authorizeReclaim?: (request: any) => Promise<boolean>;
}

/**
 * Registra o endpoint do Tribunal do MAIVW: POST /api/v1/dispute (e alias /api/v1/report-spam)
 * Fases 5, 7 e 8: Moderação Semântica (LLM Juiz), Defesa Criptográfica e Slashing / Advertência On-Chain.
 */
export async function disputeRoutes(app: FastifyInstance, options: DisputeRouteOptions) {
  const { ledger, signer, oracle, reputation, reportService } = options;

  const execute = new DisputeExecutionService({ ...options, logger: app.log });
  const handleDispute = async (request: any, reply: any) => {
    const outcome = options.executeDurably ? await options.executeDurably(request.body) : await execute.execute(request.body);
    return reply.code(outcome.statusCode).send(outcome.body);
  };

  // Endpoints
  app.post("/api/v1/dispute", handleDispute);
  app.post("/api/v1/report-spam", handleDispute);

  // Endpoint auxiliar para gerar prova de reciclagem de domínio banido (Fase 5)
  app.post("/api/v1/oracle/reclaim-proof", async (request, reply) => {
    if (options.authorizeReclaim && !await options.authorizeReclaim(request)) return reply.code(403).send({ error: "Domain ownership required" });
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
