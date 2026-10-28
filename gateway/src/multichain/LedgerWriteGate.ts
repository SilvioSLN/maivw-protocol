/**
 * LedgerWriteGate.ts
 *
 * Guardiao fail-closed de operacoes de escrita em redes blockchain (AWS-049).
 * Impede categoricamente emissoes e mutacoes em mainnets que nao foram auditadas
 * ou autorizadas explicitamente pelo operador humano.
 */

import fs from "node:fs";
import { DEFAULT_LEDGER_POLICY } from "./DefaultLedgerPolicy.js";

export interface LedgerNetworkConfig {
  id: string;
  name: string;
  chainId?: number;
  genesisHash?: string;
  writesEnabled: boolean;
  readOnly: boolean;
  status: string;
}

export interface LedgerManifestConfig {
  version: string;
  enforceStrictSeparation?: boolean;
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
    const configured = manifestOrPath ?? process.env.MAIVW_LEDGER_POLICY_FILE;
    const manifest = typeof configured === "string"
      ? JSON.parse(fs.readFileSync(configured, "utf8"))
      : configured ?? (process.env.MAIVW_LEDGER_POLICY_JSON ? JSON.parse(process.env.MAIVW_LEDGER_POLICY_JSON) : DEFAULT_LEDGER_POLICY);
    if (!manifest || !Array.isArray(manifest.networks) || !manifest.networks.length) throw new Error("Invalid ledger write policy");
    const identities = new Set<string>();
    for (const n of manifest.networks) {
      if (typeof n.id !== "string" || typeof n.name !== "string" || typeof n.writesEnabled !== "boolean" || typeof n.readOnly !== "boolean") throw new Error("Invalid ledger network policy");
      for (const identity of [n.id, n.chainId ? `evm:${n.chainId}` : null, n.genesisHash ? `solana:${n.genesisHash}` : null].filter(Boolean)) {
        if (identities.has(identity)) throw new Error("Duplicate ledger policy identity");
        identities.add(identity);
      }
    }
    this.manifest = structuredClone(manifest);
  }

  public getNetwork(networkId: string): LedgerNetworkConfig | undefined {
    const raw = String(networkId).trim();
    // Genesis hashes are case-sensitive. Never lowercase Solana identities.
    if (raw.startsWith("solana:")) return this.manifest.networks.find(n => `solana:${n.genesisHash}` === raw);
    const aliases: Record<string, string> = { base: "base-mainnet", polygon: "polygon-mainnet", arbitrum: "arbitrum-one", "arbitrum-mainnet": "arbitrum-one", ethereum: "ethereum-mainnet", solana: "solana-mainnet", amoy: "polygon-amoy", anvil: "local", hardhat: "local" };
    const normalized = aliases[raw.toLowerCase()] ?? raw.toLowerCase();
    return this.manifest.networks.find(n => n.id === normalized || (n.chainId !== undefined && (`evm:${n.chainId}` === normalized || String(n.chainId) === normalized)));
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


}

export const defaultLedgerWriteGate = new LedgerWriteGate();
