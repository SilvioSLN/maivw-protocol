/**
 * LedgerWriteGate.ts
 *
 * Guardiao fail-closed de operacoes de escrita em redes blockchain (AWS-049).
 * Impede categoricamente emissoes e mutacoes em mainnets que nao foram auditadas
 * ou autorizadas explicitamente pelo operador humano.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface LedgerNetworkConfig {
  id: string;
  name: string;
  category: "mainnet" | "testnet_canary" | "local_test";
  writesEnabled: boolean;
  readOnly: boolean;
  status: string;
}

export interface LedgerManifestConfig {
  version: string;
  enforceStrictSeparation: boolean;
  networks: LedgerNetworkConfig[];
}

export class LedgerWriteDisabledError extends Error {
  public code: string;
  public networkId: string;
  public status: string;

  constructor(networkId: string, networkName: string, status: string) {
    super(`MAINNET_WRITES_DISABLED: Operacoes de escrita na rede ${networkName} (${networkId}) estao desabilitadas fail-closed por politica de governanca.`);
    this.name = "LedgerWriteDisabledError";
    this.code = "MAINNET_WRITES_DISABLED";
    this.networkId = networkId;
    this.status = status;
  }
}

export class UnknownNetworkError extends Error {
  public code: string;
  public networkId: string;

  constructor(networkId: string) {
    super(`UNKNOWN_NETWORK: Rede ${networkId} nao cadastrada no manifesto de ledgers.`);
    this.name = "UnknownNetworkError";
    this.code = "UNKNOWN_NETWORK";
    this.networkId = networkId;
  }
}

export class LedgerWriteGate {
  private manifest: LedgerManifestConfig;

  constructor(manifestOrPath?: LedgerManifestConfig | string) {
    if (typeof manifestOrPath === "object" && manifestOrPath !== null) {
      this.manifest = manifestOrPath;
    } else if (typeof manifestOrPath === "string") {
      this.manifest = this.loadManifestFromPath(manifestOrPath);
    } else {
      this.manifest = this.discoverManifest();
    }
  }

  private loadManifestFromPath(filePath: string): LedgerManifestConfig {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return this.getDefaultFallbackManifest();
    }
  }

  private discoverManifest(): LedgerManifestConfig {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // Procurar em releases/production/ledger-manifest.json a partir de protocol/gateway/src/multichain
      const candidates = [
        path.resolve(__dirname, "../../../../releases/production/ledger-manifest.json"),
        path.resolve(__dirname, "../../../releases/production/ledger-manifest.json"),
        path.resolve(process.cwd(), "releases/production/ledger-manifest.json"),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          const raw = fs.readFileSync(candidate, "utf-8");
          return JSON.parse(raw);
        }
      }
    } catch {
      // Fallback para protecao estrita
    }

    return this.getDefaultFallbackManifest();
  }

  private getDefaultFallbackManifest(): LedgerManifestConfig {
    return {
      version: "1.0.0",
      enforceStrictSeparation: true,
      networks: [
        { id: "polygon", name: "Polygon PoS Mainnet", category: "mainnet", writesEnabled: false, readOnly: true, status: "DISABLED_PENDING_AUDIT_AND_FUNDING" },
        { id: "solana-mainnet", name: "Solana Mainnet-Beta", category: "mainnet", writesEnabled: false, readOnly: true, status: "DISABLED_PENDING_AUDIT_AND_FUNDING" },
        { id: "base", name: "Base Mainnet", category: "mainnet", writesEnabled: false, readOnly: true, status: "DISABLED_PENDING_AUDIT_AND_FUNDING" },
        { id: "ethereum", name: "Ethereum Mainnet", category: "mainnet", writesEnabled: false, readOnly: true, status: "DISABLED_PENDING_AUDIT_AND_FUNDING" },
        { id: "base-sepolia", name: "Base Sepolia Testnet", category: "testnet_canary", writesEnabled: true, readOnly: false, status: "ACTIVE_CANARY" },
        { id: "amoy", name: "Polygon Amoy Testnet", category: "testnet_canary", writesEnabled: true, readOnly: false, status: "ACTIVE_CANARY" },
        { id: "solana-devnet", name: "Solana Devnet", category: "testnet_canary", writesEnabled: true, readOnly: false, status: "ACTIVE_CANARY" },
        { id: "local", name: "Foundry Local", category: "local_test", writesEnabled: true, readOnly: false, status: "ACTIVE_LOCAL" },
      ],
    };
  }

  public getNetwork(networkId: string): LedgerNetworkConfig | undefined {
    const raw = String(networkId).trim().toLowerCase();
    const stripped = raw.replace(/^evm:/, "");

    // 1. Direct match on id
    let net = this.manifest.networks.find((n: any) => n.id.toLowerCase() === raw || n.id.toLowerCase() === stripped);
    if (net) return net;

    // 2. Chain ID match if numeric
    const numericChainId = Number(stripped);
    if (!Number.isNaN(numericChainId) && numericChainId > 0) {
      net = this.manifest.networks.find((n: any) => n.chainId === numericChainId);
      if (net) return net;
    }

    // 3. Known aliases
    const aliases: Record<string, string> = {
      base: "base-mainnet",
      polygon: "polygon-mainnet",
      arbitrum: "arbitrum-one",
      "arbitrum-mainnet": "arbitrum-one",
      ethereum: "ethereum-mainnet",
      solana: "solana-mainnet",
      amoy: "polygon-amoy",
    };
    if (aliases[raw] || aliases[stripped]) {
      const aliasTarget = aliases[raw] || aliases[stripped];
      net = this.manifest.networks.find((n: any) => n.id.toLowerCase() === aliasTarget);
      if (net) return net;
    }

    // 4. Local test networks (Anvil, Foundry, Hardhat)
    if (raw === "local" || stripped === "local" || stripped === "31337" || stripped === "1337" || raw === "anvil" || raw === "hardhat") {
      return {
        id: "local",
        name: "Local Testnet (Anvil)",
        category: "local_test",
        writesEnabled: true,
        readOnly: false,
        status: "ACTIVE_LOCAL",
      };
    }

    return undefined;
  }

  public isWriteAllowed(networkId: string): boolean {
    const net = this.getNetwork(networkId);
    if (!net) return false;
    return Boolean(net.writesEnabled && !net.readOnly);
  }

  public assertWriteAllowed(networkId: string, _operation?: string): void {
    const net = this.getNetwork(networkId);
    if (!net) {
      throw new UnknownNetworkError(networkId);
    }
    if (!net.writesEnabled || net.readOnly) {
      throw new LedgerWriteDisabledError(networkId, net.name, net.status);
    }
  }

  public assertCanWrite(networkId: string, operation?: string): void {
    this.assertWriteAllowed(networkId, operation);
  }

  public attemptWrite(networkId: string, _payload?: any): { success: boolean; txHash: string } {
    this.assertWriteAllowed(networkId);
    return {
      success: true,
      txHash: "0x" + "1".repeat(64),
    };
  }
}

export const defaultLedgerWriteGate = new LedgerWriteGate();
