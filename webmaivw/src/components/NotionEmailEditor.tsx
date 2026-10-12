"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  AlertCircle,
  Minus,
  Sparkles,
  Check,
  Type,
  AlignLeft,
} from "lucide-react";

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bullet"
  | "number"
  | "quote"
  | "callout"
  | "divider";

export interface EditorBlock {
  id: string;
  type: BlockType;
  content: string;
  calloutIcon?: string;
}

interface CommandItem {
  type: BlockType;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SLASH_COMMANDS: CommandItem[] = [
  { type: "paragraph", label: "Texto Normal", desc: "Parágrafo padrão", icon: Type },
  { type: "heading1", label: "Título Principal (H1)", desc: "Cabeçalho de seção H1", icon: Heading1 },
  { type: "heading2", label: "Subtítulo (H2)", desc: "Subtítulo de seção H2", icon: Heading2 },
  { type: "bullet", label: "Lista com Marcadores", desc: "Lista simples de pontos", icon: List },
  { type: "number", label: "Lista Numerada", desc: "Lista de passos 1, 2, 3", icon: ListOrdered },
  { type: "quote", label: "Citação", desc: "Bloco de citação destacada", icon: Quote },
  { type: "callout", label: "Caixa de Alerta / Aviso", desc: "Card em destaque com ícone", icon: AlertCircle },
  { type: "divider", label: "Divisor Horizontal", desc: "Linha divisória de conteúdo", icon: Minus },
];

interface NotionEmailEditorProps {
  initialContent?: string;
  onChange: (data: { text: string; html: string }) => void;
}

export function NotionEmailEditor({ initialContent, onChange }: NotionEmailEditorProps) {
  const [mode, setMode] = useState<"blocks" | "plain">("blocks");
  const [plainText, setPlainText] = useState(initialContent || "");
  const [blocks, setBlocks] = useState<EditorBlock[]>([
    { id: "b1", type: "paragraph", content: initialContent || "" },
  ]);

  const [activeBlockId, setActiveBlockId] = useState<string>("b1");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSearch, setSlashSearch] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const blockRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Sincronizar quando initialContent mudar (limpeza ou resposta/encaminhamento)
  useEffect(() => {
    const textVal = initialContent || "";
    setPlainText(textVal);

    if (textVal) {
      const lines = textVal.split("\n");
      const newBlocks: EditorBlock[] = lines.map((line, idx) => {
        if (line.startsWith("# ")) return { id: `b_${idx}_${Date.now()}`, type: "heading1", content: line.slice(2) };
        if (line.startsWith("## ")) return { id: `b_${idx}_${Date.now()}`, type: "heading2", content: line.slice(3) };
        if (line.startsWith("• ") || line.startsWith("- ")) return { id: `b_${idx}_${Date.now()}`, type: "bullet", content: line.slice(2) };
        if (line.startsWith("> ")) return { id: `b_${idx}_${Date.now()}`, type: "quote", content: line.slice(2) };
        return { id: `b_${idx}_${Date.now()}`, type: "paragraph", content: line };
      });
      setBlocks(newBlocks.length > 0 ? newBlocks : [{ id: `b1_${Date.now()}`, type: "paragraph", content: "" }]);
    } else {
      setBlocks([{ id: `b1_${Date.now()}`, type: "paragraph", content: "" }]);
    }
  }, [initialContent]);

