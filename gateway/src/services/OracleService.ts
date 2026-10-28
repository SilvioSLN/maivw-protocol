import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hash,
  type Account,
  keccak256,
  stringToHex,
  encodePacked,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, baseSepolia, arbitrumSepolia, polygonAmoy } from "viem/chains";
import { REGISTRY_ABI, type EnvConfig } from "../config.js";
import { LedgerService } from "./LedgerService.js";
import { createGcpKmsAccount } from "./GcpKmsAccount.js";
import { createAwsKmsAccount } from "./AwsKmsAccount.js";
import {
  type ISemanticJudge,
  type SemanticJudgeVerdict,
  HeuristicSemanticJudge,
  RemoteAiSemanticJudge,
} from "./semantic/index.js";
import { defaultLedgerWriteGate } from "../multichain/LedgerWriteGate.js";

/**
 * OracleService - O Juiz Automatizado e Nó Oráculo do MAIVW (Fases 5, 7 e 8)
 * 
 * Responsável por:
 * 1. Moderação semântica determinística (Juiz IA / Mock LLM)
 * 2. Execução de transações on-chain de Slashing e Advertência (3 strikes)
 * 3. Assinatura de provas de reciclagem de domínios legítimos (Reclaim / PoO)
 */
export class OracleService {
  private config: EnvConfig;
  private ledgerService: LedgerService;
  private account: Account;
  private walletClient;
  private semanticJudge: ISemanticJudge;

