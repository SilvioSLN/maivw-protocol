"use client";
import { runtimePublicValue } from "@/lib/runtime-public-config";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Navigation } from "@/components/Navigation";

interface NodeTelemetry {
  domain: string;
  nodeMode: "independent" | "managed";
  wallet: {
    address: string;
    balanceEth: string;
    isIndependent: boolean;
  } | null;
  reputation: {
    score: number | null;
    strikes: number;
    maxStrikes: number;
    isActive: boolean | null;
    isProvider: boolean | null;
    publicKey: string;
    status: string;
    contractAddress: string;
    chainName: string;
  };
  traffic: {
    totalProcessed: number;
    totalReceived: number;
    totalSent: number;
    validSignatures: number;
    spoofingBlocked: number;
    cryptographicSuccessRate: string | null;
    p2pDeliveryRate: string | null;
    queuePending: number | null;
    avgLatencyMs: number | null;
  };
  trafficHistory: Array<{
    time: string;
    legitimate: number;
    threats: number;
  }>;
  securityEvents: Array<{
    id: string;
    timestamp: string;
    from: string;
    to: string;
    originIp: string;
    reason: string;
    action: "bloqueado" | "quarentena" | "descartado";
  }>;
  systemHealth: {
    gateway: "online" | "offline";
    blockchain: "online" | "offline";
    redis: "online" | "offline" | "unknown";
    postgres: "online" | "offline";
    blockNumber: number | null;
    rpcLatencyMs: number;
    contractAddress?: string;
    chainName?: string;
  };
}

const formatNumber = (value: number | null) =>
  value === null || !Number.isFinite(value) ? "—" : value.toLocaleString("pt-BR");

const formatMetric = (value: string | null) => value ?? "não instrumentado";