  // Converter blocos para HTML compatível com clientes de e-mail (Gmail/Outlook)
  const compileBlocksToHTML = (currentBlocks: EditorBlock[]): string => {
    let html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;">\n`;

    let inBulletList = false;
    let inNumberedList = false;

    for (let i = 0; i < currentBlocks.length; i++) {
      const b = currentBlocks[i];
      const nextB = currentBlocks[i + 1];

      // Fechar lista se o próximo não for lista
      if (b.type === "bullet") {
        if (!inBulletList) {
          html += `<ul style="margin: 8px 0; padding-left: 24px; color: #334155;">\n`;
          inBulletList = true;
        }
        html += `  <li style="margin-bottom: 4px;">${escapeHtml(b.content)}</li>\n`;
        if (!nextB || nextB.type !== "bullet") {
          html += `</ul>\n`;
          inBulletList = false;
        }
        continue;
      }

      if (b.type === "number") {
        if (!inNumberedList) {
          html += `<ol style="margin: 8px 0; padding-left: 24px; color: #334155;">\n`;
          inNumberedList = true;
        }
        html += `  <li style="margin-bottom: 4px;">${escapeHtml(b.content)}</li>\n`;
        if (!nextB || nextB.type !== "number") {
          html += `</ol>\n`;
          inNumberedList = false;
        }
        continue;
      }

      // Outros tipos
      switch (b.type) {
        case "heading1":
          html += `<h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 16px 0 8px 0;">${escapeHtml(b.content)}</h1>\n`;
          break;
        case "heading2":
          html += `<h2 style="font-size: 17px; font-weight: 600; color: #1e293b; margin: 14px 0 6px 0;">${escapeHtml(b.content)}</h2>\n`;
          break;
        case "quote":
          html += `<blockquote style="margin: 12px 0; padding: 8px 16px; border-left: 3px solid #7d0000; color: #475569; font-style: italic; background-color: #f8fafc;">${escapeHtml(b.content)}</blockquote>\n`;
          break;
        case "callout":
          html += `<div style="margin: 14px 0; padding: 12px 16px; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; display: flex; align-items: flex-start; gap: 8px;">
  <span style="font-size: 16px;">${b.calloutIcon || "💡"}</span>
  <div style="flex: 1; font-size: 14px; font-weight: 500;">${escapeHtml(b.content)}</div>
</div>\n`;
          break;
        case "divider":
          html += `<hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 18px 0;" />\n`;
          break;
        case "paragraph":
        default:
          if (b.content.trim()) {
            html += `<p style="margin: 0 0 10px 0;">${escapeHtml(b.content).replace(/\n/g, "<br/>")}</p>\n`;
          } else {
            html += `<p style="margin: 0 0 10px 0;">&nbsp;</p>\n`;
          }
          break;
      }
    }

    html += `</div>`;
    return html;
  };

  const compileBlocksToPlain = (currentBlocks: EditorBlock[]): string => {
    return currentBlocks
      .map((b) => {
        switch (b.type) {
          case "heading1":
            return `# ${b.content}`;
          case "heading2":
            return `## ${b.content}`;
          case "bullet":
            return `• ${b.content}`;
          case "number":
            return `1. ${b.content}`;
          case "quote":
            return `> ${b.content}`;
          case "callout":
            return `[AVISO: ${b.content}]`;
          case "divider":
            return `---`;
          default:
            return b.content;
        }
      })
      .join("\n\n");
  };

  // Notificar componente pai com o conteúdo atual
  const notifyChange = (updatedBlocks: EditorBlock[]) => {
    const html = compileBlocksToHTML(updatedBlocks);
    const text = compileBlocksToPlain(updatedBlocks);
    onChange({ text, html });
  };

  const updateBlockContent = (id: string, text: string) => {
    setBlocks((prev) => {
      const updated = prev.map((b) => (b.id === id ? { ...b, content: text } : b));
      notifyChange(updated);
      return updated;
    });

    // Detectar gatilho '/' para o menu Notion
    if (text.startsWith("/")) {
      setSlashMenuOpen(true);
      setSlashSearch(text.slice(1).toLowerCase());
      setSlashSelectedIndex(0);
    } else {
      setSlashMenuOpen(false);
    }
  };

