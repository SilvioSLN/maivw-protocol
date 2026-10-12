import fs from "node:fs";
import path from "node:path";
import type { AttachmentItem, NativeEmailAttachment, PreparedEmailMessage } from "./types.js";

const ATTACHMENTS_DIR = path.resolve(process.cwd(), "data/attachments");
const MAX_NATIVE_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB limite padrão para anexos em provedores SMTP/Resend

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export class AttachmentProcessor {
  private static getPublicGatewayUrl(): string {
    const raw = process.env.GATEWAY_PUBLIC_URL || process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3001";
    return raw.replace(/\/$/, "");
  }

  /**
   * Prepara o e-mail e processa seus anexos de forma inteligente (híbrido):
   * - Arquivos até 25MB no total: Carregados da storage e anexados como binários nativos MIME.
   * - Arquivos acima de 25MB (ou se faltar no disco): Recebem card HTML responsivo com link de download direto e hash SHA-256.
   */
  static async processMessage(
    to: string,
    from: string,
    subject: string,
    content: { text: string; html?: string; attachments?: AttachmentItem[] }
  ): Promise<PreparedEmailMessage> {
    const attachments = content.attachments || [];
    let text = content.text;
    let html = content.html;

    if (attachments.length === 0) {
      return {
        to,
        from,
        subject,
        text,
        html,
        nativeAttachments: [],
        largeAttachments: [],
      };
    }

    const publicUrl = this.getPublicGatewayUrl();
    const nativeAttachments: NativeEmailAttachment[] = [];
    const largeAttachments: AttachmentItem[] = [];

    // Calcular tamanho total dos anexos
    const totalBytes = attachments.reduce((acc, curr) => acc + (curr.size || 0), 0);

    // Se o conjunto total de anexos for <= 25MB, tentamos carregar como anexo nativo
    if (totalBytes <= MAX_NATIVE_TOTAL_BYTES) {
      let allFound = true;
      const loaded: NativeEmailAttachment[] = [];

      for (const att of attachments) {
        try {
          if (!fs.existsSync(ATTACHMENTS_DIR)) {
            allFound = false;
            break;
          }
          const files = await fs.promises.readdir(ATTACHMENTS_DIR);
          const target = files.find((f) => f.startsWith(`${att.id}__`) && !f.endsWith("__meta.json"));

          if (target) {
            const filePath = path.join(ATTACHMENTS_DIR, target);
            const buffer = await fs.promises.readFile(filePath);
            loaded.push({
              filename: att.filename,
              content: buffer,
              contentType: att.mimeType,
            });
          } else {
            console.warn(`[AttachmentProcessor] ⚠️ Arquivo de anexo não encontrado em disco para id: ${att.id}`);
            allFound = false;
            break;
          }
        } catch (readErr: any) {
          console.error(`[AttachmentProcessor] ❌ Erro ao ler anexo ${att.id}:`, readErr.message);
          allFound = false;
          break;
        }
      }

      if (allFound && loaded.length === attachments.length) {
        nativeAttachments.push(...loaded);
      } else {
        // Se algum arquivo não pôde ser lido, tratamos como fallback link
        largeAttachments.push(...attachments);
      }
    } else {
      // Excedeu 25MB: fallback seguro para links verificados via Card HTML
      largeAttachments.push(...attachments);
    }

    // Se houver anexos que devem ser entregues via link / Card HTML
    if (largeAttachments.length > 0) {
      const cardHtml = this.generateDownloadCardHtml(largeAttachments, publicUrl);
      const textLinks = this.generatePlainTextLinks(largeAttachments, publicUrl);

      text = `${text.trim()}${textLinks}`;
      if (html) {
        html = `${html}${cardHtml}`;
      } else {
        html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">
          ${content.text.replace(/\n/g, "<br/>")}
          ${cardHtml}
        </div>`;
      }
    }

    return {
      to,
      from,
      subject,
      text,
      html,
      nativeAttachments,
      largeAttachments,
    };
  }

  /**
   * Gera o Card HTML com estética premium, dark/light friendly, com link de download e hash SHA-256
   */
  private static generateDownloadCardHtml(attachments: AttachmentItem[], publicUrl: string): string {
    const itemsHtml = attachments
      .map((att) => {
        const downloadUrl = `${publicUrl}/api/v1/attachments/${att.id}/download`;
        const sizeFormatted = formatBytes(att.size);
        const shortHash = att.sha256 ? `${att.sha256.slice(0, 10)}...${att.sha256.slice(-8)}` : "N/A";

        return `
          <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <div style="flex: 1; min-width: 0; padding-right: 16px;">
              <div style="font-weight: 600; font-size: 14px; color: #0f172a; word-break: break-all;">
                📎 ${att.filename}
              </div>
              <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                Tamanho: <strong>${sizeFormatted}</strong> &bull; SHA-256: <code style="background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-family: monospace; font-size: 11px; color: #475569;" title="${att.sha256}">${shortHash}</code>
              </div>
            </div>
            <div>
              <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer" style="background: #0284c7; color: #ffffff; text-decoration: none; font-size: 12px; font-weight: 600; padding: 8px 14px; border-radius: 6px; display: inline-block; white-space: nowrap;">
                Baixar Arquivo &darr;
              </a>
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div style="margin-top: 28px; padding: 16px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 16px; margin-right: 8px;">🛡️</span>
          <div>
            <div style="font-weight: 700; font-size: 14px; color: #0f172a;">Anexos Verificados — Rede MAIVW</div>
            <div style="font-size: 12px; color: #64748b;">Arquivos com verificação criptográfica de integridade contra adulteração</div>
          </div>
        </div>
        ${itemsHtml}
        <div style="font-size: 11px; color: #94a3b8; margin-top: 8px; text-align: right;">
          Verificado criptograficamente via Protocolo MAIVW
        </div>
      </div>
    `;
  }

  /**
   * Gera representação textual dos links para clientes que leem apenas texto simples
   */
  private static generatePlainTextLinks(attachments: AttachmentItem[], publicUrl: string): string {
    const lines = attachments.map((att) => {
      const downloadUrl = `${publicUrl}/api/v1/attachments/${att.id}/download`;
      const sizeFormatted = formatBytes(att.size);
      return `  - ${att.filename} (${sizeFormatted})\n    Download: ${downloadUrl}\n    SHA-256: ${att.sha256 || "N/A"}`;
    });

    return `\n\n---\n📎 Anexos Seguros (Rede MAIVW):\n${lines.join("\n\n")}\n`;
  }
}
