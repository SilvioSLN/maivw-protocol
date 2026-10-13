import { z } from "zod";
import { readFileSync } from "node:fs";

/**
 * Configuração centralizada do Gateway via variáveis de ambiente.
 * Validada com Zod para fail-fast em caso de configuração incorreta.
 */
export const EnvSchema = z.object({
  GATEWAY_PORT: z.coerce.number().default(3001),
  GATEWAY_HOST: z.string().default("0.0.0.0"),
  RPC_URL: z.string().url().default("http://localhost:8545"),
  CHAIN_ID: z.coerce.number().default(31337),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/maivw_reputation?schema=public"),
  REGISTRY_CONTRACT_ADDRESS: z.string().optional(),
  MIRROR_REGISTRY_V2_ADDRESS: z.string().optional(),
  // ATENÇÃO: Chaves padrão abaixo são contas de teste públicas do Anvil/Hardhat (Account #0, #1, #2).
  DEPLOYER_PRIVATE_KEY: z.string().optional(),
  ORACLE_PRIVATE_KEY: z.string().optional(),
  COMPANY_A_PRIVATE_KEY: z.string().optional(),
  COMPANY_B_PRIVATE_KEY: z.string().optional(),
  PROVIDER_PRIVATE_KEY: z.string().optional(),
  SENDER_DOMAIN: z.string().default("empresaA.com"),
  MASTER_SECRET_KEY: z.string().min(16, "MASTER_SECRET_KEY deve ser configurada no ambiente"),
  LEGACY_WEBHOOK_SECRET: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional(),
  ADMIN_REGISTRATION_TOKEN: z.string().min(32).optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET deve ser configurado no ambiente"),
  BASE_RPC_URL: z.string().url().default("http://localhost:8545"),
  BASE_REGISTRY_ADDRESS: z.string().optional(),
  ARBITRUM_RPC_URL: z.string().url().default("https://sepolia-rollup.arbitrum.io/rpc"),
  ARBITRUM_REGISTRY_ADDRESS: z.string().optional(),
  POLYGON_RPC_URL: z.string().url().default("https://rpc-amoy.polygon.technology"),
  POLYGON_REGISTRY_ADDRESS: z.string().optional(),
  INTERNAL_SERVICE_KEY: z.string().min(16, "INTERNAL_SERVICE_KEY deve ser configurada no ambiente"),
  ORACLE_SIGNER_TYPE: z.enum(["local", "gcp-kms"]).default("local"),
  GCP_KMS_KEY_VERSION: z.string().optional(),
  GCP_KMS_CREDENTIALS_BASE64: z.string().optional(),
  ORACLE_MIN_BALANCE_WEI: z.coerce.bigint().default(10000000000000000n),
  ORACLE_AI_JUDGE_URL: z.string().url().optional(),
  ORACLE_AI_JUDGE_TOKEN: z.string().optional(),
  MAIVW_CORE_DOMAIN: z.string().default("maivw.org"),
  PLATFORM_INGRESS_HOSTS: z.string().default(""),
  MAIVW_ORACLE_URL: z.string().url().default("https://api-test.maivw.com"),
  IS_CLOUD: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(false),
  ),
  DEFAULT_P2P_ENDPOINT: z.string().url().optional(),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  MTLS_STRICT_MODE: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(false),
  ),
  TRUST_PROXY: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(false),
  ),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

