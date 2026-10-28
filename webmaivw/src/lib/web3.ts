import { runtimePublicValue } from "@/lib/runtime-public-config";
import { encodeFunctionData, type Address } from "viem";

export interface ChainConfig {
  id: number;
  name: string;
  rpc: string;
  explorer: string;
  currency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  84532: {
    id: 84532,
    name: "Base Sepolia",
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  421614: {
    id: 421614,
    name: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  80002: {
    id: 80002,
    name: "Polygon Amoy",
    rpc: "https://rpc-amoy.polygon.technology",
    explorer: "https://amoy.polygonscan.com",
    currency: { name: "Polygon Ecosystem Token", symbol: "POL", decimals: 18 },
  },
  31337: {
    id: 31337,
    name: "Anvil Local",
    rpc: runtimePublicValue('NEXT_PUBLIC_RPC_URL') || "http://localhost:55443",
    explorer: runtimePublicValue('NEXT_PUBLIC_RPC_URL') || "http://localhost:55443",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

export const MAIVW_REGISTRY_ABI = [
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
] as const;

/**
 * Solicita conexão com a carteira EVM instalada no navegador (MetaMask, Rabby, Coinbase Wallet, etc.)
 */
export async function connectWeb3Wallet(): Promise<Address> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("Nenhuma carteira Web3 (MetaMask/Rabby) detectada no navegador.");
  }

  const ethereum = (window as any).ethereum;
  const accounts: string[] = await ethereum.request({
    method: "eth_requestAccounts",
  });

  if (!accounts || accounts.length === 0) {
    throw new Error("Nenhuma conta selecionada na carteira.");
  }

  return accounts[0] as Address;
}

/**
 * Assegura que a carteira do usuário está conectada à rede desejada (faz o switch ou adiciona a rede)
 */
export async function ensureWalletChain(targetChainId: number): Promise<void> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    return;
  }

  const ethereum = (window as any).ethereum;
  const hexChainId = `0x${targetChainId.toString(16)}`;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (switchError: any) {
    // Código 4902 indica que a rede ainda não está configurada no MetaMask
    if (
      switchError?.code === 4902 ||
      switchError?.data?.originalError?.code === 4902 ||
      switchError?.message?.includes("Unrecognized chain ID")
    ) {
      const config = SUPPORTED_CHAINS[targetChainId];
      if (config) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: hexChainId,
              chainName: config.name,
              nativeCurrency: config.currency,
              rpcUrls: [config.rpc],
              blockExplorerUrls: [config.explorer],
            },
          ],
        });
      }
    } else {
      throw switchError;
    }
  }
}

/**
 * Codifica a chamada registerCompany para transação Web3 nativa
 */
export function encodeRegisterCompanyCall(params: {
  domain: string;
  endpoint: string;
  publicKey: Address;
  adminKey?: Address;
  isProvider: boolean;
  deadline?: bigint;
  oracleProof: `0x${string}`;
}): `0x${string}` {
  const adminKey = params.adminKey || params.publicKey;
  const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400);

  return encodeFunctionData({
    abi: MAIVW_REGISTRY_ABI,
    functionName: "registerCompany",
    args: [
      params.domain,
      params.endpoint,
      params.publicKey,
      adminKey,
      params.isProvider,
      deadline,
      params.oracleProof,
    ],
  });
}

/**
 * Codifica a chamada registerMirror para transação Web3 nativa
 */
export function encodeRegisterMirrorCall(params: {
  domain: string;
  endpoint: string;
  publicKey: Address;
  adminKey?: Address;
  originChainId: bigint;
  deadline?: bigint;
  oracleProof: `0x${string}`;
}): `0x${string}` {
  const adminKey = params.adminKey || params.publicKey;
  const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400);

  return encodeFunctionData({
    abi: MAIVW_REGISTRY_ABI,
    functionName: "registerMirror",
    args: [
      params.domain,
      params.endpoint,
      params.publicKey,
      adminKey,
      params.originChainId,
      deadline,
      params.oracleProof,
    ],
  });
}

/**
 * Envia uma transação nativa via MetaMask / window.ethereum
 */
export async function sendWeb3Transaction(params: {
  from: Address;
  to: Address;
  data: `0x${string}`;
  valueWei: bigint | string;
}): Promise<`0x${string}`> {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("Nenhuma carteira Web3 detectada.");
  }

  const ethereum = (window as any).ethereum;
  const hexValue =
    typeof params.valueWei === "bigint"
      ? `0x${params.valueWei.toString(16)}`
      : `0x${BigInt(params.valueWei).toString(16)}`;

  const txHash: `0x${string}` = await ethereum.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: params.from,
        to: params.to,
        data: params.data,
        value: hexValue,
      },
    ],
  });

  return txHash;
}
