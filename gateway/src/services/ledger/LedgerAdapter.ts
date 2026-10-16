import type { Hex } from "viem";
import type { NetworkFamily, NetworkId, RegistryId } from "../../multichain/NetworkModel.js";

export interface LedgerKeyDescriptor {
  algorithm: number;
  keyData: Hex;
}

export interface LedgerDomainIdentity {
  networkId: NetworkId;
  registryId: RegistryId;
  family: NetworkFamily;
  recordKind: "ORIGIN" | "MIRROR";
  domain: string;
  endpointUrl: string;
  operationalKey: LedgerKeyDescriptor;
  adminKey: LedgerKeyDescriptor;
  status: "ACTIVE" | "SUSPENDED" | "REVOKED";
  globalDomainEpoch: bigint;
  originSequence: bigint;
  originNetworkHash: Hex;
  originRegistryId: RegistryId;
}

export interface LedgerProviderState {
  isProvider: boolean;
  tier: number;
  /** Spendable/custodied stake on this ledger; always zero for a mirror. */
  stake: bigint;
  /** Canonical or attested stake shown by this record. */
  attestedStake: bigint;
  dailyLimit: bigint;
  strikes: number;
  suspended: boolean;
}

/** Family adapter contract used by the chain-agnostic LedgerService facade. */
export interface LedgerAdapter {
  readonly family: NetworkFamily;
  readonly networkId: NetworkId;
  readonly registryId: RegistryId;
  readDomainIdentity(domain: string): Promise<LedgerDomainIdentity | null>;
  readProviderState(domain: string): Promise<LedgerProviderState | null>;
  checkHealth(): Promise<void>;
}

export class LedgerAdapterError extends Error {
  constructor(
    readonly code: "LEDGER_ADAPTER_NOT_FOUND" | "LEDGER_ADAPTER_CONFLICT" | "LEDGER_ADAPTER_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "LedgerAdapterError";
  }
}
