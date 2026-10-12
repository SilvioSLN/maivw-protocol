import type { FastifyInstance } from "fastify";
import type { LedgerService } from "../services/LedgerService.js";
import type { SignatureService } from "../services/SignatureService.js";
import type { ReputationService } from "../services/ReputationService.js";
import type { PrismaClient } from "@prisma/client";
import type { EnvConfig } from "../config.js";
import { formatEther } from "viem";

interface NodeRouteOptions {
  ledger: LedgerService;
  signer: SignatureService;
  reputation: ReputationService;
  prisma?: PrismaClient;
  config: EnvConfig;
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  from: string;
  to: string;
  originIp: string;
  reason: string;
  action: "bloqueado" | "quarentena" | "descartado";
}

export async function nodeRoutes(app: FastifyInstance, options: NodeRouteOptions) {
  const { ledger, signer, reputation, prisma, config } = options;

  app.get("/api/v1/node/telemetry", async (request, reply) => {
    const startTime = Date.now();

    // A telemetria é do nó, por isso usa o domínio configurado e não escolhe um tenant arbitrário.
    const domainName = config.SENDER_DOMAIN;

    // 2. Modo do Nó & Saldo da Carteira (Apenas se independente)
    const isIndependent = Boolean(
      config.DEPLOYER_PRIVATE_KEY ||
      config.COMPANY_A_PRIVATE_KEY ||
      config.ORACLE_SIGNER_TYPE === "local"
    );

    let walletInfo: {
      address: string;
      balanceEth: string;
      isIndependent: boolean;
    } | null = null;

    if (isIndependent && signer?.address) {
      try {
        const client = ledger.getClient();
        const balanceWei = await client.getBalance({ address: signer.address as any });
        const balanceEth = parseFloat(formatEther(balanceWei)).toFixed(4);
        walletInfo = {
          address: signer.address,
          balanceEth: `${balanceEth} ETH`,
          isIndependent: true,
        };
      } catch {
        walletInfo = {
          address: signer.address,
          balanceEth: "unknown",
          isIndependent: true,
        };
      }
    }

    // 3. Status de Reputação & Cartório On-Chain
    let profile: any = null;
    try {
      profile = await ledger.getCompanyProfile(domainName);
    } catch {
      // Ignora erro de RPC
    }

    let repData: any = null;
    try {
      repData = await reputation.getReputation(domainName);
    } catch {
      // Ignora
    }

    const strikes = profile ? Number(profile.strikeCount || 0) : (repData?.strikes || 0);
    const score = repData?.reputationScore ?? null;
    const isActive = profile ? Boolean(profile.isActive) : null;
    const isProvider = profile ? Boolean(profile.isProvider) : null;

    // 4. Métricas de Mensagens (PostgreSQL)
    let totalReceived = 0;
    let legacyCount = 0;
    let web3Count = 0;
    let revokedCount = 0;

    if (prisma) {
      try {
        totalReceived = await prisma.message.count();
        legacyCount = await prisma.message.count({ where: { isLegacy: true } });
        web3Count = await prisma.message.count({ where: { isLegacy: false } });
        revokedCount = await prisma.message.count({ where: { isRevoked: true } });
      } catch {
        // Ignora
      }
    }

    const spoofingBlocked = revokedCount;
    const totalProcessed = totalReceived;
    const validSignatures = web3Count;
    const trafficHistory: Array<{ time: string; legitimate: number; threats: number }> = [];
    const securityEvents: SecurityEvent[] = [];

    // 7. Telemetria do Bloco e RPC
    let blockNumber: number | null = null;
    let rpcLatencyMs = Date.now() - startTime;
    try {
      const client = ledger.getClient();
      const bStart = Date.now();
      const bn = await client.getBlockNumber();
      rpcLatencyMs = Date.now() - bStart;
      blockNumber = Number(bn);
    } catch {
      // Ignora erro de RPC
    }

    const chainId = config.CHAIN_ID;
    const chainName = chainId === 84532 ? "Base Sepolia" : chainId === 31337 ? "Anvil Local" : `Chain ${chainId}`;

    return {
      domain: domainName,
      nodeMode: isIndependent ? "independent" : "managed",
      wallet: walletInfo,
      reputation: {
        score,
        strikes,
        maxStrikes: 3,
        isActive,
        isProvider,
        publicKey: profile?.publicKey || signer?.address || "0x0000000000000000000000000000000000000000",
        status: isActive === null ? "unknown" : isActive ? (strikes === 0 ? "Excelente" : "Atenção") : "Suspenso",
        contractAddress: config.REGISTRY_CONTRACT_ADDRESS || "not deployed",
        chainName,
      },
      traffic: {
        totalProcessed,
        totalReceived,
        totalSent: await prisma?.message.count({ where: { status: "sent" } }) ?? 0,
        validSignatures,
        spoofingBlocked,
        cryptographicSuccessRate: null,
        p2pDeliveryRate: null,
        queuePending: null,
        avgLatencyMs: null,
      },
      trafficHistory,
      securityEvents,
      systemHealth: {
        gateway: "online",
        blockchain: blockNumber !== null ? "online" : "offline",
        redis: "unknown",
        postgres: prisma ? "online" : "offline",
        blockNumber,
        rpcLatencyMs,
        contractAddress: config.REGISTRY_CONTRACT_ADDRESS,
        chainName,
      },
    };
  });
}
