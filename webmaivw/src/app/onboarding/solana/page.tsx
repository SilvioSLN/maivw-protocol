"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, RefreshCw, Server, ShieldCheck, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type OriginNetwork = {
  family: "SOLANA";
  networkId: string;
  registryId: string;
  name: string;
  programId: string;
  standardFee: string;
  standardFeeFormatted: string;
  asset: { kind: "SPL"; symbol: string; decimals: number; mint: string };
  explorer: { baseUrl: string; clusterQuery: string | null };
};

type Challenge = {
  challengeId: string;
  token: string;
  expiresAt: string;
  records: { txt: { host: string; value: string } };
};

type ClaimResult = {
  reservationId: string;
  origin: OriginNetwork;
  originClaim: { digest: string; deadline: string };
  transaction: { family: "SOLANA"; feePayer: string; requiredSigners: string[]; instructions: unknown[]; accounts: Record<string, string> };
  execution: { mode: "WALLET" | "RELAYER"; requiredSigner: string; relayerPaysNetworkFee: boolean; clientMustAuthorize: boolean };
};

const pubkeyPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default function SolanaOnboardingPage() {
  const { user, gatewayUrl } = useAuth();
  const [networks, setNetworks] = useState<OriginNetwork[]>([]);
  const [networkId, setNetworkId] = useState("");
  const [domain, setDomain] = useState("");
  const [registrant, setRegistrant] = useState("");
  const [tokenAccount, setTokenAccount] = useState("");
  const [operationalKey, setOperationalKey] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [mode, setMode] = useState<"WALLET" | "RELAYER">("WALLET");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const token = user?.token || (typeof window !== "undefined" ? localStorage.getItem("maivw_token") : "") || "";
  const selected = useMemo(() => networks.find((item) => item.networkId === networkId), [networks, networkId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlDomain = params.get("domain");
      if (urlDomain) {
        setDomain(urlDomain.trim().toLowerCase());
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`${gatewayUrl}/api/v1/onboarding/origin-networks`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar redes Solana");
        setNetworks(body.networks || []);
        setNetworkId((current) => current || body.networks?.[0]?.networkId || "");
      })
      .catch((cause) => setError(cause.message));
  }, [gatewayUrl, token]);

  function authHeaders() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  }

  async function createChallenge() {
    if (!domain.includes(".") || !pubkeyPattern.test(registrant) || !networkId) {
      setError("Informe domínio, rede e uma Pubkey Solana válida.");
      return;
    }
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch(`${gatewayUrl}/api/v1/onboarding/challenge`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ domainName: domain.trim().toLowerCase(), networkId, registrant }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || body.message || "Falha ao criar desafio");
      setChallenge(body);
      setEndpointUrl((current) => current || `https://mw-p2p.${domain.trim().toLowerCase()}/api/v1/inbox`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada"); }
    finally { setBusy(false); }
  }

  async function issueClaim() {
    if (!challenge) return;
    if (![registrant, tokenAccount, operationalKey, adminKey].every((key) => pubkeyPattern.test(key))) {
      setError("Registrant, conta SPL e chaves operacional/admin devem ser Pubkeys Solana válidas.");
      return;
    }
    try { new URL(endpointUrl); } catch { setError("Informe um endpoint HTTPS válido."); return; }
    setBusy(true); setError(null);
    try {
      const nonce = crypto.randomUUID();
      const response = await fetch(`${gatewayUrl}/api/v1/onboarding/origin-claim`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({
          challengeId: challenge.challengeId, token: challenge.token, endpointUrl,
          registrant, registrantTokenAccount: tokenAccount, operationalKey, adminKey,
          idempotencyKey: `ui-${challenge.challengeId}`, requestId: `ui-${nonce}`, executionMode: mode,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Falha ao emitir OriginClaim");
      setResult(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada"); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[#08090d] text-white px-4 py-8 md:py-12">
      <div className="max-w-5xl mx-auto space-y-6">
        <Link href="/onboarding" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white"><ArrowLeft className="w-4 h-4" />Voltar ao Onboarding</Link>
        <header className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-950/40 to-[#101118] p-6 md:p-9">
          <div className="text-xs font-bold tracking-[.18em] text-violet-300 uppercase">Origem canônica</div>
          <h1 className="mt-2 text-3xl font-bold">Registrar domínio na Solana</h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-400">A prova DNS fica vinculada à rede e à Pubkey escolhidas. O registro nasce na Solana e pode ser projetado depois em Base, Arbitrum, Polygon ou outra rede habilitada.</p>
        </header>

        <section className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-4">
            <h2 className="font-semibold">1. Origem, domínio e titular</h2>
            <label className="block text-xs text-neutral-400">Rede de origem
              <select value={networkId} onChange={(e) => { setNetworkId(e.target.value); setChallenge(null); }} className="mt-1 w-full rounded-xl border border-white/10 bg-[#11131a] p-3 text-sm text-white">
                {networks.map((item) => <option key={item.networkId} value={item.networkId}>{item.name}</option>)}
              </select>
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Domínio" value={domain} onChange={setDomain} placeholder="empresa.com" />
              <Field label="Pubkey do registrant" value={registrant} onChange={(value) => { setRegistrant(value); setChallenge(null); }} placeholder="Base58…" mono />
            </div>
            <button onClick={createChallenge} disabled={busy || !networkId} className="w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 px-4 py-3 text-sm font-bold flex justify-center gap-2">
              {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Gerar prova DNS vinculada
            </button>
          </div>
          <aside className="rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
            <div className="text-xs text-neutral-400">Custo do protocolo</div>
            <div className="text-2xl font-bold text-emerald-300 mt-1">{selected?.standardFeeFormatted || "—"}</div>
            <div className="mt-4 text-xs text-neutral-400">Ativo SPL</div>
            <div className="font-semibold mt-1">{selected?.asset.symbol || "—"}</div>
            <div className="font-mono text-[10px] text-neutral-500 break-all mt-1">{selected?.asset.mint}</div>
            <div className="mt-4 text-xs text-neutral-400">Program</div>
            <div className="font-mono text-[10px] text-neutral-300 break-all mt-1">{selected?.programId || "—"}</div>
          </aside>
        </section>

        {challenge && <section className="rounded-2xl border border-amber-500/25 bg-amber-950/10 p-5 space-y-4">
          <div className="flex items-center gap-2 text-amber-300 font-semibold"><CheckCircle2 className="w-4 h-4" />2. Publique o TXT e solicite a transação</div>
          <CopyRow label="Host" value={challenge.records.txt.host} onCopy={() => copy(challenge.records.txt.host, "host")} copied={copied === "host"} />
          <CopyRow label="Valor" value={challenge.records.txt.value} onCopy={() => copy(challenge.records.txt.value, "value")} copied={copied === "value"} />
          <p className="text-xs text-neutral-500">Expira em {new Date(challenge.expiresAt).toLocaleString("pt-BR")}. A API valida o quorum DNS antes de reservar a origem.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Conta SPL do registrant" value={tokenAccount} onChange={setTokenAccount} placeholder="Base58…" mono />
            <Field label="Endpoint P2P" value={endpointUrl} onChange={setEndpointUrl} placeholder="https://…" />
            <Field label="Chave operacional Ed25519" value={operationalKey} onChange={setOperationalKey} placeholder="Base58…" mono />
            <Field label="Chave administrativa Ed25519" value={adminKey} onChange={setAdminKey} placeholder="Base58…" mono />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Mode active={mode === "WALLET"} icon={<Wallet className="w-5 h-5" />} title="Carteira externa" text="Você paga a taxa de rede e assina como registrant." onClick={() => setMode("WALLET")} />
            <Mode active={mode === "RELAYER"} icon={<Server className="w-5 h-5" />} title="Relayer MAIVW" text="O relayer paga a taxa de rede; sua autorização continua obrigatória." onClick={() => setMode("RELAYER")} />
          </div>
          <button onClick={issueClaim} disabled={busy} className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50 px-4 py-3 text-sm font-bold flex justify-center gap-2">
            {busy && <RefreshCw className="w-4 h-4 animate-spin" />} Validar DNS e preparar registro
          </button>
        </section>}

        {result && <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-5 space-y-4">
          <div className="flex items-center gap-2 text-emerald-300 font-semibold"><CheckCircle2 className="w-5 h-5" />3. OriginClaim emitido — pronto para assinatura</div>
          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <Stat label="Execução" value={result.execution.mode === "RELAYER" ? "Relayer + autorização" : "Carteira externa"} />
            <Stat label="Instruções" value={String(result.transaction.instructions.length)} />
            <Stat label="Assinante obrigatório" value={result.transaction.requiredSigners[0]} mono />
          </div>
          <CopyRow label="Digest do OriginClaim" value={result.originClaim.digest} onCopy={() => copy(result.originClaim.digest, "digest")} copied={copied === "digest"} />
          <button onClick={() => copy(JSON.stringify(result.transaction, null, 2), "tx")} className="rounded-xl border border-white/10 px-4 py-2 text-xs hover:bg-white/5 inline-flex gap-2"><Copy className="w-4 h-4" />{copied === "tx" ? "Transação copiada" : "Copiar transação não assinada"}</button>
          <p className="text-xs text-neutral-400">A transação contém a verificação secp256k1 do oráculo seguida de <code>register_domain</code>. O cliente adiciona blockhash recente e a assinatura Ed25519 do registrant.</p>
          <a href={`${result.origin.explorer.baseUrl}/address/${result.origin.programId}${result.origin.explorer.clusterQuery || ""}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet-300">Abrir programa no explorer <ExternalLink className="w-3 h-3" /></a>
        </section>}

        {error && <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-300">{error}</div>}
      </div>
    </main>
  );
}

function Field({ label, value, onChange, placeholder, mono = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; mono?: boolean }) {
  return <label className="block text-xs text-neutral-400">{label}<input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={placeholder} className={`mt-1 w-full rounded-xl border border-white/10 bg-[#11131a] p-3 text-sm text-white ${mono ? "font-mono" : ""}`} /></label>;
}
function CopyRow({ label, value, onCopy, copied }: { label: string; value: string; onCopy: () => void; copied: boolean }) {
  return <div><div className="text-[11px] text-neutral-500 mb-1">{label}</div><div className="flex items-center gap-2 rounded-xl bg-black/30 border border-white/10 p-3"><code className="text-xs break-all flex-1">{value}</code><button onClick={onCopy} className="text-neutral-400 hover:text-white"><Copy className="w-4 h-4" /></button>{copied && <span className="text-[10px] text-emerald-400">copiado</span>}</div></div>;
}
function Mode({ active, icon, title, text, onClick }: { active: boolean; icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return <button onClick={onClick} className={`text-left rounded-xl border p-4 ${active ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-black/20"}`}><span className="flex items-center gap-2 font-semibold text-sm">{icon}{title}</span><span className="block mt-1 text-xs text-neutral-400">{text}</span></button>;
}
function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-neutral-500">{label}</div><div className={`mt-1 break-all text-neutral-200 ${mono ? "font-mono text-[10px]" : "font-semibold"}`}>{value}</div></div>;
}
