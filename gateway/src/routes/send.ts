import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import type { Hex } from "viem";
import { SendRequestSchema } from "../schemas/payload.js";
import type { LedgerService } from "../services/LedgerService.js";
import type { SignatureService } from "../services/SignatureService.js";
import type { SmtpService } from "../services/SmtpService.js";
import {
  buildMerkleTree,
  getMerkleRootHex,
  getMerkleProofHex,
} from "../utils/merkleUtils.js";
import type { PrismaClient } from "@prisma/client";

import type { KeyManagementService } from "../services/KeyManagementService.js";
import type { EventListenerService } from "../services/EventListenerService.js";
import type { StealthRoutingService } from "../services/StealthRoutingService.js";
import type { RoutingPoolService, EndpointNodeData } from "../services/RoutingPoolService.js";

// Cache de contagem diária de mensagens por domínio (Fase 13 Rate Limiting)
const dailySendCounts = new Map<string, number>();

interface SendRouteOptions {
  ledger: LedgerService;
  signer: SignatureService;
  smtp: SmtpService;
  senderDomain: string;
  prisma?: PrismaClient;
  kms?: KeyManagementService;
  eventListener?: EventListenerService;
  stealth?: StealthRoutingService;
  routingPool?: RoutingPoolService;
}

/**
 * Registra o endpoint POST /api/v1/send — O Roteador Híbrido Expandido
 * 
 * Fases 4, 6, 7 e 13 + Dynamic P2P Multi-Cluster Routing:
 * - Roteamento Web3 P2P vs SMTP Legado
 * - Autenticação por API Key pública (maivw_live_sk_...)
 * - Escalabilidade e Merkle Trees (Batching de destinatários)
 * - Suporte a Sub-identidades de Provedores Multi-tenant
 * - Rate Limiting On-Chain por Tier e Suspensão por Saldo Zerado
 * - Roteamento por Pool de Nós Dinâmicos (Weighted Round-Robin + Circuit Breaker Failover)
 */
