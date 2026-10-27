import { PublicKey } from "@solana/web3.js";
import { padHex, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import {
  AttestationAction,
  AttestationKind,
  hashNetworkId,
  type AttestationV1,
} from "./AttestationCodec.js";
import type { SignedAttestationV1 } from "./AttestationSigner.js";
import type { CanonicalDomainState } from "./FinalizedStateReader.js";
import {
  buildEvmMirrorTransaction,
  buildSolanaMirrorTransaction,
  type EvmMirrorTransaction,
  type MirrorOperation,
  type SolanaMirrorTransaction,
} from "./MirrorTransactionBuilders.js";
import { hashMirrorStateV2 } from "./MirrorPayloadCodec.js";
import type { MultichainRelayJobService } from "./MultichainRelayJob.js";
import type {
  RelayBroadcastAdapter,
  RelaySubmissionCoordinator,
  RelaySubmissionRow,
  RelaySubmissionGate,
} from "./RelaySubmission.js";

export interface FanoutEvmDestination {
  family: "EVM";
  destinationId: string;
  networkId: string;
  networkHash: Hex;
  mirrorRegistry: Address;
  adapter: RelayBroadcastAdapter;
}

export interface FanoutSolanaDestination {
  family: "SOLANA";
  destinationId: string;
  networkId: string;
  networkHash: Hex;
  programId: string;
  relayer: string;
  adapter: RelayBroadcastAdapter;
}

export type FanoutDestination = FanoutEvmDestination | FanoutSolanaDestination;

export interface FanoutAttestationSigner {
  signAttestation(
    attestation: AttestationV1,
    context: { purpose: "STATE_ATTESTATION"; operationId: string },
  ): Promise<SignedAttestationV1>;
}

export interface PreparedRelayTransactionSigner {
  sign(input: {
    family: "EVM";
    networkId: string;
    transaction: EvmMirrorTransaction;
  } | {
    family: "SOLANA";
    networkId: string;
    transaction: SolanaMirrorTransaction;
  }): Promise<{ signedPayload: string; transactionId: string }>;
}

export interface RelayFanoutInput {
  jobId: string;
  operation: MirrorOperation;
  state: CanonicalDomainState;
  attestationDeadline: bigint;
  destinations: readonly FanoutDestination[];
  workerId: string;
  now?: Date;
}

export interface FanoutDestinationResult {
  destinationId: string;
  family: "EVM" | "SOLANA";
  networkId: string;
  status: "SUBMITTED" | "REUSED" | "FAILED";
  transactionId?: string;
  error?: string;
}

function action(operation: MirrorOperation): AttestationAction {
  return operation === "REGISTER" ? AttestationAction.REGISTER_MIRROR
    : operation === "SYNC" ? AttestationAction.SYNC_MIRROR : AttestationAction.REVOKE_MIRROR;
}

function registryBytes(destination: FanoutDestination): Hex {
  if (destination.family === "EVM") return padHex(destination.mirrorRegistry, { size: 32 });
  return toHex(new PublicKey(destination.programId).toBytes());
}

function nonce(jobId: string, destination: FanoutDestination): Hex {
  return keccak256(stringToHex(
    `MAIVW_RELAY_NONCE_V1\u0000${jobId}\u0000${destination.networkId}\u0000${registryBytes(destination)}`,
  ));
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, " ").slice(0, 1_000);
}

type JobBoundary = Pick<MultichainRelayJobService, "advanceDestination">;
type SubmissionBoundary = Pick<RelaySubmissionCoordinator, "getByDestination" | "prepare" | "submit">;

/**
 * Projects one finalized origin state to all configured destinations. Each
 * branch contains its own error boundary, so one unavailable chain never
 * prevents preparation/submission to another.
 */
export class RelayFanoutService {
  constructor(
    private readonly jobs: JobBoundary,
    private readonly submissions: SubmissionBoundary,
    private readonly attestationSigner: FanoutAttestationSigner,
    private readonly transactionSigner: PreparedRelayTransactionSigner,
    private readonly gate?: RelaySubmissionGate,
  ) {}

