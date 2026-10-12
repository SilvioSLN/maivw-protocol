"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Inbox as InboxIcon,
  Send,
  AlertOctagon,
  Key,
  Settings,
  Plus,
  ShieldCheck,
  Search,
  AlertTriangle,
  Mail,
  ChevronDown,
  ChevronUp,
  Gavel,
  RefreshCw,
  LogOut,
  ExternalLink,
  CheckCircle2,
  Trash2,
  Reply,
  Forward,
  History,
  Paperclip,
  Download,
  FileText,
  FileCode,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  Sun,
  Moon,
} from "lucide-react";
import ComposerModal from "@/components/ComposerModal";
import SignatureBuilderModal from "@/components/SignatureBuilderModal";
import { EmailContentViewer } from "@/components/EmailContentViewer";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

// === Mapeamento humano das categorias ===
const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  TX_CODE: { label: "Verificação", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  TX_RECEIPT: { label: "Comprovante", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  SUPPORT: { label: "Suporte", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  CONVERSATION: { label: "Conversa", color: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
  MARKETING: { label: "Marketing", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
  COLD_OUTREACH: { label: "Prospecção", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  UNVERIFIED_LEGACY: { label: "E-mail Externo", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
};

const FILTER_TABS = [
  { key: "ALL", label: "Todos" },
  { key: "TX_CODE", label: "Verificação" },
  { key: "SUPPORT", label: "Suporte" },
  { key: "MARKETING", label: "Marketing" },
] as const;

type FolderType = "inbox" | "sent" | "spam" | "trash";

interface EmailAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  url: string;
}

interface EmailMessage {
  id: string;
  sender: string;
  subIdentity?: string;
  to: string;
  subject: string;
  preview: string;
  fullText: string;
  msgClass: string;
  status: string;
  date: string;
  rawDate: number;
  signature: string;
  intentTx: string;
  isRead: boolean;
  isWeb3: boolean;
  isRevoked?: boolean;
  revocationReason?: string;
  html?: string;
  attachments?: EmailAttachment[];
}

interface EmailThread {
  threadKey: string;
  canonicalSubject: string;
  latestEmail: EmailMessage;
  emails: EmailMessage[];
  count: number;
}

/**
 * Renderiza o corpo do e-mail neutralizando links e URLs caso o remetente tenha sido revogado por fraude on-chain.
 */
function renderEmailBodyText(text: string, isRevoked?: boolean): React.ReactNode {
  if (!text) return null;
  if (!isRevoked) {
    return text;
  }
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (part.match(/^https?:\/\//i)) {
      return (
        <span
          key={i}
          className="inline-flex items-center gap-1 line-through text-rose-300 font-mono bg-rose-950/80 px-2 py-0.5 rounded border border-rose-700/80 text-xs mx-1 cursor-not-allowed select-none"
          title="Link desativado: domínio remetente foi revogado por fraude on-chain"
        >
          <AlertOctagon className="w-3 h-3 text-rose-400 inline shrink-0" />
          <span>[LINK DESATIVADO POR SEGURANÇA]</span>
        </span>
      );
    }
    return part;
  });
}

/**
 * Separa a resposta da mensagem original citada no histórico e extrai JSON de rich email/attachments
 */
function parseEmailBody(rawBody: string): {
  main: string;
  quote: string;
  hasQuote: boolean;
  html?: string;
  attachments: EmailAttachment[];
} {
  let text = rawBody;
  let html: string | undefined = undefined;
  let attachments: EmailAttachment[] = [];

  if (rawBody.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed === "object" && parsed !== null) {
        text = parsed.text || parsed.body || "";
        html = parsed.html;
        if (Array.isArray(parsed.attachments)) {
          attachments = parsed.attachments;
        }
      }
    } catch {
      // Ignora erro de JSON e usa texto puro
    }
  }

  // Se não foi identificado html explícito, verifica se o conteúdo bruto é HTML
  if (!html && text) {
    const trimmed = text.trim();
    const isDocHtml = trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<body");
    const hasTagPattern = /<\s*(p|div|table|tr|td|th|tbody|h[1-6]|span|a|ul|ol|li|br|hr|img|b|strong|i|em)\b[^>]*>/i.test(trimmed);
    if (isDocHtml || hasTagPattern) {
      html = text;
      // Normaliza versão em texto para quotes e previews
      text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
                 .replace(/<[^>]+>/g, " ")
                 .replace(/\s+/g, " ")
                 .trim();
    }
  }

  const lines = text.split("\n");
  const quoteMarkers = [
    "--- Mensagem Original ---",
    "---------- Mensagem Encaminhada ----------",
    "--- Em ",
  ];

  let firstQuoteIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (quoteMarkers.some((marker) => lines[i].includes(marker)) || lines[i].startsWith(">")) {
      firstQuoteIndex = i;
      break;
    }
  }

  if (firstQuoteIndex > 0) {
    const main = lines.slice(0, firstQuoteIndex).join("\n").trim();
    const quote = lines.slice(firstQuoteIndex).join("\n").trim();
    if (main.length > 0) {
      return { main, quote, hasQuote: true, html, attachments };
    }
  }

  return { main: text, quote: "", hasQuote: false, html, attachments };
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Prepara o HTML original para encaminhamento/resposta:
 * - Neutraliza media queries de modo escuro (@media prefers-color-scheme: dark) para não quebrar estilos em fundo claro.
 * - Extrai regras de <style> de <head> e atributos de <body> (fontes, cores, estilos inline) e converte em container <div> válido.
 * - Remove tags estruturais duplicadas (<!DOCTYPE>, <html>, <head>, <body>).
 */
function sanitizeHtmlForForward(rawHtml: string): string {
  if (!rawHtml) return "";

  // 1. Neutraliza media query de modo escuro para preservar a paleta de cores original no papel claro
  let cleaned = rawHtml.replace(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi,
    "@media not all and (prefers-color-scheme: dark)"
  );

  // 2. Extrai estilos de <head> e atributos de <body> para que a formatação não se perca no editor WYSIWYG
  const headMatch = cleaned.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  let headStyles = "";
  if (headMatch) {
    const styles = headMatch[1].match(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
    if (styles) {
      headStyles = styles.join("\n");
    }
  }

  const bodyMatch = cleaned.match(/<body\b([^>]*)>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const bodyAttrs = bodyMatch[1] || "";
    const bodyContent = bodyMatch[2] || "";

    const styleMatch = bodyAttrs.match(/style=["']([^"']*)["']/i);
    const classMatch = bodyAttrs.match(/class=["']([^"']*)["']/i);

    const bodyStyle = styleMatch ? styleMatch[1] : "";
    const bodyClass = classMatch ? classMatch[1] : "";

    return `${headStyles}<div class="${bodyClass}" style="${bodyStyle}">${bodyContent}</div>`;
  }

  // Remove doctype, html, head se ainda existirem
  cleaned = cleaned
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, headStyles)
    .replace(/<\/?body[^>]*>/gi, "");

  return `${headStyles}${cleaned}`;
}

export default function InboxPage() {
  const router = useRouter();
  const { user, isLoading, logout, gatewayUrl } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [currentFolder, setCurrentFolder] = useState<FolderType>("inbox");
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [counts, setCounts] = useState<{ inbox: number; sent: number; spam: number; trash: number }>({
    inbox: 0,
    sent: 0,
    spam: 0,
    trash: 0,
  });

  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set());

  // Composer States
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerRecipient, setComposerRecipient] = useState("");
  const [composerSubject, setComposerSubject] = useState("");
  const [composerContent, setComposerContent] = useState("");
  const [composerHtml, setComposerHtml] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<EmailAttachment[]>([]);

  // Signature Modal State
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("ALL");
  const [isDisputing, setIsDisputing] = useState(false);
  const [disputeResult, setDisputeResult] = useState<any>(null);
  const [showQuotedThread, setShowQuotedThread] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Redirecionar se não autenticado ou se for admin
  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.push("/login");
      } else if (user.role === "admin") {
        router.replace("/admin");
      }
    }
  }, [user, isLoading, router]);


  const loadMessages = useCallback(
    async (folderToLoad: FolderType = currentFolder) => {
      if (!user || user.role === "admin") return;
      setIsRefreshing(true);
      try {
        const params = new URLSearchParams();
        params.set("folder", folderToLoad);
        if (user.email) params.set("email", user.email);

        const token = user?.token || (typeof window !== "undefined" ? localStorage.getItem("maivw_token") : null);
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetch(`${gatewayUrl}/api/v1/inbox/messages?${params.toString()}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.counts) {
            setCounts(data.counts);
          }
          if (data.messages) {
            const mapped: EmailMessage[] = data.messages.map((m: any) => {
              const parsed = parseEmailBody(m.body || "");
              const cleanPreview = (parsed.main || parsed.quote || m.body || "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              const isRevoked = Boolean(m.isRevoked || m.status === "revoked_fraud");
              const rxTime = new Date(m.receivedAt).getTime();

              return {
                id: m.messageId,
                sender: m.from,
                to: m.to,
                subject: m.subject,
                preview: cleanPreview.slice(0, 95),
                fullText: m.body || "",
                html: parsed.html,
                attachments: parsed.attachments,
                msgClass: m.msgClass || "CONVERSATION",
                status: m.status || "received",
                date: new Date(m.receivedAt).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                rawDate: rxTime,
                signature: m.signature || "",
                intentTx: m.isLegacy ? "" : "verified",
                isRead: m.isRead || false,
                isWeb3: !m.isLegacy,
                isRevoked,
                revocationReason: m.revocationReason,
              };
            });

            setEmails(mapped);
          }
        }
      } catch {
        // Gateway offline
      } finally {
        setIsRefreshing(false);
      }
    },
    [currentFolder, gatewayUrl, user]
  );

  useEffect(() => {
    if (user) {
      loadMessages(currentFolder);
    }
  }, [user, currentFolder, loadMessages]);

  // Agrupamento em Threads (estilo Gmail)
  const threads: EmailThread[] = useMemo(() => {
    const map = new Map<string, EmailMessage[]>();

    for (const email of emails) {
      // Normalizar assunto para agrupar respostas (Re: / Fwd:)
      const canonical = email.subject.replace(/^(re|fwd|res|enc):\s*/i, "").trim().toLowerCase();
      const key = canonical || email.id;

      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(email);
    }

    const result: EmailThread[] = [];
    map.forEach((list, key) => {
      // Ordenar mensagens da thread cronologicamente
      list.sort((a, b) => a.rawDate - b.rawDate);
      const latest = list[list.length - 1];

      result.push({
        threadKey: key,
        canonicalSubject: latest.subject.replace(/^(re|fwd|res|enc):\s*/i, "").trim() || latest.subject,
        latestEmail: latest,
        emails: list,
        count: list.length,
      });
    });

    // Ordenar threads pela mensagem mais recente
    result.sort((a, b) => b.latestEmail.rawDate - a.latestEmail.rawDate);
    return result;
  }, [emails]);

  // Filtragem de threads
  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      const matchesSearch =
        t.canonicalSubject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.emails.some(
          (e) =>
            e.sender.toLowerCase().includes(searchTerm.toLowerCase()) ||
            e.to.toLowerCase().includes(searchTerm.toLowerCase()) ||
            e.preview.toLowerCase().includes(searchTerm.toLowerCase())
        );

      if (activeTab === "ALL") return matchesSearch;
      return matchesSearch && t.latestEmail.msgClass === activeTab;
    });
  }, [threads, searchTerm, activeTab]);

  // Thread selecionada atualmente
  const currentThread = useMemo(() => {
    if (!selectedThreadKey) {
      return filteredThreads[0] || null;
    }
    return threads.find((t) => t.threadKey === selectedThreadKey) || filteredThreads[0] || null;
  }, [selectedThreadKey, threads, filteredThreads]);

  // Expandir a última mensagem por padrão ao trocar de thread
  useEffect(() => {
    if (currentThread) {
      const latestId = currentThread.latestEmail.id;
      setExpandedMsgIds(new Set([latestId]));
    }
  }, [currentThread?.threadKey]);

  const toggleExpandMsg = (id: string) => {
    setExpandedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleFolderChange = (newFolder: FolderType) => {
    setCurrentFolder(newFolder);
    setSelectedThreadKey(null);
    setDisputeResult(null);
    setShowQuotedThread(false);
  };

  // Mover mensagem para Lixeira
  const handleMoveToTrash = async (email: EmailMessage) => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/inbox/messages/${email.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setActionNotice("Mensagem movida para a Lixeira.");
        setTimeout(() => setActionNotice(null), 3000);
        await loadMessages(currentFolder);
      }
    } catch {
      setActionNotice("Erro ao mover para a lixeira.");
    }
  };

  // Restaurar mensagem da Lixeira
  const handleRestoreFromTrash = async (email: EmailMessage) => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/inbox/messages/${email.id}/restore`, {
        method: "PATCH",
      });
      if (res.ok) {
        setActionNotice("Mensagem restaurada com sucesso!");
        setTimeout(() => setActionNotice(null), 3000);
        await loadMessages(currentFolder);
      }
    } catch {
      setActionNotice("Erro ao restaurar mensagem.");
    }
  };

  // Excluir definitivamente
  const handleDeleteForever = async (email: EmailMessage) => {
    if (!confirm("Deseja excluir esta mensagem permanentemente? Esta ação não pode ser desfeita.")) {
      return;
    }
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/inbox/messages/${email.id}?permanent=true`, {
        method: "DELETE",
      });
      if (res.ok) {
        setActionNotice("Mensagem excluída definitivamente.");
        setTimeout(() => setActionNotice(null), 3000);
        await loadMessages(currentFolder);
      }
    } catch {
      setActionNotice("Erro ao excluir permanentemente.");
    }
  };

  // Esvaziar Lixeira
  const handleEmptyTrash = async () => {
    if (!confirm("Tem certeza que deseja esvaziar a lixeira? Todas as mensagens serão apagadas para sempre.")) {
      return;
    }
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/inbox/trash/empty?email=${encodeURIComponent(user?.email || "")}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setActionNotice("Lixeira esvaziada com sucesso!");
        setTimeout(() => setActionNotice(null), 3000);
        await loadMessages(currentFolder);
      }
    } catch {
      setActionNotice("Erro ao esvaziar lixeira.");
    }
  };

  // Mover para Spam / Quarentena
  const handleMoveToQuarantine = async (email: EmailMessage) => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/inbox/messages/${email.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "quarantined" }),
      });
      if (res.ok) {
        setActionNotice("Mensagem movida para Spam / Quarentena.");
        setTimeout(() => setActionNotice(null), 3000);
        await loadMessages(currentFolder);
      }
    } catch {
      setActionNotice("Erro ao mover mensagem para quarentena.");
    }
  };

  // Responder
  const handleReply = (email: EmailMessage) => {
    const parsed = parseEmailBody(email.fullText || "");
    const originalHtml = email.html || parsed.html;
    const originalText = parsed.main || email.fullText || "";

    const sub = email.subject.toLowerCase().startsWith("re:") ? email.subject : `Re: ${email.subject}`;
    setComposerRecipient(email.sender);
    setComposerSubject(sub);

    const replyHeaderPlain = `\n\n--- Em ${email.date}, ${email.sender} escreveu: ---\n`;
    setComposerContent(`${replyHeaderPlain}${originalText}`);

    const sanitizedBody = originalHtml
      ? sanitizeHtmlForForward(originalHtml)
      : `<div style="white-space: pre-wrap; font-size: 14px;">${escapeHtml(originalText)}</div>`;

    const replyHeaderHtml =
      `<p><br></p>` +
      `<div class="maivw_quoted_reply" style="border-left: 2px solid #7d0000; padding-left: 12px; margin-left: 4px; margin-top: 16px; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #475569;">` +
      `<div style="font-size: 12px; margin-bottom: 8px; color: #64748b;"><strong>Em ${escapeHtml(email.date)}, ${escapeHtml(email.sender)} escreveu:</strong></div>` +
      sanitizedBody +
      `</div>`;

    setComposerHtml(replyHeaderHtml);
    setComposerAttachments([]);
    setIsComposerOpen(true);
  };

  // Encaminhar
  const handleForward = (email: EmailMessage) => {
    const parsed = parseEmailBody(email.fullText || "");
    const originalHtml = email.html || parsed.html;
    const originalText = parsed.main || email.fullText || "";
    const attachmentsToForward =
      email.attachments && email.attachments.length > 0
        ? email.attachments
        : parsed.attachments || [];

    const sub = email.subject.toLowerCase().startsWith("fwd:") ? email.subject : `Fwd: ${email.subject}`;
    setComposerRecipient("");
    setComposerSubject(sub);

    const fwdHeaderPlain = `\n\n---------- Mensagem Encaminhada ----------\nDe: ${email.sender}\nPara: ${email.to}\nData: ${email.date}\nAssunto: ${email.subject}\n\n`;
    setComposerContent(`${fwdHeaderPlain}${originalText}`);

    const fwdHeaderHtml =
      `<p><br></p>` +
      `<div class="maivw_forwarded_message" style="border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 16px; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13px; color: #475569;">` +
      `<div style="margin-bottom: 6px; font-weight: 700; color: #0f172a;">---------- Mensagem Encaminhada ----------</div>` +
      `<div><strong>De:</strong> ${escapeHtml(email.sender)}</div>` +
      `<div><strong>Para:</strong> ${escapeHtml(email.to)}</div>` +
      `<div><strong>Data:</strong> ${escapeHtml(email.date)}</div>` +
      `<div style="margin-bottom: 12px;"><strong>Assunto:</strong> ${escapeHtml(email.subject)}</div>` +
      `</div>`;

    if (originalHtml) {
      const sanitizedBody = sanitizeHtmlForForward(originalHtml);
      setComposerHtml(`${fwdHeaderHtml}${sanitizedBody}`);
    } else {
      setComposerHtml(
        `${fwdHeaderHtml}<div style="white-space: pre-wrap; font-family: sans-serif; font-size: 14px; color: #1f2937;">${escapeHtml(originalText)}</div>`
      );
    }

    setComposerAttachments(attachmentsToForward);
    setIsComposerOpen(true);
  };


  const getCategoryInfo = (msgClass: string) => {
    return CATEGORY_LABELS[msgClass] || { label: msgClass, color: "bg-slate-700 text-slate-300 border-slate-600" };
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const userEmail = user?.email || "";
  const domainName = user?.domain?.domainName || (userEmail ? userEmail.split("@")[1] : "maivw.local");

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-[#070101] text-slate-900 dark:text-slate-100 overflow-hidden font-sans transition-colors duration-200">
      {/* 1. SIDEBAR CORPORATIVA */}
      <aside className="w-64 border-r border-slate-200 dark:border-[#7d0000]/25 flex flex-col justify-between shrink-0 bg-white dark:bg-gradient-to-b dark:from-[#120202] dark:via-[#090101] dark:to-[#120202] select-none transition-colors">
        <div>
          {/* Logo e Identidade */}
          <div className="p-5 border-b border-slate-200 dark:border-[#7d0000]/25">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7d0000] to-[#3a0000] border border-[#7d0000]/60 flex items-center justify-center text-white font-black text-sm shadow-lg shadow-[#7d0000]/40">
                🛡️
              </div>
              <div className="truncate">
                <span className="font-extrabold text-sm tracking-tight text-slate-900 dark:text-white block">
                  WebMaivw
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium block truncate">
                  {domainName}
                </span>
              </div>
            </div>
            <div className="mt-2.5 text-[11px] text-slate-700 dark:text-slate-300 truncate font-mono bg-slate-100 dark:bg-black/40 px-2 py-1 rounded-lg border border-slate-200 dark:border-white/5">
              {userEmail}
            </div>
          </div>

          {/* Botão Nova Mensagem */}
          <div className="p-4">
            <button
              onClick={() => {
                setComposerRecipient("");
                setComposerSubject("");
                setComposerContent("");
                setComposerHtml("");
                setComposerAttachments([]);
                setIsComposerOpen(true);
              }}
              className="w-full py-2.5 px-4 bg-[#7d0000] hover:bg-[#990000] text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#7d0000]/30 transition flex items-center justify-center gap-2 cursor-pointer active:scale-95 border border-[#7d0000]/40"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Mensagem</span>
            </button>
          </div>

          {/* Pastas da Barra Lateral */}
          <nav className="px-3 space-y-1">
            {/* Caixa de Entrada */}
            <button
              onClick={() => handleFolderChange("inbox")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                currentFolder === "inbox"
                  ? "bg-rose-50 dark:bg-[#7d0000]/30 border border-rose-300 dark:border-[#7d0000]/60 text-rose-950 dark:text-white shadow-xs font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <InboxIcon className={`w-4 h-4 ${currentFolder === "inbox" ? "text-rose-600 dark:text-red-400" : "text-slate-400"}`} />
                <span>Caixa de Entrada</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  currentFolder === "inbox" ? "bg-[#7d0000] text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400"
                }`}
              >
                {counts.inbox}
              </span>
            </button>

            {/* Enviados */}
            <button
              onClick={() => handleFolderChange("sent")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                currentFolder === "sent"
                  ? "bg-rose-50 dark:bg-[#7d0000]/30 border border-rose-300 dark:border-[#7d0000]/60 text-rose-950 dark:text-white shadow-xs font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Send className={`w-4 h-4 ${currentFolder === "sent" ? "text-rose-600 dark:text-red-400" : "text-slate-400"}`} />
                <span>Enviados</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  currentFolder === "sent" ? "bg-[#7d0000] text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400"
                }`}
              >
                {counts.sent}
              </span>
            </button>

            {/* Spam / Quarentena */}
            <button
              onClick={() => handleFolderChange("spam")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                currentFolder === "spam"
                  ? "bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-600/60 text-rose-950 dark:text-white shadow-xs font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <AlertOctagon className={`w-4 h-4 ${currentFolder === "spam" ? "text-rose-600 dark:text-rose-400" : "text-slate-400"}`} />
                <span>Spam / Quarentena</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  currentFolder === "spam"
                    ? "bg-rose-600 text-white"
                    : counts.spam > 0
                    ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                    : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400"
                }`}
              >
                {counts.spam}
              </span>
            </button>

            {/* Lixeira */}
            <button
              onClick={() => handleFolderChange("trash")}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                currentFolder === "trash"
                  ? "bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white shadow-xs font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Trash2 className={`w-4 h-4 ${currentFolder === "trash" ? "text-slate-900 dark:text-slate-200" : "text-slate-400"}`} />
                <span>Lixeira</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  currentFolder === "trash" ? "bg-slate-700 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400"
                }`}
              >
                {counts.trash || 0}
              </span>
            </button>
          </nav>
        </div>

        {/* Footer da Barra Lateral */}
        <div className="p-4 border-t border-slate-200 dark:border-[#7d0000]/25 space-y-1.5 bg-slate-50 dark:bg-[#0e0202] transition-colors">
          {/* Alternância de Modo Claro / Escuro */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5 transition cursor-pointer"
            title="Alternar entre modo claro e escuro"
          >
            <div className="flex items-center gap-2">
              {theme === "dark" ? (
                <Sun className="w-3.5 h-3.5 text-amber-500" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-indigo-600" />
              )}
              <span>{theme === "dark" ? "Modo Claro" : "Modo Escuro"}</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-semibold">
              {theme === "dark" ? "Dark" : "Light"}
            </span>
          </button>

          <button
            onClick={() => setIsSignatureModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/5 transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-rose-500" />
            <span>Assinatura de E-mail</span>
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sair</span>
          </button>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between px-1 pt-2">
            <span className="font-semibold text-rose-600 dark:text-red-300">MAIVW Enterprise</span>
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
              <ShieldCheck className="w-3 h-3" />
              Base Sepolia
            </span>
          </div>
        </div>
      </aside>

      {/* 2. LISTA DE CONVERSAS / THREADS */}
      <section className="w-96 border-r border-slate-200 dark:border-[#7d0000]/20 flex flex-col shrink-0 bg-white dark:bg-slate-950 transition-colors">
        {/* Header da Pasta */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800/80 space-y-3 bg-slate-50/70 dark:bg-[#0d0202]/40 transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {currentFolder === "inbox" && (
                  <>
                    <InboxIcon className="w-4 h-4 text-rose-600 dark:text-red-400" />
                    <span>Caixa de Entrada</span>
                  </>
                )}
                {currentFolder === "sent" && (
                  <>
                    <Send className="w-4 h-4 text-rose-600 dark:text-red-400" />
                    <span>Enviados</span>
                  </>
                )}
                {currentFolder === "spam" && (
                  <>
                    <AlertOctagon className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                    <span>Spam / Quarentena</span>
                  </>
                )}
                {currentFolder === "trash" && (
                  <>
                    <Trash2 className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                    <span>Lixeira</span>
                  </>
                )}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {currentFolder === "inbox" && "Mensagens recebidas e verificadas"}
                {currentFolder === "sent" && "Mensagens enviadas via MAIVW ou Resend"}
                {currentFolder === "spam" && "Retidos por reputação baixa ou suspeita"}
                {currentFolder === "trash" && "Mensagens excluídas"}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {currentFolder === "trash" && counts.trash > 0 && (
                <button
                  onClick={handleEmptyTrash}
                  className="px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/80 border border-rose-300 dark:border-rose-800/60 rounded-lg transition cursor-pointer"
                  title="Esvaziar lixeira definitivamente"
                >
                  Esvaziar
                </button>
              )}
              <button
                onClick={() => loadMessages(currentFolder)}
                disabled={isRefreshing}
                className="p-2 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-[#7d0000]/30 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#7d0000]/20 transition cursor-pointer"
                title="Atualizar pasta"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-rose-600 dark:text-red-400" : ""}`} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por remetente ou assunto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-100 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#7d0000] transition"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1 rounded-lg font-medium transition shrink-0 cursor-pointer ${
                  activeTab === tab.key
                    ? "bg-[#7d0000] text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Notice Banner */}
        {actionNotice && (
          <div className="px-4 py-2 bg-rose-50 dark:bg-[#7d0000]/20 border-b border-rose-200 dark:border-[#7d0000]/30 text-xs text-rose-800 dark:text-red-200 flex items-center justify-between animate-in fade-in">
            <span>{actionNotice}</span>
          </div>
        )}

        {/* Lista de Threads */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-850">
          {filteredThreads.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs space-y-2">
              <InboxIcon className="w-8 h-8 mx-auto opacity-40 text-slate-400" />
              <p className="font-medium text-slate-600 dark:text-slate-400">Nenhuma conversa encontrada</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-600">
                {currentFolder === "trash" ? "A lixeira está vazia." : "Novas mensagens aparecerão aqui."}
              </p>
            </div>
          ) : (
            filteredThreads.map((thread) => {
              const isSelected = currentThread?.threadKey === thread.threadKey;
              const latest = thread.latestEmail;
              const cat = getCategoryInfo(latest.msgClass);
              const hasAttachments = thread.emails.some((e) => (e.attachments?.length || 0) > 0);

              return (
                <div
                  key={thread.threadKey}
                  onClick={() => {
                    setSelectedThreadKey(thread.threadKey);
                    setDisputeResult(null);
                    setShowQuotedThread(false);
                  }}
                  className={`p-4 cursor-pointer transition flex flex-col gap-1.5 ${
                    isSelected
                      ? "bg-rose-50/70 dark:bg-slate-900/90 border-l-4 border-[#7d0000]"
                      : "hover:bg-slate-50 dark:hover:bg-slate-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {currentFolder === "sent" ? `Para: ${latest.to}` : latest.sender}
                      </span>
                      {thread.count > 1 && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border border-slate-300 dark:border-slate-700">
                          {thread.count}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">{latest.date}</span>
                  </div>

                  <div className="text-xs font-medium text-slate-800 dark:text-slate-100 line-clamp-1">
                    {thread.canonicalSubject}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">{latest.preview}</div>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${cat.color}`}>
                      {cat.label}
                    </span>

                    {hasAttachments && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 flex items-center gap-1 border border-slate-200 dark:border-slate-700">
                        <Paperclip className="w-2.5 h-2.5" />
                        Anexo
                      </span>
                    )}

                    {latest.isWeb3 ? (
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                        <ShieldCheck className="w-2.5 h-2.5" />
                        Web3
                      </span>
                    ) : (
                      <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1">
                        <ExternalLink className="w-2.5 h-2.5" />
                        SMTP
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 3. READING PANE (HISTÓRICO DA CONVERSA & THREAD COMPLETA) */}
      <main className="flex-1 flex flex-col bg-white dark:bg-slate-950 overflow-y-auto transition-colors">
        {currentThread ? (
          <div className="flex-1 flex flex-col">
            {/* Action Bar no Topo da Conversa */}
            <div className="px-8 py-4 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 transition-colors">
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                    getCategoryInfo(currentThread.latestEmail.msgClass).color
                  }`}
                >
                  {getCategoryInfo(currentThread.latestEmail.msgClass).label}
                </span>

                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <span>Conversa com {currentThread.count} mensagem(ns)</span>
                </span>
              </div>

              {/* Botões de Ação na Conversa */}
              <div className="flex items-center gap-2">
                {currentFolder === "trash" ? (
                  <>
                    <button
                      onClick={() => handleRestoreFromTrash(currentThread.latestEmail)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 cursor-pointer"
                      title="Restaurar mensagem para a Caixa de Entrada"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restaurar</span>
                    </button>
                    <button
                      onClick={() => handleDeleteForever(currentThread.latestEmail)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-700 dark:text-rose-300 border border-rose-500/30 cursor-pointer"
                      title="Excluir mensagem definitivamente"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir Definitivamente</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleReply(currentThread.latestEmail)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-[#7d0000] hover:bg-[#990000] text-white shadow-sm cursor-pointer"
                      title="Responder à conversa"
                    >
                      <Reply className="w-3.5 h-3.5" />
                      <span>Responder</span>
                    </button>

                    <button
                      onClick={() => handleForward(currentThread.latestEmail)}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-slate-900 dark:hover:bg-slate-800 dark:text-slate-300 dark:border-slate-700 cursor-pointer transition-colors"
                      title="Encaminhar conversa"
                    >
                      <Forward className="w-3.5 h-3.5" />
                      <span>Encaminhar</span>
                    </button>

                    <button
                      onClick={() => handleMoveToTrash(currentThread.latestEmail)}
                      className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 border border-slate-300 hover:border-rose-300 dark:bg-slate-900 dark:hover:bg-rose-950/40 dark:text-slate-400 dark:hover:text-rose-300 dark:border-slate-800 dark:hover:border-rose-800/40 cursor-pointer transition-colors"
                      title="Mover para lixeira"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Lixeira</span>
                    </button>

                    {currentFolder === "inbox" && (
                      <button
                        onClick={() => handleMoveToQuarantine(currentThread.latestEmail)}
                        className="px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 bg-slate-100 hover:bg-rose-100 text-slate-600 hover:text-rose-700 border border-slate-300 hover:border-rose-300 dark:bg-slate-900 dark:hover:bg-rose-950/40 dark:text-slate-400 dark:hover:text-rose-300 dark:border-slate-800 dark:hover:border-rose-800/40 cursor-pointer transition-colors"
                        title="Marcar como spam"
                      >
                        <AlertOctagon className="w-3.5 h-3.5 text-rose-500" />
                        <span>Spam</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Assunto da Conversa */}
            <div className="px-8 py-5 border-b border-slate-200 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-950 transition-colors">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
                {currentThread.canonicalSubject}
              </h1>
            </div>

            {/* Linha do Tempo das Mensagens da Thread (Estilo Accordion) */}
            <div className="p-8 space-y-6 max-w-4xl">
              {currentThread.emails.map((email) => {
                const isExpanded = expandedMsgIds.has(email.id);
                const parsed = parseEmailBody(email.fullText);

                return (
                  <div
                    key={email.id}
                    className={`rounded-2xl border transition-all ${
                      isExpanded
                        ? "bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-lg"
                        : "bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-850 hover:border-slate-300 dark:hover:border-slate-800"
                    }`}
                  >
                    {/* Header do Card da Mensagem */}
                    <div
                      onClick={() => toggleExpandMsg(email.id)}
                      className="px-6 py-4 flex items-center justify-between cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-8 h-8 rounded-full bg-[#7d0000]/15 dark:bg-[#7d0000]/30 border border-[#7d0000]/30 dark:border-[#7d0000]/50 flex items-center justify-center font-bold text-[#7d0000] dark:text-red-200 text-xs shrink-0">
                          {(email.sender[0] || "M").toUpperCase()}
                        </div>
                        <div className="truncate">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">{email.sender}</span>
                            {email.isWeb3 && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                On-Chain
                              </span>
                            )}
                          </div>
                          {!isExpanded && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 max-w-lg">
                              {email.preview}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-slate-500 font-mono">{email.date}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {/* Corpo Expandido da Mensagem */}
                    {isExpanded && (
                      <div className="px-6 pb-6 pt-2 border-t border-slate-200 dark:border-slate-800/60 space-y-4">
                        <div className="text-xs text-slate-500 dark:text-slate-400 pb-2 border-b border-slate-200 dark:border-slate-800/40">
                          Para: <span className="text-slate-800 dark:text-slate-200">{email.to}</span>
                        </div>

                        {/* Conteúdo Seguro do E-mail (HTML Sanitizado ou Texto com Links Inteligentes em Fundo Claro) */}
                        <EmailContentViewer
                          html={parsed.html}
                          text={parsed.main || email.fullText}
                          isRevoked={email.isRevoked}
                        />

                        {/* Histórico Citado */}
                        {parsed.hasQuote && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => setShowQuotedThread(!showQuotedThread)}
                              className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 cursor-pointer"
                            >
                              <History className="w-3.5 h-3.5 text-[#7d0000] dark:text-red-400" />
                              <span>{showQuotedThread ? "Ocultar histórico" : "Ver histórico citado"}</span>
                            </button>

                            {showQuotedThread && (
                              <div className="mt-2 p-3 rounded-lg bg-slate-100 dark:bg-black/40 border-l-2 border-[#7d0000] text-xs text-slate-600 dark:text-slate-400 whitespace-pre-line font-mono">
                                {parsed.quote}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Renderizador de Anexos */}
                        {parsed.attachments && parsed.attachments.length > 0 && (
                          <div className="pt-4 border-t border-slate-200 dark:border-slate-800/60">
                            <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                              <Paperclip className="w-3.5 h-3.5 text-rose-500" />
                              <span>Anexos Verificados ({parsed.attachments.length})</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              {parsed.attachments.map((att) => (
                                <div
                                  key={att.id}
                                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition"
                                >
                                  <div className="flex items-center gap-3 truncate">
                                    <FileText className="w-5 h-5 text-rose-500 shrink-0" />
                                    <div className="truncate">
                                      <div className="font-semibold text-xs text-slate-800 dark:text-slate-200 truncate">
                                        {att.filename}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                                        <span>{formatFileSize(att.size)}</span>
                                        <span>•</span>
                                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                          SHA: {att.sha256.slice(0, 8)}...
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <a
                                    href={`${gatewayUrl}${att.url}`}
                                    download={att.filename}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-2 rounded-lg bg-slate-200 hover:bg-[#7d0000] text-slate-700 hover:text-white dark:bg-slate-900 dark:hover:bg-[#7d0000] dark:text-slate-300 dark:hover:text-white transition flex items-center gap-1 text-xs"
                                    title="Baixar anexo com integridade SHA-256"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Ações Rápidas no Card do E-mail */}
                        <div className="pt-3 border-t border-slate-200 dark:border-slate-800/60 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReply(email);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 cursor-pointer transition"
                            title="Responder a este e-mail"
                          >
                            <Reply className="w-3.5 h-3.5 text-[#7d0000] dark:text-red-400" />
                            <span>Responder</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleForward(email);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 cursor-pointer transition"
                            title="Encaminhar este e-mail"
                          >
                            <Forward className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                            <span>Encaminhar</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-xs">
            <Mail className="w-10 h-10 mb-2 opacity-30 text-[#7d0000]" />
            <p className="text-slate-600 dark:text-slate-400 font-medium">Selecione uma conversa para visualizar o histórico</p>
          </div>
        )}
      </main>

      {/* Modal Gerador e Construtor de Assinaturas Corporativas */}
      <SignatureBuilderModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        userEmail={userEmail}
        userDomain={domainName}
        onSaved={() => {
          setActionNotice("Assinaturas corporativas atualizadas com sucesso!");
          setTimeout(() => setActionNotice(null), 3000);
        }}
      />

      {/* Composer Modal */}
      <ComposerModal
        isOpen={isComposerOpen}
        onClose={() => {
          setIsComposerOpen(false);
          setComposerRecipient("");
          setComposerSubject("");
          setComposerContent("");
          setComposerHtml("");
          setComposerAttachments([]);
        }}
        senderEmail={userEmail}
        senderDomain={domainName}
        initialTo={composerRecipient}
        initialSubject={composerSubject}
        initialContent={composerContent}
        initialHtml={composerHtml}
        initialAttachments={composerAttachments}
        onSendSuccess={() => {
          loadMessages(currentFolder);
        }}
      />
    </div>
  );
}
