"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Minus,
  Link2,
  Image as ImageIcon,
  Smile,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  RemoveFormatting,
  Palette,
  Highlighter,
  FileText,
  Sparkles,
  Trash2,
  ChevronDown,
} from "lucide-react";

interface RichEmailEditorProps {
  initialContent?: string;
  onChange: (content: { text: string; html: string }) => void;
  placeholder?: string;
}

const COMMON_EMOJIS = [
  "👍", "👏", "💼", "✉️", "📎", "🔒", "🛡️", "💡",
  "⚠️", "✅", "❌", "🚀", "📅", "📊", "📞", "🤝",
  "🎯", "📌", "⭐", "🎉", "🙏", "❤️", "😊", "👋"
];

const TEXT_COLORS = [
  { label: "Padrão", value: "#0f172a" },
  { label: "Cinza", value: "#64748b" },
  { label: "Vermelho Maivw", value: "#7d0000" },
  { label: "Azul Corporativo", value: "#1d4ed8" },
  { label: "Verde Sucesso", value: "#15803d" },
  { label: "Âmbar / Aviso", value: "#b45309" },
  { label: "Roxo", value: "#7e22ce" },
  { label: "Preto Absoluto", value: "#000000" },
];

const HIGHLIGHT_COLORS = [
  { label: "Sem realce", value: "transparent" },
  { label: "Amarelo Suave", value: "#fef08a" },
  { label: "Verde Claro", value: "#bbf7d0" },
  { label: "Azul Suave", value: "#bfdbfe" },
  { label: "Rosa / Alerta", value: "#fecaca" },
];

const FONT_FAMILIES = [
  { label: "Sans (Padrão)", value: "ui-sans-serif, system-ui, -apple-system, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia (Serif)", value: "Georgia, Cambria, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier (Mono)", value: "ui-monospace, 'Courier New', monospace" },
];

const HEADING_OPTIONS = [
  { label: "Normal", tag: "normal" },
  { label: "Título 1 (Grande)", tag: "h1" },
  { label: "Título 2 (Médio)", tag: "h2" },
  { label: "Título 3 (Pequeno)", tag: "h3" },
];

