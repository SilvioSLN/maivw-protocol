"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, LoaderCircle, Network, RefreshCw, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type NetworkInfo = {
  family: "EVM" | "SOLANA"; networkId: string; registryId: string; name: string;
  capabilities: { origin: boolean; mirror: boolean };
  asset: { symbol: string };
  explorer: { baseUrl: string; transactionPath: string; clusterQuery?: string | null };
  state: { status: "AVAILABLE" | "UNAVAILABLE"; errorCode: string | null };
};
type Destination = {
  destinationId: string; family: "EVM" | "SOLANA"; networkId: string; status: string;
  transaction: { family: "EVM" | "SOLANA"; id: string } | null;
  submission: { status: string; attempts: number } | null;
};
type MirrorJob = {
  jobId: string; operation: string; status: string; updatedAt: string;
  origin: { family: "EVM" | "SOLANA"; networkId: string; transaction: { family: "EVM" | "SOLANA"; id: string } };
  destinations: Destination[];
};

const phases = ["DETECTED", "FINALIZED", "ATTESTED", "SUBMITTED", "CONFIRMED", "RECONCILE"];

export default function MultichainAdminPage() {
  const { user, domains, gatewayUrl } = useAuth();
  const [domain, setDomain] = useState("");
  const [networks, setNetworks] = useState<NetworkInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [job, setJob] = useState<MirrorJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = user?.token || (typeof window !== "undefined" ? localStorage.getItem("maivw_token") : "") || "";

  useEffect(() => { if (!domain && domains[0]) setDomain(domains[0].domainName); }, [domain, domains]);
  useEffect(() => {
    fetch(`${gatewayUrl}/api/v1/multichain/networks`).then((response) => response.json())
      .then((body) => setNetworks(body.networks || [])).catch(() => setError("Falha ao carregar redes"));
  }, [gatewayUrl]);

  const available = useMemo(() => networks.filter((item) => item.capabilities.mirror), [networks]);
  const byId = useMemo(() => new Map(networks.map((item) => [item.networkId, item])), [networks]);

  async function loadJob(jobId: string, selectedDomain = domain) {
    const response = await fetch(`${gatewayUrl}/api/v1/multichain/jobs/${jobId}?domain=${encodeURIComponent(selectedDomain)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || body.error || "Falha ao consultar job");
    setJob(body.job);
    return body.job as MirrorJob;
  }

  useEffect(() => {
    if (!job || job.destinations.every((item) => ["RECONCILE", "ORPHANED", "COMPENSATION_REQUIRED"].includes(item.status))) return;
    const timer = window.setInterval(() => loadJob(job.jobId).catch((cause) => setError(cause.message)), 2500);
    return () => window.clearInterval(timer);
  }, [job?.jobId, domain, gatewayUrl, token]);

  async function startMirror() {
    if (!domain || selected.length === 0) { setError("Selecione um domínio e ao menos um destino."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${gatewayUrl}/api/v1/multichain/attest-mirror`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ domain, operation: "REGISTER", destinationNetworkIds: selected }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || body.error || "Falha ao iniciar espelhamento");
      await loadJob(body.job.jobId, domain);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha inesperada"); }
    finally { setBusy(false); }
  }

  function toggle(networkId: string) {
    setSelected((current) => current.includes(networkId) ? current.filter((item) => item !== networkId) : [...current, networkId]);
  }

  return <main className="min-h-screen bg-[#08090d] text-white px-4 py-8">
    <div className="max-w-6xl mx-auto space-y-6">
      <Link href="/admin" className="inline-flex gap-2 items-center text-sm text-neutral-400 hover:text-white"><ArrowLeft className="w-4 h-4" />Administração</Link>
      <header className="rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-950/30 to-[#101118] p-6 md:p-8">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[.18em] text-blue-300 font-bold"><Network className="w-4 h-4" />Controle multichain</div>
        <h1 className="text-3xl font-bold mt-2">Espelhar identidade</h1>
        <p className="text-sm text-neutral-400 mt-2">Selecione NetworkIds canônicos. O mesmo fluxo acompanha destinos EVM e Solana sem interpretar toda transação como hash <code>0x</code>.</p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-5">
        <label className="block text-xs text-neutral-400">Domínio verificado
          <select value={domain} onChange={(event) => { setDomain(event.target.value); setJob(null); }} className="mt-1 w-full rounded-xl border border-white/10 bg-[#11131a] p-3 text-sm text-white">
            {domains.map((item) => <option key={item.id} value={item.domainName}>{item.domainName}</option>)}
          </select>
        </label>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {available.map((item) => <button key={item.networkId} onClick={() => toggle(item.networkId)} disabled={item.state.status !== "AVAILABLE"}
            className={`text-left rounded-2xl border p-4 transition ${selected.includes(item.networkId) ? "border-blue-400 bg-blue-500/10" : "border-white/10 bg-black/20"} disabled:opacity-40`}>
            <div className="flex justify-between gap-2"><strong>{item.name}</strong><span className={`text-[10px] rounded-full px-2 py-1 ${item.family === "SOLANA" ? "bg-violet-500/20 text-violet-300" : "bg-blue-500/20 text-blue-300"}`}>{item.family}</span></div>
            <div className="font-mono text-[10px] text-neutral-500 break-all mt-2">{item.networkId}</div>
            <div className="text-xs text-neutral-400 mt-3">Ativo: {item.asset.symbol}</div>
          </button>)}
        </div>
        <button onClick={startMirror} disabled={busy || !domain || selected.length === 0} className="rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-3 text-sm font-bold inline-flex gap-2 items-center">
          {busy ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Criar job para {selected.length} destino(s)
        </button>
      </section>

      {job && <section className="rounded-2xl border border-white/10 bg-white/[.03] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs text-neutral-500">Job</div><code className="text-sm">{job.jobId}</code></div><button onClick={() => loadJob(job.jobId)} className="inline-flex gap-2 items-center text-xs border border-white/10 rounded-xl px-3 py-2"><RefreshCw className="w-3 h-3" />Atualizar</button></div>
        <div className="space-y-4">{job.destinations.map((destination) => {
          const network = byId.get(destination.networkId);
          const current = Math.max(0, phases.indexOf(destination.status));
          return <article key={destination.destinationId} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex justify-between gap-3"><div><strong>{network?.name || destination.networkId}</strong><div className="text-[10px] font-mono text-neutral-500">{destination.networkId}</div></div><span className="text-xs text-blue-300">{destination.status}</span></div>
            <div className="grid grid-cols-6 gap-1 mt-4">{phases.map((phase, index) => <div key={phase}><div className={`h-1 rounded ${index <= current ? "bg-blue-400" : "bg-white/10"}`} /><div className="hidden sm:block text-[9px] text-neutral-500 mt-1 truncate">{phase}</div></div>)}</div>
            {destination.transaction && <TransactionLink network={network} transaction={destination.transaction} />}
            {!destination.transaction && <div className="mt-3 text-xs text-neutral-500 inline-flex gap-2 items-center"><LoaderCircle className="w-3 h-3 animate-spin" />Aguardando submissão do relayer</div>}
            {destination.submission && <div className="mt-2 text-[11px] text-neutral-500">Submissão {destination.submission.status} · {destination.submission.attempts} tentativa(s)</div>}
          </article>;
        })}</div>
      </section>}
      {error && <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-300">{error}</div>}
    </div>
  </main>;
}

function TransactionLink({ network, transaction }: { network?: NetworkInfo; transaction: { family: "EVM" | "SOLANA"; id: string } }) {
  const href = network ? `${network.explorer.baseUrl}${network.explorer.transactionPath.replace("{id}", transaction.id)}${network.explorer.clusterQuery || ""}` : undefined;
  return <div className="mt-3 rounded-xl bg-black/30 p-3 text-xs"><div className="text-neutral-500">{transaction.family === "SOLANA" ? "Assinatura Solana" : "Hash EVM"}</div>{href ? <a href={href} target="_blank" rel="noreferrer" className="font-mono break-all text-blue-300 inline-flex gap-1 items-center">{transaction.id}<ExternalLink className="w-3 h-3 shrink-0" /></a> : <code className="break-all">{transaction.id}</code>}</div>;
}
