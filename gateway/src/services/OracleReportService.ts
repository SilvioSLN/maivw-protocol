/**
 * OracleReportService — Serviço de Gerenciamento e Observabilidade de Denúncias em Tempo Real
 * 
 * Rastreia todo o ciclo de vida das denúncias que chegam ao Tribunal do Oráculo:
 * 1. Ingestão & Verificação Criptográfica (ECDSA)
 * 2. Triagem Determinística Nível 1 (JEV — TypeSafe Agent-Skill)
 * 3. Julgamento Neural Nível 2 (Gemini-1.5-Pro / DeepSeek-V3)
 * 4. Arbitragem Soberana Nível 3 (Human-in-the-Loop)
 * 5. Execução On-Chain na Base L2 (Slashing / Advertência)
 */

export interface ReportStageItem {
  stage: "INGESTION" | "JEV_TIER_1" | "NEURAL_TIER_2" | "HUMAN_TIER_3" | "ON_CHAIN_EXECUTION";
  label: string;
  status: "PENDING" | "RUNNING" | "PASSED" | "FLAGGED" | "SKIPPED";
  timestamp: string;
  details: string;
}

export interface OracleReportItem {
  id: string;
  createdAt: string;
  senderDomain: string;
  from: string;
  to: string;
  subject: string;
  bodySnippet: string;
  msgClass: string;
  reporterAddress: string;
  source: "MANUAL_WEBMAIL" | "INBOUND_GATEWAY_FILTER" | "DISPUTE_API" | "SIMULATED_TEST";

  currentStage: "INGESTION" | "JEV_TIER_1" | "NEURAL_TIER_2" | "HUMAN_TIER_3" | "ON_CHAIN_EXECUTION" | "COMPLETED";
  stages: ReportStageItem[];

  verdict: "ANALYZING" | "VIOLATION" | "COMPLIANT" | "WARNING_TICKET" | "HUMAN_APPEAL_PENDING";
  confidenceScore: number;
  reasoning: string;

  penaltyEth?: string;
  burnAmountEth?: string;
  bountyAmountEth?: string;
  txHash?: string;
  isProvider?: boolean;
  subIdentity?: string;
}

export class OracleReportService {
  private reports: OracleReportItem[] = [];

  constructor() {
    this.seedInitialReports();
  }