export default function OverviewPage() {
  const [telemetry, setTelemetry] = useState<NodeTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedContract, setCopiedContract] = useState(false);

  const gatewayUrl = (runtimePublicValue('NEXT_PUBLIC_GATEWAY_URL') || "http://localhost:51443").replace(/\/+$/, "");

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/node/telemetry`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data: NodeTelemetry = await res.json();
        setTelemetry(data);
      }
    } catch {
      // Fallback gracioso se a rota ainda não respondeu ou em caso de timeout
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl]);

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 6000);
    return () => clearInterval(interval);
  }, [fetchTelemetry]);

  // Estado neutro enquanto a telemetria real ainda não está disponível.
  const data: NodeTelemetry = telemetry || {
    domain: loading ? "carregando..." : "indisponível",
    nodeMode: "independent",
    wallet: null,
    reputation: {
      score: null,
      strikes: 0,
      maxStrikes: 3,
      isActive: null,
      isProvider: null,
      publicKey: "",
      status: loading ? "consultando" : "indisponível",
      contractAddress: "",
      chainName: "EVM",
    },
    traffic: {
      totalProcessed: 0,
      totalReceived: 0,
      totalSent: 0,
      validSignatures: 0,
      spoofingBlocked: 0,
      cryptographicSuccessRate: null,
      p2pDeliveryRate: null,
      queuePending: null,
      avgLatencyMs: null,
    },
    trafficHistory: [],
    securityEvents: [],
    systemHealth: {
      gateway: "offline",
      blockchain: "offline",
      redis: "unknown",
      postgres: "offline",
      blockNumber: null,
      rpcLatencyMs: 0,
    },
  };

  const copyKey = () => {
    if (data.reputation.publicKey) {
      navigator.clipboard.writeText(data.reputation.publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const copyContract = () => {
    const contract = data.systemHealth.contractAddress || data.reputation.contractAddress;
    if (contract) {
      navigator.clipboard.writeText(contract);
      setCopiedContract(true);
      setTimeout(() => setCopiedContract(false), 2000);
    }
  };

  // Cálculos do Gráfico SVG
  const trafficHistory = Array.isArray(data.trafficHistory)
    ? data.trafficHistory.filter(
        (entry) => Number.isFinite(entry.legitimate) && Number.isFinite(entry.threats)
      )
    : [];
  const securityEvents = Array.isArray(data.securityEvents) ? data.securityEvents : [];
  const maxVal = Math.max(...trafficHistory.map((d) => Math.max(d.legitimate, d.threats * 10)), 100);
  const chartWidth = 720;
  const chartHeight = 160;
  const paddingX = 40;
  const paddingY = 25;

  const pointX = (index: number) =>
    trafficHistory.length === 1
      ? chartWidth / 2
      : paddingX + (index / Math.max(trafficHistory.length - 1, 1)) * (chartWidth - paddingX * 2);

  const pointsLegit = trafficHistory.map((d, i) => {
    const x = pointX(i);
    const y = chartHeight - paddingY - (d.legitimate / maxVal) * (chartHeight - paddingY * 2);
    return { x, y, ...d };
  });

  const pointsThreats = trafficHistory.map((d, i) => {
    const x = pointX(i);
    const y = chartHeight - paddingY - ((d.threats * 10) / maxVal) * (chartHeight - paddingY * 2);
    return { x, y, ...d };
  });

  const pathLegit = pointsLegit.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");
  const areaLegit = pointsLegit.length > 1
    ? `${pathLegit} L ${pointsLegit[pointsLegit.length - 1].x} ${chartHeight - paddingY} L ${pointsLegit[0].x} ${chartHeight - paddingY} Z`
    : "";
  const pathThreats = pointsThreats.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), "");

  return (
    <div className="container">
      <Navigation contractAddress={data.systemHealth.contractAddress} />

      {/* Hero / Banner Principal do Nó Local */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(30, 8, 8, 0.9) 0%, rgba(15, 4, 4, 0.95) 100%)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          padding: "2rem 2.5rem",
          marginBottom: "2rem",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: "380px",
            height: "100%",
            background: "radial-gradient(circle at top right, rgba(125,0,0,0.3) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative", zIndex: 1, maxWidth: "780px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                background: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
              }}
            >
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981" }} />
              {data.systemHealth.gateway === "online" ? "Nó Local Operacional" : loading ? "Consultando Nó Local" : "Nó Local Indisponível"}
            </span>

            <span
              style={{
                fontSize: "0.7rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                background: "rgba(125, 0, 0, 0.3)",
                color: "#ff6b6b",
                padding: "0.2rem 0.6rem",
                borderRadius: "999px",
                border: "1px solid rgba(125, 0, 0, 0.5)",
                fontWeight: 700,
              }}
            >
              Domínio: {data.domain}
            </span>
          </div>

          <h1 style={{ fontSize: "2rem", fontWeight: 800, color: "#ffffff", letterSpacing: "-0.03em", lineHeight: 1.2 }}>
            Observabilidade do Nó Local MAIVW
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginTop: "0.75rem", lineHeight: 1.6 }}>
            Telemetria em tempo real do seu servidor de e-mail soberano: fluxo de mensagens corporativas, escudo ativo anti-spoofing, reputação criptográfica do domínio e integridade perante o Cartório On-Chain.
          </p>
        </div>

        {/* Footer do Hero com Contrato e BaseScan */}
        {data.systemHealth.contractAddress && (
          <div
            style={{
              marginTop: "1.5rem",
              paddingTop: "1.25rem",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Smart Contract Cartório:
              </span>
              <code
                style={{
                  fontSize: "0.8rem",
                  fontFamily: "monospace",
                  background: "rgba(0,0,0,0.5)",
                  padding: "0.25rem 0.6rem",
                  borderRadius: "6px",
                  color: "#f5eded",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {data.systemHealth.contractAddress}
              </code>
              <button
                onClick={copyContract}
                style={{
                  background: "transparent",
                  border: "none",
                  color: copiedContract ? "#10b981" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                }}
              >
                {copiedContract ? "✓ Copiado" : "📋 Copiar"}
              </button>
            </div>

            {data.systemHealth.chainName === "Base Sepolia" ? (
              <a
                href={`https://sepolia.basescan.org/address/${data.systemHealth.contractAddress}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "0.75rem", color: "#60a5fa", textDecoration: "none" }}
              >
                Ver no BaseScan ↗
              </a>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Contrato da rede local</span>
            )}
          </div>
        )}
      </div>

      {/* Grid com os 4 Novos KPIs Estratégicos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
        {/* KPI 1: E-mails Processados Hoje */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              E-mails Processados Hoje
            </span>
            <span style={{ fontSize: "1.2rem" }}>📨</span>
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#ffffff" }}>
            {formatNumber(data.traffic.totalProcessed)}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {data.traffic.totalReceived} recebidos • {data.traffic.totalSent} enviados
          </span>
        </div>

        {/* KPI 2: Escudo Anti-Spoofing */}
        <div className="card" style={{ padding: "1.25rem", borderLeft: "3px solid #ef4444" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Ataques &amp; Spoofing Barrados
            </span>
            <span style={{ fontSize: "1.2rem" }}>🛡️</span>
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#ef4444" }}>
            {data.traffic.spoofingBlocked} bloqueados
          </div>
          <span style={{ fontSize: "0.75rem", color: "#10b981", fontWeight: 600 }}>
            Taxa de Proteção: {formatMetric(data.traffic.cryptographicSuccessRate)}
          </span>
        </div>

        {/* KPI 3: Reputação On-Chain */}
        <div className="card" style={{ padding: "1.25rem", borderLeft: "3px solid #10b981" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Reputação On-Chain
            </span>
            <span style={{ fontSize: "1.2rem" }}>⚖️</span>
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#10b981" }}>
            {data.reputation.score === null ? "—" : `${data.reputation.score} / 100`}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {data.reputation.strikes} de 3 strikes • Nível {data.reputation.status}
          </span>
        </div>

        {/* KPI 4: Roteamento & Latência P2P */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Túnel &amp; Fila P2P
            </span>
            <span style={{ fontSize: "1.2rem" }}>⚡</span>
          </div>
          <div style={{ fontSize: "1.8rem", fontWeight: 800, color: "#60a5fa" }}>
            {data.traffic.avgLatencyMs === null ? "—" : `${data.traffic.avgLatencyMs} ms`}
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            Fila: {formatNumber(data.traffic.queuePending)} pendentes • {formatMetric(data.traffic.p2pDeliveryRate)}
          </span>
        </div>
      </div>

      {/* Seção Combinada: Gráfico de Tráfego 24h & Feed de Segurança */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "1.5rem", marginBottom: "2rem" }}>
        {/* Card do Gráfico */}
        <div className="card" style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff" }}>
                Fluxo de Mensagens &amp; Atividade do Escudo (Últimas 24h)
              </h2>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px" }}>
                Comparativo de volume entre entregas válidas verificadas e tentativas maliciosas barradas
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", fontSize: "0.8rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#10b981" }} />
                <span style={{ color: "var(--text-secondary)" }}>Entregas Legítimas</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span style={{ width: "10px", height: "10px", borderRadius: "2px", background: "#ef4444" }} />
                <span style={{ color: "var(--text-secondary)" }}>Ataques Barrados</span>
              </div>
            </div>
          </div>

          {/* Gráfico SVG Responsivo */}
          <div style={{ width: "100%", overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              style={{ width: "100%", height: "auto", minWidth: "500px", maxHeight: "190px" }}
            >
              <defs>
                <linearGradient id="legitGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Linhas de Grade Horizontais */}
              <line x1={paddingX} y1={paddingY} x2={chartWidth - paddingX} y2={paddingY} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
              <line x1={paddingX} y1={chartHeight / 2} x2={chartWidth - paddingX} y2={chartHeight / 2} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
              <line x1={paddingX} y1={chartHeight - paddingY} x2={chartWidth - paddingX} y2={chartHeight - paddingY} stroke="rgba(255,255,255,0.12)" />

              {trafficHistory.length === 0 ? (
                <text x={chartWidth / 2} y={chartHeight / 2} fill="var(--text-muted)" fontSize="12" textAnchor="middle">
                  Ainda não há histórico de tráfego instrumentado.
                </text>
              ) : (
                <>
                  {areaLegit && <path d={areaLegit} fill="url(#legitGradient)" />}
                  <path d={pathLegit} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
                  <path d={pathThreats} fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="4 2" strokeLinecap="round" />
                </>
              )}

              {/* Pontos com Labels */}
              {pointsLegit.map((p, i) => (
                <g key={`point-${i}`}>
                  <circle cx={p.x} cy={p.y} r="3.5" fill="#10b981" stroke="#080202" strokeWidth="1.5" />
                  <text
                    x={p.x}
                    y={chartHeight - 6}
                    fill="var(--text-muted)"
                    fontSize="10"
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {p.time}
                  </text>
                </g>
              ))}

              {pointsThreats.map((p, i) => (
                <circle key={`threat-${i}`} cx={p.x} cy={p.y} r="3" fill="#ef4444" stroke="#080202" strokeWidth="1" />
              ))}
            </svg>
          </div>
        </div>

        {/* Tabela de Eventos Recentes de Segurança */}
        <div className="card" style={{ padding: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff" }}>
                🚨 Log de Auditoria &amp; Escudo Anti-Spoofing
              </h2>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "2px" }}>
                Últimas tentativas maliciosas e falhas criptográficas neutralizadas na fronteira do nó
              </p>
            </div>
            <span
              style={{
                fontSize: "0.7rem",
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                padding: "0.2rem 0.5rem",
                borderRadius: "6px",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                fontWeight: 700,
              }}
            >
              Proteção Ativa
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.825rem", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "var(--text-muted)" }}>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Horário</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Remetente Forjado</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Destinatário Alvo</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Origem IP</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600 }}>Motivo do Bloqueio</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 600, textAlign: "right" }}>Ação Tomada</th>
                </tr>
              </thead>
              <tbody>
                {securityEvents.map((evt) => (
                  <tr
                    key={evt.id}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      transition: "background 0.2s",
                    }}
                  >
                    <td style={{ padding: "0.65rem 0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                      {evt.timestamp}
                    </td>
                    <td style={{ padding: "0.65rem 0.75rem", fontFamily: "monospace", color: "#f87171" }}>
                      {evt.from}
                    </td>
                    <td style={{ padding: "0.65rem 0.75rem", color: "var(--text-secondary)", fontFamily: "monospace" }}>
                      {evt.to}
                    </td>
                    <td style={{ padding: "0.65rem 0.75rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {evt.originIp}
                    </td>
                    <td style={{ padding: "0.65rem 0.75rem", color: "var(--text-primary)" }}>
                      {evt.reason}
                    </td>
                    <td style={{ padding: "0.65rem 0.75rem", textAlign: "right" }}>
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          background:
                            evt.action === "bloqueado"
                              ? "rgba(239, 68, 68, 0.2)"
                              : evt.action === "descartado"
                              ? "rgba(125, 0, 0, 0.3)"
                              : "rgba(245, 158, 11, 0.2)",
                          color:
                            evt.action === "bloqueado"
                              ? "#f87171"
                              : evt.action === "descartado"
                              ? "#fca5a5"
                              : "#fbbf24",
                          border:
                            evt.action === "bloqueado"
                              ? "1px solid rgba(239, 68, 68, 0.4)"
                              : evt.action === "descartado"
                              ? "1px solid rgba(125, 0, 0, 0.5)"
                              : "1px solid rgba(245, 158, 11, 0.4)",
                        }}
                      >
                        {evt.action}
                      </span>
                    </td>
                  </tr>
                ))}
                {securityEvents.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "1.25rem", color: "var(--text-muted)", textAlign: "center" }}>
                      Nenhum evento de segurança instrumentado até o momento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Card de Reputação & Chave Criptográfica On-Chain */}
      <div className="card" style={{ padding: "1.5rem", marginBottom: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff" }}>
            ⚖️ Reputação &amp; Conformidade no Cartório On-Chain
          </h2>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Link
              href="/cartorio"
              style={{
                fontSize: "0.75rem",
                color: "#f5eded",
                background: "rgba(255,255,255,0.08)",
                padding: "0.3rem 0.7rem",
                borderRadius: "6px",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              Auditar no Cartório ↗
            </Link>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
          {/* Coluna 1: Status do Domínio */}
          <div style={{ background: "rgba(0,0,0,0.3)", padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Status da Identidade
            </span>
            <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#ffffff" }}>
                {data.domain}
              </span>
              <span style={{ fontSize: "0.7rem", background: "rgba(16,185,129,0.2)", color: "#10b981", padding: "0.1rem 0.4rem", borderRadius: "4px", fontWeight: 700 }}>
                {data.reputation.status}
              </span>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              {data.reputation.isActive === null
                ? `Perfil ainda não confirmado na blockchain (${data.reputation.chainName}).`
                : data.reputation.isActive
                  ? `Domínio verificado com chave criptográfica ancorada na blockchain (${data.reputation.chainName}).`
                  : `Domínio suspenso na blockchain (${data.reputation.chainName}).`}
            </p>
          </div>

          {/* Coluna 2: Chave ECDSA Ativa */}
          <div style={{ background: "rgba(0,0,0,0.3)", padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Chave ECDSA Pública Ativa
            </span>
            <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <code style={{ fontSize: "0.8rem", color: "#60a5fa", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {data.reputation.publicKey || "Chave ainda não disponível"}
              </code>
              <button
                onClick={copyKey}
                style={{
                  background: "transparent",
                  border: "none",
                  color: copiedKey ? "#10b981" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {copiedKey ? "✓" : "📋"}
              </button>
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              Usada para assinar e-mails de saída e atestar a identidade soberana da empresa.
            </p>
          </div>

          {/* Coluna 3: Strikes & Alerta de Suspensão */}
          <div style={{ background: "rgba(0,0,0,0.3)", padding: "1rem", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Strikes &amp; Histórico de Infrações
            </span>
            <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  style={{
                    padding: "0.2rem 0.6rem",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    background: s <= data.reputation.strikes ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.15)",
                    color: s <= data.reputation.strikes ? "#ef4444" : "#10b981",
                    border: `1px solid ${s <= data.reputation.strikes ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.3)"}`,
                  }}
                >
                  Strike {s}: {s <= data.reputation.strikes ? "Ativo" : "Limpo"}
                </div>
              ))}
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.5rem" }}>
              {data.reputation.isActive === null
                ? "Situação de conformidade ainda não confirmada pela rede."
                : data.reputation.isActive && data.reputation.strikes === 0
                  ? "Nenhum risco de suspensão. O domínio opera em conformidade total com a rede."
                  : data.reputation.isActive
                    ? "Há infrações registradas; acompanhe os strikes antes do limite de suspensão."
                    : "O domínio está suspenso na rede."}
            </p>
          </div>
        </div>
      </div>

      {/* Telemetria de Infraestrutura do Nó Local */}
      <div style={{ marginBottom: "2rem" }}>
        <h2 className="section-title" style={{ marginBottom: "1rem" }}>
          <span>Saúde dos Serviços da Infraestrutura Local</span>
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <div className="card" style={{ padding: "1.15rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Gateway API (Fastify)
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: data.systemHealth.gateway === "online" ? "#10b981" : "#ef4444", boxShadow: data.systemHealth.gateway === "online" ? "0 0 10px #10b981" : "0 0 10px #ef4444" }} />
              <span style={{ fontWeight: 700, color: "#ffffff", fontSize: "0.95rem", textTransform: "capitalize" }}>
                {data.systemHealth.gateway} (Port 3001)
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: "1.15rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Nó Blockchain ({data.systemHealth.chainName || "EVM"})
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: data.systemHealth.blockchain === "online" ? "#10b981" : "#ef4444", boxShadow: data.systemHealth.blockchain === "online" ? "0 0 10px #10b981" : "0 0 10px #ef4444" }} />
              <span style={{ fontWeight: 700, color: "#ffffff", fontSize: "0.95rem" }}>
                Bloco #{data.systemHealth.blockNumber || "—"} ({data.systemHealth.rpcLatencyMs}ms)
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: "1.15rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Redis Cache &amp; Rate Limit
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: data.systemHealth.redis === "online" ? "#10b981" : "#ef4444", boxShadow: data.systemHealth.redis === "online" ? "0 0 10px #10b981" : "0 0 10px #ef4444" }} />
              <span style={{ fontWeight: 700, color: "#ffffff", fontSize: "0.95rem" }}>
                {data.systemHealth.redis} (Token Bucket)
              </span>
            </div>
          </div>

          <div className="card" style={{ padding: "1.15rem" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
              Banco PostgreSQL
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: data.systemHealth.postgres === "online" ? "#10b981" : "#ef4444", boxShadow: data.systemHealth.postgres === "online" ? "0 0 10px #10b981" : "0 0 10px #ef4444" }} />
              <span style={{ fontWeight: 700, color: "#ffffff", fontSize: "0.95rem" }}>
                {data.systemHealth.postgres} (Port 5432)
              </span>
            </div>
          </div>

          {/* Saldo da Carteira: Apenas se instalação independente direta com a rede cripto */}
          {data.wallet?.isIndependent && (
            <div className="card" style={{ padding: "1.15rem", borderLeft: "3px solid #f59e0b" }}>
              <span style={{ fontSize: "0.75rem", color: "#f59e0b", textTransform: "uppercase", fontWeight: 700 }}>
                Saldo Hot Wallet (Gas)
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.4rem" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 10px #f59e0b" }} />
                <span style={{ fontWeight: 800, color: "#f59e0b", fontSize: "1.05rem" }}>
                  {data.wallet.balanceEth}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Áreas de Acesso Rápido: Cartório & WebMaivw */}
      <div style={{ marginBottom: "2rem" }}>
        <h2 className="section-title" style={{ marginBottom: "1rem" }}>
          <span>Módulos de Acesso do Operador</span>
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.25rem" }}>
          {/* Card Cartório */}
          <Link
            href="/cartorio"
            style={{
              textDecoration: "none",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              transition: "all 0.2s ease",
            }}
          >
            <div>
              <div style={{ fontSize: "1.8rem", marginBottom: "0.75rem" }}>🏛️</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff", marginBottom: "0.5rem" }}>
                Cartório &amp; Domínios (Explorer Global)
              </h3>
              <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Consulte todos os domínios registrados na rede pública, resolva chaves secp256k1 de parceiros comerciais e audite o histórico no explorador on-chain.
              </p>
            </div>
            <div style={{ marginTop: "1.25rem", fontSize: "0.8rem", fontWeight: 600, color: "#ff6b6b", display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>Explorar Cartório On-Chain</span>
              <span>→</span>
            </div>
          </Link>

          {/* Card WebMaivw */}
          <a
            href={runtimePublicValue('NEXT_PUBLIC_WEBMAIVW_URL') || "http://localhost:52443"}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              textDecoration: "none",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              transition: "all 0.2s ease",
            }}
          >
            <div>
              <div style={{ fontSize: "1.8rem", marginBottom: "0.75rem" }}>✉️</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff", marginBottom: "0.5rem" }}>
                WebMaivw &amp; Administração do Domínio
              </h3>
              <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Acesse sua caixa postal corporativa descentralizada, gerencie contas locais de e-mail, configure chaves de API e apontamentos de infraestrutura.
              </p>
            </div>
            <div style={{ marginTop: "1.25rem", fontSize: "0.8rem", fontWeight: 600, color: "#10b981", display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>Abrir WebMaivw Admin</span>
              <span>↗</span>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
