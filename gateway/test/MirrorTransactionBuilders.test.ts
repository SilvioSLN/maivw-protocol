import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PublicKey, Secp256k1Program } from "@solana/web3.js";
import {
  decodeFunctionData,
  keccak256,
  padHex,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  AttestationAction,
  AttestationKind,
  encodeAttestationV1,
  hashAttestationV1,
  type AttestationV1,
} from "../src/multichain/AttestationCodec.js";
import type { CanonicalDomainState } from "../src/multichain/FinalizedStateReader.js";
import { hashMirrorStateV2 } from "../src/multichain/MirrorPayloadCodec.js";
import {
  MIRROR_ABI,
  buildEvmMirrorTransaction,
  buildSolanaMirrorTransaction,
  type MirrorOperation,
} from "../src/multichain/MirrorTransactionBuilders.js";

const PRIVATE_KEY = `0x${"00".repeat(31)}01` as Hex;
const account = privateKeyToAccount(PRIVATE_KEY);
const EVM_REGISTRY = "0x2222222222222222222222222222222222222222" as Address;
const PROGRAM_ID = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const RELAYER = "11111111111111111111111111111111";
const EVM_NETWORK = keccak256(stringToHex("evm:8453"));
const SOLANA_NETWORK = keccak256(stringToHex(`solana:${PROGRAM_ID}`));

function state(status: CanonicalDomainState["status"] = "ACTIVE"): CanonicalDomainState {
  const domain = "mail.example";
  const evmKey = `0x${"00".repeat(12)}${"07".repeat(20)}` as Hex;
  return {
    domain,
    domainHash: keccak256(stringToHex(domain)),
    recordKind: "ORIGIN",
    originFamily: "EVM",
    originNetworkHash: EVM_NETWORK,
    originRegistry: padHex("0x1111111111111111111111111111111111111111", { size: 32 }),
    operationalKey: { algorithm: 1, value: evmKey },
    adminKey: { algorithm: 1, value: evmKey },
    endpoint: "https://mail.example",
    tlsFingerprint: `0x${"02".repeat(32)}` as Hex,
    status,
    globalDomainEpoch: 7n,
    originSequence: 19n,
    isProvider: true,
    providerTier: 2,
    strikes: 3,
    registrationTime: 1_700_000_000n,
    updatedAt: 1_700_000_001n,
    attestedStake: 1_000n,
    attestedDailyLimit: 10_000n,
    originTransactionFamily: "EVM",
    originTransaction: `0x${"55".repeat(32)}` as Hex,
    schemaVersion: 2,
  };
}

function action(operation: MirrorOperation): AttestationAction {
  return operation === "REGISTER" ? AttestationAction.REGISTER_MIRROR
    : operation === "SYNC" ? AttestationAction.SYNC_MIRROR : AttestationAction.REVOKE_MIRROR;
}

async function signed(
  operation: MirrorOperation,
  domainState: CanonicalDomainState,
  destinationNetworkHash: Hex,
  destinationRegistry: Hex,
): Promise<{ attestation: AttestationV1; signature: Hex; expectedSigner: Address }> {
  const attestation: AttestationV1 = {
    kind: AttestationKind.STATE_ATTESTATION,
    action: action(operation),
    domainHash: domainState.domainHash,
    originNetworkHash: domainState.originNetworkHash,
    originRegistry: domainState.originRegistry,
    destinationNetworkHash,
    destinationRegistry,
    globalDomainEpoch: domainState.globalDomainEpoch,
    originSequence: domainState.originSequence,
    nonce: `0x${"33".repeat(32)}` as Hex,
    deadline: 2_000_000_000n,
    payloadHash: hashMirrorStateV2(domainState),
    evidenceHash: domainState.originTransaction,
  };
  return {
    attestation,
    signature: await account.sign({ hash: hashAttestationV1(attestation) }),
    expectedSigner: account.address,
  };
}

describe("MirrorStateV2 payload codec", () => {
  it("matches the normative Rust and Solidity vector", () => {
    assert.equal(
      hashMirrorStateV2(state()),
      "0x309ab981466d054d4a864fe3ce46e60fb25ed3dc4f79e419e50ba63d0f58332b",
    );
  });
});

