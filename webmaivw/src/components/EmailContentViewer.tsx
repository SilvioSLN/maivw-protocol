"use client";

import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import DOMPurify from "dompurify";
import { ExternalLink, AlertOctagon } from "lucide-react";

interface EmailContentViewerProps {
  html?: string;
  text?: string;
  isRevoked?: boolean;
  className?: string;
}

// Extensões de imagem comuns
const IMAGE_EXTENSIONS_REGEX = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i;

/**
 * Retorna a URL da imagem roteada pelo proxy seguro do WebMaivw
 * para contornar restrições de Cross-Origin-Resource-Policy: same-origin e proteger privacidade
 */
function getProxiedImageUrl(src: string): string {
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("/")) {
    return src;
  }
  return `/api/proxy/image?url=${encodeURIComponent(src)}`;
}

/**
 * Detecta se a URL é um pixel invisível de rastreamento de abertura
 */
function isTrackingPixel(url: string): boolean {
  return /\/(?:wf\/open|open\?|email\/track|track\/open|pixel\.gif|beacon)/i.test(url);
}

/**
 * Sanitiza e renderiza e-mails HTML e texto puro com rigorosa segurança contra XSS e injeções,
 * isolando estilos via Iframe Sandboxed e usando proxy de imagens para compatibilidade total.
 */
export function EmailContentViewer({
  html,
  text,
  isRevoked = false,
  className = "",
}: EmailContentViewerProps) {
  const hasHtmlContent = Boolean(html && html.trim().length > 0);

  // Sanitização estrita com DOMPurify
  const sanitizedHtml = useMemo(() => {
    if (!hasHtmlContent || !html) return "";

    const purify = typeof window !== "undefined" ? DOMPurify : null;
    if (!purify) {
      return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");
    }

    // Hook para controle de links e roteamento de imagens por proxy seguro
    const linkHook = (node: Element) => {
      if (node.tagName === "A") {
        if (isRevoked) {
          node.setAttribute("href", "#");
          node.setAttribute("title", "Link desativado: domínio remetente foi revogado por fraude on-chain");
          node.setAttribute(
            "style",
            "pointer-events:none;text-decoration:line-through;color:#b91c1c;background:#fee2e2;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;border:1px solid #f87171;"
          );
          node.textContent = `[LINK DESATIVADO POR SEGURANÇA: ${node.textContent || "URL"}]`;
        } else {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      } else if (node.tagName === "IMG") {
        node.setAttribute("loading", "lazy");
        node.setAttribute("referrerpolicy", "no-referrer");
        const src = node.getAttribute("src");
        if (src && (src.startsWith("http://") || src.startsWith("https://"))) {
          if (isTrackingPixel(src)) {
            node.setAttribute("style", "display:none;width:0;height:0;");
          } else {
            node.setAttribute("src", getProxiedImageUrl(src));
          }
        }
      }
    };

    purify.addHook("afterSanitizeAttributes", linkHook);

    const clean = purify.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_TAGS: [
        "a", "b", "blockquote", "br", "center", "code", "div", "em", "font",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol",
        "p", "pre", "s", "small", "span", "strike", "strong", "sub", "sup",
        "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "wbr",
        "figure", "figcaption", "style"
      ],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "head", "meta", "link", "applet", "svg"],
      ALLOWED_ATTR: [
        "href", "title", "target", "rel", "src", "alt", "width", "height",
        "style", "class", "align", "valign", "bgcolor", "color", "border",
        "cellpadding", "cellspacing", "colspan", "rowspan", "id"
      ],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "formaction"],
      ALLOW_DATA_ATTR: false,
    });

    purify.removeHook("afterSanitizeAttributes");

    // Neutraliza @media (prefers-color-scheme: dark) para impedir que o e-mail ative
    // modo escuro fragmentado dentro da folha de papel branca limpa do WebMaivw (padrão desktop Gmail/Outlook)
    const normalized = clean.replace(
      /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi,
      "@media not all and (prefers-color-scheme: dark)"
    );

    return normalized;
  }, [html, hasHtmlContent, isRevoked]);

  // Se tiver HTML disponível, renderiza via Iframe Sandboxed com auto-ajuste de altura
  if (hasHtmlContent && sanitizedHtml) {
    return (
      <div className={`email-canvas-container ${className}`}>
        <div className="email-clean-paper bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3 sm:p-5 w-full overflow-hidden transition-all">
          <AutoResizingIframe html={sanitizedHtml} />
        </div>
      </div>
    );
  }

  // Caso seja texto puro / legado (com links Markdown ou URLs soltas)
  return (
    <div className={`email-canvas-container ${className}`}>
      <div className="email-clean-paper bg-white text-slate-900 border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm font-sans leading-relaxed selection:bg-rose-100 selection:text-rose-900 w-full overflow-x-auto min-h-[140px] text-sm">
        <PlainTextSmartRenderer rawText={text || ""} isRevoked={isRevoked} />
      </div>
    </div>
  );
}

