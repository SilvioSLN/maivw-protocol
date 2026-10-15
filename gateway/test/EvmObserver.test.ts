import assert from "node:assert/strict";
import test from "node:test";
import { padHex, type Address, type Hex } from "viem";
import {
  EvmObserver,
  EvmObserverError,
  type EvmBlock,
  type EvmLog,
  type EvmObserverConfig,
} from "../src/multichain/EvmObserver.js";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const REGISTRY_ID = padHex(REGISTRY, { size: 32 });
const hash = (value: bigint, fork = 0): Hex => `0x${(value + BigInt(fork) * 10_000n).toString(16).padStart(64, "0")}` as Hex;

function config(overrides: Partial<EvmObserverConfig> = {}): EvmObserverConfig {
  return {
    networkName: "BASE",
    networkId: "evm:8453",
    chainId: 8453n,
    registryAddress: REGISTRY,
    registryId: REGISTRY_ID,
    confirmations: 2,
    startBlock: 100n,
    maxBlocksPerPoll: 100,
    ...overrides,
  };
}

function memoryDatabase() {
  const cursors = new Map<string, any>();
  const blocks: any[] = [];
  const events: any[] = [];
  const now = () => new Date("2026-10-14T12:00:00.000Z");

  const evmObserverCursor = {
    findUnique: async ({ where }: any) => cursors.get(where.networkId) ?? null,
    create: async ({ data }: any) => {
      const row = {
        ...data,
        lastProcessedBlock: null,
        lastProcessedHash: null,
        observedHead: null,
        finalizedHead: null,
        createdAt: now(),
        updatedAt: now(),
      };
      cursors.set(row.networkId, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = cursors.get(where.networkId);
      if (!row) throw new Error("cursor not found");
      const updated = { ...row, ...data, updatedAt: now() };
      cursors.set(where.networkId, updated);
      return updated;
    },
  };

  const evmObservedBlock = {
    findFirst: async ({ where }: any) => [...blocks]
      .reverse()
      .find((row) => row.networkId === where.networkId
        && row.blockNumber === where.blockNumber
        && row.status === where.status) ?? null,
    upsert: async ({ where, create, update }: any) => {
      const key = where.networkId_blockNumber_blockHash;
      const row = blocks.find((candidate) => candidate.networkId === key.networkId
        && candidate.blockNumber === key.blockNumber
        && candidate.blockHash === key.blockHash);
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { ...create, orphanedAt: null };
      blocks.push(created);
      return created;
    },
    updateMany: async ({ where, data }: any) => {
      const matches = blocks.filter((row) => row.networkId === where.networkId
        && row.status === where.status
        && row.blockNumber > where.blockNumber.gt);
      matches.forEach((row) => Object.assign(row, data));
      return { count: matches.length };
    },
  };

  const evmSourceEvent = {
    upsert: async ({ where, create, update }: any) => {
      const key = where.networkId_blockHash_transactionHash_logIndex;
      const row = events.find((candidate) => candidate.networkId === key.networkId
        && candidate.blockHash === key.blockHash
        && candidate.transactionHash === key.transactionHash
        && candidate.logIndex === key.logIndex);
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { ...create, orphanedAt: null };
      events.push(created);
      return created;
    },
    updateMany: async ({ where, data }: any) => {
      const matches = events.filter((row) => row.networkId === where.networkId
        && row.status === where.status
        && row.blockNumber > where.blockNumber.gt);
      matches.forEach((row) => Object.assign(row, data));
      return { count: matches.length };
    },
  };

  const database = {
    evmObserverCursor,
    evmObservedBlock,
    evmSourceEvent,
    $transaction: async (operation: (tx: any) => Promise<any>) => operation({
      evmObserverCursor,
      evmObservedBlock,
      evmSourceEvent,
    }),
  };
  return { database, cursors, blocks, events };
}

class FakeClient {
  head = 105n;
  readonly blocks = new Map<bigint, EvmBlock>();
  readonly logs = new Map<bigint, EvmLog[]>();

  constructor() {
    this.setCanonicalRange(100n, 110n);
  }

  setCanonicalRange(from: bigint, to: bigint, fork = 0): void {
    for (let number = from; number <= to; number += 1n) {
      this.blocks.set(number, {
        number,
        hash: hash(number, fork),
        parentHash: number === from && fork > 0 ? hash(number - 1n) : hash(number - 1n, fork),
      });
    }
  }

  addLog(blockNumber: bigint, fork = 0): void {
    this.logs.set(blockNumber, [{
      address: REGISTRY,
      blockNumber,
      blockHash: hash(blockNumber, fork),
      transactionHash: hash(blockNumber + 1_000n, fork),
      transactionIndex: 0,
      logIndex: 0,
      topics: [],
      data: "0x",
    }]);
  }

  async getBlockNumber(): Promise<bigint> {
    return this.head;
  }

  async getBlock({ blockNumber }: { blockNumber: bigint }): Promise<EvmBlock> {
    const block = this.blocks.get(blockNumber);
    if (!block) throw new Error("missing block");
    return block;
  }

  async getLogs({ fromBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<EvmLog[]> {
    return this.logs.get(fromBlock) ?? [];
  }
}

const decoder = {
  decode(log: EvmLog) {
    return {
      eventName: "DomainStateChanged",
      domainHash: hash(log.blockNumber!),
      payload: { sequence: log.blockNumber!, bytes: log.data },
    };
  },
};

test("persists a finalized cursor and resumes without duplicate events", async () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  client.addLog(101n);
  const first = new EvmObserver(memory.database as any, client, decoder, config());
  const initial = await first.poll();

  assert.deepEqual(initial, {
    observedHead: 105n,
    finalizedHead: 103n,
    processedBlocks: 4,
    persistedEvents: 1,
    orphanedBlocks: 0,
    nextBlock: 104n,
  });
  assert.equal(memory.blocks.filter((row) => row.status === "FINALIZED").length, 4);
  assert.equal(memory.events.length, 1);
  assert.equal(memory.events[0].payload.sequence, "101");

  client.head = 107n;
  const restarted = new EvmObserver(memory.database as any, client, decoder, config());
  const resumed = await restarted.poll();
  assert.equal(resumed.processedBlocks, 2);
  assert.equal(resumed.nextBlock, 106n);
  assert.equal(memory.events.length, 1);
});

test("does not advance the cursor across an RPC block gap", async () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  client.blocks.delete(102n);
  const observer = new EvmObserver(memory.database as any, client, decoder, config());

  await assert.rejects(
    observer.poll(),
    (error: unknown) => error instanceof EvmObserverError && error.code === "EVM_BLOCK_GAP",
  );
  assert.equal(memory.cursors.get("evm:8453").nextBlock, 102n);
  assert.deepEqual(
    memory.blocks.filter((row) => row.status === "FINALIZED").map((row) => row.blockNumber),
    [100n, 101n],
  );
});

test("orphanizes a finalized fork and backfills from the common ancestor", async () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  client.addLog(102n);
  client.addLog(103n);
  const observer = new EvmObserver(memory.database as any, client, decoder, config());
  await observer.poll();

  client.setCanonicalRange(102n, 110n, 1);
  client.addLog(102n, 1);
  client.addLog(103n, 1);
  const reorg = await observer.poll();

  assert.equal(reorg.orphanedBlocks, 2);
  assert.equal(reorg.processedBlocks, 2);
  assert.equal(reorg.nextBlock, 104n);
  assert.equal(memory.blocks.filter((row) => row.status === "ORPHANED").length, 2);
  assert.equal(memory.blocks.filter((row) => row.status === "FINALIZED").length, 4);
  assert.equal(memory.events.filter((row) => row.status === "ORPHANED").length, 2);
  assert.equal(memory.events.filter((row) => row.status === "FINALIZED").length, 2);
});

test("accepts Base, Arbitrum and Polygon but rejects a chain/family mismatch", () => {
  const memory = memoryDatabase();
  const client = new FakeClient();
  const variants: EvmObserverConfig[] = [
    config(),
    config({
      networkName: "ARBITRUM",
      networkId: "evm:42161",
      chainId: 42161n,
    }),
    config({
      networkName: "POLYGON",
      networkId: "evm:137",
      chainId: 137n,
    }),
  ];
  variants.forEach((item) => assert.doesNotThrow(
    () => new EvmObserver(memory.database as any, client, decoder, item),
  ));
  assert.throws(
    () => new EvmObserver(memory.database as any, client, decoder, config({
      networkName: "POLYGON",
      networkId: "evm:8453",
    })),
    (error: unknown) => error instanceof EvmObserverError
      && error.code === "INVALID_EVM_OBSERVER_CONFIG",
  );
});
