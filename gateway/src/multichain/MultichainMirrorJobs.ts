import type { Hex } from "viem";
import type { LedgerAdapter, LedgerDomainIdentity } from "../services/ledger/LedgerAdapter.js";
import type { LedgerService } from "../services/LedgerService.js";
import type { MultichainRelayJobService, RelayOperation } from "./MultichainRelayJob.js";
import {
  canonicalizeCatalogDomain,
  catalogDomainHash,
  type OriginCatalogService,
  type OriginRecordRow,
} from "./OriginCatalog.js";

export class MirrorJobRequestError extends Error {
  constructor(
    readonly code:
      | "MIRROR_ORIGIN_NOT_FOUND"
      | "MIRROR_ORIGIN_UNAVAILABLE"
      | "MIRROR_ORIGIN_DIVERGED"
      | "MIRROR_DESTINATION_INVALID"
      | "MIRROR_OPERATION_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "MirrorJobRequestError";
  }
}

export interface MirrorJobRequest {
  domain: string;
  operation: RelayOperation;
  destinationNetworkIds?: readonly string[];
  detectedAt?: Date;
}

export interface MirrorJobRequestResult {
  jobId: string;
  created: boolean;
  status: string;
  operation: RelayOperation;
  domain: string;
  domainHash: string;
  origin: { family: "EVM" | "SOLANA"; networkId: string; registryId: string };
  globalDomainEpoch: string;
  originSequence: string;
  destinations: Array<{ family: "EVM" | "SOLANA"; networkId: string; registryId: string }>;
}

function matchingOriginAdapter(adapters: readonly LedgerAdapter[], origin: OriginRecordRow): LedgerAdapter | undefined {
  return adapters.find((adapter) => adapter.networkId === origin.originNetworkId
    && adapter.registryId.toLowerCase() === origin.originRegistryId.toLowerCase());
}

function assertOriginIdentity(identity: LedgerDomainIdentity | null, origin: OriginRecordRow): void {
  if (!identity || identity.recordKind !== "ORIGIN") {
    throw new MirrorJobRequestError("MIRROR_ORIGIN_UNAVAILABLE", "registro de origem não está disponível");
  }
  if (identity.originNetworkHash.toLowerCase() !== origin.originNetworkHash.toLowerCase()
    || identity.originRegistryId.toLowerCase() !== origin.originRegistryId.toLowerCase()
    || identity.globalDomainEpoch !== origin.globalDomainEpoch
    || identity.originSequence !== origin.originSequence) {
    throw new MirrorJobRequestError("MIRROR_ORIGIN_DIVERGED", "origem observada diverge do catálogo");
  }
}

function assertOperation(operation: RelayOperation, identity: LedgerDomainIdentity): void {
  if ((operation === "REVOKE") !== (identity.status === "REVOKED")) {
    throw new MirrorJobRequestError("MIRROR_OPERATION_INVALID", "operação não corresponde ao status da origem");
  }
}

/** Converts an authenticated mirror request into one durable origin-to-N job. */
export class MultichainMirrorJobCoordinator {
  constructor(
    private readonly catalog: Pick<OriginCatalogService, "get">,
    private readonly ledger: Pick<LedgerService, "listAdapters">,
    private readonly jobs: Pick<MultichainRelayJobService, "detect">,
  ) {}

  async request(input: MirrorJobRequest): Promise<MirrorJobRequestResult> {
    const domain = canonicalizeCatalogDomain(input.domain);
    const domainHash = catalogDomainHash(domain);
    const origin = await this.catalog.get(domainHash);
    if (!origin) throw new MirrorJobRequestError("MIRROR_ORIGIN_NOT_FOUND", "origem não encontrada no catálogo");

    const adapters = this.ledger.listAdapters();
    const originAdapter = matchingOriginAdapter(adapters, origin);
    if (!originAdapter) {
      throw new MirrorJobRequestError("MIRROR_ORIGIN_UNAVAILABLE", "adapter da origem não está configurado");
    }
    const identity = await originAdapter.readDomainIdentity(domain);
    assertOriginIdentity(identity, origin);
    assertOperation(input.operation, identity!);

    const selected = input.destinationNetworkIds?.map((value) => value.trim()).filter(Boolean);
    if (selected && new Set(selected).size !== selected.length) {
      throw new MirrorJobRequestError("MIRROR_DESTINATION_INVALID", "destinos duplicados");
    }
    const candidates = adapters.filter((adapter) => adapter !== originAdapter && adapter.network.capabilities.mirror);
    const destinations = selected
      ? selected.map((networkId) => candidates.find((adapter) => adapter.networkId === networkId))
      : candidates;
    if (destinations.length === 0 || destinations.some((adapter) => !adapter)) {
      throw new MirrorJobRequestError("MIRROR_DESTINATION_INVALID", "destino não configurado ou sem capacidade mirror");
    }
    const resolved = destinations as LedgerAdapter[];
    const sourceEventKey = [
      "catalog-v1", input.operation, origin.domainHash, origin.originNetworkId,
      origin.globalDomainEpoch.toString(), origin.originSequence.toString(),
    ].join(":");
    const result = await this.jobs.detect({
      sourceEventKey,
      domainHash: origin.domainHash as Hex,
      operation: input.operation,
      origin: {
        family: origin.originNetworkFamily,
        networkId: origin.originNetworkId,
        registryId: origin.originRegistryId as Hex,
      },
      sourceTransactionId: origin.originTxId,
      sourcePosition: `catalog:${origin.originVersion}:${origin.globalDomainEpoch}:${origin.originSequence}`,
      globalDomainEpoch: origin.globalDomainEpoch,
      originSequence: origin.originSequence,
      detectedAt: input.detectedAt ?? new Date(),
      destinations: resolved.map((adapter) => ({
        family: adapter.family, networkId: adapter.networkId, registryId: adapter.registryId,
      })),
    });
    return {
      jobId: result.job.id,
      created: result.created,
      status: result.job.status,
      operation: result.job.operation,
      domain,
      domainHash: origin.domainHash,
      origin: {
        family: origin.originNetworkFamily,
        networkId: origin.originNetworkId,
        registryId: origin.originRegistryId,
      },
      globalDomainEpoch: origin.globalDomainEpoch.toString(),
      originSequence: origin.originSequence.toString(),
      destinations: resolved.map((adapter) => ({
        family: adapter.family, networkId: adapter.networkId, registryId: adapter.registryId,
      })),
    };
  }
}
