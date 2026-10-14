import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256, size, stringToHex, type Hex } from "viem";
import {
  ATTESTATION_MAGIC,
  ATTESTATION_V1_SIZE,
  AttestationAction,
  AttestationKind,
  encodeAttestationV1,
  evmAddressToRegistryBytes,
  hashAttestationV1,
  hashNetworkId,
  type AttestationV1,
} from "../src/multichain/AttestationCodec.js";

const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const normativeVector = JSON.parse(
  readFileSync(
    new URL("../../specs/multichain/fixtures/state-attestation-v1.json", import.meta.url),
    "utf8",
  ),
) as { encoded: Hex; digest: Hex };

function fixture(): AttestationV1 {
  return {
    kind: AttestationKind.STATE_ATTESTATION,
    action: AttestationAction.SYNC_MIRROR,
    domainHash: keccak256(stringToHex("example.com")),
    originNetworkHash: hashNetworkId("evm:8453"),
    originRegistry: evmAddressToRegistryBytes("0x1111111111111111111111111111111111111111"),
    destinationNetworkHash: hashNetworkId("solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"),
    destinationRegistry: `0x${"22".repeat(32)}` as Hex,
    globalDomainEpoch: 7n,
    originSequence: 19n,
    nonce: `0x${"33".repeat(32)}` as Hex,
    deadline: 2_000_000_000n,
    payloadHash: `0x${"44".repeat(32)}` as Hex,
    evidenceHash: `0x${"55".repeat(32)}` as Hex,
  };
}

describe("AttestationCodec V1", () => {
  it("encodes a deterministic fixed-width envelope", () => {
    const encoded = encodeAttestationV1(fixture());

    assert.equal(size(encoded), ATTESTATION_V1_SIZE);
    assert.ok(encoded.startsWith(`${ATTESTATION_MAGIC.slice(2)}01020300`.replace(/^/, "0x")));
    assert.equal(hashAttestationV1(fixture()), keccak256(encoded));
    assert.equal(encoded, normativeVector.encoded);
    assert.equal(hashAttestationV1(fixture()), normativeVector.digest);
  });

  it("binds the hash to destination, epoch and sequence", () => {
    const original = fixture();
    const originalHash = hashAttestationV1(original);

    assert.notEqual(
      hashAttestationV1({ ...original, destinationRegistry: `0x${"99".repeat(32)}` as Hex }),
      originalHash,
    );
    assert.notEqual(hashAttestationV1({ ...original, globalDomainEpoch: 8n }), originalHash);
    assert.notEqual(hashAttestationV1({ ...original, originSequence: 20n }), originalHash);
  });

  it("normalizes an EVM registry address to 32 bytes", () => {
    assert.equal(
      evmAddressToRegistryBytes("0x1111111111111111111111111111111111111111"),
      "0x0000000000000000000000001111111111111111111111111111111111111111",
    );
  });

  it("rejects ambiguous network ids and invalid field sizes", () => {
    assert.throws(() => hashNetworkId("8453"), /invalid canonical network id/);
    assert.throws(() => hashNetworkId("EVM:8453"), /invalid canonical network id/);
    assert.throws(
      () => encodeAttestationV1({ ...fixture(), nonce: "0x1234" }),
      /nonce must be exactly 32 bytes/,
    );
    assert.throws(
      () => encodeAttestationV1({ ...fixture(), deadline: 1n << 64n }),
      /deadline must fit an unsigned 64-bit integer/,
    );
    assert.throws(
      () =>
        encodeAttestationV1({
          ...fixture(),
          kind: AttestationKind.ORIGIN_CLAIM,
          action: AttestationAction.SYNC_MIRROR,
        }),
      /invalid attestation kind\/action pair/,
    );
  });

  it("supports an origin claim addressed to its chosen origin registry", () => {
    const claim = {
      ...fixture(),
      kind: AttestationKind.ORIGIN_CLAIM,
      action: AttestationAction.REGISTER_ORIGIN,
      globalDomainEpoch: 0n,
      originSequence: 0n,
      evidenceHash: ZERO32,
    };

    assert.equal(size(encodeAttestationV1(claim)), ATTESTATION_V1_SIZE);
  });

  it("supports a recovery authorization as a state attestation", () => {
    const recovery = {
      ...fixture(),
      action: AttestationAction.RECOVER_ORIGIN,
    };

    assert.equal(size(encodeAttestationV1(recovery)), ATTESTATION_V1_SIZE);
  });
});