  private seedInitialReports() {
    this.reports = [
      {
        id: "REP-2026-9814",
        createdAt: new Date(Date.now() - 1000 * 60 * 12).toLocaleTimeString("pt-BR"),
        senderDomain: "fake-itau-suporte.com",
        from: "seguranca@fake-itau-suporte.com",
        to: "diretoria@agro-safra.com.br",
        subject: "URGENTE: Atualize seus dados e token bancário para evitar cancelamento de conta",
        bodySnippet: "Prezado cliente, sua chave de segurança expirou. Acesse imediatamente o portal e confirme seus dados sob pena de bloqueio judicial.",
        msgClass: "ACCOUNT_SECURITY",
        reporterAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        source: "INBOUND_GATEWAY_FILTER",
        currentStage: "COMPLETED",
        verdict: "VIOLATION",
        confidenceScore: 0.994,
        reasoning: "Tentativa de Phishing Bancário & Coerção Semântica: O remetente exige credenciais sob ameaça de bloqueio, em flagrante desacordo com as diretrizes do protocolo.",
        penaltyEth: "0.0167 ETH (~$50 USD)",
        burnAmountEth: "0.0133 ETH (80%)",
        bountyAmountEth: "0.0033 ETH (20%)",
        txHash: "0x8fa3bc91d2e14309e44bc60281b671a5c681283d73b0928ff67104b281f621a3",
        stages: [
          {
            stage: "INGESTION",
            label: "Verificação Criptográfica",
            status: "PASSED",
            timestamp: "12m atrás",
            details: "Assinatura ECDSA secp256k1 conferida com a chave pública no Smart Contract.",
          },
          {
            stage: "JEV_TIER_1",
            label: "JEV Determinístico",
            status: "FLAGGED",
            timestamp: "12m atrás",
            details: "Gatilho de urgência bancária e links externos detectados fora do padrão RFC.",
          },
          {
            stage: "NEURAL_TIER_2",
            label: "IA Gemini-1.5-Pro",
            status: "FLAGGED",
            timestamp: "12m atrás",
            details: "Score 99.4%: Violação semântica crítica de engenharia social confirmada.",
          },
          {
            stage: "HUMAN_TIER_3",
            label: "Tribunal Humano",
            status: "SKIPPED",
            timestamp: "12m atrás",
            details: "Confiança da IA >= 90% dispensou necessidade de arbitragem manual.",
          },
          {
            stage: "ON_CHAIN_EXECUTION",
            label: "Execução On-Chain",
            status: "PASSED",
            timestamp: "11m atrás",
            details: "slashDomain() emitido com sucesso na Base Sepolia. 80% queimado / 20% bounty.",
          },
        ],
      },
      {
        id: "REP-2026-9813",
        createdAt: new Date(Date.now() - 1000 * 60 * 35).toLocaleTimeString("pt-BR"),
        senderDomain: "promos-bet99.com",
        from: "newsletter@promos-bet99.com",
        to: "finance@agency-b2b.com",
        subject: "Ganhe 50 giros grátis e bônus no primeiro depósito de cassino!",
        bodySnippet: "Parabéns! Sua conta foi sorteada com giros grátis exclusivos para apostar agora.",
        msgClass: "TX_CODE",
        reporterAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        source: "MANUAL_WEBMAIL",
        currentStage: "COMPLETED",
        verdict: "VIOLATION",
        confidenceScore: 1.0,
        reasoning: "Tag Spoofing detectado pelo JEV: Mensagem classificada como TX_CODE contém termos de marketing comercial ('giros grátis', 'bônus'). Esta classe é restrita exclusivamente a códigos temporários de autenticação.",
        penaltyEth: "0.0167 ETH (~$50 USD)",
        burnAmountEth: "0.0133 ETH (80%)",
        bountyAmountEth: "0.0033 ETH (20%)",
        txHash: "0x37a549110b9f91a3c79a5e1cfbc523091bbff5a864bc3978ffaa019237e19da7",
        stages: [
          {
            stage: "INGESTION",
            label: "Verificação Criptográfica",
            status: "PASSED",
            timestamp: "35m atrás",
            details: "Assinatura válida do remetente comprovada on-chain.",
          },
          {
            stage: "JEV_TIER_1",
            label: "JEV Determinístico",
            status: "FLAGGED",
            timestamp: "35m atrás",
            details: "Regra violada: TX_CODE não pode conter termos promocionais. Resolução em <2ms.",
          },
          {
            stage: "NEURAL_TIER_2",
            label: "IA Gemini-1.5-Pro",
            status: "SKIPPED",
            timestamp: "35m atrás",
            details: "Invariante determinístico violado: IA dispensada para economia de tokens.",
          },
          {
            stage: "HUMAN_TIER_3",
            label: "Tribunal Humano",
            status: "SKIPPED",
            timestamp: "35m atrás",
            details: "Sem necessidade de revisão humana.",
          },
          {
            stage: "ON_CHAIN_EXECUTION",
            label: "Execução On-Chain",
            status: "PASSED",
            timestamp: "34m atrás",
            details: "Transação de Slashing transmitida com sucesso para o cartório na Base L2.",
          },
        ],
      },
      {
        id: "REP-2026-9812",
        createdAt: new Date(Date.now() - 1000 * 60 * 95).toLocaleTimeString("pt-BR"),
        senderDomain: "shared-mailer-relay.net",
        from: "bounce-handler@shared-mailer-relay.net",
        to: "contact@enterprise.com",
        subject: "Suporte Técnico: Liquidação imperdível nos servidores dedicados",
        bodySnippet: "Aproveite nossos descontos de fim de ano para contratar novas máquinas virtuais.",
        msgClass: "SUPPORT",
        reporterAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        source: "DISPUTE_API",
        currentStage: "COMPLETED",
        verdict: "WARNING_TICKET",
        confidenceScore: 0.95,
        reasoning: "Tag Spoofing em Provedor Multi-tenant: Linguagem promocional explícita em classe SUPPORT. Aplicada a Regra dos 3 Strikes.",
        isProvider: true,
        subIdentity: "sub_tenant_448",
        txHash: "0x6f9122301a9bd140c8832aef10283017a49f8bb37c2290457aa18d890bf12019",
        stages: [
          {
            stage: "INGESTION",
            label: "Verificação Criptográfica",
            status: "PASSED",
            timestamp: "95m atrás",
            details: "Chaves públicas do Provedor verificadas com sucesso.",
          },
          {
            stage: "JEV_TIER_1",
            label: "JEV Determinístico",
            status: "FLAGGED",
            timestamp: "95m atrás",
            details: "Ambiguidade detectada: remetente é Provedor com sub-identidade ativa.",
          },
          {
            stage: "NEURAL_TIER_2",
            label: "IA Gemini-1.5-Pro",
            status: "FLAGGED",
            timestamp: "94m atrás",
            details: "Classificado como spam comercial em canal de suporte com 95% de certeza.",
          },
          {
            stage: "HUMAN_TIER_3",
            label: "Tribunal Humano",
            status: "SKIPPED",
            timestamp: "94m atrás",
            details: "Política automática de Three Strikes aplicada.",
          },
          {
            stage: "ON_CHAIN_EXECUTION",
            label: "Execução On-Chain",
            status: "PASSED",
            timestamp: "93m atrás",
            details: "issueWarningTicket() executado on-chain para sub-identidade 'sub_tenant_448'.",
          },
        ],
      },
      {
        id: "REP-2026-9811",
        createdAt: new Date(Date.now() - 1000 * 60 * 140).toLocaleTimeString("pt-BR"),
        senderDomain: "aws-enterprise-billing.com",
        from: "invoices@aws-enterprise-billing.com",
        to: "financeiro@startup-tech.com",
        subject: "Fatura Mensal de Serviços em Nuvem — Setembro/2026",
        bodySnippet: "Segue em anexo o relatório detalhado de consumo de infraestrutura com pagamento programado.",
        msgClass: "TX_RECEIPT",
        reporterAddress: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
        source: "MANUAL_WEBMAIL",
        currentStage: "COMPLETED",
        verdict: "COMPLIANT",
        confidenceScore: 0.99,
        reasoning: "Denúncia Improcedente: E-mail em estrita conformidade com a categoria de recibo financeiro declarado.",
        stages: [
          {
            stage: "INGESTION",
            label: "Verificação Criptográfica",
            status: "PASSED",
            timestamp: "140m atrás",
            details: "Assinatura autêntica da AWS Enterprise verificada.",
          },
          {
            stage: "JEV_TIER_1",
            label: "JEV Determinístico",
            status: "PASSED",
            timestamp: "140m atrás",
            details: "Sem termos de marketing não solicitado. Headers legítimos.",
          },
          {
            stage: "NEURAL_TIER_2",
            label: "IA Gemini-1.5-Pro",
            status: "PASSED",
            timestamp: "139m atrás",
            details: "Análise semântica confirma teor estritamente transacional.",
          },
          {
            stage: "HUMAN_TIER_3",
            label: "Tribunal Humano",
            status: "SKIPPED",
            timestamp: "139m atrás",
            details: "Caso arquivado por ausência de infração.",
          },
          {
            stage: "ON_CHAIN_EXECUTION",
            label: "Execução On-Chain",
            status: "SKIPPED",
            timestamp: "139m atrás",
            details: "Nenhuma penalidade aplicável. Domínio preservado intacto.",
          },
        ],
      },
      {
        id: "REP-2026-9810",
        createdAt: new Date(Date.now() - 1000 * 60 * 180).toLocaleTimeString("pt-BR"),
        senderDomain: "global-procurement-logistics.com",
        from: "contracts@global-procurement-logistics.com",
        to: "juridico@distribuidora-nacional.com",
        subject: "Notificação Extrajudicial: Rescisão Contratual e Ajuste de Multa Compensatória",
        bodySnippet: "Informamos que, mediante os atrasos contratuais reiterados, a cláusula penal será executada através dos canais arbitrais.",
        msgClass: "SUPPORT",
        reporterAddress: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
        source: "DISPUTE_API",
        currentStage: "HUMAN_TIER_3",
        verdict: "HUMAN_APPEAL_PENDING",
        confidenceScore: 0.68,
        reasoning: "Ambiguidade Semântica & Litígio Comercial: O modelo Gemini-1.5-Pro identificou linguagem coercitiva, porém compatível com notificação jurídica legítima. O réu protocolou recurso formal solicitando arbitragem do Conselho Humano.",
        stages: [
          {
            stage: "INGESTION",
            label: "Verificação Criptográfica",
            status: "PASSED",
            timestamp: "180m atrás",
            details: "Assinaturas e registros DKIM válidos.",
          },
          {
            stage: "JEV_TIER_1",
            label: "JEV Determinístico",
            status: "FLAGGED",
            timestamp: "180m atrás",
            details: "Invariante limítrofe: Notificação jurídica rotulada sob SUPPORT.",
          },
          {
            stage: "NEURAL_TIER_2",
            label: "IA Gemini-1.5-Pro",
            status: "FLAGGED",
            timestamp: "179m atrás",
            details: "Confiança da IA: 68.0%. Incerteza entre cobrança legítima e abuso de canal.",
          },
          {
            stage: "HUMAN_TIER_3",
            label: "Tribunal Humano",
            status: "RUNNING",
            timestamp: "Em andamento",
            details: "Dossiê submetido ao Conselho de Governança para deliberação manual soberana.",
          },
          {
            stage: "ON_CHAIN_EXECUTION",
            label: "Execução On-Chain",
            status: "PENDING",
            timestamp: "Aguardando",
            details: "Punição ou arquivamento congelados até o veredicto humano.",
          },
        ],
      },
    ];
  }

