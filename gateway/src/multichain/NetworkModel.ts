import { PublicKey } from "@solana/web3.js";
import {
  bytesToHex,
  getAddress,
  isAddress,
  padHex,
  type Address,
  type Hex,
} from "viem";
import { hashNetworkId } from "./AttestationCodec.js";

declare const networkIdBrand: unique symbol;
declare const registryIdBrand: unique symbol;

export type NetworkFamily = "EVM" | "SOLANA";
export type NetworkId<F extends NetworkFamily = NetworkFamily> = string & {
  readonly [networkIdBrand]: F;
};
export type RegistryId = Hex & { readonly [registryIdBrand]: true };

export interface NetworkCapabilities {
  origin: boolean;
  mirror: boolean;
}

export interface EvmExplorer {
  family: "EVM";
  baseUrl: string;
  transactionPath: "/tx/{id}";
  addressPath: "/address/{id}";
  blockPath: "/block/{id}";
}

export interface SolanaExplorer {
  family: "SOLANA";
  baseUrl: string;
  clusterQuery: string | null;
  transactionPath: "/tx/{id}";
  addressPath: "/address/{id}";
  blockPath: "/block/{id}";
}

export type NetworkExplorer = EvmExplorer | SolanaExplorer;

export interface EvmFinalityPolicy {
  family: "EVM";
  mode: "CONFIRMATIONS";
  confirmations: number;
  reorgMarginBlocks: number;
}

export interface SolanaFinalityPolicy {
  family: "SOLANA";
  mode: "COMMITMENT";
  commitment: "finalized";
  reorgMarginSlots: number;
}

export type NetworkFinalityPolicy = EvmFinalityPolicy | SolanaFinalityPolicy;

export type EvmSettlementAsset =
  | { family: "EVM"; kind: "NATIVE"; symbol: string; decimals: number; address: null }
  | { family: "EVM"; kind: "ERC20"; symbol: string; decimals: number; address: Address };

export type SolanaSettlementAsset =
  | { family: "SOLANA"; kind: "NATIVE"; symbol: "SOL"; decimals: 9; mint: null }
  | { family: "SOLANA"; kind: "SPL"; symbol: string; decimals: number; mint: string };

export type NetworkSettlementAsset = EvmSettlementAsset | SolanaSettlementAsset;
export type EvmSettlementAssetInput =
  | { kind: "NATIVE"; symbol: string; decimals: number; address: null }
  | { kind: "ERC20"; symbol: string; decimals: number; address: Address };
export type SolanaSettlementAssetInput =
  | { kind: "NATIVE"; symbol: "SOL"; decimals: 9; mint: null }
  | { kind: "SPL"; symbol: string; decimals: number; mint: string };

interface NetworkDefinitionBase<F extends NetworkFamily> {
  family: F;
  networkId: NetworkId<F>;
  name: string;
  rpcUrl: string;
  registryId: RegistryId;
  registryVersion: number;
  explorer: F extends "EVM" ? EvmExplorer : SolanaExplorer;
  asset: F extends "EVM" ? EvmSettlementAsset : SolanaSettlementAsset;
  finality: F extends "EVM" ? EvmFinalityPolicy : SolanaFinalityPolicy;
  capabilities: NetworkCapabilities;
}

export interface EvmNetworkDefinition extends NetworkDefinitionBase<"EVM"> {
  chainId: number;
  registryAddress: Address;
}

export interface SolanaNetworkDefinition extends NetworkDefinitionBase<"SOLANA"> {
  genesisHash: string;
  programId: string;
}

export type NetworkDefinition = EvmNetworkDefinition | SolanaNetworkDefinition;

export class NetworkModelError extends Error {
  constructor(
    readonly code: "INVALID_NETWORK" | "NETWORK_CONFLICT" | "NETWORK_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "NetworkModelError";
  }
}

function fail(code: NetworkModelError["code"], message: string): never {
  throw new NetworkModelError(code, message);
}

function cleanText(name: string, value: string, max = 256): string {
  const normalized = value.trim().replace(/[\r\n\t]+/g, " ");
  if (!normalized || normalized.length > max) fail("INVALID_NETWORK", `${name} inválido`);
  return normalized;
}

