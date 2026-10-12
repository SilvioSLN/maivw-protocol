import type { AttachmentItem } from "../../schemas/payload.js";

export type { AttachmentItem };

export interface NativeEmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface PreparedEmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html?: string;
  nativeAttachments: NativeEmailAttachment[];
  largeAttachments: AttachmentItem[];
}

export interface OutboundSendResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

export interface EmailProviderAdapter {
  readonly id: string;
  sendEmail(message: PreparedEmailMessage): Promise<OutboundSendResult>;
  testConnection?(config?: any, testEmailDestination?: string): Promise<{ ok: boolean; provider: string; message: string }>;
  syncInboundEmails?(options?: { domainName?: string }): Promise<number>;
}

export interface GenericSmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  pass: string;
  fromName?: string;
  fromEmail?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  imapUser?: string;
  imapPass?: string;
}
