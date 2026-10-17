import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, padHex, stringToHex, type Address, type Hex } from "viem";
import {
  EvmFinalizedStateReader,
  FinalizedStateError,
  SolanaFinalizedStateReader,
  solanaSignatureReference,
} from "../src/multichain/FinalizedStateReader.js";

const DOMAIN = "example.com";
const DOMAIN_HASH = keccak256(stringToHex(DOMAIN));
const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const BLOCK_HASH = `0x${"aa".repeat(32)}` as Hex;
const TX_HASH = `0x${"bb".repeat(32)}` as Hex;
const SOLANA_SIGNATURE = "1".repeat(64);

test("EVM reader pins every eth_call to the finalized block and validates its hash", async () => {
  const calls: any[] = [];
  const client = {
    getBlock: async () => ({ number: 50n, hash: BLOCK_HASH }),
    readContract: async (input: any) => {
      calls.push(input);
      switch (input.functionName) {
        case "getCompanyProfile": return {
          domain: DOMAIN, endpointUrl: "https://mail.example.com", publicKey: REGISTRY, adminKey: REGISTRY,
          registrationTime: 1_700_000_000n, strikeCount: 2, epoch: 3, isProvider: true, status: 1,
        };
        case "getDomainTlsFingerprint": return `0x${"12".repeat(32)}`;
        case "getProviderInfo": return [true, 2, 10_000n, 1000n, 2, false];
        default: throw new Error("unexpected read");
      }
    },
  };
  const reader = new EvmFinalizedStateReader(client as any, {
    networkHash: `0x${"22".repeat(32)}`,
    registryAddress: REGISTRY,
    registryId: padHex(REGISTRY, { size: 32 }),
    schemaVersion: 2,
  });
  const state = await reader.read({
    domain: DOMAIN, domainHash: DOMAIN_HASH, blockNumber: 50n, blockHash: BLOCK_HASH,
    transactionHash: TX_HASH, globalDomainEpoch: 3n, originSequence: 7n,
  });
  assert.equal(state.endpoint, "https://mail.example.com");
  assert.equal(state.originSequence, 7n);
  assert.equal(state.attestedStake, 1000n);
  assert.ok(calls.every((call) => call.blockNumber === 50n));
  await assert.rejects(
    reader.read({
      domain: DOMAIN, domainHash: DOMAIN_HASH, blockNumber: 50n,
      blockHash: `0x${"cc".repeat(32)}`, transactionHash: TX_HASH,
      globalDomainEpoch: 3n, originSequence: 7n,
    }),
    (error: unknown) => error instanceof FinalizedStateError && error.code === "FINALIZED_REFERENCE_MISMATCH",
  );
});

test("EVM reader only substitutes zero TLS for an explicitly declared legacy deployment", async () => {
  const client = {
    getBlock: async () => ({ number: 50n, hash: BLOCK_HASH }),
    readContract: async (input: any) => {
      if (input.functionName === "getDomainTlsFingerprint") throw new Error("selector unavailable");
      if (input.functionName === "getCompanyProfile") return {
        domain: DOMAIN, endpointUrl: "https://mail.example.com", publicKey: REGISTRY, adminKey: REGISTRY,
        registrationTime: 1_700_000_000n, strikeCount: 0, epoch: 0, isProvider: false, status: 1,
      };
      return [false, 0, 0n, 500n, 0, false];
    },
  };
  const checkpoint = {
    domain: DOMAIN, domainHash: DOMAIN_HASH, blockNumber: 50n, blockHash: BLOCK_HASH,
    transactionHash: TX_HASH, globalDomainEpoch: 0n, originSequence: 0n,
  };
  const required = new EvmFinalizedStateReader(client as any, {
    networkHash: `0x${"22".repeat(32)}`, registryAddress: REGISTRY,
    registryId: padHex(REGISTRY, { size: 32 }), schemaVersion: 2,
  });
  await assert.rejects(required.read(checkpoint), /selector unavailable/);
  const compatible = new EvmFinalizedStateReader(client as any, {
    networkHash: `0x${"22".repeat(32)}`, registryAddress: REGISTRY,
    registryId: padHex(REGISTRY, { size: 32 }), schemaVersion: 2,
    tlsFingerprintMode: "OPTIONAL_ZERO",
  });
  assert.equal((await compatible.read(checkpoint)).tlsFingerprint, `0x${"00".repeat(32)}`);
});

