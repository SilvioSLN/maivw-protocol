import { PublicKey } from "@solana/web3.js";
import { bytesToHex, keccak256, stringToHex, type Hex } from "viem";
import type { SolanaNetworkDefinition } from "./NetworkModel.js";
import type { OriginReservationService } from "./OriginReservation.js";
import {
  RegistrationKeyAlgorithm,
  RegistrationProviderTier,
  hashRegistrationPayloadV1,
} from "./RegistrationPayloadCodec.js";
import {
  buildSolanaOriginRegistrationTransaction,
  type SolanaRegistrationTransactionDraft,
} from "./SolanaOriginRegistrationBuilder.js";

export interface SolanaOriginDeployment {
  network: SolanaNetworkDefinition;
  standardFee: bigint;
}

export interface CreateOriginOnboardingChallengeInput {
  domain: string;
  requesterId: number;
  networkId: string;
  registrant: string;
}

export interface IssueSolanaOriginClaimInput {
  challengeId: string;
  requesterId: number;
  token: string;
  endpoint: string;
  registrant: string;
  registrantTokenAccount: string;
  operationalKey: string;
  adminKey: string;
  tlsFingerprint?: Hex;
  idempotencyKey: string;
  requestId: string;
}

export class OriginOnboardingError extends Error {
  constructor(
    readonly code: "ORIGIN_NETWORK_NOT_FOUND" | "ORIGIN_NETWORK_UNSUPPORTED" | "ORIGIN_KEY_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "OriginOnboardingError";
  }
}

function publicKeyBytes(value: string): Hex {
  try {
    return bytesToHex(new PublicKey(value).toBytes());
  } catch {
    throw new OriginOnboardingError("ORIGIN_KEY_MISMATCH", "Pubkey Solana inválida");
  }
}

export class OriginOnboardingCoordinator {
  private readonly deployments = new Map<string, SolanaOriginDeployment>();

  constructor(
    private readonly reservations: OriginReservationService,
    deployments: readonly SolanaOriginDeployment[],
  ) {
    for (const deployment of deployments) {
      if (!deployment.network.capabilities.origin || this.deployments.has(deployment.network.networkId)
        || deployment.standardFee < 0n) {
        throw new OriginOnboardingError("ORIGIN_NETWORK_UNSUPPORTED", "deployment Solana de origem inválido");
      }
      if (deployment.network.asset.kind !== "SPL") {
        throw new OriginOnboardingError("ORIGIN_NETWORK_UNSUPPORTED", "registro Solana exige ativo SPL configurado");
      }
      this.deployments.set(deployment.network.networkId, deployment);
    }
  }

  listOriginDeployments() {
    return [...this.deployments.values()].map(({ network, standardFee }) => ({
      family: network.family,
      networkId: network.networkId,
      registryId: network.registryId,
      name: network.name,
      programId: network.programId,
      asset: network.asset,
      standardFee: standardFee.toString(),
      standardFeeFormatted: `${formatUnits(standardFee, network.asset.decimals)} ${network.asset.symbol}`,
      explorer: network.explorer,
    }));
  }

  async createChallenge(input: CreateOriginOnboardingChallengeInput) {
    const deployment = this.deployments.get(input.networkId);
    if (!deployment) throw new OriginOnboardingError("ORIGIN_NETWORK_NOT_FOUND", "rede de origem não configurada");
    const registrantKey = publicKeyBytes(input.registrant);
    const result = await this.reservations.createDnsChallenge({
      domain: input.domain,
      requesterId: input.requesterId,
      origin: {
        family: "SOLANA",
        networkId: deployment.network.networkId,
        registryId: deployment.network.registryId,
      },
      registrant: { algorithm: "ED25519_SOLANA", key: registrantKey },
    });
    return {
      challengeId: result.challenge.id,
      network: deployment.network,
      token: result.token,
      dnsRecord: result.dnsRecord,
      expiresAt: result.challenge.expiresAt,
    };
  }

  async issueSolanaClaim(input: IssueSolanaOriginClaimInput): Promise<{
    network: SolanaNetworkDefinition;
    reservationId: string;
    domainHash: string;
    claim: { id: string; encoded: string; digest: string; signature: string; nonce: string; deadline: string };
    transaction: SolanaRegistrationTransactionDraft;
  }> {
    const reservationResult = await this.reservations.verifyDnsAndReserve({
      challengeId: input.challengeId,
      requesterId: input.requesterId,
      token: input.token,
      idempotencyKey: `${input.idempotencyKey}:reservation`,
      requestId: `${input.requestId}:reservation`,
    });
    const { reservation } = reservationResult;
    const deployment = this.deployments.get(reservation.originNetworkId);
    if (!deployment || reservation.originNetworkFamily !== "SOLANA") {
      throw new OriginOnboardingError("ORIGIN_NETWORK_NOT_FOUND", "reserva não pertence a deployment Solana configurado");
    }
    const registrant = publicKeyBytes(input.registrant);
    if (reservation.registrantKey.toLowerCase() !== registrant.toLowerCase()) {
      throw new OriginOnboardingError("ORIGIN_KEY_MISMATCH", "registrant diverge do desafio DNS");
    }
    const operationalKey = publicKeyBytes(input.operationalKey);
    const adminKey = publicKeyBytes(input.adminKey);
    const tlsFingerprint = input.tlsFingerprint ?? (`0x${"0".repeat(64)}` as Hex);
    const asset = deployment.network.asset;
    if (asset.kind !== "SPL") {
      throw new OriginOnboardingError("ORIGIN_NETWORK_UNSUPPORTED", "ativo do deployment não é SPL");
    }
    const mint = publicKeyBytes(asset.mint);
    const payloadHash = hashRegistrationPayloadV1({
      domainHash: reservation.domainHash as Hex,
      registrant,
      operationalKeyAlgorithm: RegistrationKeyAlgorithm.ED25519,
      operationalKey,
      adminKeyAlgorithm: RegistrationKeyAlgorithm.ED25519,
      adminKey,
      endpointHash: keccak256(stringToHex(input.endpoint)),
      tlsFingerprint,
      isProvider: false,
      providerTier: RegistrationProviderTier.NONE,
      payment: deployment.standardFee,
      mint,
    });
    const issued = await this.reservations.issueOriginClaim({
      reservationId: reservation.id,
      requesterId: input.requesterId,
      payloadHash,
      idempotencyKey: `${input.idempotencyKey}:claim`,
      requestId: `${input.requestId}:claim`,
    });
    const transaction = await buildSolanaOriginRegistrationTransaction({
      programId: deployment.network.programId,
      registrant: input.registrant,
      registrantTokenAccount: input.registrantTokenAccount,
      mint: asset.mint,
      domain: reservation.domain,
      domainHash: reservation.domainHash as Hex,
      endpoint: input.endpoint,
      operationalKey,
      adminKey,
      tlsFingerprint,
      claim: issued.claim,
    });
    return {
      network: deployment.network,
      reservationId: reservation.id,
      domainHash: reservation.domainHash,
      claim: {
        id: issued.claim.id,
        encoded: issued.claim.encoded, digest: issued.claim.digest, signature: issued.claim.signature,
        nonce: issued.claim.nonce, deadline: issued.claim.deadline.toISOString(),
      },
      transaction,
    };
  }
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const raw = value.toString().padStart(decimals + 1, "0");
  const integer = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}
