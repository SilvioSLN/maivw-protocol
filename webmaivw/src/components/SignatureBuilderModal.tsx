"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Sparkles,
  Layout,
  User,
  Image as ImageIcon,
  Share2,
  Code,
  Laptop,
  Smartphone,
  Copy,
  Check,
  Plus,
  Trash2,
  Star,
  CheckCircle2,
  ExternalLink,
  Upload,
  Link2,
  ArrowLeft,
  Edit3,
} from "lucide-react";
import { SignatureItem, SignatureData, SignatureTemplateId } from "@/types/signature";
import { SIGNATURE_TEMPLATES, renderSignatureHTML } from "./SignatureTemplates";

interface SignatureBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userDomain?: string;
  onSaved?: (signatures: SignatureItem[]) => void;
}

const DEFAULT_SIGNATURE_DATA: SignatureData = {
  fullName: "João Silva",
  role: "Fundador e CEO",
  department: "Diretoria Executiva",
  company: "Empresa Inovadora LTDA",
  email: "contato@empresa.com.br",
  phone: "+55 (11) 3214-5678",
  mobile: "+55 (11) 98765-4321",
  website: "www.empresa.com.br",
  address: "Av. Paulista, 1000 - São Paulo, SP",
  themeColor: "#7d0000",
  socials: {
    linkedin: "https://linkedin.com",
    instagram: "https://instagram.com",
    whatsapp: "+5511987654321",
  },
};

