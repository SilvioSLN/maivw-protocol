import type { PrismaClient } from "@prisma/client";

export type TimelineStage = "REGISTRATION" | "FINALITY" | "ATTESTATION" | "FAN_OUT" | "CONFIRMATION" | "RECONCILIATION";

type PrismaLike = PrismaClient | Record<string, any>;

function transaction(family: "EVM" | "SOLANA", id: string | null | undefined) {
  return id ? { family, id } : null;
}

/** Builds a stable, secret-free audit timeline from persisted pipeline evidence. */
export class MultichainTimelineService {
  constructor(private readonly prisma: PrismaLike) {}

  async get(domainHash: string) {
    const [origin, jobs, reconciliations] = await Promise.all([
      (this.prisma as any).originRecord.findUnique({ where: { domainHash } }),
      (this.prisma as any).multichainRelayJob.findMany({
        where: { domainHash }, orderBy: { detectedAt: "asc" },
        include: {
          destinations: { select: { id: true, destinationNetworkFamily: true, destinationNetworkId: true, status: true } },
          transitions: { orderBy: { createdAt: "asc" } },
        },
      }),
      (this.prisma as any).multichainReconciliationRun.findMany({
        where: { domainHash }, orderBy: { completedAt: "asc" },
        select: { id: true, status: true, completedAt: true, auditHash: true, findings: { select: { id: true } } },
      }),
    ]);
    const entries: any[] = [];
    if (origin) entries.push({
      id: `origin:${origin.id}`, stage: "REGISTRATION" as TimelineStage, status: origin.status,
      title: "Origem registrada", occurredAt: origin.activatedAt.toISOString(),
      network: { family: origin.originNetworkFamily, networkId: origin.originNetworkId },
      transaction: transaction(origin.originTxFamily, origin.originTxId),
      details: { globalDomainEpoch: origin.globalDomainEpoch.toString(), originSequence: origin.originSequence.toString() },
    });
    for (const job of jobs) {
      entries.push({
        id: `fanout:${job.id}`, stage: "FAN_OUT" as TimelineStage, status: job.status,
        title: `Fan-out para ${job.destinations.length} destino(s)`, occurredAt: job.detectedAt.toISOString(),
        jobId: job.id, network: { family: job.originNetworkFamily, networkId: job.originNetworkId },
        transaction: transaction(job.originNetworkFamily, job.sourceTransactionId),
        details: { operation: job.operation, destinations: job.destinations.map((item: any) => ({ family: item.destinationNetworkFamily, networkId: item.destinationNetworkId, status: item.status })) },
      });
      for (const transition of job.transitions) {
        const stage = ({ FINALIZED: "FINALITY", ATTESTED: "ATTESTATION", CONFIRMED: "CONFIRMATION", RECONCILE: "RECONCILIATION" } as Record<string, TimelineStage>)[transition.toStatus];
        if (!stage) continue;
        const destination = job.destinations.find((item: any) => item.id === transition.destinationId);
        entries.push({
          id: `transition:${transition.id}`, stage, status: transition.toStatus,
          title: stage === "FINALITY" ? "Origem atingiu finalidade" : stage === "ATTESTATION" ? "Atestado emitido" : stage === "CONFIRMATION" ? "Mirror confirmado" : "Mirror reconciliado",
          occurredAt: transition.createdAt.toISOString(), jobId: job.id,
          network: destination ? { family: destination.destinationNetworkFamily, networkId: destination.destinationNetworkId } : { family: job.originNetworkFamily, networkId: job.originNetworkId },
          transaction: stage === "CONFIRMATION"
            ? transaction(destination?.destinationNetworkFamily ?? job.originNetworkFamily, transition.reference)
            : null,
          details: { artifactHash: transition.artifactHash, reason: transition.reason },
        });
      }
    }
    for (const run of reconciliations) entries.push({
      id: `reconciliation:${run.id}`, stage: "RECONCILIATION" as TimelineStage, status: run.status,
      title: "Reconciliação N×N concluída", occurredAt: run.completedAt.toISOString(),
      network: null, transaction: null,
      details: { auditHash: run.auditHash, findings: run.findings.length },
    });
    entries.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id));
    return { domainHash, entries };
  }
}