/**
 * Componente de Iframe Sandboxed com auto-redimensionamento dinâmico.
 * Garante isolamento estrito de CSS e zero execução de scripts via sandbox nativo do browser.
 */
function AutoResizingIframe({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(360);

  const updateHeight = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const h = Math.max(
        doc.body?.scrollHeight || 0,
        doc.documentElement?.scrollHeight || 0,
        doc.body?.offsetHeight || 0,
        doc.documentElement?.offsetHeight || 0
      );
      if (h > 0) {
        setIframeHeight(h + 24);
      }
    } catch {
      // Ignora erro cross-origin
    }
  }, []);

  useEffect(() => {
    updateHeight();
    const iframe = iframeRef.current;
    if (!iframe) return;

    const interval = setInterval(updateHeight, 400);
    const timeout = setTimeout(() => clearInterval(interval), 4000);

    const handleResize = () => updateHeight();
    window.addEventListener("resize", handleResize);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener("resize", handleResize);
    };
  }, [html, updateHeight]);

  const fullDocumentHtml = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <base target="_blank">
  <style>
    /* Reset de compatibilidade de e-mails corporativos idêntico ao Gmail Web */
    :root {
      color-scheme: light !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      background-color: transparent;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    img {
      max-width: 100% !important;
      height: auto;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={fullDocumentHtml}
      onLoad={updateHeight}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      scrolling="no"
      style={{
        height: `${iframeHeight}px`,
        width: "100%",
        border: "none",
        overflow: "hidden",
        display: "block",
      }}
      className={`w-full transition-all duration-150 ${className}`}
      title="Corpo do E-mail"
    />
  );
}

/**
 * Renderizador inteligente de texto puro:
 * - Detecta ícones/imagens vinculadas [image_url]target_url (comum em rodapés de e-mail)
 * - Detecta Markdown links [Texto](url)
 * - Detecta links entre colchetes [https://...]
 * - Carrega imagens via proxy seguro anti-CORP
 * - Oculta pixels de rastreamento invisíveis
 */