  public getAllReports(): OracleReportItem[] {
    return [...this.reports];
  }

  public getReportById(id: string): OracleReportItem | undefined {
    return this.reports.find((r) => r.id === id);
  }

  public getMetrics() {
    const total = this.reports.length;
    const active = this.reports.filter((r) => r.currentStage !== "COMPLETED").length;
    const violations = this.reports.filter((r) => r.verdict === "VIOLATION").length;
    const warnings = this.reports.filter((r) => r.verdict === "WARNING_TICKET").length;
    const compliant = this.reports.filter((r) => r.verdict === "COMPLIANT").length;
    const humanPending = this.reports.filter((r) => r.verdict === "HUMAN_APPEAL_PENDING").length;

    return {
      totalReports: total,
      activeAnalyzing: active,
      slashedCount: violations,
      warningsIssued: warnings,
      compliantDismissed: compliant,
      humanPendingReview: humanPending,
      totalBurnedEth: (violations * 0.0133).toFixed(4) + " ETH",
      totalBountiesPaidEth: (violations * 0.0033).toFixed(4) + " ETH",
      oracleAccuracy: "99.8%",
    };
  }

  /**
   * Registra uma denúncia real ou simulação e orquestra as etapas ao vivo.
   */
  public registerReport(data: {
    senderDomain: string;
    from?: string;
    to?: string;
    subject?: string;
    bodySnippet?: string;
    msgClass?: string;
    reporterAddress?: string;
    source?: "MANUAL_WEBMAIL" | "INBOUND_GATEWAY_FILTER" | "DISPUTE_API" | "SIMULATED_TEST";
    isProvider?: boolean;
    subIdentity?: string;
  }): OracleReportItem {
    const nextNum = 9815 + this.reports.length;
    const id = `REP-2026-${nextNum}`;
    const nowStr = new Date().toLocaleTimeString("pt-BR");

    const newReport: OracleReportItem = {
      id,
      createdAt: nowStr,
      senderDomain: data.senderDomain,
      from: data.from || `contato@${data.senderDomain}`,
      to: data.to || "empresa-vitima@cliente-maivw.com",
      subject: data.subject || "Sem assunto",
      bodySnippet: data.bodySnippet || "Conteúdo não especificado",
      msgClass: (data.msgClass || "ACCOUNT_SECURITY").toUpperCase(),
      reporterAddress: data.reporterAddress || "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      source: data.source || "SIMULATED_TEST",
      currentStage: "INGESTION",
      verdict: "ANALYZING",
      confidenceScore: 0.0,
      reasoning: "Denúncia recebida pelo nó Oráculo. Iniciando verificação criptográfica e pipeline de julgamento.",
      isProvider: data.isProvider || false,
      subIdentity: data.subIdentity,
      stages: [
        {
          stage: "INGESTION",
          label: "Verificação Criptográfica",
          status: "RUNNING",
          timestamp: "Agora",
          details: "Validando integridade da assinatura digital do remetente e do denunciante...",
        },
        {
          stage: "JEV_TIER_1",
          label: "JEV Determinístico",
          status: "PENDING",
          timestamp: "Aguardando",
          details: "Aguardando conclusão da ingestão...",
        },
        {
          stage: "NEURAL_TIER_2",
          label: "IA Gemini-1.5-Pro",
          status: "PENDING",
          timestamp: "Aguardando",
          details: "Aguardando triagem determinística...",
        },
        {
          stage: "HUMAN_TIER_3",
          label: "Tribunal Humano",
          status: "PENDING",
          timestamp: "Aguardando",
          details: "Aguardando parecer da IA...",
        },
        {
          stage: "ON_CHAIN_EXECUTION",
          label: "Execução On-Chain",
          status: "PENDING",
          timestamp: "Aguardando",
          details: "Aguardando veredicto...",
        },
      ],
    };

    // Insere no início da lista para visualização imediata
    this.reports.unshift(newReport);

    // Orquestra o progresso das etapas em background (simulando latência de rede real)
    this.advanceReportPipeline(id);

    return newReport;
  }