  async execute(input: RelayFanoutInput): Promise<FanoutDestinationResult[]> {
    if (!input.jobId.trim() || !input.workerId.trim() || input.destinations.length === 0) {
      throw new Error("fan-out requires job, worker and at least one destination");
    }
    if (input.state.recordKind !== "ORIGIN") throw new Error("fan-out source must be an origin state");
    const keys = input.destinations.map((destination) =>
      `${destination.networkId}:${registryBytes(destination).toLowerCase()}`);
    if (new Set(keys).size !== keys.length) throw new Error("fan-out destinations must be unique");
    for (const destination of input.destinations) {
      const prefix = destination.family === "EVM" ? "evm:" : "solana:";
      if (!destination.networkId.startsWith(prefix)
        || hashNetworkId(destination.networkId).toLowerCase() !== destination.networkHash.toLowerCase()) {
        throw new Error("fan-out destination family/network hash mismatch");
      }
    }
    const now = input.now ?? new Date();
    const nowSeconds = BigInt(Math.floor(now.getTime() / 1_000));
    if (input.attestationDeadline <= nowSeconds) throw new Error("fan-out attestation deadline has expired");

    return Promise.all(input.destinations.map(async (destination): Promise<FanoutDestinationResult> => {
      try {
        // Check before signing/advancing ATTESTED as well as at submission time.
        await this.gate?.assertAllowed(destination.destinationId);
        const existing = await this.submissions.getByDestination(destination.destinationId);
        if (existing) return this.submitExisting(existing, destination, input.workerId, now);

        const attestation: AttestationV1 = {
          kind: AttestationKind.STATE_ATTESTATION,
          action: action(input.operation),
          domainHash: input.state.domainHash,
          originNetworkHash: input.state.originNetworkHash,
          originRegistry: input.state.originRegistry,
          destinationNetworkHash: destination.networkHash,
          destinationRegistry: registryBytes(destination),
          globalDomainEpoch: input.state.globalDomainEpoch,
          originSequence: input.state.originSequence,
          nonce: nonce(input.jobId, destination),
          deadline: input.attestationDeadline,
          payloadHash: hashMirrorStateV2(input.state),
          evidenceHash: input.state.originTransaction,
        };
        const signed = await this.attestationSigner.signAttestation(attestation, {
          purpose: "STATE_ATTESTATION",
          operationId: `${input.jobId}:${destination.destinationId}`,
        });
        const built = destination.family === "EVM"
          ? await buildEvmMirrorTransaction({
            operation: input.operation,
            state: input.state,
            destinationNetworkHash: destination.networkHash,
            mirrorRegistry: destination.mirrorRegistry,
            now: nowSeconds,
            attestation,
            signature: signed.signature,
            expectedSigner: signed.signerAddress,
          })
          : await buildSolanaMirrorTransaction({
            operation: input.operation,
            state: input.state,
            destinationNetworkHash: destination.networkHash,
            programId: destination.programId,
            relayer: destination.relayer,
            now: nowSeconds,
            attestation,
            signature: signed.signature,
            expectedSigner: signed.signerAddress,
          });
        const prepared = destination.family === "EVM"
          ? await this.transactionSigner.sign({
            family: "EVM", networkId: destination.networkId, transaction: built as EvmMirrorTransaction,
          })
          : await this.transactionSigner.sign({
            family: "SOLANA", networkId: destination.networkId, transaction: built as SolanaMirrorTransaction,
          });
        await this.jobs.advanceDestination({
          destinationId: destination.destinationId,
          toStatus: "ATTESTED",
          artifactHash: signed.digest,
        });
        const deadlineMillis = input.attestationDeadline * 1_000n;
        if (deadlineMillis > 8_640_000_000_000_000n) {
          throw new Error("fan-out deadline cannot be represented as a durable timestamp");
        }
        const submission = await this.submissions.prepare({
          destinationId: destination.destinationId,
          idempotencyKey: `${input.jobId}:${destination.destinationId}:${signed.digest}`,
          signedPayload: prepared.signedPayload,
          expectedTransactionId: prepared.transactionId,
          deadline: new Date(Number(deadlineMillis)),
          now,
        });
        const result = await this.submissions.submit(
          submission.submission.id,
          input.workerId,
          destination.adapter,
          now,
        );
        return {
          destinationId: destination.destinationId,
          family: destination.family,
          networkId: destination.networkId,
          status: result.broadcast ? "SUBMITTED" : "REUSED",
          transactionId: result.transactionId,
        };
      } catch (error) {
        return {
          destinationId: destination.destinationId,
          family: destination.family,
          networkId: destination.networkId,
          status: "FAILED",
          error: errorMessage(error),
        };
      }
    }));
  }

  private async submitExisting(
    submission: RelaySubmissionRow,
    destination: FanoutDestination,
    workerId: string,
    now: Date,
  ): Promise<FanoutDestinationResult> {
    const result = await this.submissions.submit(submission.id, workerId, destination.adapter, now);
    return {
      destinationId: destination.destinationId,
      family: destination.family,
      networkId: destination.networkId,
      status: result.broadcast ? "SUBMITTED" : "REUSED",
      transactionId: result.transactionId,
    };
  }
}
