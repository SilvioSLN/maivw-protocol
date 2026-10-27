import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";
import { v4 as uuidv4 } from "uuid";
import type { Hex } from "viem";
import { SendRequestSchema } from "../schemas/payload.js";
import type { LedgerService } from "./LedgerService.js";
import { SignatureService, type EnvelopeV2Payload } from "./SignatureService.js";
import type { SmtpService } from "./SmtpService.js";
import {
  buildMerkleTree,
  getMerkleRootHex,
  getMerkleProofHex,
} from "../utils/merkleUtils.js";
import type { PrismaClient } from "@prisma/client";

import type { KeyManagementService } from "./KeyManagementService.js";
import type { EventListenerService } from "./EventListenerService.js";
import type { StealthRoutingService } from "./StealthRoutingService.js";
import type { RoutingPoolService, EndpointNodeData } from "./RoutingPoolService.js";
import { TlsCertService } from "./TlsCertService.js";


export interface MailDispatchOptions {
  ledger: LedgerService;
  signer: SignatureService;
  smtp: SmtpService;
  senderDomain: string;
  prisma?: PrismaClient;
  kms?: KeyManagementService;
  eventListener?: EventListenerService;
  stealth?: StealthRoutingService;
  routingPool?: RoutingPoolService;
  config?: any;
  logger: FastifyBaseLogger;
}


export interface MailDispatchInput {
  payload: Record<string, unknown>;
  sender: { domain: string; mailboxEmail?: string };
  messageId?: string;
  beforeTransport?: () => Promise<void>;
}
export interface MailDispatchResult { statusCode: number; body: Record<string, any>; }
const result = (statusCode: number, body: Record<string, any>): MailDispatchResult => ({ statusCode, body });
const dailySendCounts = new Map<string, number>();

/** Transport execution. Call only after resolving/reloading the sender's authority. */
export class MailDispatchService {
  constructor(private readonly options: MailDispatchOptions) {}
  async execute(input: MailDispatchInput): Promise<MailDispatchResult> {
    const { ledger, signer, smtp, prisma, kms, eventListener, stealth, routingPool, config, logger: log } = this.options;
    // 0.1 Normalizar payload para suportar top-level text e html (estilo Resend)
    const rawBody: any = { ...input.payload };
    if (!rawBody.content && (rawBody.text || rawBody.html)) {
      rawBody.content = {
        text: rawBody.text || "",
        html: rawBody.html,
      };
    }

    // 1. Validar payload de envio
    const parseResult = SendRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return result(400, {
        error: "Payload inválido",
        details: parseResult.error.flatten(),
      });
    }

    const { to, subject, content, msgClass, recipients, subIdentityId, from, senderEmail } = parseResult.data;
    const messageId = input.messageId || uuidv4();

    const authorizedDomain = input.sender.domain.toLowerCase();
    const mailboxEmail = input.sender.mailboxEmail?.toLowerCase() || null;
    for (const supplied of [from, senderEmail]) {
      if (supplied === undefined) continue;
      if (!z.string().email().safeParse(supplied).success) return result(400, { error: "Remetente deve ser um endereço de e-mail simples" });
      const normalized = supplied.toLowerCase();
      if ((mailboxEmail && normalized !== mailboxEmail) || normalized.split("@")[1] !== authorizedDomain) return result(403, { error: "Remetente não pertence à credencial" });
    }
    if (from && senderEmail && from.toLowerCase() !== senderEmail.toLowerCase()) return result(400, { error: "Remetentes divergentes" });
    if (parseResult.data.senderDomain && parseResult.data.senderDomain.toLowerCase() !== authorizedDomain) return result(403, { error: "Domínio não pertence à credencial" });
    const effectiveSenderEmail = (from || senderEmail || mailboxEmail || `noreply@${authorizedDomain}`).toLowerCase();
    const effectiveSenderDomain = authorizedDomain;

    // 2. Extrair domínio do destinatário principal
    const recipientDomainMatch = to.match(/@([a-zA-Z0-9.-]+)/);
    const recipientDomain = recipientDomainMatch
      ? recipientDomainMatch[1].replace(/[>]/g, "").trim().toLowerCase()
      : to.split("@")[1];

    if (!recipientDomain) {
      return result(400, {
        error: "Invalid recipient email",
        message: "Could not extract domain from email address",
      });
    }