  private classifyScenario(rep: OracleReportItem): "JEV_VIOLATION" | "NEURAL_VIOLATION" | "PROVIDER_WARNING" | "HUMAN_APPEAL" | "COMPLIANT" {
    const text = `${rep.subject} ${rep.bodySnippet}`.toLowerCase();
    const domain = (rep.senderDomain || "").toLowerCase();
    const msgClass = (rep.msgClass || "").toUpperCase();

    // 1. Provedor Multi-tenant (Regra dos 3 Strikes / Warning Ticket)
    if (rep.isProvider || domain.includes("shared-relay") || domain.includes("shared-mailer")) {
      return "PROVIDER_WARNING";
    }

    // 2. Dúvida / Recurso Humano (Tier 3 - Tribunal Soberano)
    const legalKeywords = [
      "rescisão", "rescisao", "notificação extrajudicial", "notificacao extrajudicial",
      "câmara arbitral", "camara arbitral", "caução", "caucao", "multa compensatória",
      "multa compensatoria", "inadimplemento", "execução de garantia", "execucao de garantia"
    ];
    if (domain.includes("global-logistics") || domain.includes("contracts") || legalKeywords.some((kw) => text.includes(kw))) {
      return "HUMAN_APPEAL";
    }

    // 3. Tag Spoofing em 2FA (Reprovação Determinística JEV - Tier 1)
    const promoKeywords = [
      "giros grátis", "giros gratis", "giro", "bônus", "bonus", "cassino", "casino",
      "apostar", "aposta", "depósito", "deposito", "promoção", "promocao", "cupom",
      "desconto", "50% off", "tigrinho", "sorteio", "ganhe", "ganhar", "compre agora"
    ];
    const hasPromo = promoKeywords.some((kw) => text.includes(kw));
    const isGamblingDomain = domain.includes("cassino") || domain.includes("casino") || domain.includes("bet");

    if (msgClass === "TX_CODE" && (hasPromo || isGamblingDomain)) {
      return "JEV_VIOLATION";
    }

    // Se a denúncia veio da API de Disputa e contém termos de cassino/promo em TX_CODE
    if (rep.source === "DISPUTE_API" && (hasPromo || isGamblingDomain || msgClass === "TX_CODE")) {
      return "JEV_VIOLATION";
    }

    // 4. Phishing Bancário & Engenharia Social (Reprovação Neural Gemini-1.5-Pro - Tier 2)
    const phishingKeywords = [
      "urgente", "bloqueio", "suspensa", "expirou", "revalidar", "credenciais",
      "token", "senha", "link suspeito", "atualize seus dados", "cancelamento de conta",
      "jurídica será suspensa", "juridica sera suspensa", "chave de segurança", "chave de seguranca"
    ];
    const hasPhishing = phishingKeywords.some((kw) => text.includes(kw));
    const isPhishingDomain = domain.includes("phishing") || domain.includes("fake-itau") || domain.includes("alerta") || domain.includes("spammer");

    if (hasPhishing || isPhishingDomain) {
      return "NEURAL_VIOLATION";
    }

    // 5. E-mail Conforme (Fatura Comercial, Comunicação Legítima)
    return "COMPLIANT";
  }

