import type { FastifyInstance } from "fastify";
import { createChallenge, validChallenge } from "../services/OnboardingChallenge.js";
import { hashPassword, NewPasswordSchema } from "../services/PasswordService.js";
import { getAuthUser } from "./auth.js";
import dns from "node:dns/promises";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { KeyManagementService } from "../services/KeyManagementService.js";
import type { OracleService } from "../services/OracleService.js";
import type { LedgerService } from "../services/LedgerService.js";
import { isLocalDemoConfig, type EnvConfig } from "../config.js";
import type { Address } from "viem";

const ChallengeSchema = z.object({
  domainName: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  userId: z.number().int().positive().optional(),
});

const CheckDnsSchema = z.object({
  domainName: z.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/),
  token: z.string().min(8),
  simulate: z.literal(false).optional(),
});

const EndpointUrlSchema = z.string().url("O endpoint P2P deve ser uma URL válida");

const VerifyAndRegisterSchema = z.object({
  domainName: z.string().min(3),
  userId: z.number().int().positive(),
  token: z.string().min(8),
  publicKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  endpointUrl: EndpointUrlSchema.optional(),
  simulateDns: z.literal(false).optional(),
  targetChainId: z.number().int().optional(),
});

const ClaimProofSchema = z.object({
  domainName: z.string().min(3),
  userId: z.number().int().positive(),
  token: z.string().min(8),
  callerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  publicKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  endpointUrl: EndpointUrlSchema.optional(),
  targetChainId: z.number().int().optional(),
  simulateDns: z.literal(false).optional(),
});

const FinalizeWeb3RegistrationSchema = z.object({
  domainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  endpointUrl: EndpointUrlSchema.optional(),
  targetChainId: z.number().int().optional(),
});

const CompleteOnboardingSchema = z.object({
  domainId: z.number().int().positive(),
  localPart: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/).default("admin"),
  displayName: z.string().optional(),
  password: NewPasswordSchema,
  purpose: z.enum(["webmail", "api", "both"]).default("both"),
});

interface OnboardingRouteOptions {
  prisma: PrismaClient;
  kms: KeyManagementService;
  oracle: OracleService;
  ledger: LedgerService;
  config: EnvConfig;
  resolveTxt?: (host: string) => Promise<string[][]>;
}