function positiveInteger(name: string, value: number, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    fail("INVALID_NETWORK", `${name} inválido`);
  }
  return value;
}

function url(name: string, value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return fail("INVALID_NETWORK", `${name} inválida`);
  }
}

function base58PublicKey(name: string, value: string): string {
  const normalized = cleanText(name, value, 64);
  try {
    return new PublicKey(normalized).toBase58();
  } catch {
    return fail("INVALID_NETWORK", `${name} inválido`);
  }
}

function assetSymbol(value: string): string {
  const normalized = cleanText("asset.symbol", value, 16).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(normalized)) fail("INVALID_NETWORK", "asset.symbol inválido");
  return normalized;
}

function assetDecimals(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 30) fail("INVALID_NETWORK", "asset.decimals inválido");
  return value;
}

export function parseNetworkId<F extends NetworkFamily>(family: F, value: string): NetworkId<F> {
  const normalized = cleanText("networkId", value);
  try {
    hashNetworkId(normalized);
  } catch {
    return fail("INVALID_NETWORK", "networkId não é canônico");
  }
  const prefix = family === "EVM" ? "evm:" : "solana:";
  if (!normalized.startsWith(prefix)) fail("INVALID_NETWORK", "family e networkId divergem");
  return normalized as NetworkId<F>;
}

export function parseRegistryId(value: string): RegistryId {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    fail("INVALID_NETWORK", "registryId deve conter 32 bytes não-zero");
  }
  return value.toLowerCase() as RegistryId;
}

export function evmRegistryId(address: Address): RegistryId {
  if (!isAddress(address)) fail("INVALID_NETWORK", "registryAddress EVM inválido");
  return parseRegistryId(padHex(getAddress(address), { size: 32 }));
}

export function solanaRegistryId(programId: string): RegistryId {
  const key = new PublicKey(base58PublicKey("programId", programId));
  return parseRegistryId(bytesToHex(key.toBytes()));
}

export function defineEvmNetwork(input: {
  chainId: number;
  name: string;
  rpcUrl: string;
  registryAddress: Address;
  registryVersion?: number;
  explorerUrl: string;
  asset: EvmSettlementAssetInput;
  finality: Omit<EvmFinalityPolicy, "family" | "mode">;
  capabilities: NetworkCapabilities;
}): EvmNetworkDefinition {
  const chainId = positiveInteger("chainId", input.chainId);
  if (!isAddress(input.registryAddress)) fail("INVALID_NETWORK", "registryAddress EVM inválido");
  const asset = input.asset.kind === "NATIVE"
    ? {
        family: "EVM" as const, kind: "NATIVE" as const,
        symbol: assetSymbol(input.asset.symbol), decimals: assetDecimals(input.asset.decimals), address: null,
      }
    : {
        family: "EVM" as const, kind: "ERC20" as const,
        symbol: assetSymbol(input.asset.symbol), decimals: assetDecimals(input.asset.decimals),
        address: getAddress(input.asset.address),
      };
  const network: EvmNetworkDefinition = {
    family: "EVM",
    networkId: parseNetworkId("EVM", `evm:${chainId}`),
    chainId,
    name: cleanText("name", input.name),
    rpcUrl: url("rpcUrl", input.rpcUrl),
    registryId: evmRegistryId(input.registryAddress),
    registryAddress: getAddress(input.registryAddress),
    registryVersion: positiveInteger("registryVersion", input.registryVersion ?? 1),
    explorer: {
      family: "EVM", baseUrl: url("explorerUrl", input.explorerUrl),
      transactionPath: "/tx/{id}", addressPath: "/address/{id}", blockPath: "/block/{id}",
    },
    asset,
    finality: {
      family: "EVM", mode: "CONFIRMATIONS",
      confirmations: positiveInteger("finality.confirmations", input.finality.confirmations),
      reorgMarginBlocks: positiveInteger("finality.reorgMarginBlocks", input.finality.reorgMarginBlocks, true),
    },
    capabilities: { origin: Boolean(input.capabilities.origin), mirror: Boolean(input.capabilities.mirror) },
  };
  return Object.freeze(network);
}

