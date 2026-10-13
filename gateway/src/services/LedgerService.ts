import { decodeEventLog, parseAbi, createPublicClient, createWalletClient, http, padHex, parseEther, type Address, type PublicClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { MIRROR_REGISTRY_V2_ABI, REGISTRY_ABI, type EnvConfig } from "../config.js";

export interface TypedKeyDescriptor {
  algorithm: number;
  keyData: Hex;
}

export interface TypedDomainIdentity {
  source: "mirror-v2" | "registry-v2";
  domain: string;
  endpointUrl: string;
  publicKey: TypedKeyDescriptor;
  adminKey: TypedKeyDescriptor;
  status: number;
  isActive: boolean;
  originNetworkHash?: Hex;
  originRegistry?: Hex;
  globalDomainEpoch: bigint;
  originSequence: bigint;
  revoked: boolean;
}

/**
 * LedgerService — Serviço de leitura e interação com o Smart Contract MAIVWRegistry
 */
export class LedgerService {
  private client: PublicClient;
  private contractAddress: Address | null;
  private mirrorRegistryV2Address: Address | null;
  private config: EnvConfig;
  private chain: any;

  // Mapa em memória para domínios de demonstração e teste E2E autônomo
  private demoDomains: Map<string, {
    publicKey: Address;
    endpointUrl: string;
    isProvider: boolean;
    isActive: boolean;
    tlsFingerprint?: Hex;
  }> = new Map();

  constructor(config: EnvConfig) {
    this.config = config;
    // Criar chain customizada para Anvil local
    this.chain = {
      ...foundry,
      id: config.CHAIN_ID,
      rpcUrls: {
        default: { http: [config.RPC_URL] },
      },
    };

    this.client = createPublicClient({
      chain: this.chain,
      transport: http(config.RPC_URL),
    }) as any;

    this.contractAddress = config.REGISTRY_CONTRACT_ADDRESS 
      ? (config.REGISTRY_CONTRACT_ADDRESS as Address)
      : null;
    this.mirrorRegistryV2Address = config.MIRROR_REGISTRY_V2_ADDRESS
      ? (config.MIRROR_REGISTRY_V2_ADDRESS as Address)
      : null;

    console.log(`[LEDGER] Initialized with RPC: ${config.RPC_URL}`);
    console.log(`[LEDGER] Contract address: ${this.contractAddress || "NOT SET"}`);
    console.log(`[LEDGER] Mirror Registry V2: ${this.mirrorRegistryV2Address || "NOT SET"}`);
  }

  /** Confirms an exact registration on this node's configured chain, without demo/parent fallbacks. */
  async verifyRegistration(txHash: `0x${string}`, domain: string, publicKey: string, endpointUrl: string): Promise<boolean> {
    const address = this.ensureContract();
    if (await this.client.getChainId() !== this.config.CHAIN_ID) return false;
    const receipt = await this.client.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 15000 });
    if (receipt.status !== "success" || receipt.to?.toLowerCase() !== address.toLowerCase()) return false;
    const abi = parseAbi(["event CompanyRegistered(bytes32 indexed domainHash, string domain, address publicKey, address adminKey, bool isProvider, uint256 feePaid, uint256 timestamp)"]);
    const matched = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== address.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
        return decoded.args.domain === domain && decoded.args.publicKey.toLowerCase() === publicKey.toLowerCase();
      } catch { return false; }
    });
    if (!matched) return false;
    const [key, endpoint] = await Promise.all([
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "getPublicKey", args: [domain] }),
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "getEndpointUrl", args: [domain] }),
    ]);
    return String(key).toLowerCase() === publicKey.toLowerCase() && endpoint === endpointUrl;
  }

  /**
   * Registra um domínio temporário para o showcase de demonstração E2E
   */
  setDemoDomain(domain: string, data: {
    publicKey: Address;
    endpointUrl: string;
    isProvider: boolean;
    isActive: boolean;
    tlsFingerprint?: Hex;
  }): void {
    this.demoDomains.set(domain.toLowerCase().trim(), data);
  }

  /**
   * Desativa/bane um domínio de demonstração (ex: após slashing)
   */
  deactivateDemoDomain(domain: string): void {
    const d = this.demoDomains.get(domain.toLowerCase().trim());
    if (d) {
      d.isActive = false;
    }
  }

  /**
   * Verifica se o domínio é controlado pelo showcase de demonstração
   */
  isDemoDomain(domain: string): boolean {
    return this.demoDomains.has(domain.toLowerCase().trim());
  }

  /**
   * Limpa os domínios de demonstração
   */
  clearDemoDomains(): void {
    this.demoDomains.clear();
  }

  /**
   * Verifica se o contrato está configurado
   */
  private ensureContract(): Address {
    if (!this.contractAddress) {
      throw new Error(
        "[LEDGER] Contract address not configured. " +
        "Run the deploy container first or set REGISTRY_CONTRACT_ADDRESS."
      );
    }
    return this.contractAddress;
  }

  /**
   * Extrai o domínio pai caso o domínio fornecido seja um subdomínio
   * Ex: "spb.itau.com.br" -> "itau.com.br", "sub.empresa.com" -> "empresa.com"
   * Se já for um domínio raiz (ex: "empresa.com"), retorna null.
   */
  getParentDomain(domain: string): string | null {
    const parts = domain.trim().toLowerCase().split(".");
    if (parts.length <= 2) {
      return null;
    }
    // Suporte a domínios de segundo nível (ccSLD) como .com.br, .gov.br, .org.br, etc.
    const ccSLDs = new Set(["com", "gov", "org", "net", "edu", "mil", "art", "ind", "jus", "leg", "mp", "bmd"]);
    const isCcSld = parts.length >= 3 && parts[parts.length - 1].length === 2 && ccSLDs.has(parts[parts.length - 2]);

    if (isCcSld) {
      if (parts.length <= 3) {
        return null; // ex: "empresa.com.br" já é raiz
      }
      return parts.slice(1).join("."); // ex: "spb.empresa.com.br" -> "empresa.com.br"
    }

    return parts.slice(1).join("."); // ex: "sub.empresa.com" -> "empresa.com"
  }

  /**
   * Verifica se um domínio está registrado e ativo na rede MAIVW
   * Suporta Herança Hierárquica de Subdomínios (Wildcard)
   */
  async isDomainRegistered(domain: string, exactOnly = false): Promise<boolean> {
    const demo = this.demoDomains.get(domain.toLowerCase().trim());
    if (demo && demo.isActive) return true;

    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "isDomainActive",
        args: [domain],
      });
      if (result) return true;

      // Se exactOnly for true (como no Onboarding), não busca herança do domínio pai
      if (exactOnly) return false;

      // Fallback: Herança de Domínio Pai
      const parent = this.getParentDomain(domain);
      if (parent) {
        return await this.isDomainRegistered(parent, false);
      }
      return false;
    } catch (error) {
      if (demo && demo.isActive) return true;
      console.error(`[LEDGER] Error checking domain "${domain}":`, error);
      return false;
    }
  }

  /**
   * Retorna a URL do endpoint receptor de um domínio
   * Suporta Herança Hierárquica de Subdomínios (Wildcard)
   */
  async getCompanyEndpoint(domain: string): Promise<string | null> {
    const demo = this.demoDomains.get(domain.toLowerCase().trim());
    if (demo && demo.isActive) return demo.endpointUrl;

    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getEndpointUrl",
        args: [domain],
      });
      if (result && (result as string).trim() !== "") {
        return result as string;
      }

      // Fallback: Herança de Domínio Pai
      const parent = this.getParentDomain(domain);
      if (parent) {
        return await this.getCompanyEndpoint(parent);
      }
      return null;
    } catch (error) {
      if (demo && demo.isActive) return demo.endpointUrl;
      console.error(`[LEDGER] Error getting endpoint for "${domain}":`, error);
      return null;
    }
  }

  /**
   * Retorna a chave pública (address) de um domínio
   * Suporta Herança Hierárquica de Subdomínios (Wildcard)
   */
  async getPublicKey(domain: string): Promise<Address | null> {
    const demo = this.demoDomains.get(domain.toLowerCase().trim());
    if (demo && demo.isActive) return demo.publicKey;

    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getPublicKey",
        args: [domain],
      });
      if (result && result !== "0x0000000000000000000000000000000000000000") {
        return result as Address;
      }

      // Fallback: Herança de Domínio Pai
      const parent = this.getParentDomain(domain);
      if (parent) {
        return await this.getPublicKey(parent);
      }
      return null;
    } catch (error) {
      if (demo && demo.isActive) return demo.publicKey;
      console.error(`[LEDGER] Error getting public key for "${domain}":`, error);
      return null;
    }
  }

  /**
   * Resolve chaves sem converter Ed25519/Solana para um address EVM fictício.
   * Mirrors V2 têm precedência; domínios do Registry legado são normalizados como secp256k1/address.
   */
  async getTypedDomainIdentity(domain: string): Promise<TypedDomainIdentity | null> {
    if (this.mirrorRegistryV2Address) {
      const [profile, version] = await Promise.all([
        this.client.readContract({
          address: this.mirrorRegistryV2Address,
          abi: MIRROR_REGISTRY_V2_ABI,
          functionName: "getMirrorProfile",
          args: [domain],
        }),
        this.client.readContract({
          address: this.mirrorRegistryV2Address,
          abi: MIRROR_REGISTRY_V2_ABI,
          functionName: "getMirrorVersion",
          args: [domain],
        }),
      ]) as [any, any];

      if (version.exists) {
        const status = Number(profile.status);
        return {
          source: "mirror-v2",
          domain: profile.domain,
          endpointUrl: profile.endpointUrl,
          publicKey: { algorithm: Number(profile.publicKey.algorithm), keyData: profile.publicKey.keyData },
          adminKey: { algorithm: Number(profile.adminKey.algorithm), keyData: profile.adminKey.keyData },
          status,
          isActive: status === 1 && !version.revoked,
          originNetworkHash: version.originNetworkHash,
          originRegistry: version.originRegistry,
          globalDomainEpoch: BigInt(version.globalDomainEpoch),
          originSequence: BigInt(version.originSequence),
          revoked: Boolean(version.revoked),
        };
      }
    }

    const profile = await this.getCompanyProfile(domain);
    if (!profile) return null;
    const publicKey = padHex(profile.publicKey, { size: 32 });
    const adminAddress = profile.adminKey ?? profile.publicKey;
    const legacyStatus = Number((profile as any).status ?? (profile.isActive ? 1 : 0));
    return {
      source: "registry-v2",
      domain: profile.domain,
      endpointUrl: profile.endpointUrl,
      publicKey: { algorithm: 1, keyData: publicKey },
      adminKey: { algorithm: 1, keyData: padHex(adminAddress, { size: 32 }) },
      status: legacyStatus,
      isActive: profile.isActive,
      globalDomainEpoch: BigInt((profile as any).epoch ?? 0),
      originSequence: 0n,
      revoked: false,
    };
  }

  /**
   * Retorna o perfil completo de uma empresa
   * Suporta Herança Hierárquica de Subdomínios (Wildcard)
   */
  async getCompanyProfile(domain: string): Promise<{
    domain: string;
    endpointUrl: string;
    publicKey: Address;
    adminKey?: Address;
    registrationTime: bigint;
    isProvider: boolean;
    isActive: boolean;
    strikeCount: number;
  } | null> {
    const demo = this.demoDomains.get(domain.toLowerCase().trim());
    if (demo) {
      return {
        domain,
        endpointUrl: demo.endpointUrl,
        publicKey: demo.publicKey,
        registrationTime: BigInt(Date.now()),
        isProvider: demo.isProvider,
        isActive: demo.isActive,
        strikeCount: 0,
      };
    }

    try {
      const address = this.ensureContract();
      const result: any = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getCompanyProfile",
        args: [domain],
      });
      if (result && (result.registrationTime > 0n || result.status !== 0 || result.isActive)) {
        return {
          ...result,
          isActive: result.status === 1 || result.isActive === true,
        };
      }

      // Fallback: Herança de Domínio Pai
      const parent = this.getParentDomain(domain);
      if (parent) {
        const parentProfile = await this.getCompanyProfile(parent);
        if (parentProfile) {
          return {
            ...parentProfile,
            domain, // mantém o subdomínio consultado com os atributos herdados
          };
        }
      }
      return null;
    } catch (error) {
      const fallbackDemo = this.demoDomains.get(domain.toLowerCase().trim());
      if (fallbackDemo) {
        return {
          domain,
          endpointUrl: fallbackDemo.endpointUrl,
          publicKey: fallbackDemo.publicKey,
          registrationTime: BigInt(Date.now()),
          isProvider: fallbackDemo.isProvider,
          isActive: fallbackDemo.isActive,
          strikeCount: 0,
        };
      }
      console.error(`[LEDGER] Error getting profile for "${domain}":`, error);
      return null;
    }
  }

  /**
   * Retorna todas as empresas registradas (para o Dashboard)
   */
  async getAllCompanies(): Promise<Array<{
    domain: string;
    endpointUrl: string;
    publicKey: string;
    adminKey: string;
    registrationTime: number;
    isProvider: boolean;
    isActive: boolean;
    strikeCount: number;
    status: number;
  }>> {
    try {
      const address = this.ensureContract();
      const count = await this.getTotalRegistered();
      const companies: any[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const h = await this.client.readContract({
            address,
            abi: REGISTRY_ABI,
            functionName: "getDomainHashByIndex",
            args: [BigInt(i)],
          });
          const profile: any = await this.client.readContract({
            address,
            abi: REGISTRY_ABI,
            functionName: "getCompanyProfileByHash",
            args: [h],
          });
          companies.push({
            domain: profile.domain,
            endpointUrl: profile.endpointUrl,
            publicKey: profile.publicKey,
            adminKey: profile.adminKey,
            registrationTime: Number(profile.registrationTime),
            isProvider: profile.isProvider,
            isActive: profile.status === 1,
            strikeCount: Number(profile.strikeCount),
            status: Number(profile.status),
          });
        } catch (innerErr) {
          console.warn(`[LEDGER] Failed to fetch profile at index ${i}:`, innerErr);
        }
      }
      return companies;
    } catch (error) {
      console.error("[LEDGER] Error getting all companies:", error);
      return [];
    }
  }

  /**
   * Retorna o total de empresas registradas
   */
  async checkBlockchainHealth(): Promise<void> {
    await this.client.readContract({
      address: this.ensureContract(),
      abi: REGISTRY_ABI,
      functionName: "getRegisteredDomainCount",
      args: [],
    });
  }

  async getTotalRegistered(): Promise<number> {
    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getRegisteredDomainCount",
        args: [],
      });
      return Number(result);
    } catch (error) {
      console.error("[LEDGER] Error getting total registered:", error);
      return 0;
    }
  }

  /**
   * Verifica se um domínio é um provedor multi-tenant (Fase 7)
   */
  async isProvider(domain: string): Promise<boolean> {
    const demo = this.demoDomains.get(domain.toLowerCase().trim());
    if (demo) return demo.isProvider;

    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "isDomainProvider",
        args: [domain],
      });
      return result as boolean;
    } catch (error) {
      const fallbackDemo = this.demoDomains.get(domain.toLowerCase().trim());
      if (fallbackDemo) return fallbackDemo.isProvider;
      console.error(`[LEDGER] Error checking if "${domain}" is provider:`, error);
      return false;
    }
  }

  /**
   * Retorna o endereço do Oracle Node registrado no contrato
   */
  async getOracleNode(): Promise<Address | null> {
    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "oracleNode",
        args: [],
      });
      return result as Address;
    } catch (error) {
      console.error("[LEDGER] Error getting oracleNode:", error);
      return null;
    }
  }

  /**
   * Retorna o volume diário de mensagens autorizado para o domínio (Fase 13)
   */
  async getAllowedDailyVolume(domain: string): Promise<bigint> {
    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getAllowedDailyVolume",
        args: [domain],
      });
      return result as bigint;
    } catch (error) {
      console.error(`[LEDGER] Error getting allowed daily volume for "${domain}":`, error);
      return 10000n; // Fallback para volume padrão
    }
  }

  /**
   * Retorna informações de Tier, saldo de caução e rate limit do provedor (Fase 13)
   */
  async getProviderInfo(domain: string): Promise<{
    tier: number;
    balance: bigint;
    dailyLimit: bigint;
    isActive: boolean;
    strikeCount: number;
  } | null> {
    try {
      const address = this.ensureContract();
      const result = (await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getProviderInfo",
        args: [domain],
      })) as [number, bigint, bigint, boolean, number];

      return {
        tier: result[0],
        balance: result[1],
        dailyLimit: result[2],
        isActive: result[3],
        strikeCount: result[4],
      };
    } catch (error) {
      console.error(`[LEDGER] Error getting provider info for "${domain}":`, error);
      return null;
    }
  }

  /**
   * Retorna o status de vagas da Cota Gênesis do Fundador (Fase 13)
   */
  async getGenesisStatus(): Promise<{ count: bigint; maxGenesis: bigint }> {
    try {
      const address = this.ensureContract();
      const result = (await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getGenesisStatus",
        args: [],
      })) as [bigint, bigint];

      return {
        count: result[0],
        maxGenesis: result[1],
      };
    } catch (error) {
      console.error("[LEDGER] Error getting genesis status:", error);
      return { count: 0n, maxGenesis: 1000n };
    }
  }

  /**
   * Retorna a taxa dinâmica atual de registro de domínios
   */
  async getStandardRegistrationFee(): Promise<bigint> {
    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "standardRegistrationFee",
        args: [],
      });
      return result as bigint;
    } catch {
      return 10000000000000000000n; // 10 ETH default Anvil
    }
  }

  /**
   * Executa recarga de caução (Top-Up) para reativar ou fortalecer provedor (Fase 13)
   */
  async topUpBalance(domain: string, amountEth: string = "1"): Promise<{ txHash: string; newBalance: bigint }> {
    const address = this.ensureContract();
    const account = privateKeyToAccount(this.config.DEPLOYER_PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      chain: this.chain,
      transport: http(this.config.RPC_URL),
      account,
    });

    const hash = await (walletClient as any).writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "topUpBalance",
      args: [domain],
      value: parseEther(amountEth),
    });

    await this.client.waitForTransactionReceipt({ hash });
    const info = await this.getProviderInfo(domain);
    return {
      txHash: hash,
      newBalance: info ? info.balance : 0n,
    };
  }

  /**
   * Atualiza a URL do endpoint P2P do domínio no Smart Contract
   */
  async updateEndpoint(domain: string, newEndpoint: string): Promise<string> {
    const address = this.ensureContract();
    const account = privateKeyToAccount(this.config.DEPLOYER_PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      chain: this.chain,
      transport: http(this.config.RPC_URL),
      account,
    });

    const hash = await (walletClient as any).writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "updateEndpoint",
      args: [domain, newEndpoint],
    });

    await this.client.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Consulta o fingerprint SHA-256 do certificado TLS do domínio (DANE On-Chain / S08)
   */
  async getDomainTlsFingerprint(domain: string, exactOnly = false): Promise<Hex | null> {
    const cleanDomain = domain.toLowerCase().trim();
    const demo = this.demoDomains.get(cleanDomain);
    if (demo?.tlsFingerprint) return demo.tlsFingerprint;

    try {
      const address = this.ensureContract();
      const result = await this.client.readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getDomainTlsFingerprint",
        args: [cleanDomain],
      }) as Hex;

      if (result && result !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return result;
      }

      if (exactOnly) return null;

      const parent = this.getParentDomain(cleanDomain);
      if (parent) {
        return await this.getDomainTlsFingerprint(parent, false);
      }
      return null;
    } catch {
      if (demo?.tlsFingerprint) return demo.tlsFingerprint;
      return null;
    }
  }

  /**
   * Atualiza o fingerprint SHA-256 do certificado TLS do domínio on-chain (DANE On-Chain / S08)
   */
  async setDomainTlsFingerprint(domain: string, fingerprint: Hex): Promise<string> {
    const cleanDomain = domain.toLowerCase().trim();
    const demo = this.demoDomains.get(cleanDomain);
    if (demo) {
      demo.tlsFingerprint = fingerprint;
      return "0xdemo_tls_fingerprint_updated";
    }

    const address = this.ensureContract();
    const account = privateKeyToAccount(this.config.DEPLOYER_PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      chain: this.chain,
      transport: http(this.config.RPC_URL),
      account,
    });

    const hash = await (walletClient as any).writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "setDomainTlsFingerprint",
      args: [cleanDomain, fingerprint],
    });

    await this.client.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Registra um provedor utilizando a Cota Gênesis (Fase 13)
   */
  async registerGenesisProvider(
    domain: string,
    endpoint: string,
    publicKey: Address,
    tier: number = 1
  ): Promise<string> {
    const address = this.ensureContract();
    const account = privateKeyToAccount(this.config.DEPLOYER_PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      chain: this.chain,
      transport: http(this.config.RPC_URL),
      account,
    });

    const hash = await (walletClient as any).writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "registerGenesisProvider",
      args: [domain, endpoint, publicKey, tier],
    });

    await this.client.waitForTransactionReceipt({ hash });
    return hash;
  }

  /**
   * Retorna os dados completos de governança on-chain, tesouraria e taxas
   */
  async getGovernanceInfo(): Promise<{
    owner: Address | null;
    oracleNode: Address | null;
    founderWallet: Address | null;
    treasury: Address | null;
    standardFeeWei: string;
    providerFeeWei: string;
    standardFeeEth: string;
    providerFeeEth: string;
    contractBalanceWei: string;
    contractBalanceEth: string;
    accumulatedFounderFeesWei: string;
    accumulatedFounderFeesEth: string;
    accumulatedTreasuryFeesWei: string;
    accumulatedTreasuryFeesEth: string;
    genesisCount: number;
    maxGenesis: number;
    contractAddress: string;
    chainId: number;
  }> {
    const address = this.ensureContract();

    const [
      owner,
      oracleNode,
      founderWallet,
      treasury,
      standardFee,
      providerFee,
      accumulatedFounderFees,
      accumulatedTreasuryFees,
      genesisStatus,
      contractBalance,
    ] = await Promise.all([
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "owner", args: [] }).catch(() => null) as Promise<Address | null>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "oracleNode", args: [] }).catch(() => null) as Promise<Address | null>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "founderWallet", args: [] }).catch(() => null) as Promise<Address | null>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "treasury", args: [] }).catch(() => null) as Promise<Address | null>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "standardFee", args: [] }).catch(() => 0n) as Promise<bigint>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "providerFee", args: [] }).catch(() => 0n) as Promise<bigint>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "accumulatedFounderFees", args: [] }).catch(() => 0n) as Promise<bigint>,
      this.client.readContract({ address, abi: REGISTRY_ABI, functionName: "accumulatedTreasuryFees", args: [] }).catch(() => 0n) as Promise<bigint>,
      this.getGenesisStatus(),
      this.client.getBalance({ address }).catch(() => 0n),
    ]);

    const formatEth = (val: bigint) => (Number(val) / 1e18).toFixed(6);

    return {
      owner,
      oracleNode,
      founderWallet,
      treasury,
      standardFeeWei: standardFee.toString(),
      providerFeeWei: providerFee.toString(),
      standardFeeEth: formatEth(standardFee),
      providerFeeEth: formatEth(providerFee),
      contractBalanceWei: contractBalance.toString(),
      contractBalanceEth: formatEth(contractBalance),
      accumulatedFounderFeesWei: accumulatedFounderFees.toString(),
      accumulatedFounderFeesEth: formatEth(accumulatedFounderFees),
      accumulatedTreasuryFeesWei: accumulatedTreasuryFees.toString(),
      accumulatedTreasuryFeesEth: formatEth(accumulatedTreasuryFees),
      genesisCount: Number(genesisStatus.count),
      maxGenesis: Number(genesisStatus.maxGenesis),
      contractAddress: address,
      chainId: this.config.CHAIN_ID,
    };
  }

  getContractAddress(): Address | null {
    return this.contractAddress;
  }

  getClient(): PublicClient {
    return this.client;
  }

  /**
   * Retorna a lista de redes suportadas no ecossistema Multi-Chain do MAIVW
   */
  getSupportedNetworks() {
    const isAnvil = this.config.CHAIN_ID === 31337;
    return [
      {
        id: isAnvil ? 31337 : 84532,
        name: isAnvil ? "Anvil Local" : "Base Sepolia",
        symbol: "ETH",
        isPrimary: true,
        rpcUrl: isAnvil ? this.config.RPC_URL : this.config.BASE_RPC_URL,
        contractAddress: this.contractAddress || (this.config.BASE_REGISTRY_ADDRESS as Address),
        mirrorFeeFormatted: isAnvil ? "0.003 ETH" : "0.003 ETH",
        mirrorFeeWei: "3000000000000000",
        explorerUrl: isAnvil ? "http://localhost:55443" : "https://sepolia.basescan.org",
      },
      {
        id: 421614,
        name: "Arbitrum Sepolia",
        symbol: "ETH",
        isPrimary: false,
        rpcUrl: this.config.ARBITRUM_RPC_URL,
        contractAddress: (this.config.ARBITRUM_REGISTRY_ADDRESS as Address) || null,
        mirrorFeeFormatted: "0.003 ETH",
        mirrorFeeWei: "3000000000000000",
        explorerUrl: "https://sepolia.arbiscan.io",
      },
      {
        id: 80002,
        name: "Polygon Amoy",
        symbol: "POL",
        isPrimary: false,
        rpcUrl: this.config.POLYGON_RPC_URL,
        contractAddress: (this.config.POLYGON_REGISTRY_ADDRESS as Address) || null,
        mirrorFeeFormatted: "25 POL",
        mirrorFeeWei: "25000000000000000000",
        explorerUrl: "https://amoy.polygonscan.com",
      },
    ];
  }

  /**
   * Consulta os dados de espelho de um domínio no contrato da rede especificada
   */
  async getMirrorInfo(domain: string, targetChainId?: number): Promise<{
    isMirror: boolean;
    originChainId: number;
    mirroredAt: number;
  }> {
    const address = this.getContractAddress();
    if (!address) {
      return { isMirror: false, originChainId: 0, mirroredAt: 0 };
    }

    try {
      const data = await (this.client as any).readContract({
        address,
        abi: REGISTRY_ABI,
        functionName: "getMirrorInfo",
        args: [domain],
      });

      return {
        isMirror: Boolean(data[0]),
        originChainId: Number(data[1]),
        mirroredAt: Number(data[2]),
      };
    } catch {
      return { isMirror: false, originChainId: 0, mirroredAt: 0 };
    }
  }

  /**
   * Desativa um espelho on-chain via transação assinada pela carteira do Oráculo
   */
  async deactivateMirror(domain: string, targetChainId?: number): Promise<string> {
    const address = this.getContractAddress();
    if (!address) {
      throw new Error("[LEDGER] Contract address not available for mirror deactivation");
    }

    const account = privateKeyToAccount(this.config.ORACLE_PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      chain: this.chain,
      transport: http(this.config.RPC_URL),
      account,
    });

    const hash = await (walletClient as any).writeContract({
      address,
      abi: REGISTRY_ABI,
      functionName: "deactivateMirror",
      args: [domain],
    });

    await this.client.waitForTransactionReceipt({ hash });
    return hash;
  }

  getPublicClient(): PublicClient {
    return this.client;
  }
}