export default function SignatureBuilderModal({
  isOpen,
  onClose,
  userEmail,
  userDomain,
  onSaved,
}: SignatureBuilderModalProps) {
  const [signatures, setSignatures] = useState<SignatureItem[]>([]);
  const [activeSigId, setActiveSigId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"list" | "editor">("list");
  const [activeTab, setActiveTab] = useState<"templates" | "details" | "images" | "socials" | "html">("templates");
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Imagem modes (upload vs url)
  const [avatarInputMode, setAvatarInputMode] = useState<"upload" | "url">("upload");
  const [logoInputMode, setLogoInputMode] = useState<"upload" | "url">("upload");

  const avatarFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);

  // Carrega assinaturas do localStorage ao abrir
  useEffect(() => {
    if (!isOpen) return;
    setViewMode("list");

    try {
      const raw = localStorage.getItem("maivw_user_signatures");
      if (raw) {
        const parsed: SignatureItem[] = JSON.parse(raw);
        if (parsed.length > 0) {
          setSignatures(parsed);
          const def = parsed.find((s) => s.isDefault) || parsed[0];
          setActiveSigId(def.id);
          return;
        }
      }

      // Migração ou inicialização padrão
      const oldRaw = localStorage.getItem("maivw_user_signature");
      const initialItem: SignatureItem = {
        id: "sig_default_1",
        title: "Assinatura Comercial (Padrão)",
        isDefault: true,
        type: oldRaw && oldRaw.includes("<") ? "html" : "template",
        templateId: "classic-divider",
        data: {
          ...DEFAULT_SIGNATURE_DATA,
          fullName: userEmail ? userEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : DEFAULT_SIGNATURE_DATA.fullName,
          email: userEmail || DEFAULT_SIGNATURE_DATA.email,
          company: userDomain || DEFAULT_SIGNATURE_DATA.company,
          website: userDomain ? `www.${userDomain}` : DEFAULT_SIGNATURE_DATA.website,
        },
        customHtml: oldRaw && oldRaw.includes("<") ? oldRaw : undefined,
        updatedAt: new Date().toISOString(),
      };

      setSignatures([initialItem]);
      setActiveSigId(initialItem.id);
      localStorage.setItem("maivw_user_signatures", JSON.stringify([initialItem]));
    } catch {
      // Ignora erro
    }
  }, [isOpen, userEmail, userDomain]);

  if (!isOpen) return null;

  const currentSig = signatures.find((s) => s.id === activeSigId) || signatures[0];

  // Helper para atualizar campos da assinatura atual
  const updateCurrentSig = (updates: Partial<SignatureItem>) => {
    if (!currentSig) return;
    setSignatures((prev) =>
      prev.map((s) => (s.id === currentSig.id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s))
    );
  };

  const updateCurrentData = (dataUpdates: Partial<SignatureData>) => {
    if (!currentSig) return;
    const newData = { ...currentSig.data, ...dataUpdates };
    setSignatures((prev) =>
      prev.map((s) =>
        s.id === currentSig.id
          ? {
              ...s,
              data: newData,
              customHtml: s.type === "template" ? renderSignatureHTML(s.templateId, newData) : s.customHtml,
              updatedAt: new Date().toISOString(),
            }
          : s
      )
    );
  };

  // Sincronização e persistência no localStorage
  const persistSignatures = (sigs: SignatureItem[]) => {
    try {
      localStorage.setItem("maivw_user_signatures", JSON.stringify(sigs));
      const def = sigs.find((s) => s.isDefault) || sigs[0];
      if (def) {
        const defHTML = def.type === "html" && def.customHtml ? def.customHtml : renderSignatureHTML(def.templateId, def.data);
        localStorage.setItem("maivw_user_signature", defHTML);
      }
      if (onSaved) onSaved(sigs);
    } catch {
      // Ignora erro
    }
  };

  // Criação de Nova Assinatura
  const handleCreateNew = () => {
    const newId = `sig_${Date.now()}`;
    const newSig: SignatureItem = {
      id: newId,
      title: `Assinatura ${signatures.length + 1}`,
      isDefault: signatures.length === 0,
      type: "template",
      templateId: "corporate-icons",
      data: {
        ...DEFAULT_SIGNATURE_DATA,
        fullName: userEmail ? userEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) : DEFAULT_SIGNATURE_DATA.fullName,
        email: userEmail || DEFAULT_SIGNATURE_DATA.email,
        company: userDomain || DEFAULT_SIGNATURE_DATA.company,
        website: userDomain ? `www.${userDomain}` : DEFAULT_SIGNATURE_DATA.website,
      },
      updatedAt: new Date().toISOString(),
    };
    const updatedList = [...signatures, newSig];
    setSignatures(updatedList);
    setActiveSigId(newId);
    setActiveTab("templates");
    persistSignatures(updatedList);
    setViewMode("editor");
  };

  // Definir como Padrão
  const handleSetDefault = (id: string) => {
    const updated = signatures.map((s) => ({
      ...s,
      isDefault: s.id === id,
    }));
    setSignatures(updated);
    persistSignatures(updated);
    setSaveNotice("Assinatura definida como padrão!");
    setTimeout(() => setSaveNotice(null), 2000);
  };

  // Excluir Assinatura
  const handleDeleteSig = (id: string) => {
    if (signatures.length <= 1) {
      alert("Você deve manter pelo menos uma assinatura cadastrada.");
      return;
    }
    const filtered = signatures.filter((s) => s.id !== id);
    if (filtered.some((s) => s.isDefault) === false) {
      filtered[0].isDefault = true;
    }
    setSignatures(filtered);
    setActiveSigId(filtered[0].id);
    persistSignatures(filtered);
    setSaveNotice("Assinatura removida!");
    setTimeout(() => setSaveNotice(null), 2000);
  };

  // Upload de Imagens -> Base64
  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: "avatarUrl" | "logoUrl"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("A imagem excede 2MB. Selecione uma imagem menor para a assinatura.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      updateCurrentData({ [target]: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // HTML da assinatura ativa
  const renderedHTML =
    currentSig?.type === "html" && currentSig.customHtml
      ? currentSig.customHtml
      : currentSig
      ? renderSignatureHTML(currentSig.templateId, currentSig.data)
      : "";

  // Copiar HTML
  const handleCopyHTML = () => {
    if (!renderedHTML) return;
    navigator.clipboard.writeText(renderedHTML);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Salvar tudo no localStorage
  const handleSaveAll = (closeModal: boolean = false) => {
    persistSignatures(signatures);
    setSaveNotice("Assinaturas salvas com sucesso!");
    setTimeout(() => {
      setSaveNotice(null);
      if (closeModal) {
        onClose();
      } else {
        setViewMode("list");
      }
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in">
      <div className="bg-white dark:bg-[#0c0303] border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-6xl h-[92vh] max-h-[860px] shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100 transition-colors">
        {viewMode === "list" ? (
          /* ==========================================================
             TELA INICIAL: LISTA DE ASSINATURAS CADASTRADAS
             ========================================================== */
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Header da Lista */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-[#120202] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#7d0000] to-[#400000] flex items-center justify-center text-white shadow-md shadow-[#7d0000]/30 font-bold shrink-0">
                  <Sparkles className="w-5 h-5 text-rose-300" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Assinaturas de E-mail Cadastradas</span>
                    <span className="text-[10px] uppercase font-bold px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                      {signatures.length} {signatures.length === 1 ? "assinatura" : "assinaturas"}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Gerencie suas assinaturas salvas ou crie novas versões profissionais para suas mensagens.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {saveNotice && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    {saveNotice}
                  </span>
                )}
                <button
                  onClick={handleCreateNew}
                  className="px-4 py-2 bg-[#7d0000] hover:bg-[#990000] text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#7d0000]/25 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova Assinatura</span>
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Grid de Cards de Assinaturas */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-100/70 dark:bg-[#080101]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {signatures.map((sig) => {
                  const sigHtml =
                    sig.type === "html" && sig.customHtml
                      ? sig.customHtml
                      : renderSignatureHTML(sig.templateId, sig.data);

                  return (
                    <div
                      key={sig.id}
                      className={`rounded-2xl border transition-all flex flex-col justify-between overflow-hidden bg-white dark:bg-[#120202] ${
                        sig.isDefault
                          ? "border-rose-400 dark:border-[#7d0000] ring-2 ring-rose-500/20 shadow-md"
                          : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs"
                      }`}
                    >
                      {/* Top Header do Card */}
                      <div className="p-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h4 className="font-bold text-xs text-slate-900 dark:text-white truncate">
                              {sig.title}
                            </h4>
                            {sig.isDefault && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1 shrink-0">
                                <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                Padrão
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 block mt-0.5">
                            {sig.type === "html"
                              ? "HTML Personalizado"
                              : SIGNATURE_TEMPLATES.find((t) => t.id === sig.templateId)?.name || sig.templateId}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {!sig.isDefault && (
                            <button
                              onClick={() => handleSetDefault(sig.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition cursor-pointer"
                              title="Tornar esta assinatura padrão"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {signatures.length > 1 && (
                            <button
                              onClick={() => handleDeleteSig(sig.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                              title="Excluir assinatura"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Pré-visualização com fundo branco por padrão para fidelidade visual */}
                      <div className="p-4 bg-slate-50 dark:bg-black/30 flex-1 flex flex-col justify-center">
                        <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs max-h-44 overflow-y-auto select-none pointer-events-none text-slate-800 text-[10px]">
                          <div dangerouslySetInnerHTML={{ __html: sigHtml }} />
                        </div>
                      </div>

                      {/* Ações do Card */}
                      <div className="p-3 bg-white dark:bg-[#120202] border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                        <button
                          onClick={() => {
                            setActiveSigId(sig.id);
                            setViewMode("editor");
                          }}
                          className="w-full py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-[#7d0000] hover:text-white text-slate-700 dark:text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Editar Assinatura</span>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Card para Adicionar Nova Assinatura */}
                <button
                  onClick={handleCreateNew}
                  className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-rose-400 dark:hover:border-rose-600/60 p-6 flex flex-col items-center justify-center text-center gap-3 transition-all bg-white/50 dark:bg-black/20 hover:bg-rose-50/40 dark:hover:bg-rose-950/20 cursor-pointer min-h-[200px]"
                >
                  <div className="w-11 h-11 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-xs text-slate-800 dark:text-slate-200 mb-1">
                      Nova Assinatura
                    </h4>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-[200px]">
                      Escolha entre 6 modelos profissionais pré-definidos ou adicione seu HTML pronto.
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Footer da Lista */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#120202] flex items-center justify-between shrink-0 text-xs text-slate-500">
              <span>A assinatura marcada com estrela (★) será selecionada por padrão ao redigir novos e-mails.</span>
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        ) : (
          /* ==========================================================
             TELA DO CONSTRUTOR: EDIÇÃO DE ASSINATURA
             ========================================================== */
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Header Superior do Editor */}
            <div className="px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-[#120202] shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    persistSignatures(signatures);
                    setViewMode("list");
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  title="Voltar para a lista de assinaturas salvas"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Minhas Assinaturas</span>
                </button>

                <div className="h-5 w-px bg-slate-200 dark:border-slate-800" />

                <div>
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>Editor de Assinatura</span>
                    <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                      {currentSig?.title || "Assinatura"}
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ajuste dados de contato, modelos, foto, logo e código HTML com pré-visualização ao vivo.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {saveNotice && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 animate-in fade-in">
                    <CheckCircle2 className="w-4 h-4" />
                    {saveNotice}
                  </span>
                )}
                <button
                  onClick={() => handleSaveAll(false)}
                  className="px-4 py-2 bg-[#7d0000] hover:bg-[#990000] text-white font-semibold text-xs rounded-xl shadow-lg shadow-[#7d0000]/25 transition cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Salvar e Voltar</span>
                </button>
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

        {/* Barra de Gerenciamento de Assinaturas (Tabs superiores) */}
        <div className="px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-black/40 flex items-center justify-between shrink-0 overflow-x-auto gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 shrink-0">Assinatura ativa:</span>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {signatures.map((sig) => (
                <button
                  key={sig.id}
                  onClick={() => setActiveSigId(sig.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer border ${
                    sig.id === activeSigId
                      ? "bg-rose-50 dark:bg-[#7d0000]/25 border-rose-300 dark:border-[#7d0000]/60 text-rose-950 dark:text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  {sig.isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />}
                  <span className="truncate max-w-[130px]">{sig.title}</span>
                </button>
              ))}
              <button
                onClick={handleCreateNew}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-rose-600 dark:text-rose-400 border border-dashed border-rose-400/50 flex items-center gap-1 transition cursor-pointer"
                title="Cadastrar nova assinatura"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nova</span>
              </button>
            </div>
          </div>

          {currentSig && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleSetDefault(currentSig.id)}
                disabled={currentSig.isDefault}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1 transition cursor-pointer ${
                  currentSig.isDefault
                    ? "text-amber-500 bg-amber-500/10 border border-amber-500/20"
                    : "text-slate-600 dark:text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700"
                }`}
                title="Marcar como assinatura padrão nos novos e-mails"
              >
                <Star className={`w-3.5 h-3.5 ${currentSig.isDefault ? "fill-amber-500 text-amber-500" : ""}`} />
                <span>{currentSig.isDefault ? "Assinatura Padrão" : "Tornar Padrão"}</span>
              </button>

              <button
                onClick={() => handleDeleteSig(currentSig.id)}
                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition cursor-pointer"
                title="Excluir esta assinatura"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Corpo Principal (2 Colunas: Configuração à Esquerda, Preview à Direita) */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* COLUNA ESQUERDA: Abas & Formulários */}
          <div className="w-full md:w-1/2 lg:w-5/12 border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-0 bg-white dark:bg-[#0a0202]">
            {/* Navegação entre Abas de Configuração */}
            <div className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-black/30 px-3 py-2 gap-1 overflow-x-auto shrink-0 select-none">
              <button
                onClick={() => setActiveTab("templates")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  activeTab === "templates"
                    ? "bg-[#7d0000] text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                }`}
              >
                <Layout className="w-3.5 h-3.5" />
                <span>Modelos</span>
              </button>
              <button
                onClick={() => setActiveTab("details")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  activeTab === "details"
                    ? "bg-[#7d0000] text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                }`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Detalhes</span>
              </button>
              <button
                onClick={() => setActiveTab("images")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  activeTab === "images"
                    ? "bg-[#7d0000] text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Imagens</span>
              </button>
              <button
                onClick={() => setActiveTab("socials")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  activeTab === "socials"
                    ? "bg-[#7d0000] text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                }`}
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Redes</span>
              </button>
              <button
                onClick={() => setActiveTab("html")}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                  activeTab === "html"
                    ? "bg-[#7d0000] text-white shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>HTML Pronto</span>
              </button>
            </div>

            {/* Conteúdo da Aba Selecionada */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Título da Assinatura */}
              <div className="pb-3 border-b border-slate-200 dark:border-slate-800">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">
                  Nome Identificador desta Assinatura:
                </label>
                <input
                  type="text"
                  value={currentSig?.title || ""}
                  onChange={(e) => updateCurrentSig({ title: e.target.value })}
                  placeholder="ex: Comercial, Suporte, Diretoria..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white font-semibold focus:outline-none focus:border-[#7d0000]"
                />
              </div>

              {/* ABA 1: MODELOS VISUAIS */}
              {activeTab === "templates" && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Selecione um layout corporativo. O layout ajusta automaticamente seus dados na pré-visualização:
                  </p>
                  <div className="grid grid-cols-1 gap-2.5">
                    {SIGNATURE_TEMPLATES.map((tmpl) => {
                      const isSelected = currentSig?.templateId === tmpl.id && currentSig.type === "template";
                      return (
                        <div
                          key={tmpl.id}
                          onClick={() => updateCurrentSig({ templateId: tmpl.id, type: "template" })}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-rose-50/70 dark:bg-[#7d0000]/20 border-[#7d0000] shadow-sm"
                              : "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                          }`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-slate-900 dark:text-white">{tmpl.name}</span>
                              {isSelected && (
                                <span className="text-[10px] px-2 py-0.2 rounded-full bg-[#7d0000] text-white font-bold">
                                  Ativo
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                              {tmpl.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ABA 2: DETALHES & DADOS PESSOAIS */}
              {activeTab === "details" && (
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Nome Completo:</label>
                    <input
                      type="text"
                      value={currentSig?.data.fullName || ""}
                      onChange={(e) => updateCurrentData({ fullName: e.target.value })}
                      placeholder="ex: João Silva Costa"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Cargo / Função:</label>
                      <input
                        type="text"
                        value={currentSig?.data.role || ""}
                        onChange={(e) => updateCurrentData({ role: e.target.value })}
                        placeholder="ex: Fundador e CEO"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Departamento:</label>
                      <input
                        type="text"
                        value={currentSig?.data.department || ""}
                        onChange={(e) => updateCurrentData({ department: e.target.value })}
                        placeholder="ex: Comercial / Inovação"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Empresa / Organização:</label>
                    <input
                      type="text"
                      value={currentSig?.data.company || ""}
                      onChange={(e) => updateCurrentData({ company: e.target.value })}
                      placeholder="ex: SLN Soluções Tecnológicas"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">E-mail Corporativo:</label>
                      <input
                        type="email"
                        value={currentSig?.data.email || ""}
                        onChange={(e) => updateCurrentData({ email: e.target.value })}
                        placeholder="nome@empresa.com.br"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Website:</label>
                      <input
                        type="text"
                        value={currentSig?.data.website || ""}
                        onChange={(e) => updateCurrentData({ website: e.target.value })}
                        placeholder="www.empresa.com.br"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Telefone Fixo / Ramal:</label>
                      <input
                        type="text"
                        value={currentSig?.data.phone || ""}
                        onChange={(e) => updateCurrentData({ phone: e.target.value })}
                        placeholder="+55 (11) 3214-5678"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                      />
                    </div>
                    <div>
                      <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Celular / WhatsApp:</label>
                      <input
                        type="text"
                        value={currentSig?.data.mobile || ""}
                        onChange={(e) => updateCurrentData({ mobile: e.target.value })}
                        placeholder="+55 (11) 98765-4321"
                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Endereço Físico:</label>
                    <input
                      type="text"
                      value={currentSig?.data.address || ""}
                      onChange={(e) => updateCurrentData({ address: e.target.value })}
                      placeholder="ex: Av. Paulista, 1000 - Bela Vista, São Paulo, SP"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Cor do Destaque Corporativo:</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={currentSig?.data.themeColor || "#7d0000"}
                        onChange={(e) => updateCurrentData({ themeColor: e.target.value })}
                        className="w-8 h-8 rounded-lg cursor-pointer border border-slate-300 dark:border-slate-700 bg-transparent"
                      />
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400 uppercase">
                        {currentSig?.data.themeColor || "#7d0000"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ABA 3: IMAGENS (FOTO & LOGOTIPO) */}
              {activeTab === "images" && (
                <div className="space-y-5 text-xs">
                  {/* Foto de Perfil / Avatar */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">Foto de Perfil / Avatar:</span>
                      <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-800 p-0.5 rounded-lg text-[10px]">
                        <button
                          type="button"
                          onClick={() => setAvatarInputMode("upload")}
                          className={`px-2 py-0.5 rounded font-medium ${avatarInputMode === "upload" ? "bg-white dark:bg-slate-700 shadow-xs" : ""}`}
                        >
                          Upload (Base64)
                        </button>
                        <button
                          type="button"
                          onClick={() => setAvatarInputMode("url")}
                          className={`px-2 py-0.5 rounded font-medium ${avatarInputMode === "url" ? "bg-white dark:bg-slate-700 shadow-xs" : ""}`}
                        >
                          Link / URL
                        </button>
                      </div>
                    </div>

                    {avatarInputMode === "upload" ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => avatarFileRef.current?.click()}
                          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-rose-500" />
                          <span>Carregar Imagem</span>
                        </button>
                        <input
                          ref={avatarFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageUpload(e, "avatarUrl")}
                        />
                        {currentSig?.data.avatarUrl && (
                          <button
                            type="button"
                            onClick={() => updateCurrentData({ avatarUrl: "" })}
                            className="text-rose-600 text-xs hover:underline cursor-pointer"
                          >
                            Remover Foto
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="url"
                          value={currentSig?.data.avatarUrl || ""}
                          onChange={(e) => updateCurrentData({ avatarUrl: e.target.value })}
                          placeholder="https://exemplo.com.br/minha-foto.jpg"
                          className="flex-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                        />
                        {currentSig?.data.avatarUrl && (
                          <button
                            type="button"
                            onClick={() => updateCurrentData({ avatarUrl: "" })}
                            className="text-rose-600 text-xs hover:underline cursor-pointer"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    )}

                    {currentSig?.data.avatarUrl && (
                      <div className="flex items-center gap-2 pt-1">
                        <img
                          src={currentSig.data.avatarUrl}
                          alt="Avatar"
                          className="w-12 h-12 rounded-full object-cover border-2 border-[#7d0000]"
                        />
                        <span className="text-[11px] text-slate-500">Foto carregada com sucesso.</span>
                      </div>
                    )}
                  </div>

                  {/* Logotipo da Empresa */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">Logotipo da Empresa:</span>
                      <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-800 p-0.5 rounded-lg text-[10px]">
                        <button
                          type="button"
                          onClick={() => setLogoInputMode("upload")}
                          className={`px-2 py-0.5 rounded font-medium ${logoInputMode === "upload" ? "bg-white dark:bg-slate-700 shadow-xs" : ""}`}
                        >
                          Upload (Base64)
                        </button>
                        <button
                          type="button"
                          onClick={() => setLogoInputMode("url")}
                          className={`px-2 py-0.5 rounded font-medium ${logoInputMode === "url" ? "bg-white dark:bg-slate-700 shadow-xs" : ""}`}
                        >
                          Link / URL
                        </button>
                      </div>
                    </div>

                    {logoInputMode === "upload" ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => logoFileRef.current?.click()}
                          className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-rose-500" />
                          <span>Carregar Logotipo</span>
                        </button>
                        <input
                          ref={logoFileRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageUpload(e, "logoUrl")}
                        />
                        {currentSig?.data.logoUrl && (
                          <button
                            type="button"
                            onClick={() => updateCurrentData({ logoUrl: "" })}
                            className="text-rose-600 text-xs hover:underline cursor-pointer"
                          >
                            Remover Logo
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="url"
                          value={currentSig?.data.logoUrl || ""}
                          onChange={(e) => updateCurrentData({ logoUrl: e.target.value })}
                          placeholder="https://exemplo.com.br/logo.png"
                          className="flex-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                        />
                        {currentSig?.data.logoUrl && (
                          <button
                            type="button"
                            onClick={() => updateCurrentData({ logoUrl: "" })}
                            className="text-rose-600 text-xs hover:underline cursor-pointer"
                          >
                            Limpar
                          </button>
                        )}
                      </div>
                    )}

                    {currentSig?.data.logoUrl && (
                      <div className="flex items-center gap-2 pt-1">
                        <img
                          src={currentSig.data.logoUrl}
                          alt="Logo"
                          className="max-h-10 max-w-28 object-contain border border-slate-200 dark:border-slate-700 rounded-lg p-1 bg-white"
                        />
                        <span className="text-[11px] text-slate-500">Logotipo carregado com sucesso.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ABA 4: REDES SOCIAIS */}
              {activeTab === "socials" && (
                <div className="space-y-3 text-xs">
                  <p className="text-slate-500 dark:text-slate-400">
                    Insira os links dos perfis corporativos que deseja exibir na assinatura:
                  </p>
                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">LinkedIn:</label>
                    <input
                      type="url"
                      value={currentSig?.data.socials?.linkedin || ""}
                      onChange={(e) =>
                        updateCurrentData({
                          socials: { ...currentSig?.data.socials, linkedin: e.target.value },
                        })
                      }
                      placeholder="https://linkedin.com/in/seuperfil"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">Instagram:</label>
                    <input
                      type="url"
                      value={currentSig?.data.socials?.instagram || ""}
                      onChange={(e) =>
                        updateCurrentData({
                          socials: { ...currentSig?.data.socials, instagram: e.target.value },
                        })
                      }
                      placeholder="https://instagram.com/empresa"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">WhatsApp (Número com DDD):</label>
                    <input
                      type="text"
                      value={currentSig?.data.socials?.whatsapp || ""}
                      onChange={(e) =>
                        updateCurrentData({
                          socials: { ...currentSig?.data.socials, whatsapp: e.target.value },
                        })
                      }
                      placeholder="+5511987654321"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="font-semibold text-slate-500 dark:text-slate-400 block mb-1">GitHub / Portfólio:</label>
                    <input
                      type="url"
                      value={currentSig?.data.socials?.github || ""}
                      onChange={(e) =>
                        updateCurrentData({
                          socials: { ...currentSig?.data.socials, github: e.target.value },
                        })
                      }
                      placeholder="https://github.com/empresa"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* ABA 5: HTML PRONTO (CÓDIGO PURO) */}
              {activeTab === "html" && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Editor de Código HTML da Assinatura:
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateCurrentSig({
                          type: "template",
                          customHtml: undefined,
                        })
                      }
                      className="text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Regenerar a partir do Modelo</span>
                    </button>
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 leading-relaxed text-[11px]">
                    Cole aqui qualquer HTML personalizado ou ajuste diretamente o código da sua assinatura. A visualização à direita atualiza em tempo real:
                  </p>
                  <textarea
                    rows={12}
                    value={renderedHTML}
                    onChange={(e) =>
                      updateCurrentSig({
                        type: "html",
                        customHtml: e.target.value,
                      })
                    }
                    placeholder="<table><tr><td>Seu HTML de assinatura aqui...</td></tr></table>"
                    className="w-full bg-slate-50 dark:bg-black/50 border border-slate-300 dark:border-slate-800 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 font-mono focus:outline-none resize-y"
                  />
                </div>
              )}
            </div>
          </div>

          {/* COLUNA DIREITA: Preview em Tempo Real (Desktop & Mobile) */}
          <div className="w-full md:w-1/2 lg:w-7/12 flex flex-col min-h-0 bg-slate-100/70 dark:bg-[#080101] p-4 sm:p-6 overflow-y-auto">
            {/* Controles de Preview */}
            <div className="flex items-center justify-between mb-3 select-none">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <span>Pré-visualização em Tempo Real</span>
              </span>

              <div className="flex items-center gap-2">
                {/* Seletor Desktop / Mobile */}
                <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("desktop")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                      previewMode === "desktop"
                        ? "bg-[#7d0000] text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Laptop className="w-3.5 h-3.5" />
                    <span>Desktop</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("mobile")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition cursor-pointer ${
                      previewMode === "mobile"
                        ? "bg-[#7d0000] text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Mobile</span>
                  </button>
                </div>

                {/* Botão Copiar HTML */}
                <button
                  type="button"
                  onClick={handleCopyHTML}
                  className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                  title="Copiar código HTML para colar em outros programas"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "Copiado!" : "Copiar HTML"}</span>
                </button>
              </div>
            </div>

            {/* Janela Simuladora de E-mail */}
            <div
              className={`mx-auto bg-white rounded-2xl border border-slate-300/80 shadow-xl overflow-hidden transition-all duration-300 flex flex-col ${
                previewMode === "mobile" ? "w-[360px]" : "w-full max-w-2xl"
              }`}
            >
              {/* Barra de Janela Estilo macOS */}
              <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5 select-none">
                <div className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-slate-400 font-medium ml-2 font-mono">
                  {previewMode === "mobile" ? "Visualização em Smartphone (360px)" : "Visualização no Webmail"}
                </span>
              </div>

              {/* Cabeçalho do E-mail Simulado */}
              <div className="p-4 border-b border-slate-100 text-xs space-y-1.5 bg-slate-50/50">
                <div className="flex items-center text-slate-500">
                  <span className="w-16 font-semibold">Para:</span>
                  <span className="text-slate-800 font-mono text-[11px]">cliente@empresa-parceira.com.br</span>
                </div>
                <div className="flex items-center text-slate-500">
                  <span className="w-16 font-semibold">Assunto:</span>
                  <span className="text-slate-800 font-semibold">Proposta Comercial &amp; Documentação Técnica</span>
                </div>
              </div>

              {/* Corpo da Mensagem e Assinatura */}
              <div className="p-5 sm:p-6 space-y-4 text-xs text-slate-800 leading-relaxed font-sans min-h-[220px]">
                <p>Olá,</p>
                <p>
                  Seguem em anexo os relatórios solicitados e o cronograma para aprovação. Caso tenha qualquer dúvida, estamos à disposição.
                </p>
                <p className="text-slate-500">Atenciosamente,</p>

                {/* Renderização Real da Assinatura */}
                <div
                  className="pt-2 select-text"
                  dangerouslySetInnerHTML={{ __html: renderedHTML }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
</div>
  );
}