function pushU64(parts: Buffer[], value: bigint) { const item = Buffer.alloc(8); item.writeBigUInt64LE(value); parts.push(item); }
function pushI64(parts: Buffer[], value: bigint) { const item = Buffer.alloc(8); item.writeBigInt64LE(value); parts.push(item); }
function pushString(parts: Buffer[], value: string) { const bytes = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); parts.push(length, bytes); }

function domainRecord(): Buffer {
  const parts: Buffer[] = [
    Buffer.from([130, 61, 36, 125, 56, 48, 189, 247]),
    Buffer.from([2, 0, 1, 0]),
    Buffer.from(DOMAIN_HASH.slice(2), "hex"),
  ];
  pushString(parts, DOMAIN);
  parts.push(Buffer.from([1]), Buffer.alloc(32, 0x22), Buffer.alloc(32, 0x33));
  parts.push(Buffer.from([2]), Buffer.alloc(32, 0x44), Buffer.from([2]), Buffer.alloc(32, 0x55));
  pushString(parts, "https://solana.example.com");
  parts.push(Buffer.alloc(32, 0x66), Buffer.from([0]));
  pushU64(parts, 4n); pushU64(parts, 9n);
  parts.push(Buffer.alloc(32), Buffer.from([0]));
  const strikes = Buffer.alloc(4); strikes.writeUInt32LE(1); parts.push(strikes);
  pushI64(parts, 1_700_000_000n); pushI64(parts, 1_700_000_100n);
  pushU64(parts, 500n); pushU64(parts, 0n); pushU64(parts, 500n); pushU64(parts, 500n);
  parts.push(Buffer.from([1]), Buffer.alloc(32, 0x77));
  pushU64(parts, 0n);
  parts.push(Buffer.alloc(32));
  return Buffer.concat([...parts, Buffer.alloc(96)]);
}

test("Solana reader decodes the finalized DomainRecord instead of trusting event payload", async () => {
  const derivations: any[] = [];
  const reader = new SolanaFinalizedStateReader({
    deriveDomainRecordAddress: (hash: Hex, programId: string) => {
      derivations.push({ hash, programId });
      return "DomainRecordPda111111111111111111111111111";
    },
    getAccountInfo: async (input: any) => ({
      contextSlot: input.minContextSlot,
      owner: "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9",
      data: domainRecord(),
    }),
  }, "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9");
  const state = await reader.read({
    domain: DOMAIN, domainHash: DOMAIN_HASH, slot: 99n, signature: SOLANA_SIGNATURE,
    globalDomainEpoch: 4n, originSequence: 9n,
  });
  assert.equal(state.recordKind, "ORIGIN");
  assert.equal(state.originFamily, "SOLANA");
  assert.equal(state.endpoint, "https://solana.example.com");
  assert.equal(state.attestedStake, 500n);
  assert.equal(state.originTransaction, solanaSignatureReference(SOLANA_SIGNATURE));
  assert.notEqual(state.originTransaction, `0x${"00".repeat(32)}`);
  assert.deepEqual(derivations[0], {
    hash: DOMAIN_HASH,
    programId: "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9",
  });
  await assert.rejects(
    reader.read({
      domain: DOMAIN, domainHash: DOMAIN_HASH, slot: 99n, signature: SOLANA_SIGNATURE,
      globalDomainEpoch: 4n, originSequence: 10n,
    }),
    (error: unknown) => error instanceof FinalizedStateError && error.code === "FINALIZED_REFERENCE_MISMATCH",
  );
});

test("Solana transaction reference hashes the decoded 64-byte signature", () => {
  assert.equal(
    solanaSignatureReference("1".repeat(64)),
    "0xf5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b",
  );
  assert.throws(
    () => solanaSignatureReference("not-a-solana-signature"),
    (error: unknown) => error instanceof FinalizedStateError
      && error.code === "FINALIZED_REFERENCE_MISMATCH",
  );
});
