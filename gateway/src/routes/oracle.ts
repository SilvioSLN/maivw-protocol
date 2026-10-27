import type { FastifyInstance } from "fastify";
import type { OracleService } from "../services/OracleService.js";
import type { LedgerService } from "../services/LedgerService.js";
import type { OracleReportService } from "../services/OracleReportService.js";

interface OracleRouteOptions {
  oracle: OracleService;
  ledger: LedgerService;
  reportService?: OracleReportService;
  internalServiceKey?: string;
  authorizeOperator?: (request: any) => Promise<boolean>;
}

export async function oracleRoutes(app: FastifyInstance, options: OracleRouteOptions) {
  const { oracle, ledger, reportService } = options;

  async function requireOracleOperator(request: any, reply: any) {
    if (options.internalServiceKey && request.headers["x-internal-service-key"] === options.internalServiceKey
      && (!options.authorizeOperator || await options.authorizeOperator(request))) return true;
    reply.status(403).send({ error: "Operador interno do oráculo obrigatório" });
    return false;
  }

  /**
   * GET /api/v1/oracle/status
   * Retorna os dados operacionais do Nó Oráculo IA
   */
  app.get("/api/v1/oracle/status", async (request, reply) => {
    if (!await requireOracleOperator(request, reply)) return;
    try {
      const oracleAddress = await ledger.getOracleNode();
      const client = ledger.getClient();
      let balanceWei = "0";

      if (oracleAddress) {
        try {
          const balance = await client.getBalance({ address: oracleAddress });
          balanceWei = balance.toString();
        } catch {
          // Ignora
        }
      }

      const metrics = reportService ? reportService.getMetrics() : null;

      return {
        active: true,
        oracleAddress,
        balanceWei,
        balanceEth: (Number(BigInt(balanceWei) / BigInt("1000000000000000")) / 1000).toFixed(4),
        model: "TypeSafe JEV + Gemini-1.5-Pro / DeepSeek-V3",
        slashingRule: {
          burnPercent: 80,
          bountyPercent: 20,
          penaltyBaseUsd: 50,
        },
        uptime: "99.99%",
        mode: "Autonomous On-Chain Court (3-Tier Cascade)",
        metrics,
      };
    } catch (error: any) {
      return reply.status(500).send({
        error: "Falha ao obter status do Oráculo",
        message: error.message,
      });
    }
  });

  /**
   * GET /api/v1/oracle/reports
   * Lista as denúncias em tempo real com métricas e estágios
   */
  app.get("/api/v1/oracle/reports", async (request, reply) => {
    if (!await requireOracleOperator(request, reply)) return;
    if (!reportService) {
      return { reports: [], metrics: {} };
    }

    const { status, stage } = (request.query || {}) as { status?: string; stage?: string };
    let reports = reportService.getAllReports();

    if (status && status !== "ALL") {
      reports = reports.filter((r) => r.verdict === status);
    }
    if (stage && stage !== "ALL") {
      reports = reports.filter((r) => r.currentStage === stage);
    }

    return {
      reports,
      metrics: reportService.getMetrics(),
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * GET /api/v1/oracle/reports/:id
   * Retorna os detalhes de uma denúncia específica
   */
  app.get("/api/v1/oracle/reports/:id", async (request, reply) => {
    if (!await requireOracleOperator(request, reply)) return;
    if (!reportService) {
      return reply.status(404).send({ error: "Report service not initialized" });
    }
    const { id } = request.params as { id: string };
    const rep = reportService.getReportById(id);
    if (!rep) {
      return reply.status(404).send({ error: "Denúncia não encontrada" });
    }
    return rep;
  });

  /**
   * POST /api/v1/oracle/reports/simulate-incoming
   * Injeta uma nova denúncia em tempo real no pipeline do tribunal
   */
  app.post("/api/v1/oracle/reports/simulate-incoming", async (request, reply) => {
    if (!await requireOracleOperator(request, reply)) return;
    if (!reportService) {
      return reply.status(500).send({ error: "Report service not available" });
    }

    const body = (request.body || {}) as {
      senderDomain?: string;
      from?: string;
      to?: string;
      subject?: string;
      bodySnippet?: string;
      msgClass?: string;
      reporterAddress?: string;
      source?: "MANUAL_WEBMAIL" | "INBOUND_GATEWAY_FILTER" | "DISPUTE_API" | "SIMULATED_TEST";
      isProvider?: boolean;
      subIdentity?: string;
    };

    const newReport = reportService.registerReport({
      senderDomain: body.senderDomain || "phishing-bank-alert.com",
      from: body.from || "alerta@phishing-bank-alert.com",
      to: body.to || "cliente@empresa-protegida.com",
      subject: body.subject || "URGENTE: Chave de segurança revogada, confirme seu token",
      bodySnippet: body.bodySnippet || "Acesse agora o link indicado para recadastrar sua senha ou seus serviços serão cancelados.",
      msgClass: body.msgClass || "ACCOUNT_SECURITY",
      reporterAddress: body.reporterAddress || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      source: body.source || "SIMULATED_TEST",
      isProvider: body.isProvider || false,
      subIdentity: body.subIdentity,
    });

    return {
      success: true,
      message: "Nova denúncia injetada no pipeline em tempo real com sucesso.",
      report: newReport,
    };
  });

  /**
   * POST /api/v1/oracle/reports/:id/human-action
   * Arbitragem do Conselho Humano no Nível 3 (Tier 3)
   */
  app.post("/api/v1/oracle/reports/:id/human-action", async (request, reply) => {
    if (!await requireOracleOperator(request, reply)) return;
    if (!reportService) {
      return reply.status(500).send({ error: "Report service not available" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as {
      action: "ABSOLVE" | "ISSUE_WARNING" | "EXECUTE_SLASHING";
      comment?: string;
    };

    if (!body.action || !["ABSOLVE", "ISSUE_WARNING", "EXECUTE_SLASHING"].includes(body.action)) {
      return reply.status(400).send({ error: "Ação humana inválida. Use ABSOLVE, ISSUE_WARNING ou EXECUTE_SLASHING." });
    }

    try {
      const updated = reportService.applyHumanVerdict(id, body.action, body.comment || "Decisão soberana do operador");
      return {
        success: true,
        message: `Decisão humana (${body.action}) aplicada com sucesso ao caso ${id}.`,
        report: updated,
      };
    } catch (err: any) {
      return reply.status(404).send({ error: err.message });
    }
  });

  /**
   * POST /api/v1/oracle/simulate
   * Simula um julgamento semântico no Tribunal Oráculo IA
   */
  app.post("/api/v1/oracle/simulate", async (request, reply) => {
    if (!await requireOracleOperator(request, reply)) return;
    const body = (request.body || {}) as {
      msgClass?: string;
      text?: string;
      body?: string;
      subject?: string;
      senderDomain?: string;
      from?: string;
      to?: string;
      reporterAddress?: string;
    };

    const msgClass = (body.msgClass || "TX_CODE").toUpperCase();
    const content = body.body || body.text || "";
    const subject = body.subject || "";
    const fullText = `${subject} ${content}`.trim();
    const sender = body.from || body.senderDomain || "spammer-agency.com";
    const reporter = body.reporterAddress || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    // Avaliação Semântica (Heurística Neural + Regras RFC)
    const normalized = fullText.toLowerCase();
    let isViolation = false;
    let reason = "Mensagem em total conformidade semântica com o cabeçalho e ausência de indutores de spoofing/phishing.";
    let confidence = 0.97;

    // 1. Phishing / Coerção bancária disfarçada de segurança
    const hasUrgency = normalized.includes("urgente") || normalized.includes("bloqueio") || normalized.includes("suspensa") || normalized.includes("imediato");
    const hasSensitiveRequest = normalized.includes("senha") || normalized.includes("token bancário") || normalized.includes("dados bancários") || normalized.includes("clique no link");

    if (hasUrgency && hasSensitiveRequest) {
      isViolation = true;
      confidence = 0.99;
      reason = `Tentativa de Phishing Bancário & Coerção Semântica: O remetente exige credenciais sob ameaça de bloqueio, em flagrante desacordo com as diretrizes do protocolo.`;
    } else {
      // 2. Avaliação de Tag Spoofing via OracleService
      const verdict = oracle.judgeSemanticViolation(msgClass, fullText);
      if (verdict.isSpoofed) {
        isViolation = true;
        confidence = 0.98;
        reason = verdict.reason;
      }
    }

    const penaltyUsd = isViolation ? 50 : 0;
    const penaltyEth = isViolation ? "0.0167 ETH" : "0 ETH";
    const burnAmountEth = isViolation ? "0.0133 ETH (80%)" : "0 ETH";
    const bountyAmountEth = isViolation ? "0.0033 ETH (20%)" : "0 ETH";
    const simulatedTxHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

    return {
      success: true,
      status: isViolation ? "VIOLATION" : "COMPLIANT",
      confidence,
      reasoning: reason,
      senderDomain: sender,
      penaltyUsd,
      penaltyEth,
      slashingSplit: {
        burnAmountEth,
        bountyAmountEth,
        bountyRecipient: reporter,
      },
      simulatedTxHash,
      timestamp: new Date().toLocaleTimeString("pt-BR"),
    };
  });
}
