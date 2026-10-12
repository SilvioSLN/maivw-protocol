"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Send,
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  Paperclip,
  Trash2,
  FileText,
  CheckCircle2,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import RichEmailEditor from "./RichEmailEditor";
import { SignatureItem } from "@/types/signature";
import { renderSignatureHTML } from "./SignatureTemplates";
import SignatureBuilderModal from "./SignatureBuilderModal";

interface AttachmentItem {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256: string;
  url: string;
}

interface ContactSuggestion {
  email: string;
  name?: string;
  isInternal: boolean;
}

interface ComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  senderEmail?: string;
  senderDomain?: string;
  initialTo?: string;
  initialSubject?: string;
  initialCategory?: string;
  initialContent?: string;
  initialHtml?: string;
  initialAttachments?: AttachmentItem[];
  onSendSuccess?: (msg: any) => void;
}

const MESSAGE_CATEGORIES = [
  {
    id: "TX_CODE",
    label: "Código de verificação",
    desc: "Códigos temporários, OTP e tokens de acesso.",
  },
  {
    id: "TX_RECEIPT",
    label: "Comprovante / Fatura",
    desc: "Recibos de pagamento, notas fiscais e confirmações de compra.",
  },
  {
    id: "SUPPORT",
    label: "Suporte ao cliente",
    desc: "Respostas a tickets de suporte e atendimento técnico.",
  },
  {
    id: "CONVERSATION",
    label: "Conversa direta",
    desc: "Diálogos individuais entre pessoas.",
  },
  {
    id: "MARKETING",
    label: "Marketing / Newsletter",
    desc: "Campanhas, boletins informativos e promoções.",
  },
  {
    id: "COLD_OUTREACH",
    label: "Prospecção comercial",
    desc: "Primeiro contato comercial com novos leads.",
  },
];

