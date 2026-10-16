import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, stringToHex, type Hex } from "viem";
import { hashNetworkId } from "../src/multichain/AttestationCodec.js";
import { defineSolanaNetwork } from "../src/multichain/NetworkModel.js";
import {
  SolanaLedgerAdapter,
  SolanaLedgerAdapterError,
  type SolanaLedgerAccountInfo,
  type SolanaLedgerRpc,
} from "../src/services/ledger/SolanaLedgerAdapter.js";

const PROGRAM = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const GENESIS = "11111111111111111111111111111111";
const network = defineSolanaNetwork({
  genesisHash: GENESIS, name: "Solana Local", rpcUrl: "http://localhost:8899",
  programId: PROGRAM, explorerUrl: "https://explorer.solana.com",
  asset: { kind: "SPL", symbol: "MAIV", decimals: 6, mint: PROGRAM },
  finality: { reorgMarginSlots: 64 }, capabilities: { origin: true, mirror: true },
});

function u64(value: bigint) { const item = Buffer.alloc(8); item.writeBigUInt64LE(value); return item; }
function i64(value: bigint) { const item = Buffer.alloc(8); item.writeBigInt64LE(value); return item; }
function text(value: string) {
  const bytes = Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
  return [length, bytes];
}
function bytes(value: Hex) { return Buffer.from(value.slice(2), "hex"); }

function domainRecord(input: {
  domain: string;
  kind: "ORIGIN" | "MIRROR";
  originFamily: "EVM" | "SOLANA";
  originNetworkHash: Hex;
  originRegistry: Hex;
  status?: number;
}): Buffer {
  const domainHash = keccak256(stringToHex(input.domain));
  const provider = Buffer.alloc(32, 0x99);
  const strikes = Buffer.alloc(4); strikes.writeUInt32LE(3);
  return Buffer.concat([
    Buffer.from([130, 61, 36, 125, 56, 48, 189, 247]),
    Buffer.from([2, 0, 1, input.kind === "ORIGIN" ? 0 : 1]),
    bytes(domainHash), ...text(input.domain),
    Buffer.from([input.originFamily === "EVM" ? 0 : 1]),
    bytes(input.originNetworkHash), bytes(input.originRegistry),
    Buffer.from([2]), Buffer.alloc(32, 0x11),
    Buffer.from([2]), Buffer.alloc(32, 0x22),
    ...text(`https://${input.domain}/inbox`),
    Buffer.alloc(32, 0x33), Buffer.from([input.status ?? 0]),
    u64(4n), u64(9n), provider, Buffer.from([2]), strikes,
    i64(1_700_000_000n), i64(1_700_000_100n),
    u64(5_000n), u64(10_000n), u64(5_000n), u64(input.kind === "ORIGIN" ? 5_000n : 0n),
    Buffer.from([input.originFamily === "EVM" ? 0 : 1]), Buffer.alloc(32, 0x77),
    u64(0n), Buffer.alloc(32),
  ]);
}

class MemorySolanaRpc implements SolanaLedgerRpc {
  genesisHash = GENESIS;
  slot = 100n;
  readonly accounts = new Map<string, SolanaLedgerAccountInfo>();
  async getGenesisHash() { return this.genesisHash; }
  async getFinalizedSlot() { return this.slot; }
  async getAccountInfo(address: string) { return this.accounts.get(address) ?? null; }
}

test("reads a finalized Solana origin with endpoint, typed keys, provider and local stake", async () => {
  const rpc = new MemorySolanaRpc();
  const adapter = new SolanaLedgerAdapter(network, rpc);
  const domain = "origin.example";
  const address = adapter.deriveDomainRecordAddress(domain);
  rpc.accounts.set(address, {
    contextSlot: 99n, owner: PROGRAM,
    data: domainRecord({
      domain, kind: "ORIGIN", originFamily: "SOLANA",
      originNetworkHash: hashNetworkId(network.networkId), originRegistry: network.registryId,
    }),
  });
  const identity = await adapter.readDomainIdentity(domain);
  const provider = await adapter.readProviderState(domain);
  assert.equal(identity?.recordKind, "ORIGIN");
  assert.equal(identity?.endpointUrl, "https://origin.example/inbox");
  assert.equal(identity?.operationalKey.algorithm, 2);
  assert.equal(identity?.status, "ACTIVE");
  assert.deepEqual(provider, {
    isProvider: true, tier: 2, stake: 5_000n, attestedStake: 5_000n,
    dailyLimit: 10_000n, strikes: 3, suspended: false,
  });
});

test("reads a Solana mirror but never exposes its attested stake as local custody", async () => {
  const rpc = new MemorySolanaRpc();
  const adapter = new SolanaLedgerAdapter(network, rpc);
  const domain = "mirror.example";
  rpc.accounts.set(adapter.deriveDomainRecordAddress(domain), {
    contextSlot: 100n, owner: PROGRAM,
    data: domainRecord({
      domain, kind: "MIRROR", originFamily: "EVM",
      originNetworkHash: hashNetworkId("evm:8453"),
      originRegistry: `0x${"44".repeat(32)}`,
    }),
  });
  assert.equal((await adapter.readDomainIdentity(domain))?.recordKind, "MIRROR");
  const provider = await adapter.readProviderState(domain);
  assert.equal(provider?.stake, 0n);
  assert.equal(provider?.attestedStake, 5_000n);
});

test("returns null for an absent PDA and fails closed on owner, origin or RPC cluster divergence", async () => {
  const rpc = new MemorySolanaRpc();
  const adapter = new SolanaLedgerAdapter(network, rpc);
  assert.equal(await adapter.readDomainIdentity("absent.example"), null);
  const domain = "invalid.example";
  const address = adapter.deriveDomainRecordAddress(domain);
  rpc.accounts.set(address, {
    contextSlot: 100n, owner: GENESIS,
    data: domainRecord({
      domain, kind: "ORIGIN", originFamily: "SOLANA",
      originNetworkHash: hashNetworkId(network.networkId), originRegistry: network.registryId,
    }),
  });
  await assert.rejects(
    adapter.readDomainIdentity(domain),
    (error: unknown) => error instanceof SolanaLedgerAdapterError && error.code === "SOLANA_LEDGER_INVALID",
  );
  rpc.genesisHash = PROGRAM;
  await assert.rejects(
    adapter.checkHealth(),
    (error: unknown) => error instanceof SolanaLedgerAdapterError && error.code === "SOLANA_LEDGER_RPC_DIVERGENCE",
  );
});