export function defineSolanaNetwork(input: {
  genesisHash: string;
  name: string;
  rpcUrl: string;
  programId: string;
  registryVersion?: number;
  explorerUrl: string;
  explorerClusterQuery?: string | null;
  asset: SolanaSettlementAssetInput;
  finality: Omit<SolanaFinalityPolicy, "family" | "mode" | "commitment">;
  capabilities: NetworkCapabilities;
}): SolanaNetworkDefinition {
  const genesisHash = base58PublicKey("genesisHash", input.genesisHash);
  const programId = base58PublicKey("programId", input.programId);
  const asset = input.asset.kind === "NATIVE"
    ? { family: "SOLANA" as const, kind: "NATIVE" as const, symbol: "SOL" as const, decimals: 9 as const, mint: null }
    : {
        family: "SOLANA" as const, kind: "SPL" as const,
        symbol: assetSymbol(input.asset.symbol), decimals: assetDecimals(input.asset.decimals),
        mint: base58PublicKey("asset.mint", input.asset.mint),
      };
  const network: SolanaNetworkDefinition = {
    family: "SOLANA",
    networkId: parseNetworkId("SOLANA", `solana:${genesisHash}`),
    genesisHash,
    name: cleanText("name", input.name),
    rpcUrl: url("rpcUrl", input.rpcUrl),
    registryId: solanaRegistryId(programId),
    programId,
    registryVersion: positiveInteger("registryVersion", input.registryVersion ?? 1),
    explorer: {
      family: "SOLANA", baseUrl: url("explorerUrl", input.explorerUrl),
      clusterQuery: input.explorerClusterQuery ? cleanText("explorerClusterQuery", input.explorerClusterQuery) : null,
      transactionPath: "/tx/{id}", addressPath: "/address/{id}", blockPath: "/block/{id}",
    },
    asset,
    finality: {
      family: "SOLANA", mode: "COMMITMENT", commitment: "finalized",
      reorgMarginSlots: positiveInteger("finality.reorgMarginSlots", input.finality.reorgMarginSlots, true),
    },
    capabilities: { origin: Boolean(input.capabilities.origin), mirror: Boolean(input.capabilities.mirror) },
  };
  return Object.freeze(network);
}

export class NetworkCatalog {
  private readonly byId = new Map<string, NetworkDefinition>();
  private readonly byRegistry = new Map<string, NetworkDefinition>();

  constructor(networks: readonly NetworkDefinition[]) {
    if (networks.length === 0) fail("INVALID_NETWORK", "catálogo de redes vazio");
    for (const network of networks) {
      if (this.byId.has(network.networkId) || this.byRegistry.has(network.registryId)) {
        fail("NETWORK_CONFLICT", `rede ou registry duplicado: ${network.networkId}`);
      }
      this.byId.set(network.networkId, network);
      this.byRegistry.set(network.registryId, network);
    }
  }

  list(): readonly NetworkDefinition[] {
    return [...this.byId.values()];
  }

  get(networkId: string): NetworkDefinition | null {
    return this.byId.get(networkId) ?? null;
  }

  require(networkId: string): NetworkDefinition {
    const network = this.get(networkId);
    if (!network) fail("NETWORK_NOT_FOUND", `rede não suportada: ${networkId}`);
    return network;
  }

  getByRegistry(registryId: string): NetworkDefinition | null {
    return this.byRegistry.get(registryId.toLowerCase()) ?? null;
  }
}

export function explorerReferenceUrl(
  network: NetworkDefinition,
  kind: "transaction" | "address" | "block",
  reference: string | bigint,
): string {
  const id = encodeURIComponent(String(reference));
  const path = kind === "transaction"
    ? network.explorer.transactionPath
    : kind === "address" ? network.explorer.addressPath : network.explorer.blockPath;
  const query = network.family === "SOLANA" && network.explorer.clusterQuery
    ? `?${network.explorer.clusterQuery}` : "";
  return `${network.explorer.baseUrl}${path.replace("{id}", id)}${query}`;
}
