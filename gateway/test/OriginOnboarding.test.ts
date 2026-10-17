import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, type Hex } from "viem";
import { defineSolanaNetwork } from "../src/multichain/NetworkModel.js";
import { OriginOnboardingCoordinator } from "../src/multichain/OriginOnboarding.js";
import {
  AttestationAction,
  AttestationKind,
  encodeAttestationV1,
  hashAttestationV1,
  hashNetworkId,
} from "../src/multichain/AttestationCodec.js";
import { onboardingRoutes } from "../src/routes/onboarding.js";

const SECRET = "origin-onboarding-test-jwt-secret";
process.env.JWT_SECRET = SECRET;
const PROGRAM = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const GENESIS = "11111111111111111111111111111111";
const REGISTRANT = "7gP5KaqYCqDBvPKM6xqRpPs2sLMgDqQf9YnB3k9fV2sX";
const DOMAIN = "solana-origin.example";
const DOMAIN_HASH = keccak256(stringToHex(DOMAIN));
const network = defineSolanaNetwork({
  genesisHash: GENESIS, name: "Solana Local", rpcUrl: "http://localhost:8899",
  programId: PROGRAM, explorerUrl: "https://explorer.solana.com",
  asset: { kind: "SPL", symbol: "MAIV", decimals: 6, mint: PROGRAM },
  finality: { reorgMarginSlots: 64 }, capabilities: { origin: true, mirror: true },
});

test("coordinator binds Solana choice into DNS challenge, OriginClaim and transaction draft", async () => {
  const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
  let capturedPayloadHash: Hex | undefined;
  const reservation = {
    id: "reservation-1", domainHash: DOMAIN_HASH, domain: DOMAIN,
    originNetworkFamily: "SOLANA", originNetworkId: network.networkId,
    originRegistryId: network.registryId, registrantKey: `0x${Buffer.from(new (await import("@solana/web3.js")).PublicKey(REGISTRANT).toBytes()).toString("hex")}`,
    nonce: `0x${"77".repeat(32)}`,
  };
  const reservations = {
    async createDnsChallenge() {
      return {
        challenge: { id: "11111111-1111-4111-8111-111111111111", expiresAt: new Date("2026-10-16T18:00:00Z") },
        token: "challenge-token-value-with-enough-entropy",
        dnsRecord: { host: `_maivw-verify.${DOMAIN}`, value: "maivw-origin-v1=proof" },
      };
    },
    async verifyDnsAndReserve() { return { reservation, created: true }; },
    async issueOriginClaim(input: any) {
      capturedPayloadHash = input.payloadHash;
      const attestation = {
        kind: AttestationKind.ORIGIN_CLAIM,
        action: AttestationAction.REGISTER_ORIGIN,
        domainHash: DOMAIN_HASH,
        originNetworkHash: hashNetworkId(network.networkId),
        originRegistry: network.registryId,
        destinationNetworkHash: hashNetworkId(network.networkId),
        destinationRegistry: network.registryId,
        globalDomainEpoch: 0n, originSequence: 0n,
        nonce: reservation.nonce as Hex,
        deadline: 2_000_000_000n,
        payloadHash: input.payloadHash,
        evidenceHash: `0x${"88".repeat(32)}` as Hex,
      };
      const digest = hashAttestationV1(attestation);
      const encoded = encodeAttestationV1(attestation);
      return {
        reservation,
        created: true,
        claim: {
          id: "claim-1", reservationId: reservation.id, domainHash: DOMAIN_HASH,
          codecVersion: 1, encoded, digest, signedBytesHash: digest,
          signature: await signer.sign({ hash: digest }), signerKeyId: "test", signerKeyVersion: "1",
          nonce: reservation.nonce, deadline: new Date("2033-05-18T03:33:20Z"),
          payloadHash: input.payloadHash, evidenceHash: attestation.evidenceHash,
          idempotencyKeyHash: "hash", requestHash: "hash", status: "ISSUED",
          submittedAt: null, consumedAt: null, onChainTxFamily: null, onChainTxId: null,
          createdAt: new Date(), updatedAt: new Date(),
        },
      };
    },
  };
  const coordinator = new OriginOnboardingCoordinator(reservations as any, [{ network, standardFee: 1_000n }]);
  assert.deepEqual(coordinator.listOriginDeployments()[0], {
    family: "SOLANA", networkId: network.networkId, registryId: network.registryId,
    name: "Solana Local", programId: PROGRAM, asset: network.asset,
    standardFee: "1000", standardFeeFormatted: "0.001 MAIV", explorer: network.explorer,
  });
  const challenge = await coordinator.createChallenge({
    domain: DOMAIN, requesterId: 1, networkId: network.networkId, registrant: REGISTRANT,
  });
  assert.equal(challenge.network.networkId, network.networkId);
  const result = await coordinator.issueSolanaClaim({
    challengeId: challenge.challengeId, requesterId: 1, token: challenge.token,
    endpoint: "https://mail.example.com/inbox", registrant: REGISTRANT,
    registrantTokenAccount: REGISTRANT, operationalKey: REGISTRANT, adminKey: REGISTRANT,
    idempotencyKey: "onboarding-idempotency", requestId: "onboarding-request",
  });
  assert.match(capturedPayloadHash!, /^0x[0-9a-f]{64}$/);
  assert.equal(result.transaction.family, "SOLANA");
  assert.equal(result.transaction.instructions.length, 2);
  assert.equal(result.transaction.instructions[0].programId, "KeccakSecp256k11111111111111111111111111111");
  assert.equal(result.transaction.instructions[1].programId, PROGRAM);
  assert.deepEqual(result.transaction.requiredSigners, [REGISTRANT]);
  const verifyData = Buffer.from(result.transaction.instructions[0].dataBase64, "base64");
  const programData = Buffer.from(result.transaction.instructions[1].dataBase64, "base64");
  const messageOffset = verifyData.readUInt16LE(7);
  const messageSize = verifyData.readUInt16LE(9);
  assert.equal(verifyData[11], 1);
  assert.equal(verifyData.length, 97);
  assert.deepEqual(
    programData.subarray(messageOffset, messageOffset + messageSize),
    Buffer.from(result.claim.encoded.slice(2), "hex"),
  );
});