export async function sendRoutes(app: FastifyInstance, options: SendRouteOptions) {
  const { ledger, signer, smtp, senderDomain, prisma, kms, eventListener, stealth, routingPool } = options;

  app.post("/api/v1/send", async (request, reply) => {
    // 0. Autenticação por API Key (se fornecida via Bearer)
    const authHeader = request.headers.authorization;
    let apiKeyDomain: string | null = null;

    if (authHeader?.startsWith("Bearer ") && kms) {
      const rawToken = authHeader.replace("Bearer ", "").trim();
      if (rawToken.startsWith("maivw_live_") || rawToken.startsWith("maivw_test_")) {
        const keyInfo = await kms.validateApiKey(rawToken);
        if (!keyInfo) {
          return reply.status(401).send({
            error: "Não autorizado",
            message: "A chave de API fornecida é inválida ou foi revogada.",
          });
        }
        apiKeyDomain = keyInfo.domainName;
      }
    }

    // 0.1 Normalizar payload para suportar top-level text e html (estilo Resend)
    const rawBody: any = request.body || {};
    if (!rawBody.content && (rawBody.text || rawBody.html)) {
      rawBody.content = {
        text: rawBody.text || "",
        html: rawBody.html,
      };
    }

    // 1. Validar payload de envio
    const parseResult = SendRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Payload inválido",
        details: parseResult.error.flatten(),
      });
    }

    const { to, subject, content, msgClass, recipients, subIdentityId, from, senderEmail } = parseResult.data;
    const messageId = uuidv4();

    // Resolver remetente efetivo
    const effectiveSenderEmail = from || senderEmail;
    let effectiveSenderDomain = apiKeyDomain || parseResult.data.senderDomain;
    if (effectiveSenderEmail && effectiveSenderEmail.includes("@")) {
      const match = effectiveSenderEmail.match(/@([a-zA-Z0-9.-]+)/);
      if (match) {
        effectiveSenderDomain = match[1].replace(/[>]/g, "").trim().toLowerCase();
      }
    }
    if (apiKeyDomain) {
      effectiveSenderDomain = apiKeyDomain;
    }
    if (!effectiveSenderDomain) {
      effectiveSenderDomain = senderDomain;
    }

    // 2. Extrair domínio do destinatário principal
    const recipientDomainMatch = to.match(/@([a-zA-Z0-9.-]+)/);
    const recipientDomain = recipientDomainMatch
      ? recipientDomainMatch[1].replace(/[>]/g, "").trim().toLowerCase()
      : to.split("@")[1];

    if (!recipientDomain) {
      return reply.status(400).send({
        error: "Invalid recipient email",
        message: "Could not extract domain from email address",
      });
    }

    app.log.info(
      `[ROUTER] Routing message ${messageId} to ${to} (from: ${effectiveSenderEmail || effectiveSenderDomain})${subIdentityId ? ` [subId: ${subIdentityId}]` : ""}`
    );

    // ============================================
    //  2.1 Verificação de Suspensão & Rate Limiting On-Chain (Fase 13)
    // ============================================

    if (eventListener?.isSuspended(effectiveSenderDomain)) {
      return reply.status(403).send({
        error: "ProviderSuspended",
        message: `O provedor ${effectiveSenderDomain} foi SUSPENSO pelo Smart Contract devido a saldo de caução zerado. Recarregue via topUpBalance para restaurar o tráfego.`,
        domain: effectiveSenderDomain,
      });
    }

    const isSenderActive = await ledger.isDomainRegistered(effectiveSenderDomain);
    if (!isSenderActive) {
      return reply.status(403).send({
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
        return reply.status(429).send({
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
      app.log.info(`[ROUTER] ✅ ${recipientDomain} está na rede MAIVW → Caminho Web3`);

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
            app.log.info(
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
          return reply.status(403).send({
            error: "Dark Endpoint Restricted",
            code: "STEALTH_ROUTING_REQUIRED",
            message: `O domínio destinatário (${recipientDomain}) opera em Modo Stealth (Dark Endpoint) e requer autorização bilateral. Configure a rota privada e o token de acesso no painel administrativo antes de enviar.`,
          });
        }

        if (!endpointUrl) {
          return reply.status(502).send({
            error: "Endpoint not found",
            message: `Domain ${recipientDomain} is registered but has no endpoint URL`,
          });
        }

        // 3b. Assinar o payload com a chave Web3 do domínio remetente (KMS)
        let signature: Hex;
        if (kms) {
          try {
            const domainAccount = await kms.getSignerForDomain(effectiveSenderDomain);
            const contentString = JSON.stringify({
              text: content.text,
              html: content.html || "",
            });
            signature = await domainAccount.signMessage({ message: contentString });
            app.log.info(`[ROUTER] ✍️ Assinado com a chave do domínio ${effectiveSenderDomain}: ${domainAccount.address}`);
          } catch (kmsErr: any) {
            app.log.warn(`[ROUTER] Não encontrou carteira no KMS para ${effectiveSenderDomain}, usando signer padrão: ${kmsErr.message}`);
            signature = await signer.signPayload(content);
          }
        } else {
          signature = await signer.signPayload(content);
        }

        // 3c. Lógica de Escalabilidade Merkle (Fase 6)
        let intentRoot: string = "0x" + "0".repeat(64);
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

        if (allRecipientDomains.length > 0) {
          const tree = buildMerkleTree(allRecipientDomains);
          intentRoot = getMerkleRootHex(tree);
          intentProof = getMerkleProofHex(tree, recipientDomain);
        }

        // 3d. Montar headers do protocolo MAIVW
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-maivw-sender": effectiveSenderDomain,
          "x-maivw-intent-tx": "0x" + "ab".repeat(32),
          "x-maivw-intent-root": intentRoot,
          "x-maivw-intent-proof": JSON.stringify(intentProof),
        };

        if (subIdentityId) {
          headers["x-maivw-sub-identity"] = subIdentityId;
        }

        if (stealthToken) {
          headers["x-maivw-stealth-token"] = stealthToken;
        }

        // 3e. Montar body
        const maivwPayload = {
          messageId,
          msgClass,
          to,
          subject,
          content,
          signature,
          subIdentityId,
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

          app.log.info(
            `[ROUTER] 🎯 Resolução Dinâmica P2P: Destino=${recipientDomain} -> Pool=${poolCode || "DIRECT"} (Candidatos: ${candidateUrls.length})`
          );
        } else {
          const targetInboxUrl = endpointUrl.endsWith("/api/v1/inbox")
            ? endpointUrl
            : `${endpointUrl.replace(/\/$/, "")}/api/v1/inbox`;
          candidateUrls = [{ url: targetInboxUrl }];
        }

        let response: Response | null = null;
        let responseData: any = null;
        let lastError: any = null;
        let deliveredNodeName: string | undefined;

        // Tentar candidatos com failover imediato caso um nó caia ou atinja timeout de 6s
        for (const candidate of candidateUrls) {
          const start = Date.now();
          app.log.info(
            `[ROUTER] 📡 Tentando envio POST para ${candidate.url}${candidate.node ? ` (Nó #${candidate.node.id}: ${candidate.node.name})` : ""}...`
          );

          try {
            response = await fetch(candidate.url, {
              method: "POST",
              headers,
              body: JSON.stringify(maivwPayload),
              signal: AbortSignal.timeout(6000),
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
              app.log.warn(`[ROUTER] Nó ${candidate.url} retornou ${response.status}, iniciando failover...`);
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
            app.log.warn(
              `[ROUTER] Falha ao conectar a ${candidate.url} (${fetchErr.message}), tentando próximo candidato de failover...`
            );
          }
        }

        // Se nenhum candidato respondeu e estamos em ambiente de desenvolvimento/teste local
        if (!response && (
          lastError?.message?.includes("ENOTFOUND") ||
          lastError?.message?.includes("getaddrinfo") ||
          lastError?.name === "TimeoutError" ||
          process.env.NODE_ENV !== "production"
        )) {
          app.log.warn(`[ROUTER] Endpoints de pool inacessíveis externamente em dev, despachando para inbox local no Gateway...`);
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
          app.log.info(`[ROUTER] ✅ Mensagem ${messageId} entregue via Web3!${deliveredNodeName ? ` (via ${deliveredNodeName})` : ""}`);

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
                  isRead: true,
                },
              });
            } catch (dbErr: any) {
              app.log.error(dbErr, `[ROUTER] Falha ao persistir mensagem enviada Web3:`);
            }
          }

          return reply.status(200).send({
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
          app.log.warn(`[ROUTER] ⚠️ Destino retornou ${response.status}: ${JSON.stringify(responseData)}`);
          return reply.status(response.status).send({
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
        app.log.error(error as any, `[ROUTER] ❌ Erro no Caminho Web3:`);
        return reply.status(502).send({
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
      app.log.info(`[ROUTER] 📧 ${recipientDomain} NÃO está na rede MAIVW → Fallback SMTP`);

      const result = await smtp.sendEmail(
        to,
        subject,
        content,
        effectiveSenderDomain,
        undefined,
        effectiveSenderEmail
      );

      if (!result.success) {
        app.log.error(`[ROUTER] ❌ Falha no envio SMTP para ${to}: ${result.error}`);
        return reply.status(400).send({
          success: false,
          messageId,
          route: "smtp",
          provider: result.provider,
          recipientDomain,
          error: result.error || "Falha ao enviar via SMTP",
          message: result.error ? `Erro no Resend: ${result.error}` : "Falha ao enviar e-mail via SMTP",
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
              isRead: true,
            },
          });
        } catch (dbErr: any) {
          app.log.error(dbErr, `[ROUTER] Falha ao persistir mensagem enviada SMTP:`);
        }
      }

      return reply.status(200).send({
        success: true,
        messageId,
        route: "smtp",
        provider: result.provider,
        recipientDomain,
        message: `E-mail enviado com sucesso via ${result.provider.toUpperCase()} para ${to}`,
      });
    }
  });
}