  const changeBlockType = (id: string, newType: BlockType) => {
    setBlocks((prev) => {
      const updated = prev.map((b) => {
        if (b.id === id) {
          const cleanContent = b.content.startsWith("/") ? b.content.replace(/^\/[a-zA-Z0-9]*/, "").trim() : b.content;
          return {
            ...b,
            type: newType,
            content: cleanContent,
            calloutIcon: newType === "callout" ? "💡" : undefined,
          };
        }
        return b;
      });
      notifyChange(updated);
      return updated;
    });
    setSlashMenuOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, id: string, index: number) => {
    // Menu Slash aberto
    if (slashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredCommands[slashSelectedIndex];
        if (selected) {
          changeBlockType(id, selected.type);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }

    // Criar novo bloco ao pressionar Enter (se não for shift+enter)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const newId = `b_${Date.now()}`;
      const newBlock: EditorBlock = {
        id: newId,
        type: blocks[index]?.type === "bullet" ? "bullet" : blocks[index]?.type === "number" ? "number" : "paragraph",
        content: "",
      };

      setBlocks((prev) => {
        const next = [...prev];
        next.splice(index + 1, 0, newBlock);
        notifyChange(next);
        return next;
      });

      setActiveBlockId(newId);
      setTimeout(() => {
        blockRefs.current[newId]?.focus();
      }, 50);
      return;
    }

    // Deletar bloco se estiver vazio ao pressionar Backspace
    if (e.key === "Backspace" && blocks[index].content === "" && blocks.length > 1) {
      e.preventDefault();
      const prevBlock = blocks[index - 1];
      setBlocks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        notifyChange(next);
        return next;
      });

