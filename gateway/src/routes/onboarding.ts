import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { KeyManagementService } from "../services/KeyManagementService.js";
import type { OracleService } from "../services/OracleService.js";
import type { LedgerService } from "../services/LedgerService.js";
import type { EnvConfig } from "../config.js";
import type { Address } from "viem";

const ChallengeSchema = z.object({
  domainName: z.string().min(3),
  userId: z.number().int().positive().optional(),
});

const CheckDnsSchema = z.object({
  domainName: z.string().min(3),
  token: z.string().min(8),
  simulate: z.boolean().optional(),
});

const HttpsUrlSchema = z
  .string()
  .url("O endpoint P2P deve ser uma URL válida")
  .refine((url) => url.startsWith("https://"), {
    message: "O endpoint P2P deve obrigatoriamente utilizar o protocolo seguro HTTPS (https://)",
  });

const VerifyAndRegisterSchema = z.object({
  domainName: z.string().min(3),
  userId: z.number().int().positive(),
  token: z.string().min(8),
  publicKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  endpointUrl: HttpsUrlSchema.optional(),
  simulateDns: z.boolean().optional(),
  targetChainId: z.number().int().optional(),
});

const ClaimProofSchema = z.object({
  domainName: z.string().min(3),
  userId: z.number().int().positive(),
  token: z.string().min(8),
  callerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  publicKey: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  endpointUrl: HttpsUrlSchema.optional(),
  targetChainId: z.number().int().optional().default(84532),
  simulateDns: z.boolean().optional(),
});