export default function RichEmailEditor({
  initialContent = "",
  onChange,
  placeholder = "Digite sua mensagem aqui... Use a barra de ferramentas para formatar ou cole imagens com Ctrl+V.",
}: RichEmailEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [isPlainMode, setIsPlainMode] = useState(false);
  const [plainText, setPlainText] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showHeadingPicker, setShowHeadingPicker] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [linkText, setLinkText] = useState("");
  const [currentFontLabel, setCurrentFontLabel] = useState(FONT_FAMILIES[0].label);
  const [currentHeadingLabel, setCurrentHeadingLabel] = useState(HEADING_OPTIONS[0].label);
  const [savedSelection, setSavedSelection] = useState<Range | null>(null);

  // Estado para imagem selecionada (redimensionamento / alinhamento)
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);

  const isInitializedRef = useRef(false);

  // Inicializa conteúdo apenas na primeira montagem ou se mudar externamente sem estar com foco
  useEffect(() => {
    if (!editorRef.current) return;

    const isFocused =
      typeof document !== "undefined" &&
      (document.activeElement === editorRef.current || editorRef.current.contains(document.activeElement));

    if (isInitializedRef.current && isFocused) {
      return;
    }

    if (initialContent) {
      if (initialContent.includes("<") && initialContent.includes(">")) {
        editorRef.current.innerHTML = initialContent;
      } else {
        editorRef.current.innerText = initialContent;
      }
    } else if (!isInitializedRef.current) {
      editorRef.current.innerHTML = "";
    }
    isInitializedRef.current = true;
    setPlainText(editorRef.current.innerText || "");
  }, [initialContent]);

  // Salva a seleção do cursor antes de abrir menus
  const saveCurrentSelection = () => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      setSavedSelection(sel.getRangeAt(0).cloneRange());
    }
  };

  const restoreCurrentSelection = () => {
    if (typeof window === "undefined" || !savedSelection) return;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(savedSelection);
    }
  };

  // Dispara evento de alteração para o componente pai
  const handleEditorInput = useCallback(() => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    const text = editorRef.current.innerText || "";
    setPlainText(text);
    onChange({ text, html });
  }, [onChange]);

  // Executa comando no contentEditable
  const executeCommand = (command: string, value: string | undefined = undefined) => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, value);
    handleEditorInput();
  };

  // Aplica Família de Fonte APENAS no trecho selecionado
  const handleFontSelect = (fontValue: string, fontLabel: string) => {
    restoreCurrentSelection();
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand("fontName", false, fontValue);
    setCurrentFontLabel(fontLabel);
    setShowFontPicker(false);
    handleEditorInput();
  };

  // Aplica Formatação de Título no bloco selecionado
  const handleHeadingSelect = (tag: string, label: string) => {
    restoreCurrentSelection();
    if (editorRef.current) {
      editorRef.current.focus();
    }
    if (tag === "normal") {
      try {
        document.execCommand("formatBlock", false, "<p>");
      } catch {
        document.execCommand("formatBlock", false, "p");
      }
    } else {
      const headingTag = tag.toUpperCase();
      try {
        document.execCommand("formatBlock", false, `<${headingTag}>`);
      } catch {
        document.execCommand("formatBlock", false, headingTag);
      }
    }
    setCurrentHeadingLabel(label);
    setShowHeadingPicker(false);
    handleEditorInput();
  };

  // Inserir Citação / Callout preservando o texto selecionado
  const handleInsertQuote = () => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    let selectedContent = "";

    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const container = document.createElement("div");
      container.appendChild(range.cloneContents());
      selectedContent = container.innerHTML.trim();
    }

    if (selectedContent) {
      // O usuário selecionou texto: envolve o texto selecionado na citação formatada
      const quoteHtml = `
        <blockquote style="border-left: 4px solid #7d0000; padding: 10px 16px; margin: 12px 0; background-color: #f8fafc; color: #334155; font-style: italic; border-radius: 4px;">
          ${selectedContent}
        </blockquote><p><br></p>
      `;
      document.execCommand("insertHTML", false, quoteHtml);
    } else {
      // Nenhum texto selecionado: insere uma citação com dica
      const quoteHtml = `
        <blockquote style="border-left: 4px solid #7d0000; padding: 10px 16px; margin: 12px 0; background-color: #f8fafc; color: #334155; font-style: italic; border-radius: 4px;">
          Digite sua citação ou observação aqui...
        </blockquote><p><br></p>
      `;
      document.execCommand("insertHTML", false, quoteHtml);
    }
    handleEditorInput();
  };

  // Inserir Link
  const handleOpenLinkModal = () => {
    saveCurrentSelection();
    const sel = window.getSelection();
    const selected = sel ? sel.toString() : "";
    setLinkText(selected);
    setLinkUrl("https://");
    setShowLinkModal(true);
  };

  const handleApplyLink = () => {
    restoreCurrentSelection();
    if (!linkUrl || linkUrl === "https://") {
      setShowLinkModal(false);
      return;
    }

    if (linkText) {
      const linkHtml = `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline;">${linkText}</a>`;
      executeCommand("insertHTML", linkHtml);
    } else {
      executeCommand("createLink", linkUrl);
    }
    setShowLinkModal(false);
  };

  // Inserir Imagem (Base64)
  const handleInsertImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64Url = reader.result as string;
      const imgHtml = `<p><img src="${base64Url}" alt="${file.name}" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; display: block;" /></p><p><br></p>`;
      executeCommand("insertHTML", imgHtml);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  // Inserir Emoji
  const handleInsertEmoji = (emoji: string) => {
    restoreCurrentSelection();
    executeCommand("insertText", emoji);
    setShowEmojiPicker(false);
  };

  // Interceptar Colagem (Ctrl+V) de Imagens diretamente da Área de Transferência
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64Url = reader.result as string;
            const imgHtml = `<p><img src="${base64Url}" alt="Imagem colada" style="max-width: 100%; height: auto; border-radius: 8px; margin: 10px 0; display: block;" /></p><p><br></p>`;
            executeCommand("insertHTML", imgHtml);
          };
          reader.readAsDataURL(file);
        }
        return;
      }
    }
  };

  // Detecta clique em imagens dentro do editor para abrir o menu de redimensionamento
  const handleEditorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target && target.tagName === "IMG") {
      setSelectedImage(target as HTMLImageElement);
    } else {
      setSelectedImage(null);
    }
  };

  // Redimensiona a imagem selecionada para porcentagens padrão seguras para e-mail
  const handleResizeImage = (widthPercent: number) => {
    if (!selectedImage) return;
    selectedImage.style.width = `${widthPercent}%`;
    selectedImage.style.maxWidth = "100%";
    selectedImage.style.height = "auto";
    handleEditorInput();
  };

  // Alinha a imagem selecionada
  const handleAlignImage = (align: "left" | "center" | "right") => {
    if (!selectedImage) return;
    if (align === "center") {
      selectedImage.style.display = "block";
      selectedImage.style.marginLeft = "auto";
      selectedImage.style.marginRight = "auto";
      selectedImage.style.float = "none";
    } else if (align === "left") {
      selectedImage.style.display = "block";
      selectedImage.style.marginLeft = "0";
      selectedImage.style.marginRight = "auto";
      selectedImage.style.float = "none";
    } else if (align === "right") {
      selectedImage.style.display = "block";
      selectedImage.style.marginLeft = "auto";
      selectedImage.style.marginRight = "0";
      selectedImage.style.float = "none";
    }
    handleEditorInput();
  };

  // Remove a imagem selecionada
  const handleRemoveSelectedImage = () => {
    if (!selectedImage) return;
    selectedImage.remove();
    setSelectedImage(null);
    handleEditorInput();
  };

  // Alternar entre Modo Formatado e Modo Texto Simples
  const togglePlainMode = () => {
    if (isPlainMode) {
      setIsPlainMode(false);
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.innerText = plainText;
          handleEditorInput();
        }
      }, 50);
    } else {
      if (editorRef.current) {
        const text = editorRef.current.innerText || "";
        setPlainText(text);
        onChange({ text, html: text.replace(/\n/g, "<br>") });
      }
      setIsPlainMode(true);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden transition-all focus-within:border-[#7d0000]/60">
      {/* 1. BARRA DE FERRAMENTAS VISUAL SUPERIOR */}
      {!isPlainMode && (
        <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900/90 flex flex-wrap items-center gap-1 text-slate-700 dark:text-slate-300 text-xs select-none">
          {/* Seletor Customizado de Família de Fonte (Não perde seleção de texto) */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                saveCurrentSelection();
              }}
              onClick={() => {
                setShowFontPicker(!showFontPicker);
                setShowHeadingPicker(false);
                setShowColorPicker(false);
                setShowHighlightPicker(false);
                setShowEmojiPicker(false);
              }}
              className="h-7 px-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 font-medium flex items-center gap-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
              title="Mudar fonte do texto selecionado"
            >
              <span>{currentFontLabel}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showFontPicker && (
              <div className="absolute left-0 top-8 z-30 p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col gap-1 w-48 animate-in fade-in">
                {FONT_FAMILIES.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleFontSelect(f.value, f.label)}
                    className="px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span style={{ fontFamily: f.value }}>{f.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Seletor Customizado de Tamanho / Cabeçalho (Não perde seleção de texto) */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                saveCurrentSelection();
              }}
              onClick={() => {
                setShowHeadingPicker(!showHeadingPicker);
                setShowFontPicker(false);
                setShowColorPicker(false);
                setShowHighlightPicker(false);
                setShowEmojiPicker(false);
              }}
              className="h-7 px-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 font-medium flex items-center gap-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
              title="Estilo de Parágrafo / Títulos"
            >
              <span>{currentHeadingLabel}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showHeadingPicker && (
              <div className="absolute left-0 top-8 z-30 p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col gap-1 w-44 animate-in fade-in">
                {HEADING_OPTIONS.map((h) => (
                  <button
                    key={h.tag}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleHeadingSelect(h.tag, h.label)}
                    className="px-2.5 py-1.5 rounded-lg text-left text-xs text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer font-medium"
                  >
                    <span>{h.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 mx-1" />

          {/* Estilos Inline (B, I, U, S) */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("bold")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Negrito (Ctrl+B)"
          >
            <Bold className="w-3.5 h-3.5 font-bold" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("italic")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Itálico (Ctrl+I)"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("underline")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Sublinhado (Ctrl+U)"
          >
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("strikeThrough")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Tachado"
          >
            <Strikethrough className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 mx-1" />

          {/* Cor do Texto (Popover) */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                saveCurrentSelection();
              }}
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowHighlightPicker(false);
                setShowEmojiPicker(false);
                setShowFontPicker(false);
                setShowHeadingPicker(false);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
              title="Cor do Texto"
            >
              <Palette className="w-3.5 h-3.5 text-rose-600 dark:text-red-400" />
            </button>

            {showColorPicker && (
              <div className="absolute left-0 top-8 z-30 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl grid grid-cols-4 gap-1.5 w-44 animate-in fade-in">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      restoreCurrentSelection();
                      executeCommand("foreColor", c.value);
                      setShowColorPicker(false);
                    }}
                    className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-[10px] hover:scale-105 transition-transform cursor-pointer"
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Cor de Fundo / Realce (Highlight) */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                saveCurrentSelection();
              }}
              onClick={() => {
                setShowHighlightPicker(!showHighlightPicker);
                setShowColorPicker(false);
                setShowEmojiPicker(false);
                setShowFontPicker(false);
                setShowHeadingPicker(false);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
              title="Cor de Fundo / Realce"
            >
              <Highlighter className="w-3.5 h-3.5 text-amber-500" />
            </button>

            {showHighlightPicker && (
              <div className="absolute left-0 top-8 z-30 p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col gap-1.5 w-40 animate-in fade-in">
                {HIGHLIGHT_COLORS.map((hc) => (
                  <button
                    key={hc.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      restoreCurrentSelection();
                      executeCommand("hiliteColor", hc.value);
                      setShowHighlightPicker(false);
                    }}
                    className="px-2 py-1 rounded text-left text-xs text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 cursor-pointer"
                  >
                    <span
                      className="w-4 h-4 rounded border border-slate-300 dark:border-slate-600 inline-block"
                      style={{ backgroundColor: hc.value }}
                    />
                    <span>{hc.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 mx-1" />

          {/* Alinhamento */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("justifyLeft")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Alinhar à Esquerda"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("justifyCenter")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Centralizar"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("justifyRight")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Alinhar à Direita"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("justifyFull")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Justificar"
          >
            <AlignJustify className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 mx-1" />

          {/* Listas e Estruturas */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("insertUnorderedList")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Lista com Marcadores (Pontos)"
          >
            <List className="w-3.5 h-3.5 font-bold" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("insertOrderedList")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Lista Numerada (1, 2, 3...)"
          >
            <ListOrdered className="w-3.5 h-3.5 font-bold" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleInsertQuote}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Citação / Bloco em Destaque (Transforma o texto selecionado)"
          >
            <Quote className="w-3.5 h-3.5 text-[#7d0000] dark:text-red-400" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("insertHorizontalRule")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Linha Divisória"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <div className="w-[1px] h-4 bg-slate-300 dark:bg-slate-700 mx-1" />

          {/* Inserção de Link */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              saveCurrentSelection();
            }}
            onClick={handleOpenLinkModal}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Inserir Link"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>

          {/* Inserção de Imagem */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => imageInputRef.current?.click()}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Inserir Imagem (também aceita Ctrl+V!)"
          >
            <ImageIcon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleInsertImageFile}
          />

          {/* Inserção de Emoji */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                saveCurrentSelection();
              }}
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowColorPicker(false);
                setShowHighlightPicker(false);
                setShowFontPicker(false);
                setShowHeadingPicker(false);
              }}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
              title="Inserir Emoji"
            >
              <Smile className="w-3.5 h-3.5 text-amber-500" />
            </button>

            {showEmojiPicker && (
              <div className="absolute left-0 top-8 z-30 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl grid grid-cols-6 gap-1 w-56 animate-in fade-in">
                {COMMON_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleInsertEmoji(emoji)}
                    className="p-1.5 text-base hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-transform hover:scale-110 flex items-center justify-center cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Limpar Formatação */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => executeCommand("removeFormat")}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
            title="Remover Formatação do Texto Selecionado"
          >
            <RemoveFormatting className="w-3.5 h-3.5" />
          </button>

          {/* Botão de Alternar Modo */}
          <div className="ml-auto">
            <button
              type="button"
              onClick={togglePlainMode}
              className="px-2 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
              title="Alternar para edição em texto simples"
            >
              <FileText className="w-3 h-3" />
              <span>Modo Texto Simples</span>
            </button>
          </div>
        </div>
      )}

      {/* Barra do Modo Texto Simples */}
      {isPlainMode && (
        <div className="p-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span className="flex items-center gap-1.5 font-medium">
            <FileText className="w-3.5 h-3.5" />
            Modo Texto Simples (Sem formatação rica)
          </span>
          <button
            type="button"
            onClick={togglePlainMode}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-rose-700 dark:text-red-300 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 transition-colors cursor-pointer flex items-center gap-1"
          >
            <Sparkles className="w-3 h-3" />
            <span>Voltar para Modo Formatado</span>
          </button>
        </div>
      )}

      {/* 2. ÁREA DE DIGITAÇÃO CONTÍNUA (TEMA CLARO / FOLHA BRANCA CORPORATIVA) */}
      {isPlainMode ? (
        <textarea
          rows={10}
          value={plainText}
          onChange={(e) => {
            setPlainText(e.target.value);
            onChange({ text: e.target.value, html: e.target.value.replace(/\n/g, "<br>") });
          }}
          placeholder={placeholder}
          className="w-full p-5 bg-white text-slate-900 placeholder-slate-400 font-mono focus:outline-none resize-y min-h-[260px] border-t border-slate-200"
        />
      ) : (
        <div className="relative bg-white border-t border-slate-200">
          {/* Barra flutuante de redimensionamento e alinhamento quando uma imagem é selecionada */}
          {selectedImage && (
            <div className="sticky top-2 z-20 mx-4 my-2 p-2 bg-slate-900 text-white rounded-xl shadow-xl border border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs animate-in fade-in">
              <div className="flex items-center gap-1.5 font-semibold text-slate-300">
                <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tamanho da Imagem:</span>
              </div>

              {/* Botões de Tamanho */}
              <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleResizeImage(25)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="25% de largura (Pequena)"
                >
                  25%
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleResizeImage(50)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="50% de largura (Média)"
                >
                  50%
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleResizeImage(75)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="75% de largura (Grande)"
                >
                  75%
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleResizeImage(100)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="100% de largura (Largura Total)"
                >
                  100%
                </button>
              </div>

              {/* Botões de Alinhamento da Imagem */}
              <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAlignImage("left")}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="Alinhar à esquerda"
                >
                  Esquerda
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAlignImage("center")}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="Centralizar imagem"
                >
                  Centro
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAlignImage("right")}
                  className="px-2 py-0.5 rounded text-[11px] font-medium hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
                  title="Alinhar à direita"
                >
                  Direita
                </button>
              </div>

              {/* Botão de Remover Imagem */}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleRemoveSelectedImage}
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                title="Excluir imagem do e-mail"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remover</span>
              </button>
            </div>
          )}

          <div
            ref={editorRef}
            contentEditable
            onClick={handleEditorClick}
            onInput={handleEditorInput}
            onPaste={handlePaste}
            className="rich-email-canvas p-5 min-h-[260px] max-h-[500px] overflow-y-auto text-sm text-slate-900 bg-white focus:outline-none leading-relaxed transition-colors selection:bg-[#7d0000]/20"
            data-placeholder={placeholder}
            suppressContentEditableWarning
          />
        </div>
      )}

      {/* Modal / Diálogo para Inserir Link */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 w-full max-w-sm shadow-2xl space-y-3">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-rose-500" />
              <span>Inserir Hiperlink</span>
            </h4>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Texto a exibir:
              </label>
              <input
                type="text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder="ex: Clique aqui ou Nome do Site"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Endereço Web (URL):
              </label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://exemplo.com.br"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-[#7d0000]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="px-3 py-1 rounded-lg text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApplyLink}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#7d0000] hover:bg-[#990000] text-white transition-colors cursor-pointer"
              >
                Inserir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
