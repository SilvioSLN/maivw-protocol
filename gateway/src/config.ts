import { z } from "zod";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { RUNTIME_ROLES } from "./runtime/roles.js";

const optionalEvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional();
const optionalEvmPrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional();
const httpUrl = z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
  message: "deve usar http:// ou https://",
});
const optionalWsUrl = z.string().url().refine((value) => value.startsWith("ws://") || value.startsWith("wss://"), {
  message: "deve usar ws:// ou wss://",
}).optional();
const booleanFlag = z.preprocess(
  (value) => value === "true" ? true : value === "false" ? false : value,
  z.boolean(),
);
const solanaPublicKey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/).refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}, { message: "Pubkey Solana inválida" });

function validSolanaKeypairBase64(value: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return Array.isArray(parsed) && parsed.length === 64
      && parsed.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
  } catch {
    return false;
  }
}

function solanaKeypairPublicKey(value: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(parsed)).publicKey.toBase58();
  } catch {
    return null;
  }
}

/**
 * Configuração centralizada do Gateway via variáveis de ambiente.
 * Validada com Zod para fail-fast em caso de configuração incorreta.
 */
const EnvObjectSchema = z.object({
  MAIVW_ENVIRONMENT: z.enum(["local", "testnet", "staging", "production"]).default("local"),
  MAIVW_RUNTIME_ROLE: z.enum(RUNTIME_ROLES).default("all-in-one"),
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  GATEWAY_HOST: z.string().default("0.0.0.0"),
  GATEWAY_PUBLIC_URL: httpUrl.default("http://localhost:3001"),
  RPC_URL: httpUrl.default("http://localhost:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  QUEUE_DRIVER: z.enum(["bullmq", "memory"]).default("bullmq"),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  QUEUE_DEFAULT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  QUEUE_DEFAULT_BACKOFF_MS: z.coerce.number().int().min(50).max(60000).default(1000),
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  STORAGE_DRIVER: z.enum(["filesystem", "s3"]).default("filesystem"),
  ATTACHMENTS_DIR: z.string().default("data/attachments"),
  STORAGE_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  STORAGE_SIGNED_URL_EXPIRES_SECONDS: z.coerce.number().int().positive().default(900),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanFlag.default(true),
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/maivw_reputation?schema=public"),
  REGISTRY_CONTRACT_ADDRESS: optionalEvmAddress,
  MIRROR_REGISTRY_V2_ADDRESS: optionalEvmAddress,
  // ATENÇÃO: Chaves padrão abaixo são contas de teste públicas do Anvil/Hardhat (Account #0, #1, #2).
  DEPLOYER_PRIVATE_KEY: optionalEvmPrivateKey,
  ORACLE_PRIVATE_KEY: optionalEvmPrivateKey,
  COMPANY_A_PRIVATE_KEY: optionalEvmPrivateKey,
  COMPANY_B_PRIVATE_KEY: optionalEvmPrivateKey,
  PROVIDER_PRIVATE_KEY: optionalEvmPrivateKey,
  SENDER_DOMAIN: z.string().default("empresaA.com"),
  MASTER_SECRET_KEY: z.string().min(16, "MASTER_SECRET_KEY deve ser configurada no ambiente"),
  LEGACY_WEBHOOK_SECRET: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional(),
  ADMIN_REGISTRATION_TOKEN: z.string().min(32).optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET deve ser configurado no ambiente"),
  BASE_RPC_URL: httpUrl.default("http://localhost:8545"),
  BASE_WS_URL: optionalWsUrl,
  BASE_REGISTRY_ADDRESS: optionalEvmAddress,
  ARBITRUM_RPC_URL: httpUrl.default("https://sepolia-rollup.arbitrum.io/rpc"),
  ARBITRUM_WS_URL: optionalWsUrl,
  ARBITRUM_REGISTRY_ADDRESS: optionalEvmAddress,
  POLYGON_RPC_URL: httpUrl.default("https://rpc-amoy.polygon.technology"),
  POLYGON_WS_URL: optionalWsUrl,
  POLYGON_REGISTRY_ADDRESS: optionalEvmAddress,
  MULTICHAIN_RELAY_ENABLED: booleanFlag.default(false),
  SOLANA_ENABLED: booleanFlag.default(false),
  SOLANA_RPC_URL: z.string().url().optional(),
  SOLANA_WS_URL: optionalWsUrl,
  SOLANA_GENESIS_HASH: solanaPublicKey.optional(),
  SOLANA_PROGRAM_ID: solanaPublicKey.optional(),
  SOLANA_EXPLORER_URL: z.string().url().default("https://explorer.solana.com"),
  SOLANA_EXPLORER_CLUSTER_QUERY: z.string().max(128).optional(),
  SOLANA_COMMITMENT: z.literal("finalized").default("finalized"),
  SOLANA_ASSET_KIND: z.enum(["NATIVE", "SPL"]).default("NATIVE"),
  SOLANA_ASSET_SYMBOL: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,15}$/).default("SOL"),
  SOLANA_ASSET_DECIMALS: z.coerce.number().int().min(0).max(30).default(9),
  SOLANA_ASSET_MINT: solanaPublicKey.optional(),
  SOLANA_STANDARD_FEE_BASE_UNITS: z.coerce.bigint().min(0n).default(0n),
  SOLANA_RELAYER_PUBLIC_KEY: solanaPublicKey.optional(),
  SOLANA_RELAYER_KEYPAIR_PATH: z.string().min(1).max(1024).optional(),
  SOLANA_RELAYER_KEYPAIR_BASE64: z.string().refine(validSolanaKeypairBase64, {
    message: "deve codificar um array JSON de 64 bytes",
  }).optional(),
  SOLANA_REORG_MARGIN_SLOTS: z.coerce.number().int().min(0).max(1_000_000).default(64),
  SOLANA_OBSERVER_PAGE_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  SOLANA_OBSERVER_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(10),
  SOLANA_OBSERVER_START_SLOT: z.coerce.bigint().min(0n).default(0n),
  SOLANA_OBSERVER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(5_000),
  MULTICHAIN_ALERT_INDEXER_LAG_SLOTS: z.coerce.number().int().min(1).max(10_000_000).default(128),
  RELAY_ATTESTATION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
  RELAY_LEASE_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
  RELAY_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(3),
  INTERNAL_SERVICE_KEY: z.string().min(16, "INTERNAL_SERVICE_KEY deve ser configurada no ambiente"),
  ORACLE_SIGNER_TYPE: z.enum(["local", "gcp-kms"]).default("local"),
  GCP_KMS_KEY_VERSION: z.string().optional(),
  GCP_KMS_CREDENTIALS_BASE64: z.string().optional(),
  ORACLE_MIN_BALANCE_WEI: z.coerce.bigint().default(10000000000000000n),
  ORACLE_AI_JUDGE_URL: z.string().url().optional(),
  ORACLE_AI_JUDGE_TOKEN: z.string().optional(),
  MAIVW_CORE_DOMAIN: z.string().default("maivw.org"),
  PLATFORM_INGRESS_HOSTS: z.string().default(""),
  MAIVW_ORACLE_URL: httpUrl.default("http://localhost:3001"),
  IS_CLOUD: booleanFlag.default(false),
  DEFAULT_P2P_ENDPOINT: z.string().url().optional(),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  MTLS_STRICT_MODE: booleanFlag.default(false),
  TRUST_PROXY: booleanFlag.default(false),
});