export default function ComposerModal({
  isOpen,
  onClose,
  senderEmail,
  senderDomain,
  initialTo,
  initialSubject,
  initialCategory,
  initialContent,
  initialHtml,
  initialAttachments,
  onSendSuccess,
}: ComposerModalProps) {
  const { user, gatewayUrl } = useAuth();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("CONVERSATION");
  const [contentText, setContentText] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [signaturesList, setSignaturesList] = useState<SignatureItem[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string>("none");
  const [isSigBuilderOpen, setIsSigBuilderOpen] = useState(false);

  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carregar assinaturas salvas (Multi-assinaturas com suporte a fallback legado)
  const loadSignatures = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("maivw_user_signatures");
      if (raw) {
        const parsed: SignatureItem[] = JSON.parse(raw);
        if (parsed.length > 0) {
          setSignaturesList(parsed);
          setSelectedSignatureId((prev) => {
            if (prev === "none") return "none";
            const match = parsed.find((s) => s.id === prev);
            if (match) return prev;
            const def = parsed.find((s) => s.isDefault) || parsed[0];
            return def.id;
          });
          return;
        }
      }

      // Fallback para assinatura legada simples se existir
      const legacy = localStorage.getItem("maivw_user_signature");
      if (legacy && legacy.trim()) {
        const legacyItem: SignatureItem = {
          id: "legacy",
          title: "Assinatura Padrão",
          isDefault: true,
          type: legacy.includes("<") ? "html" : "template",
          templateId: "classic-divider",
          data: {
            fullName: user?.displayName || (user?.email ? user.email.split("@")[0] : "Usuário"),
            role: "",
            department: "",
            company: user?.domain?.domainName || "",
            email: user?.email || "",
            phone: "",
            mobile: "",
            website: "",
            address: "",
          },
          customHtml: legacy,
          updatedAt: new Date().toISOString(),
        };
        setSignaturesList([legacyItem]);
        setSelectedSignatureId(legacyItem.id);
      } else {
        setSignaturesList([]);
        setSelectedSignatureId("none");
      }
    } catch {
      // Ignora erro
    }
  }, [user]);

  useEffect(() => {
    if (isOpen) {
      loadSignatures();
    }
  }, [isOpen, loadSignatures]);

  // Limpar ou inicializar estados sempre que abrir/fechar
  const resetForm = useCallback(() => {
    setTo(initialTo || "");
    setSubject(initialSubject || "");
    setCategory(initialCategory || "CONVERSATION");

    let textVal = initialContent || "";
    let htmlVal = initialHtml || "";
    if (!textVal && initialHtml) {
      textVal = initialHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
                           .replace(/<[^>]+>/g, " ")
                           .replace(/\s+/g, " ")
                           .trim();
    }
    if (!htmlVal && initialContent) {
      if (initialContent.includes("<") && initialContent.includes(">")) {
        htmlVal = initialContent;
      } else {
        htmlVal = `<p>${initialContent.replace(/\n/g, "<br/>")}</p>`;
      }
    }

    setContentText(textVal);
    setContentHtml(htmlVal);
    setAttachments(initialAttachments && initialAttachments.length > 0 ? [...initialAttachments] : []);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowSuggestions(false);
  }, [initialTo, initialSubject, initialCategory, initialContent, initialHtml, initialAttachments]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
    } else {
      setTo("");
      setSubject("");
      setCategory("CONVERSATION");
      setContentText("");
      setContentHtml("");
      setAttachments([]);
      setErrorMsg(null);
      setSuccessMsg(null);
      setShowSuggestions(false);
    }
  }, [isOpen, resetForm]);

  const handleClose = () => {
    setTo("");
    setSubject("");
    setCategory("CONVERSATION");
    setContentText("");
    setContentHtml("");
    setAttachments([]);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowSuggestions(false);
    onClose();
  };

  // Autocomplete de contatos
  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const baseUrl = (gatewayUrl || process.env.NEXT_PUBLIC_GATEWAY_URL || "https://api-test.maivw.com").replace(/\/+$/, "");
      const token = user?.token || (typeof window !== "undefined" ? localStorage.getItem("maivw_token") : null);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${baseUrl}/api/v1/contacts/autocomplete?q=${encodeURIComponent(query)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.contacts || []);
        setShowSuggestions((data.contacts || []).length > 0);
      }
    } catch {
      // Ignora erro de autocomplete
    }
  }, [gatewayUrl, user]);

  if (!isOpen) return null;

  const isFormValid =
    to.trim().includes("@") &&
    subject.trim().length > 0 &&
    category.trim().length > 0 &&
    (contentText.trim().length > 0 || contentHtml.trim().length > 0 || attachments.length > 0);

  const effectiveEmail =
    senderEmail ||
    user?.email ||
    (typeof window !== "undefined" ? localStorage.getItem("user_email") || "" : "");

  const effectiveDomain =
    senderDomain ||
    user?.domain?.domainName ||
    user?.domainName ||
    (effectiveEmail ? effectiveEmail.split("@")[1] : "");

  // Upload de Anexos
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setErrorMsg("O anexo excede o limite máximo permitido de 25MB");
      return;
    }

    setIsUploadingAttachment(true);
    setErrorMsg(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const baseUrl = (gatewayUrl || process.env.NEXT_PUBLIC_GATEWAY_URL || "https://api-test.maivw.com").replace(/\/+$/, "");
        const token = user?.token || (typeof window !== "undefined" ? localStorage.getItem("maivw_token") : null);

        const res = await fetch(`${baseUrl}/api/v1/attachments/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type,
            dataBase64: base64Data,
          }),
        });

        const data = await res.json();
        if (res.ok && data.success && data.attachment) {
          setAttachments((prev) => [...prev, data.attachment]);
        } else {
          setErrorMsg(data.error || "Falha ao anexar arquivo");
        }
        setIsUploadingAttachment(false);
      };

      reader.onerror = () => {
        setErrorMsg("Erro ao ler o arquivo local");
        setIsUploadingAttachment(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao processar anexo");
      setIsUploadingAttachment(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Envio de E-mail (Anexa assinatura no momento do envio para não duplicar no editor)
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSending) return;

    setIsSending(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const baseUrl = (gatewayUrl || process.env.NEXT_PUBLIC_GATEWAY_URL || "https://api-test.maivw.com").replace(/\/+$/, "");
    const token = user?.token || (typeof window !== "undefined" ? localStorage.getItem("maivw_token") : null);

    // Assinatura selecionada
    const selectedSig = signaturesList.find((s) => s.id === selectedSignatureId);
    const currentSigHtml = selectedSig
      ? selectedSig.type === "html" && selectedSig.customHtml
        ? selectedSig.customHtml
        : renderSignatureHTML(selectedSig.templateId, selectedSig.data)
      : "";

    const hasSignature = selectedSignatureId !== "none" && currentSigHtml.trim().length > 0;

    const sigPlainText = hasSignature
      ? selectedSig?.data?.fullName
        ? `\n\n--\n${selectedSig.data.fullName}\n${[selectedSig.data.role, selectedSig.data.department, selectedSig.data.company].filter(Boolean).join(" • ")}\n${selectedSig.data.email || ""}`
        : `\n\n--\n${currentSigHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`
      : "";

    const finalContentText = `${contentText.trim()}${sigPlainText}`;

    const finalContentHtml = hasSignature
      ? `${contentHtml || `<p>${contentText.replace(/\n/g, "<br/>")}</p>`}<div style="margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b;">${currentSigHtml}</div>`
      : (contentHtml || undefined);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${baseUrl}/api/v1/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: to.trim(),
          from: effectiveEmail,
          senderEmail: effectiveEmail,
          senderDomain: effectiveDomain,
          subject: subject.trim(),
          msgClass: category,
          content: {
            text: finalContentText,
            html: finalContentHtml,
            attachments: attachments.length > 0 ? attachments : undefined,
          },
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const isWeb3 = data.route === "web3";
        setSuccessMsg(
          isWeb3
            ? `Mensagem entregue com sucesso via Protocolo MAIVW P2P para ${to.trim()}!`
            : `E-mail enviado com sucesso via ${data.provider ? data.provider.toUpperCase() : "SMTP"} para ${to.trim()}!`
        );

        setTimeout(() => {
          if (onSendSuccess) {
            onSendSuccess({
              id: data.messageId || String(Date.now()),
              sender: effectiveEmail,
              to: to.trim(),
              subject: subject.trim(),
              msgClass: category,
              preview: contentText.slice(0, 100),
              fullText: JSON.stringify({
                text: finalContentText,
                html: finalContentHtml,
                attachments,
              }),
              date: "Agora",
              signature: data.signature || "",
              intentTx: isWeb3 ? (data.merkleRoot || "verified") : "",
              isRead: true,
              isWeb3,
            });
          }
          handleClose();
        }, 1200);
      } else {
        setErrorMsg(data.message || data.error || "Falha ao enviar mensagem");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Erro de conexão com o Gateway");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] transition-colors">
        {/* Header do Compositor */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Nova Mensagem Corporativa</h2>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                De: <span className="font-mono text-slate-700 dark:text-slate-300">{effectiveEmail || "conta@empresa.com"}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSend} className="p-6 overflow-y-auto space-y-4 flex-1">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Campo Para com Autocomplete */}
          <div className="relative">
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 w-16">Para:</label>
              <input
                type="email"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  fetchSuggestions(e.target.value);
                }}
                onFocus={() => {
                  if (to.length >= 2) fetchSuggestions(to);
                }}
                placeholder="destinatario@empresa.com"
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
                required
              />
            </div>

            {/* Menu Dropdown de Autocomplete */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute left-16 top-9 z-20 w-80 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 animate-in fade-in duration-100">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 flex items-center gap-1.5">
                  <Users className="w-3 h-3" />
                  Contatos Sugeridos
                </div>
                {suggestions.map((sug) => (
                  <button
                    key={sug.email}
                    type="button"
                    onClick={() => {
                      setTo(sug.email);
                      setShowSuggestions(false);
                    }}
                    className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{sug.email}</span>
                      {sug.name && <span className="ml-2 text-slate-400">({sug.name})</span>}
                    </div>
                    {sug.isInternal && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/30">
                        Corporativo
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Assunto */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 w-16">Assunto:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Assunto da mensagem corporativa"
              className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
              required
            />
          </div>

          {/* Categoria Semântica */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 w-16">Categoria:</label>
            <div className="flex-1 flex flex-wrap gap-1.5">
              {MESSAGE_CATEGORIES.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategory(cat.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-200 border border-rose-300 dark:border-rose-600/80 shadow-xs"
                        : "bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700/40"
                    }`}
                    title={cat.desc}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Editor de E-mail com Barra de Ferramentas Rica */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Mensagem:</label>
            <RichEmailEditor
              key={isOpen ? `composer_${initialHtml ? "html_" + initialHtml.slice(0, 30) : initialContent ? "txt_" + initialContent.slice(0, 30) : "new"}` : "closed"}
              initialContent={initialHtml || initialContent}
              onChange={({ text, html }) => {
                setContentText(text);
                setContentHtml(html);
              }}
            />
          </div>

          {/* Bloco Fixo Dedicado da Assinatura Corporativa (Multi-Assinaturas) */}
          {(() => {
            const selectedSig = signaturesList.find((s) => s.id === selectedSignatureId);
            const currentSigHtml = selectedSig
              ? selectedSig.type === "html" && selectedSig.customHtml
                ? selectedSig.customHtml
                : renderSignatureHTML(selectedSig.templateId, selectedSig.data)
              : "";
            const hasSignature = selectedSignatureId !== "none" && currentSigHtml.trim().length > 0;

            return (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-3 text-xs flex flex-col gap-2.5 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-slate-500 dark:text-slate-400 font-medium">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Assinatura Corporativa:</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Seletor Dropdown de Assinaturas */}
                    <select
                      value={selectedSignatureId}
                      onChange={(e) => setSelectedSignatureId(e.target.value)}
                      className="bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 font-medium focus:outline-none focus:border-[#7d0000] cursor-pointer"
                    >
                      {signaturesList.map((sig) => (
                        <option key={sig.id} value={sig.id}>
                          {sig.title} {sig.isDefault ? "★ (Padrão)" : ""}
                        </option>
                      ))}
                      <option value="none">🚫 Sem Assinatura</option>
                    </select>

                    {/* Botão Gerenciar Assinaturas */}
                    <button
                      type="button"
                      onClick={() => setIsSigBuilderOpen(true)}
                      className="px-2.5 py-1 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded-lg border border-rose-300/40 font-semibold flex items-center gap-1 transition cursor-pointer"
                      title="Criar nova ou editar modelos de assinatura"
                    >
                      <span>+ Gerenciar</span>
                    </button>
                  </div>
                </div>

                {/* Preview da Assinatura Selecionada (Fundo branco por padrão para fidelidade do e-mail) */}
                <div className="rounded-xl p-3.5 bg-white border border-slate-200 shadow-xs overflow-x-auto text-[11px] text-slate-800">
                  {hasSignature ? (
                    <div
                      className="select-text"
                      dangerouslySetInnerHTML={{ __html: currentSigHtml }}
                    />
                  ) : (
                    <span className="italic text-slate-400">
                      (Nenhuma assinatura será anexada a este e-mail)
                    </span>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Seção de Anexos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                Anexos Corporativos ({attachments.length})
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAttachment}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
              >
                + Adicionar Arquivo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {isUploadingAttachment && (
              <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                <span>Calculando hash SHA-256 e protegendo anexo...</span>
              </div>
            )}

            {attachments.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-rose-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">{att.filename}</div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {(att.size / 1024).toFixed(1)} KB • SHA: {att.sha256.slice(0, 8)}...
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="text-slate-400 hover:text-red-500 p-1 rounded-md transition-colors"
                      title="Remover anexo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer do Form */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>Protegido por assinatura ECDSA on-chain</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={!isFormValid || isSending}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#7d0000] to-[#a81515] hover:from-[#900000] hover:to-[#c51c1c] text-white text-xs font-bold shadow-lg shadow-rose-950/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all cursor-pointer"
              >
                {isSending ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Enviando...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar E-mail</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Modal Construtor e Gerador de Assinaturas */}
      <SignatureBuilderModal
        isOpen={isSigBuilderOpen}
        onClose={() => {
          setIsSigBuilderOpen(false);
          loadSignatures();
        }}
        onSaved={() => loadSignatures()}
        userEmail={effectiveEmail}
        userDomain={effectiveDomain}
      />
    </div>
  );
}
