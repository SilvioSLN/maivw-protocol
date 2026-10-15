import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { size, type Hex } from "viem";
import {
  RegistrationKeyAlgorithm,
  RegistrationProviderTier,
  encodeRegistrationPayloadV1,
  hashRegistrationPayloadV1,
  type RegistrationPayloadV1,
} from "../src/multichain/RegistrationPayloadCodec.js";
import {
  AttestationAction,
  AttestationKind,
  encodeAttestationV1,
  hashAttestationV1,
  type AttestationV1,
} from "../src/multichain/AttestationCodec.js";

const vector = JSON.parse(readFileSync(
  new URL("../../specs/multichain/fixtures/origin-claim-v1.json", import.meta.url),
  "utf8",
)) as Record<string, any>;

function payload(): RegistrationPayloadV1 {
  return {
    domainHash: vector.domainHash,
    registrant: vector.registrant,
    operationalKeyAlgorithm: RegistrationKeyAlgorithm.ED25519,
    operationalKey: vector.operationalKey,
    adminKeyAlgorithm: RegistrationKeyAlgorithm.ED25519,
    adminKey: vector.adminKey,
    endpointHash: vector.endpointHash,
    tlsFingerprint: vector.tlsFingerprint,
    isProvider: false,
    providerTier: RegistrationProviderTier.NONE,
    payment: BigInt(vector.payment),
    mint: vector.mint,
  };
}

function claim(payloadHash: Hex): AttestationV1 {
  return {
    kind: AttestationKind.ORIGIN_CLAIM,
    action: AttestationAction.REGISTER_ORIGIN,
    domainHash: vector.domainHash,
    originNetworkHash: vector.originNetworkHash,
    originRegistry: vector.originRegistry,
    destinationNetworkHash: vector.originNetworkHash,
    destinationRegistry: vector.originRegistry,
    globalDomainEpoch: 0n,
    originSequence: 0n,
    nonce: vector.nonce,
    deadline: BigInt(vector.deadline),
    payloadHash,
    evidenceHash: vector.evidenceHash,
  };
}

test("registration payload and OriginClaim match the shared normative vector", () => {
  const encodedPayload = encodeRegistrationPayloadV1(payload());
  const payloadHash = hashRegistrationPayloadV1(payload());
  const attestation = claim(payloadHash);

  assert.equal(size(encodedPayload), 245);
  assert.equal(encodedPayload, vector.payloadEncoded);
  assert.equal(payloadHash, vector.payloadHash);
  assert.equal(encodeAttestationV1(attestation), vector.attestationEncoded);
  assert.equal(hashAttestationV1(attestation), vector.attestationDigest);
});

test("registration payload rejects ambiguous keys, provider tier and uint64 overflow", () => {
  assert.throws(
    () => encodeRegistrationPayloadV1({ ...payload(), operationalKey: `0x${"0".repeat(64)}` }),
    /must not be zero/,
  );
  assert.throws(
    () => encodeRegistrationPayloadV1({ ...payload(), isProvider: true }),
    /inconsistent/,
  );
  assert.throws(
    () => encodeRegistrationPayloadV1({ ...payload(), payment: 1n << 64n }),
    /uint64/,
  );
});