      if (prevBlock) {
        setActiveBlockId(prevBlock.id);
        setTimeout(() => {
          const el = blockRefs.current[prevBlock.id];
          if (el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
          }
        }, 50);
      }
      return;
    }
  };

  // Alternar para modo texto simples ou blocos (SEM duplicação de assinatura)
  const handleToggleMode = () => {
    if (mode === "blocks") {
      const plain = compileBlocksToPlain(blocks);
      setPlainText(plain);
      setMode("plain");
    } else {
      const lines = plainText.split("\n").filter((l) => l.trim().length > 0);
      const newBlocks: EditorBlock[] = lines.length > 0
        ? lines.map((line, idx) => {
            if (line.startsWith("# ")) return { id: `b_${idx}_${Date.now()}`, type: "heading1", content: line.slice(2) };
            if (line.startsWith("## ")) return { id: `b_${idx}_${Date.now()}`, type: "heading2", content: line.slice(3) };
            if (line.startsWith("• ") || line.startsWith("- ")) return { id: `b_${idx}_${Date.now()}`, type: "bullet", content: line.slice(2) };
            if (line.startsWith("> ")) return { id: `b_${idx}_${Date.now()}`, type: "quote", content: line.slice(2) };
            return { id: `b_${idx}_${Date.now()}`, type: "paragraph", content: line };
          })
        : [{ id: `b1_${Date.now()}`, type: "paragraph", content: "" }];
      setBlocks(newBlocks);
      setMode("blocks");
      notifyChange(newBlocks);
    }
  };

  const filteredCommands = SLASH_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(slashSearch) || c.type.toLowerCase().includes(slashSearch)
  );

  return (
    <div className="relative border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950/60 overflow-hidden shadow-sm flex flex-col transition-colors">
      {/* Header do Editor */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
            <Sparkles className="w-3.5 h-3.5 text-rose-500" />
            {mode === "blocks" ? "Editor de Blocos (Estilo Notion)" : "Editor de Texto Simples"}
          </span>
          {mode === "blocks" && (
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-[10px] text-slate-600 dark:text-slate-400 font-mono">
              Digite &quot;/&quot; para comandos
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleToggleMode}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors border border-slate-200 dark:border-slate-700 shadow-xs"
        >
          {mode === "blocks" ? (
            <>
              <AlignLeft className="w-3 h-3 text-slate-500" />
              <span>Modo Texto Simples</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3 text-rose-500" />
              <span>Modo Blocos Notion</span>
            </>
          )}
        </button>
      </div>

      {/* Corpo do Editor */}
      <div className="p-3 min-h-[190px] max-h-[340px] overflow-y-auto">
        {mode === "plain" ? (
          <textarea
            value={plainText}
            onChange={(e) => {
              const val = e.target.value;
              setPlainText(val);
              onChange({
                text: val,
                html: `<div style="font-family: sans-serif; font-size: 15px; color: #1e293b;">${escapeHtml(val).replace(/\n/g, "<br/>")}</div>`,
              });
            }}
            placeholder="Digite o texto do e-mail corporativo..."
            className="w-full h-44 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none resize-none font-sans leading-relaxed"
          />
        ) : (
          <div className="space-y-1.5">
            {blocks.map((block, idx) => {
              const isH1 = block.type === "heading1";
              const isH2 = block.type === "heading2";
              const isBullet = block.type === "bullet";
              const isNumber = block.type === "number";
              const isQuote = block.type === "quote";
              const isCallout = block.type === "callout";
              const isDivider = block.type === "divider";

              if (isDivider) {
                return (
                  <div
                    key={block.id}
                    onClick={() => setActiveBlockId(block.id)}
                    className="py-2 cursor-pointer group flex items-center justify-between"
                  >
                    <hr className="flex-1 border-t border-slate-300 dark:border-slate-700" />
                    <button
                      type="button"
                      onClick={() =>
                        setBlocks((prev) => {
                          const next = prev.filter((b) => b.id !== block.id);
                          notifyChange(next);
                          return next;
                        })
                      }
                      className="opacity-0 group-hover:opacity-100 text-[10px] text-rose-500 px-1 ml-2 hover:underline"
                    >
                      Remover
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={block.id}
                  className={`relative group flex items-start gap-2 rounded-lg p-1 transition-colors ${
                    isCallout
                      ? "bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-rose-900 dark:text-rose-200 p-2.5"
                      : isQuote
                      ? "border-l-3 border-[#7d0000] bg-slate-50 dark:bg-slate-900/60 pl-3 py-1 italic"
                      : "hover:bg-slate-100/60 dark:hover:bg-slate-900/40"
                  }`}
                >
                  {/* Ícones de prefixo */}
                  {isBullet && <span className="text-slate-400 text-sm select-none pt-0.5">•</span>}
                  {isNumber && <span className="text-slate-400 text-xs font-mono select-none pt-1">{idx + 1}.</span>}
                  {isCallout && <span className="text-base shrink-0 pt-0.5">{block.calloutIcon || "💡"}</span>}

                  <textarea
                    ref={(el) => {
                      blockRefs.current[block.id] = el;
                    }}
                    rows={1}
                    value={block.content}
                    placeholder={
                      isH1
                        ? "Título da Seção..."
                        : isH2
                        ? "Subtítulo..."
                        : isCallout
                        ? "Aviso ou destaque importante..."
                        : isQuote
                        ? "Citação..."
                        : idx === 0
                        ? "Digite sua mensagem ou '/' para blocos..."
                        : "Conteúdo..."
                    }
                    onChange={(e) => {
                      updateBlockContent(block.id, e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    onFocus={() => setActiveBlockId(block.id)}
                    onKeyDown={(e) => handleKeyDown(e, block.id, idx)}
                    className={`flex-1 bg-transparent resize-none focus:outline-none placeholder-slate-400 dark:placeholder-slate-600 transition-all ${
                      isH1
                        ? "text-base font-bold text-slate-900 dark:text-white"
                        : isH2
                        ? "text-sm font-semibold text-slate-800 dark:text-slate-100"
                        : isCallout
                        ? "text-xs font-medium text-rose-900 dark:text-rose-200"
                        : isQuote
                        ? "text-xs text-slate-700 dark:text-slate-300"
                        : "text-sm text-slate-800 dark:text-slate-200"
                    }`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Menu Flutuante de Comandos Slash (Estilo Notion) */}
      {slashMenuOpen && mode === "blocks" && (
        <div className="absolute left-6 bottom-14 z-50 w-72 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Comandos de Bloco
          </div>
          <div className="max-h-56 overflow-y-auto p-1 divide-y divide-slate-100 dark:divide-slate-800/40">
            {filteredCommands.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">Nenhum comando encontrado</div>
            ) : (
              filteredCommands.map((cmd, index) => {
                const isSelected = index === slashSelectedIndex;
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.type}
                    type="button"
                    onMouseEnter={() => setSlashSelectedIndex(index)}
                    onClick={() => changeBlockType(activeBlockId, cmd.type)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors text-xs ${
                      isSelected
                        ? "bg-rose-50 dark:bg-[#7d0000]/30 text-rose-900 dark:text-rose-100"
                        : "hover:bg-slate-100 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                        isSelected ? "bg-rose-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{cmd.label}</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{cmd.desc}</div>
                    </div>
                    {isSelected && <Check className="w-3 h-3 text-rose-600 dark:text-rose-400" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