  constructor(config: EnvConfig, ledgerService: LedgerService, account?: Account) {
    this.config = config;
    this.ledgerService = ledgerService;

    if (config.ORACLE_AI_JUDGE_URL) {
      this.semanticJudge = new RemoteAiSemanticJudge(
        config.ORACLE_AI_JUDGE_URL,
        config.ORACLE_AI_JUDGE_TOKEN
      );
    } else {
      this.semanticJudge = new HeuristicSemanticJudge();
    }

    this.account = account || privateKeyToAccount(config.ORACLE_PRIVATE_KEY as `0x${string}`);

    const chain = {
      ...foundry,
      id: config.CHAIN_ID,
      rpcUrls: {
        default: { http: [config.RPC_URL] },
      },
    };

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.RPC_URL),
    });

    if (!this.account.signTypedData) {
      throw new Error("[ORACLE] A conta configurada deve implementar signTypedData (EIP-712)");
    }

    console.log(`[ORACLE] Initialized (${this.getSignerType()}) with address: ${this.account.address}`);
  }

  /**
   * Método de fábrica assíncrono para inicialização com fail-fast.
   * Suporta tanto Google Cloud KMS (Cloud HSM) quanto chave privada local para dev/testes.
   */
  static async create(config: EnvConfig, ledgerService: LedgerService): Promise<OracleService> {
    let account;
    if (config.ORACLE_SIGNER_TYPE === "gcp-kms") {
      if (!config.GCP_KMS_KEY_VERSION) {
        throw new Error(
          "[ORACLE] Configuração inválida: ORACLE_SIGNER_TYPE='gcp-kms' exige que GCP_KMS_KEY_VERSION seja definido."
        );
      }
      console.log(`[ORACLE] Initializing GCP Cloud KMS HSM Signer (Key: ${config.GCP_KMS_KEY_VERSION})...`);
      account = await createGcpKmsAccount({
        keyVersionName: config.GCP_KMS_KEY_VERSION,
        credentialsJsonBase64: config.GCP_KMS_CREDENTIALS_BASE64,
      });
    } else if (config.ORACLE_SIGNER_TYPE === "aws-kms") {
      if (!config.AWS_KMS_KEY_ID) {
        throw new Error(
          "[ORACLE] Configuração inválida: ORACLE_SIGNER_TYPE='aws-kms' exige que AWS_KMS_KEY_ID seja definido."
        );
      }
      console.log(`[ORACLE] Initializing AWS KMS Signer (Key: ${config.AWS_KMS_KEY_ID})...`);
      account = await createAwsKmsAccount({
        keyId: config.AWS_KMS_KEY_ID,
        region: config.SES_REGION,
      });
    } else {
      console.log("[ORACLE] Initializing Local Private Key Signer...");
      if (!config.ORACLE_PRIVATE_KEY) {
        throw new Error(
          "[ORACLE] Configuração inválida: ORACLE_SIGNER_TYPE='local' exige que ORACLE_PRIVATE_KEY seja definido no ambiente."
        );
      }
      account = privateKeyToAccount(config.ORACLE_PRIVATE_KEY as `0x${string}`);
    }

    const service = new OracleService(config, ledgerService, account);

    // Verificação proativa do saldo nativo de gas no boot
    try {
      const balance = await service.getBalance();
      const minBalance = config.ORACLE_MIN_BALANCE_WEI;
      if (balance < minBalance) {
        console.warn(
          `[ORACLE] ⚠️ WARNING: Saldo da carteira do Oráculo (${formatEther(balance)} ETH / ${balance} wei) está abaixo do limiar mínimo (${formatEther(minBalance)} ETH). Transações on-chain de Slashing e Advertência podem falhar!`
        );
      } else {
        console.log(`[ORACLE] ✅ Saldo nativo da carteira verificado: ${formatEther(balance)} ETH.`);
      }
    } catch (err: any) {
      console.warn(`[ORACLE] ⚠️ Não foi possível verificar o saldo do Oráculo no boot: ${err.message}`);
    }

    return service;
  }

  /**
   * Permite injeção de motor de julgamento semântico customizado (Fase 8).
   */
  setSemanticJudge(judge: ISemanticJudge): void {
    this.semanticJudge = judge;
  }

  /**
   * Juiz Semântico Automatizado (Fase 8).
   * Analisa se o conteúdo textual do e-mail condiz estritamente com a categoria declarada (MessageClass).
   * Detecta fraudes do tipo "Tag Spoofing" (ex: marcar um e-mail de vendas como TX_CODE para furar a quarentena).
   */
  judgeSemanticViolation(
    msgClass: string,
    text: string
  ): SemanticJudgeVerdict {
    const verdict = this.semanticJudge.judge(msgClass, text);
    if (verdict instanceof Promise) {
      return new HeuristicSemanticJudge().judge(msgClass, text);
    }
    return verdict;
  }

  /**
   * Avaliação semântica assíncrona com suporte completo a provedores de IA remotos.
   */
  async judgeSemanticViolationAsync(
    msgClass: string,
    text: string
  ): Promise<SemanticJudgeVerdict> {
    return Promise.resolve(this.semanticJudge.judge(msgClass, text));
  }

  /**
   * Valida se operacoes de escrita no ledger estao liberadas (fail-closed)
   */
  private assertLedgerWritesAllowed(operation: string): void {
    const chainIdMap: Record<number, string> = {
      1: "ethereum",
      137: "polygon",
      8453: "base",
      42161: "arbitrum",
      84532: "base-sepolia",
      80002: "amoy",
      421614: "arbitrum-sepolia",
      31337: "local",
    };
    const networkId = chainIdMap[this.config.CHAIN_ID] || (this.config.CHAIN_ID === 31337 ? "local" : "unknown");
    defaultLedgerWriteGate.assertWriteAllowed(networkId, operation);
  }

  /**
   * Executa a punição on-chain (Slashing) confiscando o stake e distribuindo recompensa aos repórteres.
   */
  async executeSlashing(
    domain: string,
    reporters: Address[],
    onBroadcast?: (hash: Hash) => Promise<void>
  ): Promise<{ txHash: Hash; success: boolean }> {
    const contractAddress = this.ledgerService.getContractAddress();
    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    // Ordenar e deduplicar repórteres estritamente em ordem crescente para cumprir H-07
    const sortedReporters = Array.from(
      new Set(reporters.map((r) => r.toLowerCase()))
    )
      .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
      .map((r) => r as Address);

    console.log(
      `[ORACLE] Executing slashing on-chain for domain "${domain}" with ${sortedReporters.length} sorted reporter(s)...`
    );

    // Guardiao fail-closed de escrita em mainnets (R07)
    this.assertLedgerWritesAllowed("slashDomain");

    const txHash = await this.walletClient.writeContract({
      account: this.account, address: contractAddress, abi: REGISTRY_ABI,
      functionName: "slashDomain", args: [domain, sortedReporters],
    });
    await onBroadcast?.(txHash);
    const receipt = await this.ledgerService.getClient().waitForTransactionReceipt({
      hash: txHash, confirmations: this.config.CHAIN_ID === 31337 ? 1 : 2, timeout: 60000,
    });
    if (receipt.status !== "success") throw new Error("Slashing transaction reverted");
    this.ledgerService.deactivateDemoDomain(domain);
    return { txHash, success: true };
  }

  /**
   * Executa uma advertência on-chain para provedores compartilhados (3 strikes).
   */
  async executeWarning(
    providerDomain: string,
    subIdentity: string,
    onBroadcast?: (hash: Hash) => Promise<void>
  ): Promise<{ txHash: Hash; success: boolean }> {
    const contractAddress = this.ledgerService.getContractAddress();
    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    console.log(
      `[ORACLE] Issuing warning ticket for provider "${providerDomain}" and subIdentity "${subIdentity}"...`
    );

    // Guardiao fail-closed de escrita em mainnets (R07)
    this.assertLedgerWritesAllowed("issueWarningTicket");

    try {
      const txHash = await this.walletClient.writeContract({
        account: this.account,
        address: contractAddress,
        abi: REGISTRY_ABI,
        functionName: "issueWarningTicket",
        args: [providerDomain, subIdentity],
      });

      await onBroadcast?.(txHash);
      const receipt = await this.ledgerService.getClient().waitForTransactionReceipt({
        hash: txHash, confirmations: this.config.CHAIN_ID === 31337 ? 1 : 2, timeout: 60000,
      });
      if (receipt.status !== "success") throw new Error("Warning transaction reverted");
      return { txHash, success: true };
    } catch (err) {
      if ((err as any)?.code === "MAINNET_WRITES_DISABLED") throw err;
      console.error("[ORACLE] Warning action not confirmed; reconciliation may be required");
      throw new Error("Warning action not confirmed");
    }
  }

  /**
   * Registra a raiz Merkle de um lote na blockchain (Fase 6).
   */
  async registerIntentBatchOnChain(
    senderDomain: string,
    messageClass: string,
    merkleRoot: `0x${string}`
  ): Promise<Hash> {
    const contractAddress = this.ledgerService.getContractAddress();
    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    console.log(
      `[ORACLE] Registering intent batch on-chain for ${senderDomain} (${messageClass}): ${merkleRoot}`
    );

    // Guardiao fail-closed de escrita em mainnets (R07)
    this.assertLedgerWritesAllowed("registerIntentBatch");

    return await this.walletClient.writeContract({
      account: this.account,
      address: contractAddress,
      abi: REGISTRY_ABI,
      functionName: "registerIntentBatch",
      args: [senderDomain, messageClass, merkleRoot],
    });
  }

  /**
   * Gera a assinatura EIP-712 do Oráculo autorizando a reciclagem de um domínio banido (PoO).
   */
  async generateReclaimProof(
    domain: string,
    newPublicKey: Address,
    buyerAddress: Address,
    adminKey?: Address,
    deadline?: bigint
  ): Promise<`0x${string}`> {
    const contractAddress = this.ledgerService.getContractAddress();
    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    const effectiveAdmin = adminKey || buyerAddress;
    const effectiveDeadline = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400);
    const cleanDomain = domain.toLowerCase().trim();
    const domainHash = keccak256(stringToHex(cleanDomain));

    let nonce = 0n;
    let epoch = 0;
    try {
      nonce = await (this.ledgerService.getPublicClient() as any).readContract({
        address: contractAddress,
        abi: [
          {
            name: "domainNonces",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "", type: "bytes32" }],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "domainNonces",
        args: [domainHash],
      });
      const profile: any = await (this.ledgerService.getPublicClient() as any).readContract({
        address: contractAddress,
        abi: REGISTRY_ABI,
        functionName: "getCompanyProfile",
        args: [cleanDomain],
      });
      epoch = Number(profile?.epoch ?? 0);
    } catch {
      nonce = 0n;
      epoch = 0;
    }

    const typedDomain = {
      name: "MAIVWRegistry",
      version: "2",
      chainId: this.config.CHAIN_ID,
      verifyingContract: contractAddress,
    };

    const types = {
      Reclaim: [
        { name: "domainHash", type: "bytes32" },
        { name: "publicKey", type: "address" },
        { name: "adminKey", type: "address" },
        { name: "registrant", type: "address" },
        { name: "isProvider", type: "bool" },
        { name: "tier", type: "uint8" },
        { name: "epoch", type: "uint32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const signature = await this.account.signTypedData!({
      domain: typedDomain,
      types,
      primaryType: "Reclaim",
      message: {
        domainHash,
        publicKey: newPublicKey,
        adminKey: effectiveAdmin,
        registrant: buyerAddress,
        isProvider: false,
        tier: 0,
        epoch,
        nonce,
        deadline: effectiveDeadline,
      },
    });

    console.log(
      `[ORACLE] Generated EIP-712 Reclaim Proof for domain "${domain}" -> newOwner "${buyerAddress}"`
    );

    return signature;
  }

  /**
   * Gera a assinatura EIP-712 do Oráculo autorizando o registro inicial de um domínio comprovado via DNS TXT.
   */
  async generateRegistrationProof(
    domain: string,
    publicKey: Address,
    callerAddress: Address,
    targetChainId?: number,
    adminKey?: Address,
    deadline?: bigint
  ): Promise<`0x${string}`> {
    const effectiveChainId = targetChainId || this.config.CHAIN_ID;
    let contractAddress = this.ledgerService.getContractAddress();
    if (effectiveChainId === 421614 && this.config.ARBITRUM_REGISTRY_ADDRESS) {
      contractAddress = this.config.ARBITRUM_REGISTRY_ADDRESS as Address;
    } else if (effectiveChainId === 80002 && this.config.POLYGON_REGISTRY_ADDRESS) {
      contractAddress = this.config.POLYGON_REGISTRY_ADDRESS as Address;
    }

    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    const effectiveAdmin = adminKey || publicKey;
    const effectiveDeadline = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400); // 24h
    const cleanDomain = domain.toLowerCase().trim();
    const domainHash = keccak256(stringToHex(cleanDomain));

    let nonce = 0n;
    try {
      let publicClient: any = this.ledgerService.getPublicClient();
      if (effectiveChainId === 421614) {
        publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(this.config.ARBITRUM_RPC_URL) });
      } else if (effectiveChainId === 80002) {
        publicClient = createPublicClient({ chain: polygonAmoy, transport: http(this.config.POLYGON_RPC_URL) });
      }
      nonce = await publicClient.readContract({
        address: contractAddress,
        abi: [
          {
            name: "domainNonces",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "", type: "bytes32" }],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "domainNonces",
        args: [domainHash],
      });
    } catch {
      nonce = 0n;
    }

    const typedDomain = {
      name: "MAIVWRegistry",
      version: "2",
      chainId: effectiveChainId,
      verifyingContract: contractAddress,
    };

    const types = {
      Register: [
        { name: "domainHash", type: "bytes32" },
        { name: "publicKey", type: "address" },
        { name: "adminKey", type: "address" },
        { name: "registrant", type: "address" },
        { name: "isProvider", type: "bool" },
        { name: "tier", type: "uint8" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const signature = await this.account.signTypedData!({
      domain: typedDomain,
      types,
      primaryType: "Register",
      message: {
        domainHash,
        publicKey,
        adminKey: effectiveAdmin,
        registrant: callerAddress,
        isProvider: false,
        tier: 0,
        nonce,
        deadline: effectiveDeadline,
      },
    });

    console.log(
      `[ORACLE] Generated EIP-712 Registration Proof for domain "${domain}" (Chain: ${effectiveChainId}) -> key "${publicKey}", caller "${callerAddress}"`
    );

    return signature;
  }

  /**
   * Gera a assinatura EIP-712 do Oráculo autorizando o espelhamento de um domínio em uma rede de destino.
   */
  async generateMirrorProof(
    domain: string,
    publicKey: Address,
    originChainId: number,
    targetChainId: number,
    callerAddress: Address,
    adminKey?: Address,
    deadline?: bigint
  ): Promise<`0x${string}`> {
    let contractAddress = this.ledgerService.getContractAddress();
    if (targetChainId === 421614 && this.config.ARBITRUM_REGISTRY_ADDRESS) {
      contractAddress = this.config.ARBITRUM_REGISTRY_ADDRESS as Address;
    } else if (targetChainId === 80002 && this.config.POLYGON_REGISTRY_ADDRESS) {
      contractAddress = this.config.POLYGON_REGISTRY_ADDRESS as Address;
    }
    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    const effectiveAdmin = adminKey || publicKey;
    const effectiveDeadline = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400);
    const cleanDomain = domain.toLowerCase().trim();
    const domainHash = keccak256(stringToHex(cleanDomain));

    let nonce = 0n;
    try {
      let publicClient: any = this.ledgerService.getPublicClient();
      if (targetChainId === 421614) {
        publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(this.config.ARBITRUM_RPC_URL) });
      } else if (targetChainId === 80002) {
        publicClient = createPublicClient({ chain: polygonAmoy, transport: http(this.config.POLYGON_RPC_URL) });
      }
      nonce = await publicClient.readContract({
        address: contractAddress,
        abi: [
          {
            name: "domainNonces",
            type: "function",
            stateMutability: "view",
            inputs: [{ name: "", type: "bytes32" }],
            outputs: [{ name: "", type: "uint256" }],
          },
        ],
        functionName: "domainNonces",
        args: [domainHash],
      });
    } catch {
      nonce = 0n;
    }

    const typedDomain = {
      name: "MAIVWRegistry",
      version: "2",
      chainId: targetChainId,
      verifyingContract: contractAddress,
    };

    const types = {
      Mirror: [
        { name: "domainHash", type: "bytes32" },
        { name: "publicKey", type: "address" },
        { name: "adminKey", type: "address" },
        { name: "registrant", type: "address" },
        { name: "originChainId", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const signature = await this.account.signTypedData!({
      domain: typedDomain,
      types,
      primaryType: "Mirror",
      message: {
        domainHash,
        publicKey,
        adminKey: effectiveAdmin,
        registrant: callerAddress,
        originChainId: BigInt(originChainId),
        nonce,
        deadline: effectiveDeadline,
      },
    });

    console.log(
      `[ORACLE] Generated EIP-712 Mirror Proof for domain "${domain}" (Origin: ${originChainId} -> Target: ${targetChainId}, Caller: ${callerAddress})`
    );

    return signature;
  }

  /**
   * Executa o registro on-chain de uma empresa via Relayer do protocolo com a taxa exata e a prova do oráculo.
   */
  async registerCompanyOnChain(
    domain: string,
    endpointUrl: string,
    publicKey: Address,
    isProvider: boolean,
    oracleProof: `0x${string}`,
    targetChainId?: number,
    adminKey?: Address,
    deadline?: bigint
  ): Promise<Hash> {
    let contractAddress = this.ledgerService.getContractAddress();
    let client: any = this.walletClient;
    let standardFeeWei = 100000000000000n; // 0.0001 ETH padrão

    if (targetChainId === 421614 && this.config.ARBITRUM_REGISTRY_ADDRESS) {
      contractAddress = this.config.ARBITRUM_REGISTRY_ADDRESS as Address;
      standardFeeWei = 100000000000000n; // 0.0001 ETH
      client = createWalletClient({
        chain: arbitrumSepolia,
        transport: http(this.config.ARBITRUM_RPC_URL),
        account: this.account,
      });
    } else if (targetChainId === 80002 && this.config.POLYGON_REGISTRY_ADDRESS) {
      contractAddress = this.config.POLYGON_REGISTRY_ADDRESS as Address;
      standardFeeWei = 100000000000000000n; // 0.1 POL no Amoy
      client = createWalletClient({
        chain: polygonAmoy,
        transport: http(this.config.POLYGON_RPC_URL),
        account: this.account,
      });
    } else if (this.config.CHAIN_ID === 31337) {
      standardFeeWei = 10000000000000000000n; // 10 ETH no Anvil
    }

    if (!contractAddress) {
      throw new Error("[ORACLE] Contract address not configured");
    }

    const effectiveAdmin = adminKey || publicKey;
    const effectiveDeadline = deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400);

    console.log(
      `[ORACLE] Registering ${domain} on-chain at ${contractAddress} (Chain: ${targetChainId || this.config.CHAIN_ID}) with fee ${standardFeeWei} wei...`
    );

    defaultLedgerWriteGate.assertCanWrite(`evm:${targetChainId || this.config.CHAIN_ID}`);

    return await client.writeContract({
      account: this.account,
      address: contractAddress,
      abi: REGISTRY_ABI,
      functionName: "registerCompany",
      args: [
        domain,
        endpointUrl,
        publicKey,
        effectiveAdmin,
        isProvider,
        effectiveDeadline,
        oracleProof,
      ],
      value: standardFeeWei,
    });
  }

  getOracleAddress(): Address {
    return this.account.address;
  }

  getSignerType(): "local" | "gcp-kms" | "aws-kms" {
    return this.config.ORACLE_SIGNER_TYPE;
  }

  async getBalance(): Promise<bigint> {
    const publicClient = this.ledgerService.getPublicClient() as any;
    return await publicClient.getBalance({
      address: this.account.address,
    });
  }
}