    log.info(
      `[ROUTER] Routing message ${messageId} to ${to} (from: ${effectiveSenderEmail || effectiveSenderDomain})${subIdentityId ? ` [subId: ${subIdentityId}]` : ""}`
    );

    // ============================================
    //  2.1 Verificação de Suspensão & Rate Limiting On-Chain (Fase 13)
    // ============================================

    if (eventListener?.isSuspended(effectiveSenderDomain)) {
      return result(403, {
        error: "ProviderSuspended",
        message: `O provedor ${effectiveSenderDomain} foi SUSPENSO pelo Smart Contract devido a saldo de caução zerado. Recarregue via topUpBalance para restaurar o tráfego.`,
        domain: effectiveSenderDomain,
      });
    }

    const isSenderActive = await ledger.isDomainRegistered(effectiveSenderDomain);
    if (!isSenderActive) {
      return result(403, {
        error: "SenderDomainNotActive",
        message: `O domínio remetente ${effectiveSenderDomain} não está ativo na rede MAIVW.`,
        domain: effectiveSenderDomain,
      });
    }

    const allowedDailyVolume = await ledger.getAllowedDailyVolume(effectiveSenderDomain);
    if (allowedDailyVolume > 0n && allowedDailyVolume < 1000000000000n) {
      const today = new Date().toISOString().slice(0, 10);
      const usageKey = `${effectiveSenderDomain}:${today}`;
      const currentUsage = (dailySendCounts.get(usageKey) || 0) + 1;
      dailySendCounts.set(usageKey, currentUsage);

      if (BigInt(currentUsage) > allowedDailyVolume) {
        return result(429, {
          error: "RateLimitExceeded",
          message: `Limite diário de envio do Tier excedido para o domínio ${effectiveSenderDomain}.`,
          domain: effectiveSenderDomain,
          dailyLimit: Number(allowedDailyVolume),
          currentUsage,
        });
      }
    }

    // ============================================
    //  3. O ALGORITMO DE ROTEAMENTO
    // ============================================

    const isDomainOnNetwork = await ledger.isDomainRegistered(recipientDomain);

