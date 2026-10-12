"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/Navigation";

interface CompanyProfile {
  domain: string;
  endpointUrl: string;
  publicKey: string;
  adminKey?: string;
  registrationTime: number;
  isProvider: boolean;
  isActive: boolean;
  strikeCount: number;
  status: number;
}

interface ReputationData {
  score?: number;
  reputation?: number;
  strikes?: number;
  status?: string;
  tier?: string;
}

interface WhoisResult {
  registered: boolean;
  domain: string;
  company?: CompanyProfile;
  reputation?: ReputationData;
}

interface ServiceHealth {
  gateway: "online" | "offline" | "loading";
  blockchain: "online" | "offline" | "loading";
  contractAddress?: string;
}

export default function CartorioPage() {
  const [queryInput, setQueryInput] = useState("");
  const [searchedDomain, setSearchedDomain] = useState<string | null>(null);
  const [result, setResult] = useState<WhoisResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Stats globais leves
  const [totalDomains, setTotalDomains] = useState<number | null>(null);
  const [health, setHealth] = useState<ServiceHealth>({ gateway: "loading", blockchain: "loading" });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const gatewayUrl = (process.env.NEXT_PUBLIC_GATEWAY_URL || "https://api-test.maivw.com").replace(/\/+$/, "");
  const chainId = process.env.NEXT_PUBLIC_CHAIN_ID || "84532";
  const chainName = chainId === "84532" ? "Base Sepolia" : chainId === "31337" ? "Anvil Local" : `Chain ${chainId}`;

  // Carrega status básico da rede
  const fetchGlobalStats = useCallback(async () => {
    try {
      const [healthRes, statsRes] = await Promise.all([
        fetch(`${gatewayUrl}/health`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${gatewayUrl}/api/v1/companies/stats`, { signal: AbortSignal.timeout(3000) }),
      ]);

      if (healthRes.ok) {
        const hData = await healthRes.json();
        setHealth({
          gateway: hData.status === "ok" ? "online" : "offline",
          blockchain: hData.services?.blockchain?.connected ? "online" : "offline",
          contractAddress: hData.services?.blockchain?.contractAddress,
        });
      }

      if (statsRes.ok) {
        const sData = await statsRes.json();
        setTotalDomains(sData.totalRegistered ?? 0);
      }
    } catch {
      // Ignora erro de telemetria
    }
  }, [gatewayUrl]);

  useEffect(() => {
    fetchGlobalStats();
  }, [fetchGlobalStats]);

  // Busca pontual por um domínio específico (Whois on-chain)
  const handleSearch = async (domainToSearch?: string) => {
    const raw = domainToSearch !== undefined ? domainToSearch : queryInput;
    const target = raw.toLowerCase().trim();

    if (!target) {
      setSearchError("Por favor, digite um domínio para consultar.");
      return;
    }

    if (!target.includes(".") || target.length < 3) {
      setSearchError("Formato de domínio inválido. Exemplo correto: empresa.com ou empresa.com.br");
      return;
    }

    setSearchError(null);
    setSearching(true);
    setSearchedDomain(target);
    setResult(null);

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/companies/${encodeURIComponent(target)}`, {
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        if (res.status === 404) {
          setResult({ registered: false, domain: target });
        } else {
          setSearchError(`Falha ao consultar registro no nó RPC (${res.status}). Tente novamente.`);
        }
        return;
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setSearchError("Tempo limite esgotado ou Gateway indisponível ao consultar a blockchain.");
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(type);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatDate = (timestamp: number) => {
    if (!timestamp || timestamp <= 0) return "—";
    // se timestamp estiver em segundos ou ms
    const ms = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
    return new Date(ms).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (company: CompanyProfile) => {
    if (company.status === 3) {
      return { label: "Banido por Fraude (Slashed)", color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", border: "rgba(239, 68, 68, 0.4)" };
    }
    if (company.status === 2) {
      return { label: "Suspenso", color: "#f97316", bg: "rgba(249, 115, 22, 0.15)", border: "rgba(249, 115, 22, 0.4)" };
    }
    if (!company.isActive) {
      return { label: "Inativo", color: "#6b7280", bg: "rgba(107, 114, 128, 0.15)", border: "rgba(107, 114, 128, 0.4)" };
    }

    const regMs = company.registrationTime < 10000000000 ? company.registrationTime * 1000 : company.registrationTime;
    const daysSince = (Date.now() - regMs) / (1000 * 60 * 60 * 24);

    if (daysSince < 30) {
      return { label: "Em Quarentena (< 30 dias)", color: "#f59e0b", bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.4)" };
    }

    return { label: "Ativo & Soberano", color: "#10b981", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.4)" };
  };

  return (
    <div className="container">
      <Navigation contractAddress={health.contractAddress} />

      <section>
        {/* Header do Cartório */}
        <div style={{ textAlign: "center", maxWidth: "760px", margin: "1rem auto 2.5rem auto" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.4rem 1rem", borderRadius: "999px", background: "rgba(59, 130, 246, 0.1)", border: "1px solid rgba(59, 130, 246, 0.3)", color: "#60a5fa", fontSize: "0.8rem", fontWeight: 600, marginBottom: "1rem" }}>
            <span>🏛️</span>
            <span>Registro Notarial &amp; Whois Criptográfico</span>
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em", marginBottom: "0.75rem" }}>
            Cartório On-Chain de Domínios
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6 }}>
            Consulte a autenticidade e a identidade criptográfica de qualquer remetente da rede MAIVW. Cada domínio é ancorado no Smart Contract <code>MAIVWRegistry</code> ({chainName}), eliminando spoofing e falsificação de e-mails.
          </p>
        </div>

        {/* Caixa de Busca Central — Estilo Whois */}
        <div
          style={{
            maxWidth: "760px",
            margin: "0 auto 2.5rem auto",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "1.5rem",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
          }}
        >
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: "1.1rem", top: "50%", transform: "translateY(-50%)", fontSize: "1.1rem", opacity: 0.6 }}>
                🌐
              </span>
              <input
                type="text"
                placeholder="Digite o domínio completo (ex.: empresa.com.br ou empresa.com)..."
                value={queryInput}
                onChange={(e) => {
                  setQueryInput(e.target.value);
                  if (searchError) setSearchError(null);
                }}
                onKeyDown={handleKeyDown}
                style={{
                  width: "100%",
                  background: "var(--bg-secondary)",
                  border: searchError ? "1px solid var(--danger)" : "1px solid var(--border)",
                  borderRadius: "12px",
                  padding: "0.9rem 1.25rem 0.9rem 2.8rem",
                  color: "#ffffff",
                  fontSize: "1rem",
                  outline: "none",
                  transition: "border 0.2s ease",
                }}
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={searching}
              className="btn btn-primary"
              style={{
                padding: "0.9rem 1.75rem",
                fontSize: "0.95rem",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                whiteSpace: "nowrap",
              }}
            >
              {searching ? (
                <>
                  <div className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                  <span>Consultando...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>Consultar</span>
                </>
              )}
            </button>
          </div>

          {searchError && (
            <div style={{ color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>⚠️</span>
              <span>{searchError}</span>
            </div>
          )}

          {/* Atalhos Rápidos para Testar */}
          <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Consultas de teste:</span>
            {["empresa.com.br", "maivw.com", "claude.ai", "google.com"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setQueryInput(d);
                  handleSearch(d);
                }}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "6px",
                  padding: "0.2rem 0.5rem",
                  fontSize: "0.75rem",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* ÁREA DE RESULTADOS DA CONSULTA */}
        {searching && (
          <div
            style={{
              maxWidth: "760px",
              margin: "0 auto",
              textAlign: "center",
              padding: "3.5rem 2rem",
              background: "var(--bg-card)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
            }}
          >
            <div className="spinner" style={{ margin: "0 auto 1.25rem auto", width: "36px", height: "36px" }} />
            <h3 style={{ fontSize: "1.1rem", color: "#ffffff", marginBottom: "0.5rem" }}>
              Consultando Smart Contract on-chain...
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Executando chamada RPC atômica para ler o registro notarial de <code>{searchedDomain}</code>.
            </p>
          </div>
        )}

        {/* DOMÍNIO NÃO REGISTRADO */}
        {!searching && result && !result.registered && (
          <div
            style={{
              maxWidth: "760px",
              margin: "0 auto",
              background: "rgba(239, 68, 68, 0.05)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: "16px",
              padding: "2.5rem 2rem",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
            <h3 style={{ fontSize: "1.35rem", color: "#f87171", fontWeight: 700, marginBottom: "0.5rem" }}>
              Domínio Não Registrado no Cartório MAIVW
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: "580px", margin: "0 auto 1.5rem auto", lineHeight: 1.6 }}>
              O domínio <strong>{result.domain}</strong> não possui identidade criptográfica, chave de assinatura de e-mail ou endpoint ancorado na blockchain ({chainName}).
            </p>

            <div
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                borderRadius: "12px",
                padding: "1rem 1.5rem",
                maxWidth: "540px",
                margin: "0 auto 1.75rem auto",
                textAlign: "left",
                fontSize: "0.85rem",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontWeight: 600, color: "#ffffff", marginBottom: "0.35rem" }}>
                🛡️ Consequências de segurança:
              </div>
              <ul style={{ paddingLeft: "1.2rem", margin: 0, lineHeight: 1.5 }}>
                <li>E-mails recebidos deste remetente não possuem validação soberana do protocolo.</li>
                <li>Este domínio não possui proteção anti-spoofing criptográfica nativa.</li>
              </ul>
            </div>

            <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
              <a
                href={`${(process.env.NEXT_PUBLIC_WEBMAIVW_URL || "http://localhost:52443").replace(/\/+$/, "")}/admin`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                style={{ padding: "0.75rem 1.5rem" }}
              >
                <span>Proteger este Domínio (Onboarding) →</span>
              </a>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setSearchedDomain(null);
                  setQueryInput("");
                }}
                className="btn btn-secondary"
                style={{ padding: "0.75rem 1.25rem" }}
              >
                Nova Consulta
              </button>
            </div>
          </div>
        )}

        {/* DOMÍNIO REGISTRADO — CERTIFICADO WHOIS */}
        {!searching && result && result.registered && result.company && (
          <div
            style={{
              maxWidth: "760px",
              margin: "0 auto",
              background: "var(--bg-card)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              borderRadius: "16px",
              padding: "2rem",
              boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.5)",
            }}
          >
            {/* Header do Certificado */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                paddingBottom: "1.5rem",
                borderBottom: "1px solid var(--border)",
                marginBottom: "1.5rem",
                flexWrap: "wrap",
                gap: "1rem",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <span style={{ fontSize: "1.5rem" }}>✅</span>
                  <h2 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#ffffff", margin: 0 }}>
                    {result.company.domain}
                  </h2>
                </div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                  Certificado Notarial Registrado na Blockchain ({chainName})
                </div>
              </div>

              {/* Status Badge */}
              {(() => {
                const badge = getStatusBadge(result.company);
                return (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      padding: "0.45rem 1rem",
                      borderRadius: "8px",
                      background: badge.bg,
                      border: `1px solid ${badge.border}`,
                      color: badge.color,
                      fontWeight: 700,
                      fontSize: "0.85rem",
                    }}
                  >
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: badge.color }} />
                    <span>{badge.label}</span>
                  </div>
                );
              })()}
            </div>

            {/* Reputação Semântica & Classificação */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "1rem",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Score de Reputação
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                  <span style={{ fontSize: "1.75rem", fontWeight: 800, color: "#10b981" }}>
                    {result.reputation?.reputation ?? result.reputation?.score ?? 100}
                  </span>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>/ 100</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "0.25rem" }}>
                  ⭐ Auditoria Contínua do Oráculo
                </div>
              </div>

              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Classificação da Entidade
                </div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#ffffff", marginTop: "0.35rem" }}>
                  {result.company.isProvider ? "🏢 Provedor Multi-Tenant" : "🏛️ Domínio Soberano"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {result.company.isProvider ? "Opera caixas postais para múltiplos usuários" : "Nó independente direto"}
                </div>
              </div>

              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Infrações &amp; Denúncias
                </div>
                <div style={{ fontSize: "1.75rem", fontWeight: 800, color: result.company.strikeCount > 0 ? "var(--danger)" : "var(--text-secondary)" }}>
                  {result.company.strikeCount} <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Strikes</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                  {result.company.strikeCount === 0 ? "Nenhuma penalidade registrada" : "Sujeito a suspensão se atingir 3"}
                </div>
              </div>
            </div>

            {/* Grade de Parâmetros Notariais Criptográficos */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.75rem" }}>
              {/* Chave Pública */}
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                    🔑 Chave Pública de Assinatura (ECDSA secp256k1)
                  </div>
                  {result.company.publicKey && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(result.company!.publicKey, "pubkey")}
                      style={{
                        background: "none",
                        border: "none",
                        color: copiedKey === "pubkey" ? "#10b981" : "#60a5fa",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {copiedKey === "pubkey" ? "Copiado! ✓" : "Copiar Chave"}
                    </button>
                  )}
                </div>
                <div className="mono" style={{ fontSize: "0.85rem", color: "#60a5fa", wordBreak: "break-all" }}>
                  {result.company.publicKey || "—"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  Utilizada para assinar criptograficamente cada mensagem enviada, garantindo não-repúdio sem depender de terceiros.
                </div>
              </div>

              {/* Chave Admin */}
              {result.company.adminKey && (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    borderRadius: "12px",
                    padding: "1rem 1.25rem",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                      👑 Carteira de Titularidade (Admin / Cold Key)
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(result.company!.adminKey!, "adminkey")}
                      style={{
                        background: "none",
                        border: "none",
                        color: copiedKey === "adminkey" ? "#10b981" : "#60a5fa",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {copiedKey === "adminkey" ? "Copiado! ✓" : "Copiar Endereço"}
                    </button>
                  </div>
                  <div className="mono" style={{ fontSize: "0.85rem", color: "#e2e8f0", wordBreak: "break-all" }}>
                    {result.company.adminKey}
                  </div>
                </div>
              )}

              {/* Endpoint P2P */}
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                  📡 Endpoint de Roteamento P2P
                </div>
                <div className="mono" style={{ fontSize: "0.85rem" }}>
                  {["PRIVATE", "STEALTH", "RESTRICTED"].includes((result.company.endpointUrl || "").toUpperCase()) ||
                  (result.company.endpointUrl || "").startsWith("stealth://") ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        background: "rgba(168, 85, 247, 0.15)",
                        color: "#c084fc",
                        border: "1px solid rgba(168, 85, 247, 0.35)",
                        padding: "0.25rem 0.6rem",
                        borderRadius: "6px",
                        fontWeight: 600,
                      }}
                    >
                      🛡️ Dark Endpoint (Roteamento Privado / Intranet Bilateral)
                    </span>
                  ) : (
                    <span style={{ color: "#34d399" }}>{result.company.endpointUrl || "—"}</span>
                  )}
                </div>
              </div>

              {/* Data de Registro */}
              <div
                style={{
                  background: "var(--bg-secondary)",
                  borderRadius: "12px",
                  padding: "1rem 1.25rem",
                  border: "1px solid var(--border)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                    📅 Registro Ancorado em
                  </div>
                  <div style={{ fontSize: "0.9rem", color: "#ffffff", fontWeight: 600, marginTop: "0.2rem" }}>
                    {formatDate(result.company.registrationTime)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setSearchedDomain(null);
                    setQueryInput("");
                  }}
                  className="btn btn-secondary"
                  style={{ fontSize: "0.8rem", padding: "0.5rem 1rem" }}
                >
                  Consultar Outro Domínio
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ESTADO INICIAL (SEM BUSCA FEITA) — EXPLICATIVO */}
        {!searching && !result && (
          <div
            style={{
              maxWidth: "760px",
              margin: "0 auto",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1.25rem",
            }}
          >
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "14px",
                padding: "1.5rem",
              }}
            >
              <div style={{ fontSize: "1.75rem", marginBottom: "0.75rem" }}>🔐</div>
              <h3 style={{ fontSize: "1rem", color: "#ffffff", fontWeight: 700, marginBottom: "0.5rem" }}>
                Identidade Soberana
              </h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                A autenticidade corporativa é atestada via registros DNS TXT e ancorada na blockchain, sem dependência de autoridades certificadoras frágeis.
              </p>
            </div>

            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "14px",
                padding: "1.5rem",
              }}
            >
              <div style={{ fontSize: "1.75rem", marginBottom: "0.75rem" }}>⚡</div>
              <h3 style={{ fontSize: "1rem", color: "#ffffff", fontWeight: 700, marginBottom: "0.5rem" }}>
                Imunidade a Spoofing
              </h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Se um e-mail for assinado com uma chave que não coincidir com a chave pública do Cartório, ele é descartado instantaneamente no Gateway.
              </p>
            </div>

            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "14px",
                padding: "1.5rem",
              }}
            >
              <div style={{ fontSize: "1.75rem", marginBottom: "0.75rem" }}>⚖️</div>
              <h3 style={{ fontSize: "1rem", color: "#ffffff", fontWeight: 700, marginBottom: "0.5rem" }}>
                Reputação Dinâmica
              </h3>
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Domínios maliciosos sofrem denúncias validadas pelo Oráculo com penalidades e Slashing de caução on-chain.
              </p>
            </div>
          </div>
        )}

        {/* Rodapé com Stats Rápidos do Protocolo */}
        <div
          style={{
            maxWidth: "760px",
            margin: "3rem auto 0 auto",
            paddingTop: "1.5rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div>
            Contrato <code>MAIVWRegistry</code>:{" "}
            <span style={{ color: "#60a5fa" }}>
              {health.contractAddress ? `${health.contractAddress.slice(0, 8)}...${health.contractAddress.slice(-6)}` : "—"}
            </span>{" "}
            ({chainName})
          </div>
          <div>
            Total de Domínios Ancorados: <strong style={{ color: "#ffffff" }}>{totalDomains ?? "—"}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
