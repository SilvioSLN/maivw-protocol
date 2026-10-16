import type { PrismaClient } from "@prisma/client";

type PrismaLike = PrismaClient | Record<string, any>;

/** Read-only projection for UI polling. Signed payloads and worker errors are never exposed. */
export class MultichainJobQuery {
  constructor(private readonly prisma: PrismaLike) {}

  async get(jobId: string) {
    const job = await (this.prisma as any).multichainRelayJob.findUnique({
      where: { id: jobId },
      include: {
        destinations: {
          orderBy: [{ destinationNetworkId: "asc" }, { destinationRegistryId: "asc" }],
          include: {
            submission: {
              select: {
                status: true, expectedTransactionId: true, attempts: true,
                submittedAt: true, confirmedAt: true, finalityReference: true,
                attemptsLog: {
                  orderBy: { createdAt: "desc" }, take: 1,
                  select: { transactionId: true, finalityRef: true, outcome: true, createdAt: true },
                },
              },
            },
          },
        },
      },
    });
    if (!job) return null;
    return {
      jobId: job.id,
      domainHash: job.domainHash,
      operation: job.operation,
      status: job.status,
      origin: {
        family: job.originNetworkFamily,
        networkId: job.originNetworkId,
        registryId: job.originRegistryId,
        transaction: { family: job.originNetworkFamily, id: job.sourceTransactionId },
      },
      globalDomainEpoch: job.globalDomainEpoch.toString(),
      originSequence: job.originSequence.toString(),
      detectedAt: job.detectedAt.toISOString(),
      finalizedAt: job.finalizedAt?.toISOString() ?? null,
      updatedAt: job.updatedAt.toISOString(),
      destinations: job.destinations.map((destination: any) => {
        const attempt = destination.submission?.attemptsLog?.[0];
        const transactionId = attempt?.transactionId ?? destination.submission?.expectedTransactionId ?? null;
        return {
          destinationId: destination.id,
          family: destination.destinationNetworkFamily,
          networkId: destination.destinationNetworkId,
          registryId: destination.destinationRegistryId,
          status: destination.status,
          attestationDigest: destination.attestationDigest,
          transaction: transactionId ? { family: destination.destinationNetworkFamily, id: transactionId } : null,
          confirmationReference: destination.confirmationReference,
          reconcileReference: destination.reconcileReference,
          submission: destination.submission ? {
            status: destination.submission.status,
            attempts: destination.submission.attempts,
            submittedAt: destination.submission.submittedAt?.toISOString() ?? null,
            confirmedAt: destination.submission.confirmedAt?.toISOString() ?? null,
            finalityReference: attempt?.finalityRef ?? destination.submission.finalityReference,
          } : null,
          updatedAt: destination.updatedAt.toISOString(),
        };
      }),
    };
  }
}