    if (isDomainOnNetwork) {
      // ============================================
      //  CAMINHO WEB3 (Protocolo Nativo MAIVW)
      // ============================================
      log.info(`[ROUTER] ✅ ${recipientDomain} está na rede MAIVW → Caminho Web3`);

      try {
        // 3a. Obter endpoint do destinatário (com suporte a Dark Endpoints / Modo Stealth)
        let endpointUrl = await ledger.getCompanyEndpoint(recipientDomain);
        let stealthToken: string | undefined;

        const isDarkEndpoint =
          !endpointUrl ||
          endpointUrl.toUpperCase() === "PRIVATE" ||
          endpointUrl.toUpperCase() === "STEALTH" ||
          endpointUrl.toUpperCase() === "RESTRICTED" ||
          endpointUrl.startsWith("stealth://") ||
          endpointUrl.startsWith("oob://");

        if (stealth) {
          const privateRoute = await stealth.getRoute(recipientDomain);
          if (privateRoute) {
            endpointUrl = privateRoute.privateEndpointUrl;
            stealthToken = privateRoute.stealthToken || undefined;
            log.info(
              `[ROUTER] 🛡️ Dark Endpoint resolvido via Tabela de Rotas Privadas para ${recipientDomain}: ${endpointUrl}`
            );
          }
        }

        if (
          isDarkEndpoint &&
          (!endpointUrl ||
            endpointUrl.toUpperCase() === "PRIVATE" ||
            endpointUrl.toUpperCase() === "STEALTH" ||
            endpointUrl.startsWith("stealth://"))
        ) {
          return result(403, {
            error: "Dark Endpoint Restricted",
            code: "STEALTH_ROUTING_REQUIRED",
            message: `O domínio destinatário (${recipientDomain}) opera em Modo Stealth (Dark Endpoint) e requer autorização bilateral. Configure a rota privada e o token de acesso no painel administrativo antes de enviar.`,
          });
        }

        if (!endpointUrl) {
          return result(502, {
            error: "Endpoint not found",
            message: `Domain ${recipientDomain} is registered but has no endpoint URL`,
          });
        }

        // 3b. Montar dados do Envelope v2 canônico e assinar com a chave Web3 do domínio remetente
        const nowSeconds = Math.floor(Date.now() / 1000);
        const contentHash = SignatureService.computeContentHash(content);
        const attachmentsHash = SignatureService.computeAttachmentsHash(content.attachments);

        const envelopeV2Payload: EnvelopeV2Payload = {
          version: "2.0",
          messageId,
          from: effectiveSenderDomain,
          to,
          subject,
          msgClass,
          timestamp: nowSeconds,
          contentHash,
          attachmentsHash,
          subIdentityId: subIdentityId || undefined,
        };
        const canonicalMessage = SignatureService.canonicalizeEnvelopeV2(envelopeV2Payload);

        let signature: Hex;
        if (kms) {
          try {
            const domainAccount = await kms.getSignerForDomain(effectiveSenderDomain);
            signature = await domainAccount.signMessage({ message: canonicalMessage });
            log.info(`[ROUTER] ✍️ Assinado envelope v2 com chave do domínio ${effectiveSenderDomain}: ${domainAccount.address}`);
          } catch (kmsErr: any) {
            log.warn("Domain signer unavailable; default signer fallback refused");
            throw new Error("Domain signer unavailable");
          }
        } else {
          signature = await signer.signEnvelopeV2(envelopeV2Payload);
        }

        // 3c. Lógica de Escalabilidade Merkle (Fase 6)
        let intentRoot: string | undefined;
        let intentProof: string[] = [];

        // Lista de domínios para construir a árvore Merkle se for um lote
        const allRecipientEmails = [to, ...(recipients || [])];
        const allRecipientDomains = Array.from(
          new Set(
            allRecipientEmails
              .map((e) => e.split("@")[1])
              .filter((d): d is string => Boolean(d))
          )
        );

        if (allRecipientDomains.length > 1) {
          const tree = buildMerkleTree(allRecipientDomains);
          intentRoot = getMerkleRootHex(tree);
          intentProof = getMerkleProofHex(tree, recipientDomain);
        }

        // 3d. Montar headers do protocolo MAIVW (Envelope v2)
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-maivw-envelope-version": "2.0",
          "x-maivw-sender": effectiveSenderDomain,
          "x-maivw-timestamp": String(nowSeconds),
        };

        if (intentRoot && intentProof.length > 0) {
          headers["x-maivw-intent-root"] = intentRoot;
          headers["x-maivw-intent-proof"] = JSON.stringify(intentProof);
        }

        if (subIdentityId) {
          headers["x-maivw-sub-identity"] = subIdentityId;
        }

        if (stealthToken) {
          headers["x-maivw-stealth-token"] = stealthToken;
        }

        // 3e. Montar body
        const maivwPayload = {
          envelopeVersion: "2.0",
          messageId,
          msgClass,
          to,
          subject,
          content,
          signature,
          timestamp: nowSeconds,
          contentHash,
          attachmentsHash,
          subIdentityId,
          attachments: content.attachments,
        };

        // 3f. Resolução Dinâmica de Roteamento P2P (Pools, Circuit Breaker e Failover)
        let candidateUrls: { url: string; node?: EndpointNodeData }[] = [];
        let routeSource = "on-chain-direct";
        let poolCode: string | undefined;

        if (routingPool) {
          const resolved = routingPool.resolveTarget(recipientDomain, endpointUrl);
          routeSource = resolved.source;
          poolCode = resolved.poolCode;

          if (resolved.candidateNodes.length > 0) {
            candidateUrls = resolved.candidateNodes.map((node) => ({
              url: node.endpointUrl.endsWith("/api/v1/inbox")
                ? node.endpointUrl
                : `${node.endpointUrl.replace(/\/$/, "")}/api/v1/inbox`,
              node,
            }));
          } else {
            const cleanUrl = resolved.targetUrl.endsWith("/api/v1/inbox")
              ? resolved.targetUrl
              : `${resolved.targetUrl.replace(/\/$/, "")}/api/v1/inbox`;
            candidateUrls = [{ url: cleanUrl }];
          }

          log.info(
            `[ROUTER] 🎯 Resolução Dinâmica P2P: Destino=${recipientDomain} -> Pool=${poolCode || "DIRECT"} (Candidatos: ${candidateUrls.length})`
          );
        } else {
          const targetInboxUrl = endpointUrl.endsWith("/api/v1/inbox")
            ? endpointUrl
            : `${endpointUrl.replace(/\/$/, "")}/api/v1/inbox`;
          candidateUrls = [{ url: targetInboxUrl }];
        }

        const recipientTlsFingerprint = typeof ledger.getDomainTlsFingerprint === "function"
          ? await ledger.getDomainTlsFingerprint(recipientDomain)
          : null;
        let nodeCredentials: any = null;
        try {
          nodeCredentials = TlsCertService.getOrProvisionNodeCredentials({
            certPath: config?.TLS_CERT_PATH,
            keyPath: config?.TLS_KEY_PATH,
            domain: authorizedDomain,
          });
        } catch (credErr: any) {
          log.warn(`[ROUTER] ⚠️ Falha ao obter credenciais TLS locais: ${credErr.message}`);
        }

        if (recipientTlsFingerprint) {
          log.info(
            `[ROUTER] 🔒 DANE On-Chain ativo para destinatário ${recipientDomain} (${recipientTlsFingerprint}). TLS estrito requerido.`
          );
        }

        let response: any = null;
        let responseData: any = null;
        let lastError: any = null;
        let deliveredNodeName: string | undefined;

        // Tentar candidatos com failover imediato caso um nó caia ou atinja timeout de 6s
        for (const candidate of candidateUrls) {
          const start = Date.now();
          log.info(
            `[ROUTER] 📡 Tentando envio POST para ${candidate.url}${candidate.node ? ` (Nó #${candidate.node.id}: ${candidate.node.name})` : ""}...`
          );

          try {
            await input.beforeTransport?.();
            response = await TlsCertService.dispatchP2PRequest(candidate.url, {
              method: "POST",
              headers,
              body: JSON.stringify(maivwPayload),
              recipientFingerprint: recipientTlsFingerprint,
              nodeCredentials,
              timeoutMs: 6000,
            });

            if (response.ok) {
              const latency = Date.now() - start;
              if (candidate.node && routingPool) {
                await routingPool.recordNodeSuccess(candidate.node.id, latency);
              }
              deliveredNodeName = candidate.node?.name;
              responseData = await response.json().catch(() => null);
              break; // Sucesso!
            } else if (response.status >= 500) {
              if (candidate.node && routingPool) {
                await routingPool.recordNodeFailure(candidate.node.id, `HTTP ${response.status}`);
              }
              lastError = new Error(`HTTP ${response.status}`);
              log.warn(`[ROUTER] Nó ${candidate.url} retornou ${response.status}, iniciando failover...`);
            } else {
              // 4xx: Resposta da aplicação (não tenta próximo nó de rede)
              responseData = await response.json().catch(() => null);
              break;
            }
          } catch (fetchErr: any) {
            lastError = fetchErr;
            if (candidate.node && routingPool) {
              await routingPool.recordNodeFailure(candidate.node.id, fetchErr.message || "Timeout/NetworkError");
            }
            log.warn(
              `[ROUTER] Falha ao conectar a ${candidate.url} (${fetchErr.message}), tentando próximo candidato de failover...`
            );
          }
        }

        // Se nenhum candidato respondeu e estamos em ambiente de desenvolvimento/teste local (sem DANE obrigatório)
        if (config?.MAIVW_ENVIRONMENT === "local" && config?.MAIVW_RUNTIME_ROLE === "all-in-one" && !response && !recipientTlsFingerprint && (
          lastError?.message?.includes("ENOTFOUND") ||
          lastError?.message?.includes("getaddrinfo") ||
          lastError?.name === "TimeoutError" ||
          process.env.NODE_ENV !== "production"
        )) {
          log.warn(`[ROUTER] Endpoints de pool inacessíveis externamente em dev, despachando para inbox local no Gateway...`);
          const localPort = process.env.GATEWAY_PORT || 3001;
          response = await fetch(`http://127.0.0.1:${localPort}/api/v1/inbox`, {
            method: "POST",
            headers,
            body: JSON.stringify(maivwPayload),
            signal: AbortSignal.timeout(6000),
          });
          responseData = await response.json().catch(() => null);
        }

        if (!response) {
          throw lastError || new Error("Nenhum nó do cluster respondeu à requisição de envio");
        }

        if (response.ok) {
          log.info(`[ROUTER] ✅ Mensagem ${messageId} entregue via Web3!${deliveredNodeName ? ` (via ${deliveredNodeName})` : ""}`);

          // Persistir mensagem enviada
          if (prisma) {
            try {
              await prisma.message.create({
                data: {
                  messageId,
                  from: effectiveSenderEmail || `noreply@${effectiveSenderDomain}`,
                  to,
                  subject,
                  body: typeof content === "string" ? content : JSON.stringify(content),
                  msgClass,
                  status: "sent",
                  signature: signature as string,
                  isLegacy: false,
                  transportProvider: "maivw-p2p",
                  transportMessageId: typeof responseData?.messageId === "string" ? responseData.messageId : messageId,
                  isRead: true,
                },
              });
            } catch (dbErr: any) {
              log.error("P2P accepted but message persistence failed");
              return result(503, { success: false, messageId, route: "web3", deliveryState: "accepted_unrecorded", message: "Delivery requires reconciliation; do not resend blindly" });
            }
          }

          return result(200, {
            success: true,
            messageId,
            route: "web3",
            recipientDomain,
            merkleRoot: intentRoot,
            routingPool: poolCode || "direct",
            deliveredByNode: deliveredNodeName || null,
            message: `Mensagem entregue diretamente via protocolo MAIVW para ${recipientDomain}`,
            deliveryStatus: response.status,
          });
        } else {
          log.warn(`[ROUTER] ⚠️ Destino retornou ${response.status}: ${JSON.stringify(responseData)}`);
          return result(response.status, {
            success: false,
            messageId,
            route: "web3",
            recipientDomain,
            routingPool: poolCode || "direct",
            message: `Destino rejeitou a mensagem com status ${response.status}`,
            details: responseData,
          });
        }
      } catch (error) {
        log.error(error as any, `[ROUTER] ❌ Erro no Caminho Web3:`);
        return result(502, {
          success: false,
          messageId,
          route: "web3",
          recipientDomain,
          message: "Erro ao entregar mensagem via protocolo MAIVW",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      // ============================================
      //  CAMINHO SMTP LEGADO (Fallback)
      // ============================================
      log.info(`[ROUTER] 📧 ${recipientDomain} NÃO está na rede MAIVW → Fallback SMTP`);

      await input.beforeTransport?.();
      const smtpResult = await smtp.sendEmail(
        to,
        subject,
        content,
        effectiveSenderDomain,
        undefined,
        effectiveSenderEmail
      );

      if (!smtpResult.success) {
        log.error(`[ROUTER] ❌ Falha no envio SMTP para ${to}: ${smtpResult.error}`);
        return result(400, {
          success: false,
          messageId,
          route: "smtp",
          provider: smtpResult.provider,
          recipientDomain,
          error: smtpResult.error || "Falha ao enviar via SMTP",
          message: smtpResult.error ? `Erro no Resend: ${smtpResult.error}` : "Falha ao enviar e-mail via SMTP",
        });
      }

      // Persistir a mensagem enviada no banco com status: "sent"
      if (prisma) {
        try {
          await prisma.message.create({
            data: {
              messageId,
              from: effectiveSenderEmail || `noreply@${effectiveSenderDomain}`,
              to,
              subject,
              body: typeof content === "string" ? content : JSON.stringify(content),
              msgClass,
              status: "sent",
              signature: null,
              isLegacy: true,
              transportProvider: smtpResult.provider,
              transportMessageId: smtpResult.messageId || null,
              isRead: true,
            },
          });
        } catch (dbErr: any) {
          log.error("SMTP accepted but message persistence failed");
          return result(503, { success: false, messageId, route: "smtp", deliveryState: "accepted_unrecorded", transportMessageId: smtpResult.messageId || null, message: "Delivery requires reconciliation; do not resend blindly" });
        }
      }

      return result(200, {
        success: true,
        messageId,
        route: "smtp",
        provider: smtpResult.provider,
        transportMessageId: smtpResult.messageId || null,
        deliveryState: "accepted",
        recipientDomain,
        message: `E-mail enviado com sucesso via ${smtpResult.provider.toUpperCase()} para ${to}`,
      });
    }
  }
}
