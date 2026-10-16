import assert from "node:assert/strict";
import test from "node:test";
import {
  ChainAccountSchema,
  ChainTransactionReferenceSchema,
  MirrorJobRequestBodySchema,
  MultichainApiError,
  SolanaSignatureSchema,
  multichainApiError,
} from "../src/multichain/MultichainApiSchema.js";

const evmAddress = "0x1111111111111111111111111111111111111111";
const evmHash = `0x${"ab".repeat(32)}`;
const solanaPublicKey = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const solanaSignature = "1".repeat(64);

test("chain account schema keeps EVM addresses and Solana public keys distinct", () => {
  assert.equal(ChainAccountSchema.parse({ family: "EVM", address: evmAddress }).address, evmAddress);
  assert.equal(ChainAccountSchema.parse({ family: "SOLANA", publicKey: solanaPublicKey }).publicKey, solanaPublicKey);
  assert.equal(ChainAccountSchema.safeParse({ family: "EVM", address: solanaPublicKey }).success, false);
  assert.equal(ChainAccountSchema.safeParse({ family: "SOLANA", publicKey: evmAddress }).success, false);
});

test("transaction reference schema never accepts an EVM hash as a Solana signature", () => {
  assert.equal(ChainTransactionReferenceSchema.parse({ family: "EVM", hash: evmHash }).hash, evmHash);
  assert.equal(ChainTransactionReferenceSchema.parse({ family: "SOLANA", signature: solanaSignature }).signature, solanaSignature);
  assert.equal(SolanaSignatureSchema.safeParse(evmHash).success, false);
  assert.equal(ChainTransactionReferenceSchema.safeParse({ family: "SOLANA", signature: evmHash }).success, false);
  assert.equal(ChainTransactionReferenceSchema.safeParse({ family: "EVM", hash: solanaSignature }).success, false);
});

test("mirror request accepts only canonical, unique destination network ids", () => {
  const parsed = MirrorJobRequestBodySchema.parse({
    domain: " Example.COM ", destinationNetworkIds: ["evm:84532", `solana:${solanaPublicKey}`],
  });
  assert.equal(parsed.domain, "example.com");
  assert.equal(parsed.operation, "REGISTER");
  assert.equal(MirrorJobRequestBodySchema.safeParse({
    domain: "example.com", destinationNetworkIds: ["evm:84532", "evm:84532"],
  }).success, false);
  assert.equal(MirrorJobRequestBodySchema.safeParse({
    domain: "example.com", destinationNetworkIds: ["84532"],
  }).success, false);
});

test("public error mapping distinguishes origin conflict and same-version state drift", () => {
  const conflict = multichainApiError({ code: "ORIGIN_REFERENCE_MISMATCH" });
  const drift = multichainApiError({ code: "STATE_DRIFT" });
  assert.ok(conflict instanceof MultichainApiError);
  assert.deepEqual({ code: conflict.code, status: conflict.statusCode }, { code: "ORIGIN_CONFLICT", status: 409 });
  assert.deepEqual({ code: drift.code, status: drift.statusCode }, { code: "STATE_DRIFT", status: 409 });
});
