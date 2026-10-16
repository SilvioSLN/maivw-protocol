import assert from "node:assert/strict";
import test from "node:test";
import { recoverAddress, type Hex } from "viem";
import {
  AttestationAction,
  AttestationKind,
  hashNetworkId,
  type AttestationV1,
} from "../src/multichain/AttestationCodec.js";
import { AttestationSigner, createAttestationSigner } from "../src/multichain/AttestationSigner.js";

const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BYTES_A = `0x${"11".repeat(32)}` as Hex;
const BYTES_B = `0x${"22".repeat(32)}` as Hex;
const BYTES_C = `0x${"33".repeat(32)}` as Hex;

function attestation(kind: AttestationKind, action: AttestationAction): AttestationV1 {
  return {
    kind,
    action,
    domainHash: BYTES_A,
    originNetworkHash: hashNetworkId("evm:8453"),
    originRegistry: BYTES_B,
    destinationNetworkHash: hashNetworkId("solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"),
    destinationRegistry: BYTES_C,
    globalDomainEpoch: 3n,
    originSequence: 8n,
    nonce: BYTES_A,
    deadline: 2_000_000_000n,
    payloadHash: BYTES_B,
    evidenceHash: BYTES_C,
  };
}

test("one isolated signer signs OriginClaim and StateAttestation digests", async () => {
  const signer = await createAttestationSigner({
    ORACLE_SIGNER_TYPE: "local",
    ORACLE_PRIVATE_KEY: PRIVATE_KEY,
    GCP_KMS_KEY_VERSION: undefined,
    GCP_KMS_CREDENTIALS_BASE64: undefined,
  });

  const origin = await signer.signAttestation(
    attestation(AttestationKind.ORIGIN_CLAIM, AttestationAction.REGISTER_ORIGIN),
    { purpose: "ORIGIN_CLAIM", operationId: "issuance-1" },
  );
  const state = await signer.signAttestation(
    attestation(AttestationKind.STATE_ATTESTATION, AttestationAction.SYNC_MIRROR),
    { purpose: "STATE_ATTESTATION", operationId: "mirror-job-1" },
  );

  assert.equal(origin.encoded.length, 2 + 292 * 2);
  assert.equal(state.encoded.length, 2 + 292 * 2);
  assert.equal(origin.keyVersion, "development");
  assert.match(origin.keyId, /^local:0x[0-9a-f]{40}$/);
  assert.equal(await recoverAddress({ hash: origin.digest, signature: origin.signature }), origin.signerAddress);
  assert.equal(await recoverAddress({ hash: state.digest, signature: state.signature }), state.signerAddress);
});

test("signer rejects purpose confusion and invalid local key material", async () => {
  const signer = await createAttestationSigner({
    ORACLE_SIGNER_TYPE: "local",
    ORACLE_PRIVATE_KEY: PRIVATE_KEY,
    GCP_KMS_KEY_VERSION: undefined,
    GCP_KMS_CREDENTIALS_BASE64: undefined,
  });
  await assert.rejects(
    signer.signAttestation(
      attestation(AttestationKind.STATE_ATTESTATION, AttestationAction.REGISTER_MIRROR),
      { purpose: "ORIGIN_CLAIM", operationId: "wrong-purpose" },
    ),
    /does not match signing purpose/,
  );
  await assert.rejects(
    createAttestationSigner({
      ORACLE_SIGNER_TYPE: "local",
      ORACLE_PRIVATE_KEY: "not-a-key",
      GCP_KMS_KEY_VERSION: undefined,
      GCP_KMS_CREDENTIALS_BASE64: undefined,
    }),
    /32-byte hex key/,
  );
});

test("signer reports backend failures without exposing key material", async () => {
  const failures: unknown[] = [];
  const signer = new AttestationSigner({
    getKeyMetadata: () => ({ keyId: "kms-key", keyVersion: "1" }),
    getAddress: async () => "0x1111111111111111111111111111111111111111",
    signDigest: async () => { throw new Error("KMS unavailable"); },
  }, (error) => failures.push(error));
  await assert.rejects(signer.signDigest(BYTES_A, { purpose: "STATE_ATTESTATION", operationId: "job-1" }), /KMS unavailable/);
  assert.equal(failures.length, 1);
});
