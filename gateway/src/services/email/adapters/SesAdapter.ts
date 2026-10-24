import crypto from "node:crypto";
import { SESv2Client, SendEmailCommand, type SendEmailCommandInput } from "@aws-sdk/client-sesv2";
import type { EmailProviderAdapter, OutboundSendResult, PreparedEmailMessage } from "../types.js";

export interface SesAdapterConfig {
  region: string;
  configurationSet?: string;
  fromEmail?: string;
}

interface SesClientLike {
  send(command: SendEmailCommand): Promise<{ MessageId?: string }>;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function wrapBase64(value: Buffer | string): string {
  const encoded = Buffer.isBuffer(value)
    ? value.toString("base64")
    : Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

export function buildRawSesMessage(message: PreparedEmailMessage): Uint8Array {
  const mixed = `maivw-mixed-${crypto.randomBytes(12).toString("hex")}`;
  const alternative = `maivw-alt-${crypto.randomBytes(12).toString("hex")}`;
  const subject = `=?UTF-8?B?${Buffer.from(safeHeader(message.subject), "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${safeHeader(message.from)}`,
    `To: ${safeHeader(message.to)}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(message.text),
  ];

  if (message.html) {
    lines.push(
      `--${alternative}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(message.html),
    );
  }
  lines.push(`--${alternative}--`);

  for (const attachment of message.nativeAttachments) {
    const filename = safeHeader(attachment.filename).replace(/["\\]/g, "_");
    lines.push(
      `--${mixed}`,
      `Content-Type: ${safeHeader(attachment.contentType || "application/octet-stream")}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(attachment.content),
    );
  }
  lines.push(`--${mixed}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export class SesAdapter implements EmailProviderAdapter {
  readonly id = "aws_ses";
  private readonly client: SesClientLike;

  constructor(private readonly config: SesAdapterConfig, client?: SesClientLike) {
    this.client = client || new SESv2Client({ region: config.region });
  }

  async sendEmail(message: PreparedEmailMessage): Promise<OutboundSendResult> {
    const effectiveMessage = this.config.fromEmail ? { ...message, from: this.config.fromEmail } : message;
    const input: SendEmailCommandInput = {
      FromEmailAddress: effectiveMessage.from,
      Destination: { ToAddresses: [effectiveMessage.to] },
      Content: { Raw: { Data: buildRawSesMessage(effectiveMessage) } },
      ...(this.config.configurationSet ? { ConfigurationSetName: this.config.configurationSet } : {}),
    };
    try {
      const response = await this.client.send(new SendEmailCommand(input));
      return { success: true, provider: this.id, messageId: response.MessageId };
    } catch (error) {
      return {
        success: false,
        provider: this.id,
        error: error instanceof Error ? error.message : "Falha desconhecida no Amazon SES",
      };
    }
  }
}