const ANVIL_ACCOUNT_ZERO_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export function isLocalDemoConfig(config: Pick<EnvConfig, "CHAIN_ID" | "RPC_URL">): boolean {
  if (config.CHAIN_ID !== 31337) return false;
  try {
    const hostname = new URL(config.RPC_URL).hostname.toLowerCase();
    return hostname === "anvil" || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function environmentSafetyErrors(config: EnvConfig): string[] {
  if (isLocalDemoConfig(config)) return [];

  const errors: string[] = [];
  if (!config.REGISTRY_CONTRACT_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(config.REGISTRY_CONTRACT_ADDRESS)) {
    errors.push("REGISTRY_CONTRACT_ADDRESS válido é obrigatório fora do Anvil local");
  }

  for (const name of ["JWT_SECRET", "MASTER_SECRET_KEY", "INTERNAL_SERVICE_KEY", "ADMIN_REGISTRATION_TOKEN"] as const) {
    const value = config[name];
    if (value?.startsWith("local-demo-")) errors.push(`${name} usa um valor público reservado à demonstração local`);
  }

  if (config.ORACLE_PRIVATE_KEY?.toLowerCase() === ANVIL_ACCOUNT_ZERO_PRIVATE_KEY) {
    errors.push("ORACLE_PRIVATE_KEY usa a conta pública #0 do Anvil");
  }
  if (config.DEPLOYER_PRIVATE_KEY?.toLowerCase() === ANVIL_ACCOUNT_ZERO_PRIVATE_KEY) {
    errors.push("DEPLOYER_PRIVATE_KEY usa a conta pública #0 do Anvil");
  }
  if (config.DEFAULT_P2P_ENDPOINT && new URL(config.DEFAULT_P2P_ENDPOINT).protocol !== "https:") {
    errors.push("DEFAULT_P2P_ENDPOINT deve usar HTTPS fora do Anvil local");
  }
  return errors;
}

export function parseEnvironment(env: NodeJS.ProcessEnv) {
  return EnvSchema.safeParse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")),
  );
}

/**
 * Carrega e valida as variáveis de ambiente.
 * Também tenta ler o endereço do contrato do arquivo gerado pelo deploy.
 */
export function loadConfig(): EnvConfig {
  // Tentar ler contract address do arquivo gerado pelo deploy container
  let contractAddress = process.env.REGISTRY_CONTRACT_ADDRESS;
  let mirrorRegistryV2Address = process.env.MIRROR_REGISTRY_V2_ADDRESS;
  
  if (!contractAddress) {
    try {
      const addr = readFileSync("/deploy-output/contract-address.txt", "utf-8").trim();
      if (addr) {
        contractAddress = addr;
        console.log(`[CONFIG] Contract address loaded from deploy output: ${addr}`);
      }
    } catch {
      // Arquivo não existe ainda, provavelmente rodando sem Docker
    }
  }

  if (!mirrorRegistryV2Address) {
    try {
      mirrorRegistryV2Address = readFileSync(
        "/deploy-output/mirror-registry-v2-address.txt",
        "utf-8",
      ).trim() || undefined;
    } catch {
      // Deploy legado ou execução fora do Docker.
    }
  }

  const env = {
    ...process.env,
    ...(contractAddress ? { REGISTRY_CONTRACT_ADDRESS: contractAddress } : {}),
    ...(mirrorRegistryV2Address ? { MIRROR_REGISTRY_V2_ADDRESS: mirrorRegistryV2Address } : {}),
  };

  const result = parseEnvironment(env);
  
  if (!result.success) {
    console.error("[CONFIG] ❌ Invalid environment configuration:");
    console.error(result.error.format());
    process.exit(1);
  }

  if (result.data.ORACLE_SIGNER_TYPE === "gcp-kms" && !result.data.GCP_KMS_KEY_VERSION) {
    console.error(
      "[CONFIG] ❌ Configuração inválida: ORACLE_SIGNER_TYPE='gcp-kms' exige que GCP_KMS_KEY_VERSION seja definido."
    );
    process.exit(1);
  }

  const safetyErrors = environmentSafetyErrors(result.data);
  if (safetyErrors.length > 0) {
    console.error("[CONFIG] ❌ Configuração insegura para uma rede externa:");
    for (const error of safetyErrors) console.error(`- ${error}`);
    process.exit(1);
  }

  return result.data;
}

/**
 * ABI mínima do MAIVWRegistry para leitura via viem.
 * Contém apenas as funções view necessárias para o Gateway.
 */
export const REGISTRY_ABI = [
  {
    name: "isDomainActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getCompanyProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "domain", type: "string" },
          { name: "endpointUrl", type: "string" },
          { name: "publicKey", type: "address" },
          { name: "adminKey", type: "address" },
          { name: "registrationTime", type: "uint64" },
          { name: "strikeCount", type: "uint32" },
          { name: "epoch", type: "uint32" },
          { name: "isProvider", type: "bool" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getPublicKey",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "getEndpointUrl",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "getAllowedDailyVolume",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getTotalRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRegisteredDomainCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getDomainHashByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_index", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getCompanyProfileByHash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_h", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "domain", type: "string" },
          { name: "endpointUrl", type: "string" },
          { name: "publicKey", type: "address" },
          { name: "adminKey", type: "address" },
          { name: "registrationTime", type: "uint64" },
          { name: "strikeCount", type: "uint32" },
          { name: "epoch", type: "uint32" },
          { name: "isProvider", type: "bool" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "getAllCompanies",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "domain", type: "string" },
          { name: "endpointUrl", type: "string" },
          { name: "publicKey", type: "address" },
          { name: "adminKey", type: "address" },
          { name: "registrationTime", type: "uint64" },
          { name: "strikeCount", type: "uint32" },
          { name: "epoch", type: "uint32" },
          { name: "isProvider", type: "bool" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    name: "isDomainProvider",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "oracleNode",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "domainStakes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "registerIntentBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_senderDomain", type: "string" },
      { name: "_messageClass", type: "string" },
      { name: "_merkleRoot", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "slashDomain",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_reporters", type: "address[]" },
    ],
    outputs: [],
  },
  {
    name: "issueWarningTicket",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_providerDomain", type: "string" },
      { name: "_subIdentity", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "reclaimDomain",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_endpointUrl", type: "string" },
      { name: "_publicKey", type: "address" },
      { name: "_adminKey", type: "address" },
      { name: "_isProvider", type: "bool" },
      { name: "_tier", type: "uint8" },
      { name: "_deadline", type: "uint256" },
      { name: "_oracleProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "registerCompany",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_endpointUrl", type: "string" },
      { name: "_publicKey", type: "address" },
      { name: "_adminKey", type: "address" },
      { name: "_isProvider", type: "bool" },
      { name: "_deadline", type: "uint256" },
      { name: "_oracleProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "updateEndpoint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_newEndpoint", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "updatePublicKey",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_newPublicKey", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "standardFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "standardRegistrationFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getGenesisStatus",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "count", type: "uint256" },
      { name: "maxGenesis", type: "uint256" },
    ],
  },
  {
    name: "getProviderInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [
      { name: "tier", type: "uint8" },
      { name: "balance", type: "uint256" },
      { name: "dailyLimit", type: "uint256" },
      { name: "isActive", type: "bool" },
      { name: "strikeCount", type: "uint8" },
    ],
  },
  {
    name: "providerBalances",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tierConfigs",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint8" }],
    outputs: [
      { name: "requiredStake", type: "uint256" },
      { name: "dailyLimit", type: "uint256" },
      { name: "penaltyPerStrike", type: "uint256" },
    ],
  },
  {
    name: "topUpBalance",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [],
  },
  {
    name: "registerGenesisDomain",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_endpoint", type: "string" },
      { name: "_publicKey", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "registerGenesisProvider",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_endpoint", type: "string" },
      { name: "_publicKey", type: "address" },
      { name: "_tier", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "ProviderSuspended",
    type: "event",
    inputs: [
      { name: "domain", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "ProviderReactivated",
    type: "event",
    inputs: [
      { name: "domain", type: "string", indexed: false },
      { name: "newBalance", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "GenesisDomainRegistered",
    type: "event",
    inputs: [
      { name: "domain", type: "string", indexed: false },
      { name: "publicKey", type: "address", indexed: false },
      { name: "genesisIndex", type: "uint256", indexed: false },
    ],
  },
  {
    name: "BalanceToppedUp",
    type: "event",
    inputs: [
      { name: "domain", type: "string", indexed: false },
      { name: "amountAdded", type: "uint256", indexed: false },
      { name: "newBalance", type: "uint256", indexed: false },
    ],
  },
  {
    name: "DomainDeactivated",
    type: "event",
    inputs: [
      { name: "domain", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    name: "DomainSlashed",
    type: "event",
    inputs: [
      { name: "domain", type: "string", indexed: false },
      { name: "reporters", type: "address[]", indexed: false },
      { name: "redistributed", type: "uint256", indexed: false },
      { name: "burned", type: "uint256", indexed: false },
    ],
  },
  {
    name: "treasury",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "setTreasury",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_newTreasury", type: "address" }],
    outputs: [],
  },
  {
    name: "withdrawTreasury",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [],
  },
  {
    name: "founderWallet",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "setFounderWallet",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_newFounderWallet", type: "address" }],
    outputs: [],
  },
  {
    name: "withdrawFounderFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "FounderWalletUpdated",
    type: "event",
    inputs: [
      { name: "oldWallet", type: "address", indexed: true },
      { name: "newWallet", type: "address", indexed: true },
    ],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "providerFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setOracleNode",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_newOracle", type: "address" }],
    outputs: [],
  },
  {
    name: "setFees",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_standardFee", type: "uint256" },
      { name: "_providerFee", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "accumulatedFounderFees",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "accumulatedTreasuryFees",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "mirrorFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getMirrorInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [
      { name: "isMirror", type: "bool" },
      { name: "originChainId", type: "uint256" },
      { name: "mirroredAt", type: "uint256" },
    ],
  },
  {
    name: "registerMirror",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_endpointUrl", type: "string" },
      { name: "_publicKey", type: "address" },
      { name: "_adminKey", type: "address" },
      { name: "_originChainId", type: "uint256" },
      { name: "_deadline", type: "uint256" },
      { name: "_oracleProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "deactivateMirror",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [],
  },
  {
    name: "setMirrorFee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_newFee", type: "uint256" }],
    outputs: [],
  },
  {
    name: "setDomainTlsFingerprint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_domain", type: "string" },
      { name: "_fingerprint", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getDomainTlsFingerprint",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "DomainTlsFingerprintUpdated",
    type: "event",
    inputs: [
      { name: "domainHash", type: "bytes32", indexed: true },
      { name: "domain", type: "string", indexed: false },
      { name: "fingerprint", type: "bytes32", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

/** ABI de leitura do registry upgradeable dedicado a mirrors multichain V2. */
export const MIRROR_REGISTRY_V2_ABI = [
  {
    name: "getMirrorProfile",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "domain", type: "string" },
        { name: "endpointUrl", type: "string" },
        { name: "publicKey", type: "tuple", components: [
          { name: "algorithm", type: "uint8" },
          { name: "keyData", type: "bytes32" },
        ] },
        { name: "adminKey", type: "tuple", components: [
          { name: "algorithm", type: "uint8" },
          { name: "keyData", type: "bytes32" },
        ] },
        { name: "tlsFingerprint", type: "bytes32" },
        { name: "status", type: "uint8" },
        { name: "isProvider", type: "bool" },
        { name: "tier", type: "uint8" },
        { name: "strikeCount", type: "uint32" },
        { name: "registrationTime", type: "uint64" },
      ],
    }],
  },
  {
    name: "getMirrorVersion",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "originNetworkHash", type: "bytes32" },
        { name: "originRegistry", type: "bytes32" },
        { name: "globalDomainEpoch", type: "uint64" },
        { name: "originSequence", type: "uint64" },
        { name: "originTxReference", type: "bytes32" },
        { name: "lastPayloadHash", type: "bytes32" },
        { name: "attestedStake", type: "uint256" },
        { name: "dailyLimit", type: "uint256" },
        { name: "updatedAt", type: "uint64" },
        { name: "revoked", type: "bool" },
        { name: "exists", type: "bool" },
      ],
    }],
  },
  {
    name: "getTypedKeys",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [
      { name: "publicKey", type: "tuple", components: [
        { name: "algorithm", type: "uint8" },
        { name: "keyData", type: "bytes32" },
      ] },
      { name: "adminKey", type: "tuple", components: [
        { name: "algorithm", type: "uint8" },
        { name: "keyData", type: "bytes32" },
      ] },
    ],
  },
  {
    name: "isMirrorActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_domain", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