export async function onboardingRoutes(app: FastifyInstance, options: OnboardingRouteOptions) {
  const { prisma, kms, oracle, ledger, config } = options;
  const isLocalDemo = Boolean(config && isLocalDemoConfig(config));
  async function hasDnsChallenge(domain: string, expected: string): Promise<boolean> {
    if (isLocalDemo) {
      app.log.info({ domain }, "[ONBOARDING] desafio DNS aprovado no modo de demonstração local");
      return true;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const records = await Promise.race([
        (options.resolveTxt || dns.resolveTxt)(`_maivw-verify.${domain}`),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 4000); }),
      ]);
      return records.some(parts => parts.join("") === expected);
    } catch { return false; }
    finally { if (timer) clearTimeout(timer); }
  }
  async function authorizeOnboarding(request: any, reply: any) {
    const claims = getAuthUser(request);
    if (!claims) return reply.status(401).send({ error: "Autenticação obrigatória" });
    const current = await prisma.user.findUnique({ where: { id: claims.id } });
    if (!current || current.role !== "admin" || current.email.toLowerCase() !== claims.email.toLowerCase()) return reply.status(403).send({ error: "Administrador ativo obrigatório" });
    const body = request.body || {};
    if (body.userId !== undefined && body.userId !== current.id) return reply.status(403).send({ error: "Usuário não corresponde à sessão" });
    if (body.targetChainId !== undefined && body.targetChainId !== config.CHAIN_ID) return reply.status(400).send({ error: "Use a rede configurada neste nó" });
    if (body.simulate === true || body.simulateDns === true) return reply.status(400).send({ error: "Simulação DNS desativada" });
    if (body.endpointUrl !== undefined) {
      const endpoint = EndpointUrlSchema.safeParse(body.endpointUrl);
      if (!endpoint.success) return reply.status(400).send({ error: "Endpoint P2P inválido" });
      if (!isLocalDemo && new URL(endpoint.data).protocol !== "https:") return reply.status(400).send({ error: "Endpoint P2P deve usar HTTPS fora do Anvil local" });
    }
    if (body.domainName !== undefined) {
      const domain = ChallengeSchema.shape.domainName.safeParse(body.domainName);
      if (!domain.success) return reply.status(400).send({ error: "Domínio inválido" });
      const existing = await prisma.domain.findUnique({ where: { domainName: domain.data } });
      if (existing && existing.userId !== current.id) return reply.status(403).send({ error: "Domínio indisponível para esta conta" });
      if (request.routeOptions.url !== "/api/v1/onboarding/challenge" && !validChallenge(body.token, domain.data, current.id, config.JWT_SECRET)) return reply.status(400).send({ error: "Desafio inválido ou expirado; gere outro e atualize o DNS" });
    }
    if (body.domainId !== undefined) {
      if (!Number.isInteger(body.domainId) || body.domainId < 1) return reply.status(400).send({ error: "Domínio inválido" });
      const domain = await prisma.domain.findUnique({ where: { id: body.domainId } });
      if (!domain || domain.userId !== current.id) return reply.status(404).send({ error: "Domínio não encontrado" });
    }
  }

  const MAIVW_CORE_DOMAIN = config?.MAIVW_CORE_DOMAIN || "maivw.org";
  const DEFAULT_P2P_ENDPOINT = config?.DEFAULT_P2P_ENDPOINT || `https://mw.${MAIVW_CORE_DOMAIN}/api/v1/inbox`;

  /**
   * GET /api/v1/onboarding/node-mode
   * Informa ao frontend se o nó está rodando em modo Self-Hosted ou Cloud,
   * se é a autoridade Oráculo oficial da rede ou se faz ponte com um Oráculo remoto.
   */
  app.get("/api/v1/onboarding/node-mode", async () => {
    let contractOracle: string | null = null;
    try {
      contractOracle = await ledger.getOracleNode();
    } catch {
      // Ignora erro eventual de RPC
    }

    const myOracleAddress = oracle.getOracleAddress();
    const isOracleAuthority = Boolean(
      contractOracle &&
      myOracleAddress &&
      contractOracle.toLowerCase() === myOracleAddress.toLowerCase()
    );

    const isCloud = Boolean(config.IS_CLOUD);
    const isSelfHosted = !isCloud;

    return {
      chainId: config.CHAIN_ID,
      paymentProvisioningEnabled: false,
      isCloud,
      isSelfHosted,
      isOracleAuthority,
      oracleAddress: myOracleAddress,
      contractOracleAddress: contractOracle,
      remoteOracleUrl: config.MAIVW_ORACLE_URL || "https://api-test.maivw.com",
      defaultEndpoint: DEFAULT_P2P_ENDPOINT,
      defaultEndpointPattern: isLocalDemo ? DEFAULT_P2P_ENDPOINT : "https://mw-p2p.{domain}/api/v1/inbox",
      dnsMode: isLocalDemo ? "local-demo" : "public-dns",
    };
  });

  /**
   * POST /api/v1/onboarding/challenge
   * Gera o desafio de posse único via DNS TXT e verifica se o domínio já existe
   */
  app.post("/api/v1/onboarding/challenge", { preHandler: authorizeOnboarding }, async (request, reply) => {
    const parse = ChallengeSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const cleanDomain = parse.data.domainName.toLowerCase().trim();
    const userId = getAuthUser(request)!.id;

    // 1. Verificar se o domínio já existe on-chain no Cartório MAIVW (apenas o domínio exato)
    const isOnChain = await ledger.isDomainRegistered(cleanDomain, true);
    if (isOnChain) {
      return reply.status(409).send({
        error: "Domínio já registrado",
        message: `O domínio ${cleanDomain} já está registrado no Cartório On-Chain da rede MAIVW.`,
      });
    }

    const token = createChallenge(cleanDomain, userId, config.JWT_SECRET);

    return {
      domain: cleanDomain,
      token,
      records: {
        txt: {
          type: "TXT",
          host: `_maivw-verify.${cleanDomain}`,
          name: "_maivw-verify",
          value: `maivw-verification=${token}`,
          purpose: "Prova de Posse Obrigatória para Registro On-Chain",
          required: true,
        },
        mx: {
          type: "MX",
          host: cleanDomain,
          name: "@",
          value: `inbound.${MAIVW_CORE_DOMAIN}`,
          priority: 10,
          purpose: "Recebimento de E-mails",
          required: false,
        },
        spf: {
          type: "TXT",
          host: cleanDomain,
          name: "@",
          value: `v=spf1 include:_spf.${MAIVW_CORE_DOMAIN} ~all`,
          purpose: "Reputação e Anti-Spam (SPF)",
          required: false,
        },
        dmarc: {
          type: "TXT",
          host: `_dmarc.${cleanDomain}`,
          name: "_dmarc",
          value: "v=DMARC1; p=quarantine;",
          purpose: "Proteção contra Phishing e Spoofing",
          required: false,
        },
      },
    };
  });

  /**
   * POST /api/v1/onboarding/check-dns
   * Consulta os servidores DNS em tempo real (via DoH / dns.google)
   */
  app.post("/api/v1/onboarding/check-dns", { preHandler: authorizeOnboarding }, async (request, reply) => {
    const parse = CheckDnsSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { domainName, token, simulate } = parse.data;
    const cleanDomain = domainName.toLowerCase().trim();
    const challengeHost = `_maivw-verify.${cleanDomain}`;
    const expectedValue = `maivw-verification=${token}`;

    if (isLocalDemo) {
      return {
        domain: cleanDomain,
        isPosseVerified: true,
        localBypass: true,
        records: {
          txt: { verified: true, found: [expectedValue] },
          mx: { verified: false },
          spf: { verified: false },
          dmarc: { verified: false },
        },
      };
    }

    let isPosseVerified = false;
    let foundTxts: string[] = [];
    let mxVerified = false;
    let spfVerified = false;
    let dmarcVerified = false;

    // 1. Tentar consulta via DoH (DNS-over-HTTPS da Google)
    try {
      const dohRes = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(challengeHost)}&type=TXT`,
        { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) }
      );
      if (dohRes.ok) {
        const dohData: any = await dohRes.json();
        if (dohData?.Answer) {
          foundTxts = dohData.Answer.map((a: any) =>
            (a.data || "").replace(/^"|"$/g, "")
          );
          isPosseVerified = foundTxts.some((t) => t === expectedValue);
        }
      }
    } catch {
      // Fallback para DNS nativo do Node
      try {
        const records = await dns.resolveTxt(challengeHost);
        foundTxts = records.map(parts => parts.join(""));
        isPosseVerified = foundTxts.some((t) => t === expectedValue);
      } catch {}
    }

    // 2. Checar MX
    try {
      const mxRes = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=MX`,
        { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) }
      );
      if (mxRes.ok) {
        const data: any = await mxRes.json();
        mxVerified = (data?.Answer?.length || 0) > 0;
      }
    } catch {}

    // 3. Checar SPF
    try {
      const spfRes = await fetch(
        `https://dns.google/resolve?name=${encodeURIComponent(cleanDomain)}&type=TXT`,
        { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) }
      );
      if (spfRes.ok) {
        const data: any = await spfRes.json();
        const txts: string[] = (data?.Answer || []).map((a: any) => a.data || "");
        spfVerified = txts.some((t) => t.toLowerCase().includes("v=spf1"));
      }
    } catch {}


    return {
      domain: cleanDomain,
      isPosseVerified,
      records: {
        txt: { verified: isPosseVerified, found: foundTxts },
        mx: { verified: mxVerified },
        spf: { verified: spfVerified },
        dmarc: { verified: dmarcVerified },
      },
    };
  });

  /**
   * POST /api/v1/onboarding/verify-and-register
   * Valida o desafio, gera a prova criptográfica do Oráculo e registra on-chain no Cartório MAIVW
   */
  app.post("/api/v1/onboarding/verify-and-register", { preHandler: authorizeOnboarding }, async (request, reply) => {
    const parse = VerifyAndRegisterSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { domainName, userId, token, simulateDns, targetChainId, publicKey: providedPubKey, endpointUrl } = parse.data;
    const cleanDomain = domainName.toLowerCase().trim();
    const expectedValue = `maivw-verification=${token}`;
    const resolvedEndpoint = endpointUrl || DEFAULT_P2P_ENDPOINT || `https://mw-p2p.${cleanDomain}/api/v1/inbox`;

    let contractOracle: string | null = null;
    try {
      contractOracle = await ledger.getOracleNode();
    } catch {}

    const myOracleAddress = oracle.getOracleAddress();
    const isOracleAuthority = Boolean(
      contractOracle &&
      myOracleAddress &&
      contractOracle.toLowerCase() === myOracleAddress.toLowerCase()
    );

    if (!isOracleAuthority) return reply.status(503).send({ error: "Este nó não é a autoridade do Registry; integração autenticada com oráculo remoto pendente" });

    // 3. Validação de DNS pelo próprio Oráculo Local (se for a autoridade ou modo Anvil)
    const isPosseVerified = await hasDnsChallenge(cleanDomain, expectedValue);

    if (!isPosseVerified) {
      return reply.status(400).send({
        error: "Posse do domínio não confirmada",
        message: `Não encontramos a entrada TXT "_maivw-verify.${cleanDomain}" com o valor "${expectedValue}" no seu provedor de DNS.`,
      });
    }

    // 1. Garantir usuário e domínio no banco local
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const domain = await prisma.domain.upsert({
      where: { domainName: cleanDomain },
      create: { domainName: cleanDomain, userId: user.id, isVerified: false },
      update: {},
    });

    if (domain.userId !== user.id) return reply.status(403).send({ error: "Domínio pertence a outra conta" });

    // 2. Provisionar Carteira e Chave Criptográfica ECDSA para o Domínio
    const localWallet = await kms.provisionWalletForDomain(domain.id);
    if (providedPubKey && providedPubKey.toLowerCase() !== localWallet.publicKey.toLowerCase()) return reply.status(400).send({ error: "Chave deve corresponder ao cofre local" });
    const domainPublicKey = localWallet.publicKey as Address;
    const effectiveChainId = targetChainId || config.CHAIN_ID;

    const adminKey = domainPublicKey;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

    // 4. Oráculo gera o Atestado Criptográfico (oracleProof)
    const oracleProof = await oracle.generateRegistrationProof(
      cleanDomain,
      domainPublicKey,
      oracle.getOracleAddress(),
      effectiveChainId,
      adminKey,
      deadline
    );

    // 5. Executar o registro oficial no Cartório On-Chain via Relayer
    let txHash: string;
    try {
      txHash = await oracle.registerCompanyOnChain(
        cleanDomain,
        resolvedEndpoint,
        domainPublicKey,
        false,
        oracleProof,
        effectiveChainId,
        adminKey,
        deadline
      );
    } catch (err: any) {
      app.log.error(err, "[ONBOARDING] Erro ao registrar na blockchain:");
      if (err?.message?.includes("DomainAlreadyRegistered")) {
        return reply.status(409).send({
          error: "Domínio já registrado na blockchain",
          message: `O domínio ${cleanDomain} já está cadastrado no Cartório on-chain.`,
        });
      }
      return reply.status(500).send({
        error: "Falha na transação on-chain",
        message: err?.shortMessage || err?.message || "Erro ao registrar no smart contract",
      });
    }

    try {
      if (!await ledger.verifyRegistration(txHash as `0x${string}`, cleanDomain, domainPublicKey, resolvedEndpoint)) throw new Error("Registro não corresponde ao domínio");
    } catch {
      return reply.status(409).send({ error: "Transação ainda não confirmada ou registro divergente; use finalize-web3-registration para conferir novamente", txHash, domainId: domain.id });
    }
    await prisma.domain.update({ where: { id: domain.id }, data: { isVerified: true } });

    let networkName = "Base Sepolia";
    let basescanUrl = `https://sepolia.basescan.org/tx/${txHash}`;
    if (effectiveChainId === 421614) {
      networkName = "Arbitrum Sepolia";
      basescanUrl = `https://sepolia.arbiscan.io/tx/${txHash}`;
    } else if (effectiveChainId === 80002) {
      networkName = "Polygon Amoy";
      basescanUrl = `https://amoy.polygonscan.com/tx/${txHash}`;
    } else if (effectiveChainId === 31337) {
      networkName = "Anvil Local";
      basescanUrl = `http://localhost:55443`;
    }

    return reply.status(201).send({
      success: true,
      domain: {
        id: domain.id,
        domainName: cleanDomain,
        isVerified: true,
      },
      blockchain: {
        network: networkName,
        chainId: effectiveChainId,
        txHash,
        basescanUrl,
        publicKey: domainPublicKey,
        endpointUrl: resolvedEndpoint,
        oracleAttestationVerified: true,
      },
      message: `Domínio ${cleanDomain} registrado com sucesso no Cartório On-Chain (${networkName})!`,
    });
  });

  /**
   * POST /api/v1/onboarding/claim-proof
   * Valida a posse do domínio e emite a Prova Criptográfica ECDSA do Oráculo autorizando a carteira Web3 do usuário (msg.sender)
   * a invocar diretamente registerCompany() no Smart Contract.
   */
  app.post("/api/v1/onboarding/claim-proof", { preHandler: authorizeOnboarding }, async (request, reply) => {
    const parse = ClaimProofSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { domainName, userId, token, callerAddress, targetChainId, simulateDns, publicKey: providedPubKey, endpointUrl } = parse.data;
    const cleanDomain = domainName.toLowerCase().trim();
    const expectedValue = `maivw-verification=${token}`;
    const resolvedEndpoint = endpointUrl || DEFAULT_P2P_ENDPOINT || `https://mw-p2p.${cleanDomain}/api/v1/inbox`;

    let contractOracle: string | null = null;
    try {
      contractOracle = await ledger.getOracleNode();
    } catch {}

    const myOracleAddress = oracle.getOracleAddress();
    const isOracleAuthority = Boolean(
      contractOracle &&
      myOracleAddress &&
      contractOracle.toLowerCase() === myOracleAddress.toLowerCase()
    );

    if (!isOracleAuthority) return reply.status(503).send({ error: "Este nó não é a autoridade do Registry; integração autenticada com oráculo remoto pendente" });

    // 3. Validar posse via DNS se for o próprio Oráculo
    const isPosseVerified = await hasDnsChallenge(cleanDomain, expectedValue);

    if (!isPosseVerified) {
      return reply.status(400).send({
        error: "Posse do domínio não confirmada",
        message: `Não encontramos a entrada TXT "_maivw-verify.${cleanDomain}" com o valor "${expectedValue}" no seu DNS.`,
      });
    }

    // 1. Garantir usuário e domínio no banco de dados local
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const domain = await prisma.domain.upsert({
      where: { domainName: cleanDomain },
      create: { domainName: cleanDomain, userId: user.id, isVerified: false },
      update: {},
    });

    if (domain.userId !== user.id) return reply.status(403).send({ error: "Domínio pertence a outra conta" });

    // 2. Provisionar Carteira e Chave Criptográfica ECDSA para o Domínio
    const localWallet = await kms.provisionWalletForDomain(domain.id);
    if (providedPubKey && providedPubKey.toLowerCase() !== localWallet.publicKey.toLowerCase()) return reply.status(400).send({ error: "Chave deve corresponder ao cofre local" });
    const domainPublicKey = localWallet.publicKey as Address;
    const effectiveChainId = targetChainId || config.CHAIN_ID;

    // 4. Determinar contrato e taxa da rede
    let contractAddress = ledger.getContractAddress() as Address;
    let standardFeeWei = 100000000000000n; // 0.0001 ETH
    let standardFeeFormatted = "0.0001 ETH";
    let networkName = "Base Sepolia";
    let explorerUrl = "https://sepolia.basescan.org";

    if (effectiveChainId === 421614) {
      contractAddress = (config.ARBITRUM_REGISTRY_ADDRESS || contractAddress) as Address;
      standardFeeWei = 100000000000000n; // 0.0001 ETH
      standardFeeFormatted = "0.0001 ETH";
      networkName = "Arbitrum Sepolia";
      explorerUrl = "https://sepolia.arbiscan.io";
    } else if (effectiveChainId === 80002) {
      contractAddress = (config.POLYGON_REGISTRY_ADDRESS || contractAddress) as Address;
      standardFeeWei = 100000000000000000n; // 0.1 POL
      standardFeeFormatted = "0.1 POL";
      networkName = "Polygon Amoy";
      explorerUrl = "https://amoy.polygonscan.com";
    } else if (effectiveChainId === 31337) {
      standardFeeWei = 10000000000000000000n; // 10 ETH
      standardFeeFormatted = "10 ETH";
      networkName = "Anvil Local";
      explorerUrl = "http://localhost:55443";
    }

    // 5. Oráculo assina a Prova autorizando especificamente a carteira do usuário (callerAddress)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);
    const adminKey = callerAddress as Address;
    const oracleProof = await oracle.generateRegistrationProof(
      cleanDomain,
      domainPublicKey,
      callerAddress as Address,
      effectiveChainId,
      adminKey,
      deadline
    );

    return reply.status(200).send({
      success: true,
      domain: cleanDomain,
      domainId: domain.id,
      publicKey: domainPublicKey,
      adminKey,
      deadline: deadline.toString(),
      endpointUrl: resolvedEndpoint,
      network: networkName,
      chainId: effectiveChainId,
      contractAddress,
      standardFeeWei: standardFeeWei.toString(),
      standardFeeFormatted,
      oracleProof,
      callerAddress,
      oracleNodeAddress: oracle.getOracleAddress(),
      explorerUrl,
    });
  });

  /**
   * POST /api/v1/onboarding/finalize-web3-registration
   * Conclui o onboarding após a carteira Web3 do usuário transmitir com sucesso a transação on-chain
   */
  app.post("/api/v1/onboarding/finalize-web3-registration", { preHandler: authorizeOnboarding }, async (request, reply) => {
    const parse = FinalizeWeb3RegistrationSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { domainId, txHash, targetChainId, endpointUrl } = parse.data;

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
    });
    if (!domain) {
      return reply.status(404).send({ error: "Domínio não encontrado" });
    }

    const resolvedEndpoint = endpointUrl || DEFAULT_P2P_ENDPOINT || `https://mw-p2p.${domain.domainName}/api/v1/inbox`;

    const vault = await prisma.walletVault.findUnique({ where: { domainId } });
    if (!vault) return reply.status(409).send({ error: "Emita uma prova de registro antes de finalizar" });
    const publicKey = vault.publicKey;
    try {
      if (!await ledger.verifyRegistration(txHash as `0x${string}`, domain.domainName, publicKey, resolvedEndpoint)) throw new Error("Registro divergente");
    } catch {
      return reply.status(409).send({ error: "Transação não confirmada para este domínio, chave e endpoint" });
    }
    await prisma.domain.update({ where: { id: domainId }, data: { isVerified: true } });

    const effectiveChainId = targetChainId || config.CHAIN_ID;
    let networkName = "Base Sepolia";
    let basescanUrl = `https://sepolia.basescan.org/tx/${txHash}`;
    if (effectiveChainId === 421614) {
      networkName = "Arbitrum Sepolia";
      basescanUrl = `https://sepolia.arbiscan.io/tx/${txHash}`;
    } else if (effectiveChainId === 80002) {
      networkName = "Polygon Amoy";
      basescanUrl = `https://amoy.polygonscan.com/tx/${txHash}`;
    } else if (effectiveChainId === 31337) {
      networkName = "Anvil Local";
      basescanUrl = "http://localhost:55443";
    }

    return reply.status(200).send({
      success: true,
      domain: {
        id: domain.id,
        domainName: domain.domainName,
        isVerified: true,
      },
      blockchain: {
        network: networkName,
        chainId: effectiveChainId,
        txHash,
        basescanUrl,
        publicKey,
        endpointUrl: resolvedEndpoint,
        oracleAttestationVerified: true,
      },
      message: `Domínio ${domain.domainName} registrado com sucesso diretamente via Web3 (${networkName})!`,
    });
  });

  /**
   * POST /api/v1/onboarding/fulfill-registration
   * Rota interna chamada pelo microserviço de pagamentos (apps/payment) ou webhooks após pagamento confirmado
   * Protegida por X-Internal-Service-Key
   */
  app.post("/api/v1/onboarding/fulfill-registration", async (_request, reply) => {
    return reply.status(503).send({ error: "Provisionamento por pagamento suspenso até vincular pedido autenticado, prova DNS e confirmação on-chain" });
  });

  /**
   * POST /api/v1/onboarding/complete
   * Cria a 1ª caixa postal e provisiona as chaves de API caso o usuário tenha selecionado a finalidade de desenvolvedor
   */
  app.post("/api/v1/onboarding/complete", { preHandler: authorizeOnboarding }, async (request, reply) => {
    const authUser = getAuthUser(request);
    if (!authUser || authUser.role !== "admin") return reply.status(403).send({ error: "Administrador autenticado obrigatório" });
    const parse = CompleteOnboardingSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const { domainId, localPart, displayName, password, purpose } = parse.data;
    const cleanLocal = localPart.toLowerCase().trim();

    const domain = await prisma.domain.findUnique({
      where: { id: domainId },
      include: { user: true },
    });
    if (!domain || domain.userId !== authUser.id || !domain.isVerified) {
      return reply.status(404).send({ error: "Domínio não encontrado" });
    }

    const fullEmail = `${cleanLocal}@${domain.domainName}`;

    const existingAccount = await prisma.emailAccount.findUnique({
      where: { localPart_domainId: { localPart: cleanLocal, domainId } },
    });
    if (existingAccount) return reply.status(409).send({ error: "Caixa já existente" });

    // 1. Criar o User dedicado para a caixa postal (com role "user")
    const passwordHash = await hashPassword(password);
    let mailboxUser = await prisma.user.findUnique({
      where: { email: fullEmail },
    });

    if (mailboxUser) {
      return reply.status(409).send({ error: "Caixa já existente; conclusão de onboarding não redefine senhas" });
    } else {
      mailboxUser = await prisma.user.create({
        data: {
          email: fullEmail,
          passwordHash,
          displayName: displayName || `${cleanLocal.toUpperCase()} - ${domain.domainName}`,
          role: "user",
        },
      });
    }

    // 2. Criar ou vincular a conta de e-mail (EmailAccount)
    let account = await prisma.emailAccount.findUnique({
      where: { localPart_domainId: { localPart: cleanLocal, domainId } },
    });

    if (!account) {
      account = await prisma.emailAccount.create({
        data: {
          localPart: cleanLocal,
          domainId,
          userId: mailboxUser.id,
          displayName: displayName || `${cleanLocal.toUpperCase()} - ${domain.domainName}`,
          isActive: true,
        },
      });
    } else {
      account = await prisma.emailAccount.update({
        where: { id: account.id },
        data: {
          userId: mailboxUser.id,
          displayName: displayName || account.displayName,
          isActive: true,
        },
      });
    }

    // 2. Se for para desenvolvedores ou ambos, gerar a API Key pública
    let apiKeyData = null;
    if (purpose === "api" || purpose === "both") {
      const generated = await kms.generateApiKey(domainId, "Chave de Produção Onboarding", "production");
      apiKeyData = {
        id: generated.id,
        name: generated.name,
        key: generated.apiKey,
        environment: "production",
      };
    }

    return reply.status(201).send({
      success: true,
      email: fullEmail,
      mailbox: {
        id: account.id,
        email: fullEmail,
        displayName: account.displayName,
      },
      apiKey: apiKeyData,
      purpose,
      nextRoute: purpose === "api" ? "/developer" : "/inbox",
      message: "Onboarding concluído com sucesso!",
    });
  });
}