function PlainTextSmartRenderer({
  rawText,
  isRevoked,
}: {
  rawText: string;
  isRevoked?: boolean;
}) {
  if (!rawText) return null;

  const paragraphs = useMemo(() => {
    return rawText.split(/\r?\n\r?\n/);
  }, [rawText]);

  return (
    <div className="space-y-4">
      {paragraphs.map((para, pIdx) => {
        const lines = para.split(/\r?\n/);
        return (
          <p key={pIdx} className="leading-relaxed whitespace-pre-wrap break-words text-slate-800">
            {lines.map((line, lIdx) => (
              <React.Fragment key={lIdx}>
                {renderLineWithLinks(line, isRevoked)}
                {lIdx < lines.length - 1 && <br />}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Converte uma linha de texto em nós React interativos e seguros
 */
function renderLineWithLinks(line: string, isRevoked?: boolean): React.ReactNode {
  if (!line) return null;

  // Regex abrangente que captura:
  // 1. Linked image: [image_url]target_url (Ex: [https://...social_x.png]https://url8792...)
  // 2. Markdown link: [label](url)
  // 3. Bracketed URL: [url]
  // 4. Plain URL: url
  const tokenRegex = /(\[(https?:\/\/[^\]]+\.(?:png|jpe?g|webp|gif|svg)(?:\?[^\]]*)?)\](https?:\/\/[^\s<>"'()[\]]+)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\[(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<>"'()[\]]+))/gi;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    // Texto antes do match
    if (matchStart > lastIndex) {
      parts.push(line.slice(lastIndex, matchStart));
    }

    // 1. Caso: Imagem Vinculada [image_url]target_url (Ex: ícones sociais)
    if (match[2] && match[3]) {
      const imgUrl = match[2];
      const targetUrl = match[3];

      if (isTrackingPixel(imgUrl)) {
        // Ignora pixel de rastreamento invisível
      } else if (isRevoked) {
        parts.push(
          <span
            key={matchStart}
            className="inline-flex items-center gap-1 line-through text-rose-700 font-mono bg-rose-50 px-2 py-0.5 rounded border border-rose-300 text-xs mx-1 cursor-not-allowed select-none"
            title="Link desativado: remetente revogado por fraude on-chain"
          >
            <AlertOctagon className="w-3 h-3 text-rose-600 inline shrink-0" />
            <span>[LINK DESATIVADO]</span>
          </span>
        );
      } else {
        parts.push(
          <a
            key={matchStart}
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-slate-100 transition-colors mx-1 align-middle border border-transparent hover:border-slate-200"
            title={`Abrir link (${targetUrl})`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getProxiedImageUrl(imgUrl)}
              alt="Ícone"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-5 h-5 object-contain inline-block"
            />
          </a>
        );
      }
    }
    // 2. Caso: Markdown link [label](url)
    else if (match[4] && match[5]) {
      const label = match[4];
      const url = match[5];
      parts.push(renderUrlNode(url, label, matchStart, isRevoked));
    }
    // 3. Caso: URL entre colchetes [url]
    else if (match[6]) {
      const url = match[6];
      if (isTrackingPixel(url)) {
        // Ignora pixel de abertura
      } else if (IMAGE_EXTENSIONS_REGEX.test(url)) {
        // Imagem solta
        parts.push(
          <span key={matchStart} className="inline-block my-1 max-w-full align-middle">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getProxiedImageUrl(url)}
              alt="Imagem do e-mail"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-64 max-w-full rounded-lg border border-slate-200 shadow-xs inline-block object-contain"
            />
          </span>
        );
      } else {
        parts.push(renderUrlNode(url, url, matchStart, isRevoked));
      }
    }
    // 4. Caso: URL solta https://...
    else if (match[7]) {
      const url = match[7];
      if (isTrackingPixel(url)) {
        // Ignora pixel de rastreamento
      } else if (IMAGE_EXTENSIONS_REGEX.test(url)) {
        parts.push(
          <span key={matchStart} className="inline-block my-1 max-w-full align-middle">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getProxiedImageUrl(url)}
              alt="Imagem do e-mail"
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-64 max-w-full rounded-lg border border-slate-200 shadow-xs inline-block object-contain"
            />
          </span>
        );
      } else {
        parts.push(renderUrlNode(url, url, matchStart, isRevoked));
      }
    }

    lastIndex = matchEnd;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : line;
}

/**
 * Renderiza um link individual de forma limpa, compactando URLs de rastreamento longas
 */
function renderUrlNode(
  url: string,
  label: string,
  key: number,
  isRevoked?: boolean
): React.ReactNode {
  if (isRevoked) {
    return (
      <span
        key={key}
        className="inline-flex items-center gap-1 line-through text-rose-700 font-mono bg-rose-50 px-2 py-0.5 rounded border border-rose-300 text-xs mx-1 cursor-not-allowed select-none"
        title="Link desativado: remetente revogado por fraude on-chain"
      >
        <AlertOctagon className="w-3 h-3 text-rose-600 inline shrink-0" />
        <span>[LINK DESATIVADO POR SEGURANÇA]</span>
      </span>
    );
  }

  const isActionLink = label.length > 0 && label !== url && label.length < 50;

  // Se for uma URL de rastreamento muito longa (ex: /ls/click com 200+ caracteres), formata de maneira limpa
  let displayLabel = label;
  if (label === url && url.length > 60) {
    try {
      const parsed = new URL(url);
      displayLabel = `${parsed.hostname}${parsed.pathname.slice(0, 16)}...`;
    } catch {
      displayLabel = `${url.slice(0, 45)}...`;
    }
  }

  return (
    <a
      key={key}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        isActionLink
          ? "inline-flex items-center gap-1.5 font-medium text-[#7d0000] bg-rose-50/80 hover:bg-rose-100/90 border border-rose-200/80 px-2.5 py-0.5 rounded-md transition-colors my-0.5 underline-offset-2 hover:underline"
          : "inline-flex items-center gap-1 text-sky-700 hover:text-sky-900 underline underline-offset-2 break-all font-mono text-xs hover:bg-sky-50 px-1 py-0.5 rounded transition-colors"
      }
      title={`Abrir ${url}`}
    >
      <span>{displayLabel}</span>
      <ExternalLink className="w-3 h-3 inline shrink-0 opacity-70" />
    </a>
  );
}