describe("EVM mirror transaction builder", () => {
  it("builds verifiable register calldata without a private key", async () => {
    const domainState = state();
    const proof = await signed(
      "REGISTER",
      domainState,
      EVM_NETWORK,
      padHex(EVM_REGISTRY, { size: 32 }),
    );
    const built = await buildEvmMirrorTransaction({
      operation: "REGISTER",
      state: domainState,
      destinationNetworkHash: EVM_NETWORK,
      mirrorRegistry: EVM_REGISTRY,
      now: 1_900_000_000n,
      ...proof,
    });
    const decoded = decodeFunctionData({ abi: MIRROR_ABI, data: built.data });
    assert.equal(decoded.functionName, "registerMirrorV2");
    assert.equal(built.to, EVM_REGISTRY);
    assert.equal(built.payloadHash, proof.attestation.payloadHash);
    assert.equal(built.value, 0n);
  });

  it("rejects a payload or signer that is not bound by the oracle", async () => {
    const domainState = state();
    const proof = await signed(
      "SYNC",
      domainState,
      EVM_NETWORK,
      padHex(EVM_REGISTRY, { size: 32 }),
    );
    await assert.rejects(
      buildEvmMirrorTransaction({
        operation: "SYNC",
        state: { ...domainState, endpoint: "https://tampered.example" },
        destinationNetworkHash: EVM_NETWORK,
        mirrorRegistry: EVM_REGISTRY,
        now: 1_900_000_000n,
        ...proof,
      }),
      /does not bind/,
    );
    await assert.rejects(
      buildEvmMirrorTransaction({
        operation: "SYNC",
        state: domainState,
        destinationNetworkHash: EVM_NETWORK,
        mirrorRegistry: EVM_REGISTRY,
        now: 1_900_000_000n,
        ...proof,
        expectedSigner: "0x9999999999999999999999999999999999999999",
      }),
      /configured destination signer/,
    );
  });
});

describe("Solana mirror transaction builder", () => {
  it("orders the secp256k1 verification immediately before the Anchor call", async () => {
    const domainState = state("REVOKED");
    const registryBytes = toProgramBytes(PROGRAM_ID);
    const proof = await signed("REVOKE", domainState, SOLANA_NETWORK, registryBytes);
    const built = await buildSolanaMirrorTransaction({
      operation: "REVOKE",
      state: domainState,
      destinationNetworkHash: SOLANA_NETWORK,
      programId: PROGRAM_ID,
      relayer: RELAYER,
      now: 1_900_000_000n,
      ...proof,
    });
    assert.equal(built.transaction.instructions.length, 2);
    assert.ok(built.transaction.instructions[0].programId.equals(Secp256k1Program.programId));
    assert.ok(built.transaction.instructions[1].programId.equals(new PublicKey(PROGRAM_ID)));
    const verifyData = built.verificationInstruction.data;
    const messageOffset = verifyData.readUInt16LE(7);
    const messageSize = verifyData.readUInt16LE(9);
    assert.equal(verifyData[3], 0);
    assert.equal(verifyData[6], 0);
    assert.equal(verifyData[11], 0);
    assert.deepEqual(
      verifyData.subarray(messageOffset, messageOffset + messageSize),
      Buffer.from(encodeAttestationV1(proof.attestation).slice(2), "hex"),
    );
    assert.deepEqual(
      built.programInstruction.data.subarray(0, 8),
      Buffer.from([105, 99, 35, 241, 103, 60, 119, 105]),
    );
    assert.equal(built.programInstruction.keys.length, 6);
    assert.equal(built.payloadHash, proof.attestation.payloadHash);
  });

  it("rejects an operation/status mismatch before producing instructions", async () => {
    const domainState = state("REVOKED");
    const proof = await signed("SYNC", domainState, SOLANA_NETWORK, toProgramBytes(PROGRAM_ID));
    await assert.rejects(
      buildSolanaMirrorTransaction({
        operation: "SYNC",
        state: domainState,
        destinationNetworkHash: SOLANA_NETWORK,
        programId: PROGRAM_ID,
        relayer: RELAYER,
        now: 1_900_000_000n,
        ...proof,
      }),
      /does not match/,
    );
  });
});

function toProgramBytes(programId: string): Hex {
  return `0x${Buffer.from(new PublicKey(programId).toBytes()).toString("hex")}` as Hex;
}