test("onboarding API accepts a Solana origin selection and returns family-specific proof/transaction", async () => {
  const app = Fastify();
  const user = { id: 1, email: "admin@example.com", role: "admin" };
  const originOnboarding = {
    listOriginDeployments() {
      return [{ family: "SOLANA", networkId: network.networkId, name: network.name, standardFee: "1000", standardFeeFormatted: "0.001 MAIV", asset: network.asset }];
    },
    async createChallenge() {
      return {
        challengeId: "11111111-1111-4111-8111-111111111111", token: "t".repeat(43), network,
        dnsRecord: { host: `_maivw-verify.${DOMAIN}`, value: "maivw-origin-v1=proof" },
        expiresAt: new Date("2026-10-16T18:00:00Z"),
      };
    },
    async issueSolanaClaim() {
      return {
        network, reservationId: "reservation-1",
        claim: { encoded: "0x01", digest: `0x${"11".repeat(32)}`, signature: `0x${"22".repeat(65)}`, nonce: `0x${"33".repeat(32)}`, deadline: "2030-01-01T00:00:00.000Z" },
        transaction: { family: "SOLANA", feePayer: REGISTRANT, requiredSigners: [REGISTRANT], instructions: [], accounts: {}, claimDigest: `0x${"11".repeat(32)}`, deadline: "2030-01-01T00:00:00.000Z" },
      };
    },
  };
  await app.register(onboardingRoutes, {
    prisma: {
      user: { findUnique: async () => user },
      domain: { findUnique: async () => null },
    } as any,
    kms: {} as any, oracle: { getOracleAddress: () => null } as any,
    ledger: { readDomainIdentity: async () => null } as any,
    originOnboarding: originOnboarding as any,
    config: {
      JWT_SECRET: SECRET, CHAIN_ID: 31337, RPC_URL: "http://anvil:8545",
      MAIVW_CORE_DOMAIN: "maivw.org", DEFAULT_P2P_ENDPOINT: "http://gateway:3001/inbox",
    } as any,
  });
  const authorization = `Bearer ${jwt.sign(user, SECRET)}`;
  const networks = await app.inject({
    method: "GET", url: "/api/v1/onboarding/origin-networks", headers: { authorization },
  });
  assert.equal(networks.statusCode, 200);
  assert.equal(networks.json().networks[0].standardFeeFormatted, "0.001 MAIV");
  const challenge = await app.inject({
    method: "POST", url: "/api/v1/onboarding/challenge", headers: { authorization },
    payload: { domainName: DOMAIN, networkId: network.networkId, registrant: REGISTRANT },
  });
  assert.equal(challenge.statusCode, 200);
  assert.equal(challenge.json().origin.family, "SOLANA");
  const claim = await app.inject({
    method: "POST", url: "/api/v1/onboarding/origin-claim", headers: { authorization },
    payload: {
      challengeId: "11111111-1111-4111-8111-111111111111", token: "t".repeat(43),
      endpointUrl: "http://gateway:3001/inbox", registrant: REGISTRANT,
      registrantTokenAccount: REGISTRANT, operationalKey: REGISTRANT, adminKey: REGISTRANT,
      idempotencyKey: "idempotency-1", requestId: "request-1",
      executionMode: "RELAYER",
    },
  });
  assert.equal(claim.statusCode, 200);
  assert.equal(claim.json().origin.networkId, network.networkId);
  assert.equal(claim.json().transaction.family, "SOLANA");
  assert.equal(claim.json().execution.relayerPaysNetworkFee, true);
  await app.close();
});