const FinalizeWeb3RegistrationSchema = z.object({
  domainId: z.number().int().positive(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  endpointUrl: HttpsUrlSchema.optional(),
  targetChainId: z.number().int().optional().default(84532),
});

const CompleteOnboardingSchema = z.object({
  domainId: z.number().int().positive(),
  localPart: z.string().min(1).default("admin"),
  displayName: z.string().optional(),
  password: z.string().min(6),
  purpose: z.enum(["webmail", "api", "both"]).default("both"),
});

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

interface OnboardingRouteOptions {
  prisma: PrismaClient;
  kms: KeyManagementService;
  oracle: OracleService;
  ledger: LedgerService;
  config: EnvConfig;
}

export async function onboardingRoutes(app: FastifyInstance, options: OnboardingRouteOptions) {
  const { prisma, kms, oracle, ledger, config } = options;
  const MAIVW_CORE_DOMAIN = process.env.MAIVW_CORE_DOMAIN || "maivw.org";
  const DEFAULT_P2P_ENDPOINT = process.env.DEFAULT_P2P_ENDPOINT || `https://mw.${MAIVW_CORE_DOMAIN}/api/v1/inbox`;

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
      isCloud,
      isSelfHosted,
      isOracleAuthority,
      oracleAddress: myOracleAddress,
      contractOracleAddress: contractOracle,
      remoteOracleUrl: config.MAIVW_ORACLE_URL || "https://api-test.maivw.com",
      defaultEndpointPattern: "https://mw-p2p.{domain}/api/v1/inbox",
    };
  });

  /**
   * POST /api/v1/onboarding/challenge
   * Gera o desafio de posse único via DNS TXT e verifica se o domínio já existe
   */
  app.post("/api/v1/onboarding/challenge", async (request, reply) => {
    const parse = ChallengeSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        error: "Dados inválidos",
        details: parse.error.flatten(),
      });
    }

    const cleanDomain = parse.data.domainName.toLowerCase().trim();
    const userId = parse.data.userId || 1;

    // 1. Verificar se o domínio já existe on-chain no Cartório MAIVW (apenas o domínio exato)
    const isOnChain = await ledger.isDomainRegistered(cleanDomain, true);
    if (isOnChain) {
      return reply.status(409).send({
        error: "Domínio já registrado",
        message: `O domínio ${cleanDomain} já está registrado no Cartório On-Chain da rede MAIVW.`,
      });
    }

    // 2. Gerar token de desafio determinístico seguro
    const secret = config.JWT_SECRET || "maivw_secret";
    const token = crypto
      .createHash("sha256")
      .update(`${cleanDomain}:${userId}:${secret}`)
      .digest("hex")
      .substring(0, 32);

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
  app.post("/api/v1/onboarding/check-dns", async (request, reply) => {
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
          isPosseVerified = foundTxts.some((t) => t.includes(expectedValue));
        }
      }
    } catch {
      // Fallback para DNS nativo do Node
      try {
        const records = await dns.resolveTxt(challengeHost);
        foundTxts = records.flat();
        isPosseVerified = foundTxts.some((t) => t.includes(expectedValue));
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

    // Suporte para ambiente de simulação/demonstração rápida
    if (simulate && !isPosseVerified) {
      isPosseVerified = true;
      foundTxts.push(expectedValue);
    }

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
  app.post("/api/v1/onboarding/verify-and-register", async (request, reply) => {
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

    // 1. Garantir usuário e domínio no banco local
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      user = await prisma.user.findFirst();
    }
    if (!user) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const domain = await prisma.domain.upsert({
      where: { domainName: cleanDomain },
      create: { domainName: cleanDomain, userId: user.id, isVerified: true },
      update: { isVerified: true },
    });

    // 2. Provisionar Carteira e Chave Criptográfica ECDSA para o Domínio
    const localWallet = await kms.provisionWalletForDomain(domain.id);
    const domainPublicKey = (providedPubKey || localWallet.publicKey) as Address;
    const effectiveChainId = targetChainId || config.CHAIN_ID;

    // Se NÃO for a autoridade do Oráculo e tiver MAIVW_ORACLE_URL configurado (Máquina B -> Máquina A):
    if (!isOracleAuthority && config.MAIVW_ORACLE_URL && effectiveChainId !== 31337) {
      try {
        const remoteRes = await fetch(`${config.MAIVW_ORACLE_URL.replace(/\/+$/, "")}/api/v1/onboarding/verify-and-register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domainName: cleanDomain,
            userId: 1,
            token,
            publicKey: domainPublicKey,
            endpointUrl: resolvedEndpoint,
            simulateDns,
            targetChainId: effectiveChainId,
          }),
          signal: AbortSignal.timeout(25000),
        });

        const remoteData: any = await remoteRes.json();
        if (!remoteRes.ok) {
          return reply.status(remoteRes.status).send({
            error: remoteData.error || "Falha na atestação com o Oráculo da Rede Maivw",
            message: remoteData.message || "O Oráculo remoto rejeitou a validação.",
            details: remoteData.details,
          });
        }

        return reply.status(201).send({
          success: true,
          domain: {
            id: domain.id,
            domainName: cleanDomain,
            isVerified: true,
          },
          blockchain: {
            ...remoteData.blockchain,
            publicKey: domainPublicKey,
            endpointUrl: resolvedEndpoint,
          },
          message: remoteData.message || `Domínio ${cleanDomain} registrado com sucesso no Cartório On-Chain!`,
        });
      } catch (err: any) {
        return reply.status(502).send({
          error: "Falha de conexão com o Oráculo da Rede",
          message: `Não foi possível contatar o Oráculo da Rede em ${config.MAIVW_ORACLE_URL}: ${err.message}`,
        });
      }
    }

    // 3. Validação de DNS pelo próprio Oráculo Local (se for a autoridade ou modo Anvil)
    let isPosseVerified = false;
    try {
      const dohRes = await fetch(
        `https://dns.google/resolve?name=_maivw-verify.${cleanDomain}&type=TXT`,
        { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) }
      );
      if (dohRes.ok) {
        const dohData: any = await dohRes.json();
        const foundTxts = (dohData?.Answer || []).map((a: any) =>
          (a.data || "").replace(/^"|"$/g, "")
        );
        isPosseVerified = foundTxts.some((t: string) => t.includes(expectedValue));
      }
    } catch {}

    if (!isPosseVerified && simulateDns) {
      isPosseVerified = true;
    }

    if (!isPosseVerified) {
      return reply.status(400).send({
        error: "Posse do domínio não confirmada",
        message: `Não encontramos a entrada TXT "_maivw-verify.${cleanDomain}" com o valor "${expectedValue}" no seu provedor de DNS.`,
      });
    }

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
      basescanUrl = `http://localhost:8545/tx/${txHash}`;
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
  app.post("/api/v1/onboarding/claim-proof", async (request, reply) => {
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

    // 1. Garantir usuário e domínio no banco de dados local
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      user = await prisma.user.findFirst();
    }
    if (!user) {
      return reply.status(404).send({ error: "Usuário não encontrado" });
    }

    const domain = await prisma.domain.upsert({
      where: { domainName: cleanDomain },
      create: { domainName: cleanDomain, userId: user.id, isVerified: true },
      update: { isVerified: true },
    });

    // 2. Provisionar Carteira e Chave Criptográfica ECDSA para o Domínio
    const localWallet = await kms.provisionWalletForDomain(domain.id);
    const domainPublicKey = (providedPubKey || localWallet.publicKey) as Address;
    const effectiveChainId = targetChainId || config.CHAIN_ID;

    // Se NÃO for a autoridade do Oráculo e tiver MAIVW_ORACLE_URL configurado (Máquina B -> Máquina A):
    if (!isOracleAuthority && config.MAIVW_ORACLE_URL && effectiveChainId !== 31337) {
      try {
        const remoteRes = await fetch(`${config.MAIVW_ORACLE_URL.replace(/\/+$/, "")}/api/v1/onboarding/claim-proof`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domainName: cleanDomain,
            userId: 1,
            token,
            callerAddress,
            publicKey: domainPublicKey,
            endpointUrl: resolvedEndpoint,
            simulateDns,
            targetChainId: effectiveChainId,
          }),
          signal: AbortSignal.timeout(25000),
        });

        const remoteData: any = await remoteRes.json();
        if (!remoteRes.ok) {
          return reply.status(remoteRes.status).send({
            error: remoteData.error || "Falha ao obter atestado do Oráculo da Rede Maivw",
            message: remoteData.message || "O Oráculo remoto rejeitou a requisição.",
            details: remoteData.details,
          });
        }

        return reply.status(200).send({
          ...remoteData,
          domainId: domain.id,
          publicKey: domainPublicKey,
          endpointUrl: resolvedEndpoint,
        });
      } catch (err: any) {
        return reply.status(502).send({
          error: "Falha de conexão com o Oráculo da Rede",
          message: `Não foi possível contatar o Oráculo da Rede em ${config.MAIVW_ORACLE_URL}: ${err.message}`,
        });
      }
    }

    // 3. Validar posse via DNS se for o próprio Oráculo
    let isPosseVerified = false;
    try {
      const dohRes = await fetch(
        `https://dns.google/resolve?name=_maivw-verify.${cleanDomain}&type=TXT`,
        { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) }
      );
      if (dohRes.ok) {
        const dohData: any = await dohRes.json();
        const foundTxts = (dohData?.Answer || []).map((a: any) =>
          (a.data || "").replace(/^"|"$/g, "")
        );
        isPosseVerified = foundTxts.some((t: string) => t.includes(expectedValue));
      }
    } catch {}

    if (!isPosseVerified && simulateDns) {
      isPosseVerified = true;
    }

    if (!isPosseVerified) {
      return reply.status(400).send({
        error: "Posse do domínio não confirmada",
        message: `Não encontramos a entrada TXT "_maivw-verify.${cleanDomain}" com o valor "${expectedValue}" no seu DNS.`,
      });
    }

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
      explorerUrl = "http://localhost:8545";
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
  app.post("/api/v1/onboarding/finalize-web3-registration", async (request, reply) => {
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

    await prisma.domain.update({
      where: { id: domainId },
      data: { isVerified: true },
    });

    const { publicKey } = await kms.provisionWalletForDomain(domainId);

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
      basescanUrl = `http://localhost:8545/tx/${txHash}`;
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
  app.post("/api/v1/onboarding/fulfill-registration", async (request, reply) => {
    const serviceKey = request.headers["x-internal-service-key"];
    if (!serviceKey || serviceKey !== config.INTERNAL_SERVICE_KEY) {
      return reply.status(403).send({ error: "Acesso negado: chave interna de serviço inválida" });
    }

    const { domain, userId, targetChainId, orderId } = request.body as {
      domain: string;
      userId: number;
      targetChainId: number;
      orderId?: string;
    };

    if (!domain) {
      return reply.status(400).send({ error: "Domínio é obrigatório" });
    }

    const cleanDomain = domain.toLowerCase().trim();
    const effectiveChainId = targetChainId || config.CHAIN_ID;

    // 1. Garantir usuário e domínio no banco de dados local
    let user = await prisma.user.findFirst();
    if (userId) {
      const foundUser = await prisma.user.findUnique({ where: { id: userId } });
      if (foundUser) user = foundUser;
    }

    if (!user) {
      return reply.status(404).send({ error: "Usuário padrão não encontrado no sistema" });
    }

    const domainRecord = await prisma.domain.upsert({
      where: { domainName: cleanDomain },
      create: { domainName: cleanDomain, userId: user.id, isVerified: true },
      update: { isVerified: true },
    });

    // 2. Provisionar carteira e chave criptográfica ECDSA
    const { publicKey } = await kms.provisionWalletForDomain(domainRecord.id);

    // 3. Gerar prova do oráculo
    const adminKey = publicKey as `0x${string}`;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

    const oracleProof = await oracle.generateRegistrationProof(
      cleanDomain,
      publicKey as `0x${string}`,
      oracle.getOracleAddress(),
      effectiveChainId,
      adminKey,
      deadline
    );

    // 4. Executar transação on-chain
    let txHash: string;
    try {
      txHash = await oracle.registerCompanyOnChain(
        cleanDomain,
        DEFAULT_P2P_ENDPOINT,
        publicKey as `0x${string}`,
        false,
        oracleProof,
        effectiveChainId,
        adminKey,
        deadline
      );
    } catch (err: any) {
      app.log.error(err, "[FULFILL] Erro ao registrar on-chain:");
      if (err?.message?.includes("DomainAlreadyExists") || err?.message?.includes("DomainAlreadyRegistered")) {
        return reply.status(200).send({
          success: true,
          alreadyRegistered: true,
          domain: cleanDomain,
          message: "Domínio já se encontrava ativo on-chain",
        });
      }
      return reply.status(500).send({
        error: "Falha na transação blockchain",
        message: err?.shortMessage || err?.message || "Erro desconhecido",
      });
    }

    return reply.status(200).send({
      success: true,
      domain: cleanDomain,
      domainId: domainRecord.id,
      chainId: effectiveChainId,
      txHash,
      publicKey,
      orderId,
    });
  });

  /**
   * POST /api/v1/onboarding/complete
   * Cria a 1ª caixa postal e provisiona as chaves de API caso o usuário tenha selecionado a finalidade de desenvolvedor
   */
  app.post("/api/v1/onboarding/complete", async (request, reply) => {
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
    if (!domain) {
      return reply.status(404).send({ error: "Domínio não encontrado" });
    }

    const fullEmail = `${cleanLocal}@${domain.domainName}`;

    // 1. Criar ou atualizar o User dedicado para a caixa postal (com role "user")
    const passwordHash = hashPassword(password);
    let mailboxUser = await prisma.user.findUnique({
      where: { email: fullEmail },
    });

    if (mailboxUser) {
      mailboxUser = await prisma.user.update({
        where: { id: mailboxUser.id },
        data: {
          passwordHash,
          displayName: displayName || `${cleanLocal.toUpperCase()} - ${domain.domainName}`,
          role: "user",
        },
      });
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
