import type { FastifyInstance } from "fastify";
import type { Hex, Address } from "viem";
import { MessagePayloadSchema } from "../schemas/payload.js";
import { BLOCKABLE_CLASSES, type MessageClass } from "../schemas/taxonomy.js";
import type { LedgerService } from "../services/LedgerService.js";
import type { SignatureService } from "../services/SignatureService.js";
import type { ReputationService } from "../services/ReputationService.js";
import type { PrismaClient } from "@prisma/client";
import { verifyDomainMerkleProof } from "../utils/merkleUtils.js";

import type { StealthRoutingService } from "../services/StealthRoutingService.js";
import type { RoutingPoolService } from "../services/RoutingPoolService.js";

interface InboxRouteOptions {
  ledger: LedgerService;
  signer: SignatureService;
  reputation: ReputationService;
  prisma?: PrismaClient;
  stealth?: StealthRoutingService;
  routingPool?: RoutingPoolService;
}

/**
 * Preferências locais do destinatário
 */
const BLOCKED_CLASSES: Set<MessageClass> = new Set([]);

/**
 * Registra o endpoint POST /api/v1/inbox — Recepção de Mensagens Expandida
 * 
 * Fases 4, 6, 7 e Dark Endpoints (Stealth Mode) + Smart Ingress Multi-Cluster Proxy:
 * - Smart Ingress Reverse Proxy para Nós de Destino (se INGRESS_PROXY_ENABLED=true)
 * - Validação de Modo Stealth (Camuflagem 404 / Silent Drop para não autorizados)
 * - Validação de Sub-identidade obrigatória para Provedores (Fase 7)
 * - Verificação de Reputação Local Granular [domain, subIdentityId] em PostgreSQL (Fase 7)
 * - Verificação Matemática de Prova de Merkle (Fase 6)
 * - Verificação Criptográfica com Chave Pública on-chain (Fase 4)
 */
