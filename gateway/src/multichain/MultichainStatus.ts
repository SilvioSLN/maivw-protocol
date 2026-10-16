import type { LedgerDomainIdentity } from "../services/ledger/LedgerAdapter.js";
import type { LedgerService } from "../services/LedgerService.js";
import {
  catalogDomainHash,
  canonicalizeCatalogDomain,
  type OriginCatalogService,
  type OriginRecordRow,
} from "./OriginCatalog.js";

export type DeploymentProjectionStatus =
  | "IN_SYNC"
  | "MISSING_ORIGIN"
  | "MISSING_MIRROR"
  | "VERSION_BEHIND"
  | "VERSION_AHEAD"
  | "ORIGIN_CONFLICT"
  | "UNREADABLE";

export interface MultichainDomainDeploymentStatus {
  family: "EVM" | "SOLANA";
  networkId: string;
  registryId: string;
  name: string;
  role: "ORIGIN" | "MIRROR";
  projection: DeploymentProjectionStatus;
  errorCode: string | null;
  identity: null | {
    recordKind: "ORIGIN" | "MIRROR";
    status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    endpointUrl: string;
    operationalKey: { algorithm: number; keyData: string };
    adminKey: { algorithm: number; keyData: string };
    globalDomainEpoch: string;
    originSequence: string;
    originNetworkHash: string;
    originRegistryId: string;
  };
}

export interface MultichainDomainStatus {
  domain: string;
  domainHash: string;
  registered: boolean;
  origin: null | {
    family: "EVM" | "SOLANA";
    networkId: string;
    registryId: string;
    transaction: { family: "EVM" | "SOLANA"; id: string };
    globalDomainEpoch: string;
    originSequence: string;
    activatedAt: string;
    lastReconciledAt: string | null;
  };
  deployments: MultichainDomainDeploymentStatus[];
}

function compareVersion(identity: LedgerDomainIdentity, origin: OriginRecordRow): number {
  if (identity.globalDomainEpoch !== origin.globalDomainEpoch) {
    return identity.globalDomainEpoch > origin.globalDomainEpoch ? 1 : -1;
  }
  if (identity.originSequence !== origin.originSequence) {
    return identity.originSequence > origin.originSequence ? 1 : -1;
  }
  return 0;
}

function projection(
  identity: LedgerDomainIdentity | null,
  origin: OriginRecordRow,
  isOrigin: boolean,
): DeploymentProjectionStatus {
  if (!identity) return isOrigin ? "MISSING_ORIGIN" : "MISSING_MIRROR";
  if (identity.recordKind !== (isOrigin ? "ORIGIN" : "MIRROR")) return "ORIGIN_CONFLICT";
  if (identity.originNetworkHash.toLowerCase() !== origin.originNetworkHash.toLowerCase()
    || identity.originRegistryId.toLowerCase() !== origin.originRegistryId.toLowerCase()) {
    return "ORIGIN_CONFLICT";
  }
  const ordering = compareVersion(identity, origin);
  return ordering < 0 ? "VERSION_BEHIND" : ordering > 0 ? "VERSION_AHEAD" : "IN_SYNC";
}

function serializeIdentity(identity: LedgerDomainIdentity | null): MultichainDomainDeploymentStatus["identity"] {
  if (!identity) return null;
  return {
    recordKind: identity.recordKind,
    status: identity.status,
    endpointUrl: identity.endpointUrl,
    operationalKey: identity.operationalKey,
    adminKey: identity.adminKey,
    globalDomainEpoch: identity.globalDomainEpoch.toString(),
    originSequence: identity.originSequence.toString(),
    originNetworkHash: identity.originNetworkHash,
    originRegistryId: identity.originRegistryId,
  };
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error
    && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return "LEDGER_READ_FAILED";
}

/** Resolves the immutable origin in the catalog, then reads every configured deployment. */
export class MultichainStatusService {
  constructor(
    private readonly catalog: Pick<OriginCatalogService, "get">,
    private readonly ledger: Pick<LedgerService, "listAdapters">,
  ) {}

  async get(domainInput: string): Promise<MultichainDomainStatus> {
    const domain = canonicalizeCatalogDomain(domainInput);
    const domainHash = catalogDomainHash(domain);
    const origin = await this.catalog.get(domainHash);
    if (!origin) {
      return { domain, domainHash, registered: false, origin: null, deployments: [] };
    }

    const deployments = await Promise.all(this.ledger.listAdapters().map(async (adapter) => {
      const isOrigin = adapter.networkId === origin.originNetworkId
        && adapter.registryId.toLowerCase() === origin.originRegistryId.toLowerCase();
      try {
        const identity = await adapter.readDomainIdentity(domain);
        return {
          family: adapter.family,
          networkId: adapter.networkId,
          registryId: adapter.registryId,
          name: adapter.network.name,
          role: isOrigin ? "ORIGIN" as const : "MIRROR" as const,
          projection: projection(identity, origin, isOrigin),
          errorCode: null,
          identity: serializeIdentity(identity),
        };
      } catch (error) {
        return {
          family: adapter.family,
          networkId: adapter.networkId,
          registryId: adapter.registryId,
          name: adapter.network.name,
          role: isOrigin ? "ORIGIN" as const : "MIRROR" as const,
          projection: "UNREADABLE" as const,
          errorCode: errorCode(error),
          identity: null,
        };
      }
    }));

    return {
      domain,
      domainHash,
      registered: true,
      origin: {
        family: origin.originNetworkFamily,
        networkId: origin.originNetworkId,
        registryId: origin.originRegistryId,
        transaction: { family: origin.originTxFamily, id: origin.originTxId },
        globalDomainEpoch: origin.globalDomainEpoch.toString(),
        originSequence: origin.originSequence.toString(),
        activatedAt: origin.activatedAt.toISOString(),
        lastReconciledAt: origin.lastReconciledAt?.toISOString() ?? null,
      },
      deployments,
    };
  }
}
