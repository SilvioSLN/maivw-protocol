import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex } from "viem";
import { SolanaRegistryAccountValidator, SolanaRegistryIndexerError } from "../src/multichain/SolanaRegistryIndexer.js";

const PROGRAM = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const DOMAIN = "example.com";
const DOMAIN_HASH = keccak256(stringToHex(DOMAIN));

function u64(parts: Buffer[], value: bigint) { const item = Buffer.alloc(8); item.writeBigUInt64LE(value); parts.push(item); }
function i64(parts: Buffer[], value: bigint) { const item = Buffer.alloc(8); item.writeBigInt64LE(value); parts.push(item); }
function text(parts: Buffer[], value: string) { const bytes = Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); parts.push(size, bytes); }
function domainRecord(discriminator = Buffer.from([130, 61, 36, 125, 56, 48, 189, 247])) {
  const parts = [discriminator, Buffer.from([2, 0, 1, 0]), Buffer.from(DOMAIN_HASH.slice(2), "hex")];
  text(parts, DOMAIN);
  parts.push(Buffer.from([1]), Buffer.alloc(32, 0x22), Buffer.alloc(32, 0x33));
  parts.push(Buffer.from([2]), Buffer.alloc(32, 0x44), Buffer.from([2]), Buffer.alloc(32, 0x55));
  text(parts, "https://mail.example.com");
  parts.push(Buffer.alloc(32, 0x66), Buffer.from([0]));
  u64(parts, 4n); u64(parts, 9n); parts.push(Buffer.alloc(32), Buffer.from([0]));
  const strikes = Buffer.alloc(4); strikes.writeUInt32LE(0); parts.push(strikes);
  i64(parts, 1n); i64(parts, 2n);
  u64(parts, 10n); u64(parts, 0n); u64(parts, 10n); u64(parts, 10n);
  parts.push(Buffer.from([1]), Buffer.alloc(32, 0x77)); u64(parts, 0n); parts.push(Buffer.alloc(32));
  return Buffer.concat(parts);
}

const event = {
  instructionIndex: 0, logIndex: 1, eventName: "DomainStateChanged", domainHash: DOMAIN_HASH,
  payload: { schemaVersion: 2, globalDomainEpoch: 4n, originSequence: 9n },
};

test("indexer validates finalized owner, PDA discriminator and schema before accepting Registry event", async () => {
  const calls: any[] = [];
  const validator = new SolanaRegistryAccountValidator({ getAccountInfo: async (input) => {
    calls.push(input);
    return { owner: PROGRAM, contextSlot: 101n, data: domainRecord() };
  } }, PROGRAM);
  await validator.validate(event, { signature: "signature", slot: 100n });
  assert.equal(calls[0].commitment, "finalized");
  assert.equal(calls[0].minContextSlot, 100n);

  const wrongOwner = new SolanaRegistryAccountValidator({ getAccountInfo: async () => ({ owner: "11111111111111111111111111111111", contextSlot: 101n, data: domainRecord() }) }, PROGRAM);
  await assert.rejects(wrongOwner.validate(event, { signature: "signature", slot: 100n }), (error: unknown) => error instanceof SolanaRegistryIndexerError && error.code === "INDEXED_ACCOUNT_INVALID");

  const badSchema = new SolanaRegistryAccountValidator({ getAccountInfo: async () => ({ owner: PROGRAM, contextSlot: 101n, data: domainRecord(Buffer.alloc(8)) }) }, PROGRAM);
  await assert.rejects(badSchema.validate(event, { signature: "signature", slot: 100n }), (error: unknown) => error instanceof SolanaRegistryIndexerError && error.code === "INDEXED_ACCOUNT_INVALID");
});