export async function inboxRoutes(app: FastifyInstance, options: InboxRouteOptions) {
  const { ledger, signer, reputation, prisma, stealth, routingPool } = options;

  app.post("/api/v1/inbox", async (request, reply) => {
    const headers = request.headers;

    // ============================================
    //  0. Verificação de Modo Stealth / Dark Endpoint (Silent Drop 404)
    // ============================================
    const stealthToken = headers["x-maivw-stealth-token"] as string | undefined;
    const explicitRecipient = (headers["x-maivw-target-domain"] || headers["x-maivw-recipient-domain"]) as string | undefined;
    let recipientDomain = explicitRecipient?.toLowerCase().trim();

    if (!recipientDomain && request.body && typeof request.body === "object") {
      const b = request.body as Record<string, any>;
      if (typeof b.to === "string" && b.to.includes("@")) {
        recipientDomain = b.to.split("@")[1]?.toLowerCase().trim();
      }
    }

    // ============================================
    //  0.1 Smart Ingress Reverse Proxy Forwarding
    // ============================================
    const isAlreadyProxied = Boolean(headers["x-maivw-ingress-proxied"]);
    const isIngressProxyMode = process.env.INGRESS_PROXY_ENABLED === "true";

    if (!isAlreadyProxied && isIngressProxyMode && routingPool && recipientDomain) {
      const resolved = routingPool.resolveTarget(recipientDomain);
      if (resolved.selectedNode && resolved.targetUrl) {
        const targetUrl = resolved.targetUrl.endsWith("/api/v1/inbox")
          ? resolved.targetUrl
          : `${resolved.targetUrl.replace(/\/$/, "")}/api/v1/inbox`;

        // Se o destino for diferente da instância local, repassa a requisição
        const currentPort = String(process.env.GATEWAY_PORT || 3001);
        const isSelf = targetUrl.includes(`:${currentPort}`) || targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");

        if (!isSelf) {
          app.log.info(
            `[SMART-INGRESS] 🔀 Redirecionando requisição para o nó do cluster: ${resolved.selectedNode.name} (${targetUrl})...`
          );
          try {
            const proxyHeaders: Record<string, string> = {
              "Content-Type": "application/json",
              "x-maivw-ingress-proxied": "true",
            };

            for (const [key, val] of Object.entries(headers)) {
              if (key.toLowerCase().startsWith("x-maivw-") && typeof val === "string") {
                proxyHeaders[key] = val;
              }
            }

            const proxyRes = await fetch(targetUrl, {
              method: "POST",
              headers: proxyHeaders,
              body: JSON.stringify(request.body),
              signal: AbortSignal.timeout(6000),
            });

            const proxyData = await proxyRes.json().catch(() => null);
            return reply.status(proxyRes.status).send(proxyData);
          } catch (proxyErr: any) {
            app.log.error(`[SMART-INGRESS] ❌ Falha ao repassar requisição para o nó: ${proxyErr.message}`);
            // Em caso de falha de proxy, prossegue com processamento local de fallback
          }
        }
      }
    }

    if (stealth) {
      const stealthCheck = await stealth.validateInboundAccess(recipientDomain, stealthToken);
      if (stealthCheck.isStealth && !stealthCheck.allowed) {
        app.log.warn(
          `[INBOX] 🛡️ Stealth Silent Drop (404) para "${recipientDomain || 'blind-probe'}" — Token ausente ou não autorizado.`
        );
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "Cannot POST /api/v1/inbox",
        });
      }
    }

    // ============================================
    //  1. Extrair headers do protocolo MAIVW
    // ============================================
    const senderDomain = headers["x-maivw-sender"] as string | undefined;
    const intentTx = headers["x-maivw-intent-tx"] as string | undefined;
    const subIdentityHeader = headers["x-maivw-sub-identity"] as string | undefined;
    const intentRoot = headers["x-maivw-intent-root"] as string | undefined;
    const intentProof = headers["x-maivw-intent-proof"] as string | undefined;

    if (!senderDomain) {
      return reply.status(400).send({
        error: "Missing x-maivw-sender header",
        message: "O header x-maivw-sender é obrigatório",
      });
    }

    if (!intentTx && !intentRoot) {
      return reply.status(400).send({
        error: "Missing intent header",
        message: "O header x-maivw-intent-tx ou x-maivw-intent-root é obrigatório",
      });
    }

    // ============================================
    //  2. Validar payload estrutural (Zod)
    // ============================================
    const parseResult = MessagePayloadSchema.safeParse(request.body);
    if (!parseResult.success) {
      app.log.warn(`[INBOX] ❌ Payload inválido de ${senderDomain}`);
      return reply.status(400).send({
        error: "Invalid payload",
        details: parseResult.error.flatten(),
      });
    }

    const { messageId, msgClass, to, subject, content, signature, subIdentityId } =
      parseResult.data;
    const effectiveSubId = subIdentityHeader || subIdentityId;

    // ============================================
    //  3. Regra de Provedor Multi-Tenant (Fase 7)
    // ============================================
    const isSenderProvider = await ledger.isProvider(senderDomain);
    if (isSenderProvider && !effectiveSubId) {
      app.log.warn(`[INBOX] ❌ Provedor ${senderDomain} não incluiu subIdentityId`);
      return reply.status(400).send({
        error: "Sub-identity required",
        message: `O domínio remetente "${senderDomain}" está registrado como Provedor Multi-tenant. É obrigatório fornecer subIdentityId (ou header x-maivw-sub-identity).`,
      });
    }

    // ============================================
    //  4. Reputação Granular Local [domain, subIdentityId] (Fase 7)
    // ============================================
    const isBlocked = await reputation.isSenderBlocked(senderDomain, effectiveSubId);
    if (isBlocked) {
      app.log.warn(
        `[INBOX] 🚫 Remetente bloqueado na reputação local: ${senderDomain}#${effectiveSubId || "default"}`
      );
      return reply.status(403).send({
        error: "Forbidden",
        message: `O remetente "${senderDomain}" (sub-identidade: "${effectiveSubId || "default"}") está bloqueado na reputação local por infrações anteriores.`,
      });
    }

    // ============================================
    //  5. Validação de Merkle Proof (Fase 6)
    // ============================================
    if (intentRoot && intentProof) {
      try {
        const proofsArray: string[] = JSON.parse(intentProof);
        const recipientDomain = to.split("@")[1] || "";
        const isProofValid = verifyDomainMerkleProof(
          recipientDomain,
          intentRoot,
          proofsArray
        );

        if (!isProofValid) {
          app.log.warn(
            `[INBOX] ❌ Prova de Merkle inválida para ${recipientDomain} na raiz ${intentRoot}`
          );
          return reply.status(401).send({
            error: "Invalid Merkle Proof",
            message: `A prova de inclusão de Merkle não comprova que "${recipientDomain}" faz parte da intenção em lote ${intentRoot}.`,
          });
        }
        app.log.info(`[INBOX] 🌲 Prova de Merkle verificada com sucesso para ${recipientDomain}`);
      } catch (err: any) {
        app.log.warn(`[INBOX] ❌ Erro ao validar Merkle Proof: ${err.message}`);
        return reply.status(400).send({
          error: "Malformed Merkle Proof",
          message: "Formato inválido do cabeçalho x-maivw-intent-proof",
        });
      }
    }

    // ============================================
    //  6. Soft Bounce / Filtro de Taxonomia
    // ============================================
    if (BLOCKED_CLASSES.has(msgClass as MessageClass)) {
      app.log.info(`[INBOX] 🚫 Categoria ${msgClass} bloqueada pelo destinatário → 406`);
      return reply.status(406).send({
        error: "Not Acceptable",
        message: `A categoria "${msgClass}" está bloqueada pelo destinatário`,
        msgClass,
      });
    }

    // ============================================
    //  7. Buscar Chave Pública no Smart Contract
    // ============================================
    const publicKey = await ledger.getPublicKey(senderDomain);
    if (!publicKey) {
      app.log.warn(`[INBOX] ❌ Domínio ${senderDomain} não encontrado no Cartório`);
      return reply.status(401).send({
        error: "Unauthorized",
        message: `Domínio "${senderDomain}" não está registrado ou foi banido na rede MAIVW`,
      });
    }

    // ============================================
    //  8. Validar Assinatura Criptográfica
    // ============================================
    const isSignatureValid = await signer.verifyPayload(
      content,
      signature as Hex,
      publicKey as Address
    );

    if (!isSignatureValid) {
      app.log.warn(`[INBOX] ❌ Assinatura inválida de ${senderDomain}`);
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Assinatura criptográfica inválida. A mensagem pode ter sido adulterada.",
      });
    }

    // ============================================
    //  9. Mensagem Validada! Aceitar
    // ============================================
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  ✅ [MAIVW INBOX] Mensagem validada e recebida!            ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  ID:        ${messageId}`);
    console.log(`║  De:        ${senderDomain}${effectiveSubId ? ` (#${effectiveSubId})` : ""}`);
    console.log(`║  Para:      ${to}`);
    console.log(`║  Assunto:   ${subject}`);
    console.log(`║  Classe:    ${msgClass}`);
    console.log(`║  Assinatura: ${(signature as string).slice(0, 20)}...`);
    if (intentRoot) console.log(`║  MerkleRoot:${intentRoot.slice(0, 20)}...`);
    console.log(`║  Rota:      Protocolo MAIVW (Web3 P2P)`);
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");

    if (prisma) {
      try {
        await prisma.message.upsert({
          where: { messageId },
          create: {
            messageId,
            from: `${senderDomain}${effectiveSubId ? ` (#${effectiveSubId})` : ""}`,
            to,
            subject,
            body: typeof content === "string" ? content : JSON.stringify(content),
            msgClass,
            status: "received",
            signature: signature as string,
            isLegacy: false,
          },
          update: {},
        });
      } catch (err: any) {
        app.log.error(`[INBOX] Failed to persist message ${messageId}: ${err.message}`);
      }
    }

    return reply.status(202).send({
      status: "accepted",
      messageId,
      senderDomain,
      subIdentityId: effectiveSubId,
      merkleVerified: Boolean(intentRoot && intentProof),
      message: `Mensagem de ${senderDomain} validada e aceita para a caixa de entrada`,
    });
  });
}