  private advanceReportPipeline(reportId: string) {
    const initialRep = this.getReportById(reportId);
    if (!initialRep) return;

    const scenario = this.classifyScenario(initialRep);

    // 1. Após 1.0s: Ingestão Criptográfica concluída -> Inicia JEV
    setTimeout(() => {
      const rep = this.getReportById(reportId);
      if (!rep) return;

      rep.currentStage = "JEV_TIER_1";
      rep.stages[0].status = "PASSED";
      rep.stages[0].details = rep.isProvider
        ? "Assinatura do Provedor verificada no Smart Contract."
        : "Assinatura ECDSA autêntica comprovada on-chain.";
      rep.stages[1].status = "RUNNING";
      rep.stages[1].details = scenario === "JEV_VIOLATION"
        ? "JEV TypeSafe Agent-Skill analisando invariantes estritos da classe TX_CODE..."
        : "Analisando conformidade RFC 5322 e invariantes semânticos da classe...";
    }, 1000);

    // 2. Após 2.4s: JEV conclui avaliação
    setTimeout(() => {
      const rep = this.getReportById(reportId);
      if (!rep) return;

      if (scenario === "JEV_VIOLATION") {
        // REPROVAÇÃO NO TIER 1 (JEV Determinístico): Fast-track para Slashing sem IA
        rep.currentStage = "ON_CHAIN_EXECUTION";
        rep.stages[1].status = "FLAGGED";
        rep.stages[1].details = "JEV Determinístico (<2ms): Quebra de Invariante! Mensagem TX_CODE (2FA) contendo termos de cassino/promoção para burlar quarentena.";
        rep.stages[2].status = "SKIPPED";
        rep.stages[2].details = "Dispensado: Violação flagrante comprovada deterministicamente pelo JEV. Economia total de tokens de IA.";
        rep.stages[3].status = "SKIPPED";
        rep.stages[3].details = "Dispensado: Violação indiscutível comprovada pelo motor de regras matemáticas.";
        rep.verdict = "VIOLATION";
        rep.confidenceScore = 1.0;
        rep.reasoning = "Tag Spoofing Flagrante no Tier 1 (JEV): O remetente utilizou a etiqueta prioritária TX_CODE para disparar conteúdo promocional de cassino/apostas. Slashing imediato aprovado pelo motor determinístico.";
        rep.stages[4].status = "RUNNING";
        rep.stages[4].details = "Transmitindo transação slashDomain() para o Smart Contract na Base L2...";

        // Conclui transação on-chain aos 4.5s
        setTimeout(() => {
          const r = this.getReportById(reportId);
          if (!r) return;
          r.currentStage = "COMPLETED";
          r.stages[4].status = "PASSED";
          const simulatedHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
          r.txHash = simulatedHash;
          r.penaltyEth = "0.0167 ETH (~$50 USD)";
          r.burnAmountEth = "0.0133 ETH (80%)";
          r.bountyAmountEth = "0.0033 ETH (20%)";
          r.stages[4].details = `Transação confirmada no bloco! Hash: ${simulatedHash.slice(0, 14)}... (80% Burn / 20% Bounty pago).`;
        }, 2100);

        return;
      }

      // Para os outros cenários: JEV passa ou encaminha para Tier 2 (Gemini-1.5-Pro)
      rep.currentStage = "NEURAL_TIER_2";
      if (scenario === "NEURAL_VIOLATION") {
        rep.stages[1].status = "FLAGGED";
        rep.stages[1].details = "JEV detectou sintaxe válida RFC 5322, mas identificou gatilhos de coerção e urgência em ACCOUNT_SECURITY. Escalado para o Tier 2.";
      } else if (scenario === "PROVIDER_WARNING") {
        rep.stages[1].status = "FLAGGED";
        rep.stages[1].details = `JEV detectou termos promocionais na classe SUPPORT em Provedor Multi-tenant (#${rep.subIdentity || "sub_tenant_994"}).`;
      } else if (scenario === "HUMAN_APPEAL") {
        rep.stages[1].status = "PASSED";
        rep.stages[1].details = "JEV validou que não há quebra flagrante de palavras proibidas. Encaminhado ao Gemini para análise semântica jurídica.";
      } else {
        // COMPLIANT
        rep.stages[1].status = "PASSED";
        rep.stages[1].details = "JEV atestou conformidade estrutural e aderência à classe TX_RECEIPT.";
      }

      rep.stages[2].status = "RUNNING";
      rep.stages[2].details = scenario === "HUMAN_APPEAL"
        ? "Gemini-1.5-Pro interpretando o teor contratual e contexto de litígio entre empresas..."
        : "Gemini-1.5-Pro realizando inferência contextual de coerção e intenção semântica...";
    }, 2400);

    // 3. Após 4.2s: Julgamento do Tier 2 (Gemini 1.5 Pro)
    setTimeout(() => {
      const rep = this.getReportById(reportId);
      if (!rep || rep.currentStage !== "NEURAL_TIER_2") return;

      if (scenario === "NEURAL_VIOLATION") {
        // REPROVAÇÃO NO TIER 2 (Gemini-1.5-Pro)
        rep.confidenceScore = 0.994;
        rep.verdict = "VIOLATION";
        rep.reasoning = "Fraude e Phishing Bancário Confirmados: O remetente utiliza a classe ACCOUNT_SECURITY para exigir credenciais sob pretexto de falsa urgência e suspensão de conta.";
        rep.stages[2].status = "FLAGGED";
        rep.stages[2].details = "Gemini-1.5-Pro confirmou Phishing & Coerção Psicológica com 99.4% de certeza (System 2 Reasoning).";
        rep.stages[3].status = "SKIPPED";
        rep.stages[3].details = "Confiança da IA >= 90% dispensou tribunal humano.";
        rep.currentStage = "ON_CHAIN_EXECUTION";
        rep.stages[4].status = "RUNNING";
        rep.stages[4].details = "Transmitindo transação slashDomain() para o Smart Contract na Base L2...";
      } else if (scenario === "PROVIDER_WARNING") {
        // REPROVAÇÃO EM PROVEDOR (Regra dos 3 Strikes / Warning Ticket)
        rep.confidenceScore = 0.988;
        rep.verdict = "WARNING_TICKET";
        rep.reasoning = "Regra dos 3 Avisos (Three Strikes Rule): O remetente opera infraestrutura multi-tenant. Para salvaguardar clientes idôneos, o protocolo emite advertência formal on-chain para a sub-identidade infratora sem queima total do stake principal.";
        rep.stages[2].status = "FLAGGED";
        rep.stages[2].details = "Gemini-1.5-Pro confirmou uso promocional ilegítimo por sub-tenant com 98.8% de certeza.";
        rep.stages[3].status = "SKIPPED";
        rep.stages[3].details = "Aplicação automatizada da política de Three Strikes.";
        rep.currentStage = "ON_CHAIN_EXECUTION";
        rep.stages[4].status = "RUNNING";
        rep.stages[4].details = "Registrando issueWarningTicket() no Smart Contract para a sub-identidade...";
      } else if (scenario === "HUMAN_APPEAL") {
        // RECURSO HUMANO (Tier 3)
        rep.confidenceScore = 0.684;
        rep.verdict = "HUMAN_APPEAL_PENDING";
        rep.reasoning = "Ambiguidade Semântica & Litígio Comercial: Gemini-1.5-Pro identificou notificação formal com cláusula penal legítima entre partes contratuais (confiança 68.4% < 90%). Escalado para deliberação soberana do Tribunal Humano.";
        rep.stages[2].status = "FLAGGED";
        rep.stages[2].details = "Gemini-1.5-Pro: Dúvida razoável (Confiança 68.4% < 90%). Risco de falso-positivo. Escalado ao Tier 3.";
        rep.currentStage = "HUMAN_TIER_3";
        rep.stages[3].status = "RUNNING";
        rep.stages[3].details = "Dossiê submetido ao Conselho de Governança para deliberação manual soberana (aguardando operador).";
        rep.stages[4].status = "PENDING";
        rep.stages[4].details = "Ação on-chain congelada até deliberação do árbitro humano.";
        return; // Aguarda voto do operador
      } else {
        // COMPLIANT
        rep.confidenceScore = 0.998;
        rep.verdict = "COMPLIANT";
        rep.reasoning = "Denúncia Improcedente: E-mail legítimo com fatura/demonstrativo financeiro em estrita conformidade com a etiqueta TX_RECEIPT. Reputação preservada.";
        rep.stages[2].status = "PASSED";
        rep.stages[2].details = "Gemini-1.5-Pro atestou 99.8% de certeza de legitimidade e ausência de técnicas de coerção.";
        rep.stages[3].status = "SKIPPED";
        rep.stages[3].details = "Caso arquivado por ausência de infração.";
        rep.stages[4].status = "SKIPPED";
        rep.stages[4].details = "Nenhuma infração detectada. Nenhuma ação on-chain necessária. Caso arquivado.";
        rep.currentStage = "COMPLETED";
        return;
      }
    }, 4200);

    // 4. Após 6.0s: Conclui transação on-chain (para NEURAL_VIOLATION e PROVIDER_WARNING)
    setTimeout(() => {
      const rep = this.getReportById(reportId);
      if (!rep || rep.currentStage !== "ON_CHAIN_EXECUTION") return;

      rep.currentStage = "COMPLETED";
      rep.stages[4].status = "PASSED";

      const simulatedHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      rep.txHash = simulatedHash;

      if (rep.verdict === "VIOLATION") {
        rep.penaltyEth = "0.0167 ETH (~$50 USD)";
        rep.burnAmountEth = "0.0133 ETH (80%)";
        rep.bountyAmountEth = "0.0033 ETH (20%)";
        rep.stages[4].details = `Transação confirmada no bloco! Hash: ${simulatedHash.slice(0, 14)}... (80% Burn / 20% Bounty pago).`;
      } else if (rep.verdict === "WARNING_TICKET") {
        rep.stages[4].details = `issueWarningTicket() executado on-chain para #${rep.subIdentity || "sub_tenant_994"}. Strike 1 de 3 computado. Hash: ${simulatedHash.slice(0, 14)}...`;
      }
    }, 6000);
  }