export const EnvSchema = EnvObjectSchema.superRefine((config, context) => {
  const add = (path: string, message: string) => context.addIssue({ code: "custom", path: [path], message });
  const needsOracleSigner = ["all-in-one", "gateway-api", "oracle-worker", "relayer-worker"]
    .includes(config.MAIVW_RUNTIME_ROLE);
  const needsSolanaRelayerSigner = config.SOLANA_ENABLED && config.MULTICHAIN_RELAY_ENABLED
    && ["all-in-one", "relayer-worker"].includes(config.MAIVW_RUNTIME_ROLE);
  if (config.SOLANA_ENABLED) {
    for (const field of ["SOLANA_RPC_URL", "SOLANA_WS_URL", "SOLANA_GENESIS_HASH", "SOLANA_PROGRAM_ID"] as const) {
      if (!config[field]) add(field, `${field} é obrigatório quando SOLANA_ENABLED=true`);
    }
    if (needsSolanaRelayerSigner && !config.SOLANA_RELAYER_PUBLIC_KEY) {
      add("SOLANA_RELAYER_PUBLIC_KEY", "pubkey do relayer Solana é obrigatória para este papel");
    }
    if (needsSolanaRelayerSigner && !config.SOLANA_RELAYER_KEYPAIR_PATH && !config.SOLANA_RELAYER_KEYPAIR_BASE64) {
      add("SOLANA_RELAYER_KEYPAIR_PATH", "signer do relayer Solana é obrigatório");
    }
    if (config.SOLANA_RELAYER_KEYPAIR_BASE64 && config.SOLANA_RELAYER_PUBLIC_KEY
      && solanaKeypairPublicKey(config.SOLANA_RELAYER_KEYPAIR_BASE64) !== config.SOLANA_RELAYER_PUBLIC_KEY) {
      add("SOLANA_RELAYER_PUBLIC_KEY", "Pubkey não corresponde ao keypair do relayer");
    }
    if (config.SOLANA_ASSET_KIND === "NATIVE"
      && (config.SOLANA_ASSET_SYMBOL !== "SOL" || config.SOLANA_ASSET_DECIMALS !== 9 || config.SOLANA_ASSET_MINT)) {
      add("SOLANA_ASSET_KIND", "ativo nativo Solana deve ser SOL com 9 decimals e sem mint");
    }
    if (config.SOLANA_ASSET_KIND === "SPL" && !config.SOLANA_ASSET_MINT) {
      add("SOLANA_ASSET_MINT", "mint é obrigatório para ativo SPL");
    }
    if (config.SOLANA_ASSET_KIND === "SPL" && config.SOLANA_STANDARD_FEE_BASE_UNITS <= 0n) {
      add("SOLANA_STANDARD_FEE_BASE_UNITS", "taxa positiva é obrigatória para origem Solana");
    }
  }
  if (needsOracleSigner && config.ORACLE_SIGNER_TYPE === "local" && !config.ORACLE_PRIVATE_KEY) {
    add("ORACLE_PRIVATE_KEY", `papel ${config.MAIVW_RUNTIME_ROLE} exige signer local do oráculo`);
  }
  if (needsOracleSigner && config.ORACLE_SIGNER_TYPE === "gcp-kms" && !config.GCP_KMS_KEY_VERSION) {
    add("GCP_KMS_KEY_VERSION", `papel ${config.MAIVW_RUNTIME_ROLE} exige signer KMS do oráculo`);
  }
  if (config.MULTICHAIN_RELAY_ENABLED && needsSolanaRelayerSigner) {
    const deployments = [config.BASE_REGISTRY_ADDRESS, config.ARBITRUM_REGISTRY_ADDRESS, config.POLYGON_REGISTRY_ADDRESS]
      .filter(Boolean).length + (config.SOLANA_ENABLED ? 1 : 0);
    if (deployments < 2) add("MULTICHAIN_RELAY_ENABLED", "relayer exige ao menos dois deployments configurados");
    if (config.ORACLE_SIGNER_TYPE === "local" && !config.ORACLE_PRIVATE_KEY) {
      add("ORACLE_PRIVATE_KEY", "signer local do relayer exige ORACLE_PRIVATE_KEY");
    }
    if (config.ORACLE_SIGNER_TYPE === "gcp-kms" && !config.GCP_KMS_KEY_VERSION) {
      add("GCP_KMS_KEY_VERSION", "signer gcp-kms exige GCP_KMS_KEY_VERSION");
    }
  }
  for (const [registry, ws] of [
    [config.BASE_REGISTRY_ADDRESS, config.BASE_WS_URL],
    [config.ARBITRUM_REGISTRY_ADDRESS, config.ARBITRUM_WS_URL],
    [config.POLYGON_REGISTRY_ADDRESS, config.POLYGON_WS_URL],
  ]) {
    if (config.MULTICHAIN_RELAY_ENABLED && needsSolanaRelayerSigner && registry && !ws) {
      add("MULTICHAIN_RELAY_ENABLED", "cada deployment EVM do relayer exige URL WebSocket");
    }
  }
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
  const errors: string[] = [];
  const localNetwork = isLocalDemoConfig(config);
  const requiresPrimaryEvm = config.MAIVW_RUNTIME_ROLE !== "solana-indexer";

  if (config.MAIVW_RUNTIME_ROLE === "solana-indexer" && !config.SOLANA_ENABLED) {
    errors.push("MAIVW_RUNTIME_ROLE=solana-indexer exige SOLANA_ENABLED=true");
  }
  if (config.MAIVW_RUNTIME_ROLE === "relayer-worker" && !config.MULTICHAIN_RELAY_ENABLED) {
    errors.push("MAIVW_RUNTIME_ROLE=relayer-worker exige MULTICHAIN_RELAY_ENABLED=true");
  }
  if (config.MAIVW_RUNTIME_ROLE === "evm-indexer" && !config.REGISTRY_CONTRACT_ADDRESS) {
    errors.push("MAIVW_RUNTIME_ROLE=evm-indexer exige REGISTRY_CONTRACT_ADDRESS");
  }

  if (config.MAIVW_ENVIRONMENT === "local") {
    if (requiresPrimaryEvm && !localNetwork) {
      errors.push("MAIVW_ENVIRONMENT=local exige Anvil 31337 em anvil, localhost ou loopback");
    }
    return errors;
  }

  if (requiresPrimaryEvm && localNetwork) {
    errors.push(`MAIVW_ENVIRONMENT=${config.MAIVW_ENVIRONMENT} não pode usar Anvil local`);
  }
  if (requiresPrimaryEvm
    && (!config.REGISTRY_CONTRACT_ADDRESS || !/^0x[a-fA-F0-9]{40}$/.test(config.REGISTRY_CONTRACT_ADDRESS))) {
    errors.push("REGISTRY_CONTRACT_ADDRESS válido é obrigatório fora do Anvil local");
  }

  for (const name of ["JWT_SECRET", "MASTER_SECRET_KEY", "INTERNAL_SERVICE_KEY", "ADMIN_REGISTRATION_TOKEN"] as const) {
    const value = config[name];
    if (value && /^(local-demo-|change_me|changeme|substitua)|maivw_internal_sec_service_key_2026/i.test(value)) {
      errors.push(`${name} usa placeholder ou valor público reservado à demonstração local`);
    }
  }

  if (config.ORACLE_PRIVATE_KEY?.toLowerCase() === ANVIL_ACCOUNT_ZERO_PRIVATE_KEY) {
    errors.push("ORACLE_PRIVATE_KEY usa a conta pública #0 do Anvil");
  }
  if (config.DEPLOYER_PRIVATE_KEY?.toLowerCase() === ANVIL_ACCOUNT_ZERO_PRIVATE_KEY) {
    errors.push("DEPLOYER_PRIVATE_KEY usa a conta pública #0 do Anvil");
  }
  for (const [name, value] of [
    ["GATEWAY_PUBLIC_URL", config.GATEWAY_PUBLIC_URL],
    ["MAIVW_ORACLE_URL", ["all-in-one", "gateway-api"].includes(config.MAIVW_RUNTIME_ROLE) ? config.MAIVW_ORACLE_URL : undefined],
    ["DEFAULT_P2P_ENDPOINT", config.DEFAULT_P2P_ENDPOINT],
    ["RPC_URL", requiresPrimaryEvm ? config.RPC_URL : undefined],
    ["SOLANA_RPC_URL", config.SOLANA_RPC_URL],
  ] as const) {
    if (value && new URL(value).protocol !== "https:") {
      errors.push(`${name} deve usar HTTPS fora do ambiente local`);
    }
  }
  for (const [name, value] of [
    ["BASE_WS_URL", config.BASE_WS_URL],
    ["ARBITRUM_WS_URL", config.ARBITRUM_WS_URL],
    ["POLYGON_WS_URL", config.POLYGON_WS_URL],
    ["SOLANA_WS_URL", config.SOLANA_WS_URL],
  ] as const) {
    if (value && new URL(value).protocol !== "wss:") {
      errors.push(`${name} deve usar WSS fora do ambiente local`);
    }
  }
  for (const [registry, name, value] of [
    [config.BASE_REGISTRY_ADDRESS, "BASE_RPC_URL", config.BASE_RPC_URL],
    [config.ARBITRUM_REGISTRY_ADDRESS, "ARBITRUM_RPC_URL", config.ARBITRUM_RPC_URL],
    [config.POLYGON_REGISTRY_ADDRESS, "POLYGON_RPC_URL", config.POLYGON_RPC_URL],
  ] as const) {
    if (registry && new URL(value).protocol !== "https:") {
      errors.push(`${name} deve usar HTTPS quando seu Registry estiver configurado fora do ambiente local`);
    }
  }

  if (config.STORAGE_DRIVER === "s3") {
    if (!config.S3_BUCKET) {
      errors.push("STORAGE_DRIVER=s3 exige S3_BUCKET configurado");
    }
    if (!config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
      errors.push("STORAGE_DRIVER=s3 exige S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY");
    }
    if (config.S3_ENDPOINT && new URL(config.S3_ENDPOINT).protocol !== "https:") {
      errors.push("S3_ENDPOINT deve usar HTTPS fora do ambiente local");
    }
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
