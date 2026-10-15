import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainStateChangedDecoder,
  SolanaObserver,
  SolanaObserverError,
  type SolanaSignatureInfo,
  type SolanaTransaction,
} from "../src/multichain/SolanaObserver.js";

const PROGRAM = "8MybG5qUxPpe3vVQB47VtMVUEknBuBk9yuQydr8XxRy9";
const NETWORK = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const signature = (slot: bigint) => `${"1".repeat(70)}${slot.toString().replaceAll("0", "A")}`;

function eventLog(): string {
  const data = Buffer.alloc(198);
  Buffer.from([251, 63, 5, 20, 116, 211, 59, 224]).copy(data, 0);
  data[8] = 1;
  data[9] = 0;
  Buffer.alloc(32, 0x11).copy(data, 10);
  data[42] = 1;
  Buffer.alloc(32, 0x22).copy(data, 43);
  Buffer.alloc(32, 0x33).copy(data, 75);
  data.writeBigUInt64LE(4n, 107);
  data.writeBigUInt64LE(9n, 115);
  data[123] = 0;
  Buffer.alloc(32, 0x44).copy(data, 124);
  data.writeUInt16LE(2, 156);
  Buffer.alloc(32, 0x55).copy(data, 158);
  data.writeBigInt64LE(1_700_000_000n, 190);
  return `Program data: ${data.toString("base64")}`;
}

function memoryDatabase() {
  const cursors = new Map<string, any>();
  const transactions: any[] = [];
  const events: any[] = [];
  const cursor = {
    findUnique: async ({ where }: any) => cursors.get(where.networkId) ?? null,
    create: async ({ data }: any) => {
      const row = { ...data, lastSlot: null, lastSignature: null, observedSlot: null, createdAt: new Date(), updatedAt: new Date() };
      cursors.set(row.networkId, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = { ...cursors.get(where.networkId), ...data, updatedAt: new Date() };
      cursors.set(where.networkId, row);
      return row;
    },
  };
  const txs = {
    upsert: async ({ where, create }: any) => {
      const key = where.networkId_signature;
      const found = transactions.find((row) => row.networkId === key.networkId && row.signature === key.signature);
      if (found) return found;
      transactions.push(create);
      return create;
    },
  };
  const sourceEvents = {
    upsert: async ({ where, create }: any) => {
      const key = where.networkId_signature_instructionIndex_logIndex;
      const found = events.find((row) => row.networkId === key.networkId
        && row.signature === key.signature
        && row.instructionIndex === key.instructionIndex
        && row.logIndex === key.logIndex);
      if (found) return found;
      events.push(create);
      return create;
    },
  };
  const database = {
    solanaObserverCursor: cursor,
    solanaObservedTransaction: txs,
    solanaSourceEvent: sourceEvents,
    $transaction: async (operation: (tx: any) => Promise<any>) => operation({
      solanaObserverCursor: cursor,
      solanaObservedTransaction: txs,
      solanaSourceEvent: sourceEvents,
    }),
  };
  return { database, cursors, transactions, events };
}

class FakeClient {
  slot = 110n;
  infos: SolanaSignatureInfo[] = [105n, 104n, 103n, 102n, 101n].map((slot) => ({
    signature: signature(slot), slot, err: null, blockTime: Number(slot), confirmationStatus: "finalized",
  }));
  missing = new Set<string>();

  async getSlot() { return this.slot; }
  async getSignatureStatus({ signature: value }: { signature: string }) {
    return this.infos.some((info) => info.signature === value) ? { confirmationStatus: "finalized" as const } : null;
  }
  async getSignaturesForAddress(input: { before?: string; until?: string; limit: number }) {
    let start = input.before ? this.infos.findIndex((info) => info.signature === input.before) + 1 : 0;
    if (start < 0) start = 0;
    const untilIndex = input.until ? this.infos.findIndex((info) => info.signature === input.until) : this.infos.length;
    const end = untilIndex < 0 ? this.infos.length : untilIndex;
    return this.infos.slice(start, Math.min(start + input.limit, end));
  }
  async getTransaction({ signature: value }: { signature: string }): Promise<SolanaTransaction | null> {
    if (this.missing.has(value)) return null;
    const info = this.infos.find((item) => item.signature === value)!;
    return {
      slot: info.slot,
      blockTime: info.blockTime,
      meta: { err: null, logMessages: [`Program ${PROGRAM} invoke [1]`, eventLog(), `Program ${PROGRAM} success`] },
    };
  }
}

const config = {
  networkId: NETWORK,
  programId: PROGRAM,
  commitment: "finalized" as const,
  startSlot: 101n,
  pageSize: 2,
  maxPagesPerPoll: 4,
};

test("backfills finalized signatures across pages and resumes without duplicates", async () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  const observer = new SolanaObserver(memory.database as any, client, new DomainStateChangedDecoder(), config);
  const first = await observer.poll();
  assert.equal(first.scannedSignatures, 5);
  assert.equal(first.persistedTransactions, 5);
  assert.equal(first.persistedEvents, 5);
  assert.equal(first.lastSlot, 105n);
  assert.equal(memory.events[0].payload.globalDomainEpoch, "4");

  const idle = await observer.poll();
  assert.equal(idle.scannedSignatures, 0);
  assert.equal(memory.transactions.length, 5);
  assert.equal(memory.events.length, 5);

  client.infos.unshift({
    signature: signature(106n), slot: 106n, err: null, blockTime: 106, confirmationStatus: "finalized",
  });
  const incremental = await observer.poll();
  assert.equal(incremental.scannedSignatures, 1);
  assert.equal(incremental.lastSlot, 106n);
  assert.equal(memory.events.length, 6);
});

test("does not move the slot/signature cursor when a finalized transaction is missing", async () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  client.missing.add(signature(103n));
  const observer = new SolanaObserver(memory.database as any, client, new DomainStateChangedDecoder(), config);
  await assert.rejects(
    observer.poll(),
    (error: unknown) => error instanceof SolanaObserverError && error.code === "SOLANA_TRANSACTION_MISSING",
  );
  assert.equal(memory.cursors.get(NETWORK).lastSignature, null);
  assert.equal(memory.transactions.length, 0);
});

test("requires finalized commitment and bounds incomplete backfill", async () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  assert.throws(
    () => new SolanaObserver(memory.database as any, client, new DomainStateChangedDecoder(), {
      ...config, commitment: "confirmed" as any,
    }),
    (error: unknown) => error instanceof SolanaObserverError
      && error.code === "INVALID_SOLANA_OBSERVER_CONFIG",
  );
  const bounded = new SolanaObserver(memory.database as any, client, new DomainStateChangedDecoder(), {
    ...config, maxPagesPerPoll: 1,
  });
  await assert.rejects(
    bounded.poll(),
    (error: unknown) => error instanceof SolanaObserverError && error.code === "SOLANA_BACKFILL_LIMIT",
  );
});