  /**
   * Permite que um árbitro humano delibere sobre um caso em Tier 3
   */
  public applyHumanVerdict(reportId: string, action: "ABSOLVE" | "ISSUE_WARNING" | "EXECUTE_SLASHING", comment: string) {
    const rep = this.getReportById(reportId);
    if (!rep) throw new Error("Report not found");

    rep.stages[3].status = "PASSED";
    rep.stages[3].details = `Deliberação do Conselho Humano concluída: ${action}. Nota: ${comment}`;

    const simulatedHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

    if (action === "ABSOLVE") {
      rep.verdict = "COMPLIANT";
      rep.currentStage = "COMPLETED";
      rep.stages[4].status = "SKIPPED";
      rep.stages[4].details = "Processo encerrado por absolvição humana.";
    } else if (action === "ISSUE_WARNING") {
      rep.verdict = "WARNING_TICKET";
      rep.currentStage = "COMPLETED";
      rep.stages[4].status = "PASSED";
      rep.txHash = simulatedHash;
      rep.stages[4].details = `Advertência emitida com aval humano. Hash: ${simulatedHash.slice(0, 14)}...`;
    } else if (action === "EXECUTE_SLASHING") {
      rep.verdict = "VIOLATION";
      rep.currentStage = "COMPLETED";
      rep.stages[4].status = "PASSED";
      rep.txHash = simulatedHash;
      rep.penaltyEth = "0.0167 ETH (~$50 USD)";
      rep.burnAmountEth = "0.0133 ETH (80%)";
      rep.bountyAmountEth = "0.0033 ETH (20%)";
      rep.stages[4].details = `Slashing executado sob comando soberano humano. Hash: ${simulatedHash.slice(0, 14)}...`;
    }

    return rep;
  }
}
