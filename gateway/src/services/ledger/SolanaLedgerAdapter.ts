import { Connection, PublicKey } from "@solana/web3.js";
import { keccak256, stringToHex, type Hex } from "viem";
import { decodeSolanaDomainRecord, type CanonicalDomainState } from "../../multichain/FinalizedStateReader.js";
import { hashNetworkId } from "../../multichain/AttestationCodec.js";
import type { SolanaNetworkDefinition } from "../../multichain/NetworkModel.js";
import type {
  LedgerAdapter,
  LedgerDomainIdentity,
  LedgerProviderState,
} from "./LedgerAdapter.js";

export interface SolanaLedgerAccountInfo {
  contextSlot: bigint;
  owner: string;
  data: Uint8Array;
}

export interface SolanaLedgerRpc {
  getGenesisHash(): Promise<string>;
  getFinalizedSlot(): Promise<bigint>;
  getAccountInfo(address: string): Promise<SolanaLedgerAccountInfo | null>;
}

export class Web3SolanaLedgerRpc implements SolanaLedgerRpc {
  private readonly connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "finalized");
  }

  getGenesisHash(): Promise<string> {
    return this.connection.getGenesisHash();
  }

  async getFinalizedSlot(): Promise<bigint> {
    return BigInt(await this.connection.getSlot("finalized"));
  }

  async getAccountInfo(address: string): Promise<SolanaLedgerAccountInfo | null> {
    const response = await this.connection.getAccountInfoAndContext(new PublicKey(address), {
      commitment: "finalized",
    });
    if (!response.value) return null;
    return {
      contextSlot: BigInt(response.context.slot),
      owner: response.value.owner.toBase58(),
      data: response.value.data,
    };
  }
}

export class SolanaLedgerAdapterError extends Error {
  constructor(
    readonly code: "SOLANA_LEDGER_INVALID" | "SOLANA_LEDGER_RPC_DIVERGENCE",
    message: string,
  ) {
    super(message);
    this.name = "SolanaLedgerAdapterError";
  }
}

function fail(code: SolanaLedgerAdapterError["code"], message: string): never {
  throw new SolanaLedgerAdapterError(code, message);
}

function canonicalDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (!domain || domain !== value || domain.length > 253 || domain.includes(" ")) {
    fail("SOLANA_LEDGER_INVALID", "domínio não canônico");
  }
  return domain;
}

function domainHash(domain: string): Hex {
  return keccak256(stringToHex(canonicalDomain(domain)));
}

export interface SolanaDomainSnapshot {
  address: string;
  contextSlot: bigint;
  state: CanonicalDomainState;
}

/** Finalized, read-only adapter for both Solana origins and mirrors. */
export class SolanaLedgerAdapter implements LedgerAdapter {
  readonly family = "SOLANA" as const;
  readonly networkId;
  readonly registryId;
  private readonly programId: PublicKey;

  constructor(
    readonly network: SolanaNetworkDefinition,
    private readonly rpc: SolanaLedgerRpc = new Web3SolanaLedgerRpc(network.rpcUrl),
  ) {
    this.networkId = network.networkId;
    this.registryId = network.registryId;
    this.programId = new PublicKey(network.programId);
  }

  deriveDomainRecordAddress(domain: string): string {
    const hash = domainHash(domain);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("domain"), Buffer.from(hash.slice(2), "hex")],
      this.programId,
    )[0].toBase58();
  }

  async readDomainSnapshot(domain: string): Promise<SolanaDomainSnapshot | null> {
    const normalized = canonicalDomain(domain);
    const expectedHash = domainHash(normalized);
    const address = this.deriveDomainRecordAddress(normalized);
    const account = await this.rpc.getAccountInfo(address);
    if (!account) return null;
    if (account.owner !== this.programId.toBase58()) {
      fail("SOLANA_LEDGER_INVALID", "DomainRecord pertence a outro programa");
    }
    const state = decodeSolanaDomainRecord(account.data);
    if (state.domain !== normalized || state.domainHash.toLowerCase() !== expectedHash.toLowerCase()) {
      fail("SOLANA_LEDGER_INVALID", "DomainRecord não corresponde ao PDA consultado");
    }
    if (state.recordKind === "ORIGIN") {
      if (state.originFamily !== "SOLANA"
        || state.originNetworkHash.toLowerCase() !== hashNetworkId(this.networkId).toLowerCase()
        || state.originRegistry.toLowerCase() !== this.registryId.toLowerCase()) {
        fail("SOLANA_LEDGER_INVALID", "origem do DomainRecord diverge do deployment Solana");
      }
    }
    return { address, contextSlot: account.contextSlot, state };
  }

  async readDomainIdentity(domain: string): Promise<LedgerDomainIdentity | null> {
    const snapshot = await this.readDomainSnapshot(domain);
    if (!snapshot) return null;
    const { state } = snapshot;
    return {
      networkId: this.networkId,
      registryId: this.registryId,
      family: "SOLANA",
      recordKind: state.recordKind,
      domain: state.domain,
      endpointUrl: state.endpoint,
      operationalKey: { algorithm: state.operationalKey.algorithm, keyData: state.operationalKey.value },
      adminKey: { algorithm: state.adminKey.algorithm, keyData: state.adminKey.value },
      status: state.status,
      globalDomainEpoch: state.globalDomainEpoch,
      originSequence: state.originSequence,
      originNetworkHash: state.originNetworkHash,
      originRegistryId: state.originRegistry as LedgerDomainIdentity["originRegistryId"],
    };
  }

  async readProviderState(domain: string): Promise<LedgerProviderState | null> {
    const snapshot = await this.readDomainSnapshot(domain);
    if (!snapshot) return null;
    const { state } = snapshot;
    return {
      isProvider: state.isProvider,
      tier: state.providerTier,
      stake: state.recordKind === "ORIGIN" ? state.attestedStake : 0n,
      attestedStake: state.attestedStake,
      dailyLimit: state.attestedDailyLimit,
      strikes: state.strikes,
      suspended: state.status !== "ACTIVE",
    };
  }

  async checkHealth(): Promise<void> {
    const [genesisHash, slot] = await Promise.all([
      this.rpc.getGenesisHash(),
      this.rpc.getFinalizedSlot(),
    ]);
    if (genesisHash !== this.network.genesisHash) {
      fail("SOLANA_LEDGER_RPC_DIVERGENCE", "RPC respondeu por outro cluster Solana");
    }
    if (slot < 0n) fail("SOLANA_LEDGER_RPC_DIVERGENCE", "RPC retornou slot finalizado inválido");
  }
}
