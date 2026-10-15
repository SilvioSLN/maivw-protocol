import { randomUUID } from "node:crypto";
import {
  decodeEventLog,
  padHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type EvmNetworkName = "BASE" | "ARBITRUM" | "POLYGON";
export type EvmObservationStatus = "FINALIZED" | "ORPHANED";

const SUPPORTED_CHAIN_IDS: Record<EvmNetworkName, ReadonlySet<bigint>> = {
  BASE: new Set([8453n, 84532n]),
  ARBITRUM: new Set([42161n, 421614n]),
  POLYGON: new Set([137n, 80002n]),
};

export interface EvmObserverConfig {
  networkName: EvmNetworkName;
  networkId: string;
  chainId: bigint;
  registryAddress: Address;
  registryId: Hex;
  confirmations: number;
  startBlock: bigint;
  maxBlocksPerPoll: number;
}

export interface EvmBlock {
  number: bigint | null;
  hash: Hex | null;
  parentHash: Hex;
}

export interface EvmLog {
  address: Address;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  transactionIndex: number | null;
  logIndex: number | null;
  topics: readonly Hex[];
  data: Hex;
}

export interface EvmObserverClient {
  getBlockNumber(): Promise<bigint>;
  getBlock(input: { blockNumber: bigint }): Promise<EvmBlock>;
  getLogs(input: { address: Address; fromBlock: bigint; toBlock: bigint }): Promise<readonly EvmLog[]>;
}

export interface DecodedEvmSourceEvent {
  eventName: string;
  domainHash?: Hex;
  payload: unknown;
}

export interface EvmSourceEventDecoder {
  decode(log: EvmLog): DecodedEvmSourceEvent | null;
}

export interface EvmObserverCursorRow {
  networkId: string;
  networkName: string;
  chainId: bigint;
  registryAddress: string;
  registryId: string;
  confirmations: number;
  startBlock: bigint;
  nextBlock: bigint;
  lastProcessedBlock: bigint | null;
  lastProcessedHash: string | null;
  observedHead: bigint | null;
  finalizedHead: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EvmObservedBlockRow {
  id: string;
  networkId: string;
  blockNumber: bigint;
  blockHash: string;
  parentHash: string;
  status: EvmObservationStatus;
  observedAt: Date;
  orphanedAt: Date | null;
}

interface FindCreateUpdateDelegate<Row> {
  findUnique(args: any): Promise<Row | null>;
  create(args: any): Promise<Row>;
  update(args: any): Promise<Row>;
}

interface EvmObserverTransaction {
  evmObserverCursor: FindCreateUpdateDelegate<EvmObserverCursorRow>;
  evmObservedBlock: {
    findFirst(args: any): Promise<EvmObservedBlockRow | null>;
    upsert(args: any): Promise<EvmObservedBlockRow>;
    updateMany(args: any): Promise<{ count: number }>;
  };
  evmSourceEvent: {
    upsert(args: any): Promise<unknown>;
    updateMany(args: any): Promise<{ count: number }>;
  };
}

interface EvmObserverDatabase extends EvmObserverTransaction {
  $transaction<T>(operation: (tx: EvmObserverTransaction) => Promise<T>): Promise<T>;
}

export type EvmObserverErrorCode =
  | "INVALID_EVM_OBSERVER_CONFIG"
  | "EVM_BLOCK_GAP"
  | "EVM_PARENT_HASH_MISMATCH"
  | "EVM_LOG_POSITION_INVALID"
  | "EVM_CURSOR_CONFIG_MISMATCH";

export class EvmObserverError extends Error {
  constructor(readonly code: EvmObserverErrorCode, message: string) {
    super(message);
    this.name = "EvmObserverError";
  }
}

export interface EvmPollResult {
  observedHead: bigint;
  finalizedHead: bigint | null;
  processedBlocks: number;
  persistedEvents: number;
  orphanedBlocks: number;
  nextBlock: bigint;
}

function fail(code: EvmObserverErrorCode, message: string): never {
  throw new EvmObserverError(code, message);
}

function normalizeHex(value: string): string {
  return value.toLowerCase();
}

function validateConfig(config: EvmObserverConfig): void {
  if (!SUPPORTED_CHAIN_IDS[config.networkName].has(config.chainId)) {
    fail("INVALID_EVM_OBSERVER_CONFIG", `${config.chainId} não pertence a ${config.networkName}`);
  }
  if (config.networkId !== `evm:${config.chainId}`) {
    fail("INVALID_EVM_OBSERVER_CONFIG", "networkId deve ser o CAIP-like canônico evm:{chainId}");
  }
  if (!ADDRESS_PATTERN.test(config.registryAddress)) {
    fail("INVALID_EVM_OBSERVER_CONFIG", "registryAddress EVM inválido");
  }
  if (!BYTES32_PATTERN.test(config.registryId)
    || normalizeHex(config.registryId) !== normalizeHex(padHex(config.registryAddress, { size: 32 }))) {
    fail("INVALID_EVM_OBSERVER_CONFIG", "registryId deve ser o endereço EVM alinhado em 32 bytes");
  }
  if (!Number.isSafeInteger(config.confirmations) || config.confirmations < 1) {
    fail("INVALID_EVM_OBSERVER_CONFIG", "confirmations deve ser inteiro positivo");
  }
  if (config.startBlock < 0n) fail("INVALID_EVM_OBSERVER_CONFIG", "startBlock não pode ser negativo");
  if (!Number.isSafeInteger(config.maxBlocksPerPoll)
    || config.maxBlocksPerPoll < 1
    || config.maxBlocksPerPoll > 5_000) {
    fail("INVALID_EVM_OBSERVER_CONFIG", "maxBlocksPerPoll deve estar entre 1 e 5000");
  }
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

/** Creates a strict ABI decoder; unrelated Registry logs are ignored. */
export function createEvmSourceEventDecoder(abi: Abi): EvmSourceEventDecoder {
  return {
    decode(log) {
      try {
        const topics = [...log.topics] as [] | [Hex, ...Hex[]];
        const decoded = decodeEventLog({ abi, data: log.data, topics, strict: true }) as {
          eventName: string;
          args?: Record<string, unknown>;
        };
        const candidate = decoded.args?.domainHash;
        const domainHash = typeof candidate === "string" && BYTES32_PATTERN.test(candidate)
          ? candidate.toLowerCase() as Hex
          : undefined;
        return { eventName: decoded.eventName, domainHash, payload: jsonSafe(decoded.args ?? {}) };
      } catch {
        return null;
      }
    },
  };
}

export class EvmObserver {
  constructor(
    private readonly database: EvmObserverDatabase,
    private readonly client: EvmObserverClient,
    private readonly decoder: EvmSourceEventDecoder,
    private readonly config: EvmObserverConfig,
    private readonly clock: () => Date = () => new Date(),
  ) {
    validateConfig(config);
  }

  async poll(): Promise<EvmPollResult> {
    let cursor = await this.loadCursor();
    const observedHead = await this.client.getBlockNumber();
    const finalizedHead = observedHead >= BigInt(this.config.confirmations)
      ? observedHead - BigInt(this.config.confirmations)
      : null;
    const reorg = await this.reconcileTip(cursor);
    cursor = reorg.cursor;

    let processedBlocks = 0;
    let persistedEvents = 0;
    if (finalizedHead !== null && cursor.nextBlock <= finalizedHead) {
      const batchEnd = minBigInt(
        finalizedHead,
        cursor.nextBlock + BigInt(this.config.maxBlocksPerPoll) - 1n,
      );
      for (let blockNumber = cursor.nextBlock; blockNumber <= batchEnd; blockNumber += 1n) {
        const block = await this.readBlock(blockNumber);
        if (cursor.lastProcessedHash
          && blockNumber === cursor.lastProcessedBlock! + 1n
          && normalizeHex(block.parentHash) !== normalizeHex(cursor.lastProcessedHash)) {
          fail(
            "EVM_PARENT_HASH_MISMATCH",
            `bloco ${blockNumber} não estende ${cursor.lastProcessedBlock}`,
          );
        }
        const logs = await this.client.getLogs({
          address: this.config.registryAddress,
          fromBlock: blockNumber,
          toBlock: blockNumber,
        });
        const decoded = logs.flatMap((log) => {
          this.validateLogPosition(log, blockNumber, block.hash!);
          const event = this.decoder.decode(log);
          return event ? [{ log, event }] : [];
        });
        cursor = await this.persistBlock(cursor, block, decoded, observedHead, finalizedHead);
        processedBlocks += 1;
        persistedEvents += decoded.length;
      }
    } else {
      cursor = await this.database.evmObserverCursor.update({
        where: { networkId: this.config.networkId },
        data: { observedHead, finalizedHead },
      });
    }

    return {
      observedHead,
      finalizedHead,
      processedBlocks,
      persistedEvents,
      orphanedBlocks: reorg.orphanedBlocks,
      nextBlock: cursor.nextBlock,
    };
  }

  private async loadCursor(): Promise<EvmObserverCursorRow> {
    const existing = await this.database.evmObserverCursor.findUnique({
      where: { networkId: this.config.networkId },
    });
    if (existing) {
      const mismatch = existing.chainId !== this.config.chainId
        || normalizeHex(existing.registryAddress) !== normalizeHex(this.config.registryAddress)
        || normalizeHex(existing.registryId) !== normalizeHex(this.config.registryId)
        || existing.confirmations !== this.config.confirmations
        || existing.startBlock !== this.config.startBlock;
      if (mismatch) fail("EVM_CURSOR_CONFIG_MISMATCH", "configuração diverge do cursor persistido");
      return existing;
    }
    return this.database.evmObserverCursor.create({
      data: {
        networkId: this.config.networkId,
        networkName: this.config.networkName,
        chainId: this.config.chainId,
        registryAddress: normalizeHex(this.config.registryAddress),
        registryId: normalizeHex(this.config.registryId),
        confirmations: this.config.confirmations,
        startBlock: this.config.startBlock,
        nextBlock: this.config.startBlock,
      },
    });
  }

  private async reconcileTip(cursor: EvmObserverCursorRow): Promise<{
    cursor: EvmObserverCursorRow;
    orphanedBlocks: number;
  }> {
    if (cursor.lastProcessedBlock === null || !cursor.lastProcessedHash) {
      return { cursor, orphanedBlocks: 0 };
    }
    const currentTip = await this.readBlock(cursor.lastProcessedBlock);
    if (normalizeHex(currentTip.hash!) === normalizeHex(cursor.lastProcessedHash)) {
      return { cursor, orphanedBlocks: 0 };
    }

    let candidate = cursor.lastProcessedBlock - 1n;
    let common: EvmObservedBlockRow | null = null;
    while (candidate >= this.config.startBlock) {
      const stored = await this.findFinalizedBlock(candidate);
      if (!stored) fail("EVM_BLOCK_GAP", `cursor aponta para histórico ausente no bloco ${candidate}`);
      const remote = await this.readBlock(candidate);
      if (normalizeHex(stored.blockHash) === normalizeHex(remote.hash!)) {
        common = stored;
        break;
      }
      candidate -= 1n;
    }

    const commonNumber = common?.blockNumber ?? this.config.startBlock - 1n;
    const orphanedBlocks = Number(cursor.lastProcessedBlock - commonNumber);
    const now = this.clock();
    const updated = await this.database.$transaction(async (tx) => {
      await tx.evmObservedBlock.updateMany({
        where: {
          networkId: this.config.networkId,
          status: "FINALIZED",
          blockNumber: { gt: commonNumber },
        },
        data: { status: "ORPHANED", orphanedAt: now },
      });
      await tx.evmSourceEvent.updateMany({
        where: {
          networkId: this.config.networkId,
          status: "FINALIZED",
          blockNumber: { gt: commonNumber },
        },
        data: { status: "ORPHANED", orphanedAt: now },
      });
      return tx.evmObserverCursor.update({
        where: { networkId: this.config.networkId },
        data: {
          nextBlock: commonNumber + 1n,
          lastProcessedBlock: common?.blockNumber ?? null,
          lastProcessedHash: common?.blockHash ?? null,
        },
      });
    });
    return { cursor: updated, orphanedBlocks };
  }

  private async readBlock(blockNumber: bigint): Promise<EvmBlock> {
    let block: EvmBlock;
    try {
      block = await this.client.getBlock({ blockNumber });
    } catch (error) {
      fail("EVM_BLOCK_GAP", `não foi possível obter o bloco ${blockNumber}: ${String(error)}`);
    }
    if (block.number !== blockNumber || !block.hash || !BYTES32_PATTERN.test(block.hash)
      || !BYTES32_PATTERN.test(block.parentHash)) {
      fail("EVM_BLOCK_GAP", `RPC retornou posição incompleta para o bloco ${blockNumber}`);
    }
    return block;
  }

  private validateLogPosition(log: EvmLog, blockNumber: bigint, blockHash: Hex): void {
    const valid = normalizeHex(log.address) === normalizeHex(this.config.registryAddress)
      && log.blockNumber === blockNumber
      && log.blockHash !== null
      && normalizeHex(log.blockHash) === normalizeHex(blockHash)
      && log.transactionHash !== null
      && BYTES32_PATTERN.test(log.transactionHash)
      && Number.isSafeInteger(log.transactionIndex)
      && Number.isSafeInteger(log.logIndex)
      && log.transactionIndex! >= 0
      && log.logIndex! >= 0;
    if (!valid) fail("EVM_LOG_POSITION_INVALID", `log inválido no bloco ${blockNumber}`);
  }

  private async findFinalizedBlock(blockNumber: bigint): Promise<EvmObservedBlockRow | null> {
    return this.database.evmObservedBlock.findFirst({
      where: { networkId: this.config.networkId, blockNumber, status: "FINALIZED" },
      orderBy: { observedAt: "desc" },
    });
  }

  private async persistBlock(
    cursor: EvmObserverCursorRow,
    block: EvmBlock,
    decoded: readonly { log: EvmLog; event: DecodedEvmSourceEvent }[],
    observedHead: bigint,
    finalizedHead: bigint,
  ): Promise<EvmObserverCursorRow> {
    const blockNumber = block.number!;
    const blockHash = normalizeHex(block.hash!);
    const now = this.clock();
    return this.database.$transaction(async (tx) => {
      await tx.evmObservedBlock.upsert({
        where: {
          networkId_blockNumber_blockHash: {
            networkId: this.config.networkId,
            blockNumber,
            blockHash,
          },
        },
        create: {
          id: randomUUID(),
          networkId: this.config.networkId,
          blockNumber,
          blockHash,
          parentHash: normalizeHex(block.parentHash),
          status: "FINALIZED",
          observedAt: now,
        },
        update: { status: "FINALIZED", orphanedAt: null },
      });
      for (const { log, event } of decoded) {
        const transactionHash = normalizeHex(log.transactionHash!);
        await tx.evmSourceEvent.upsert({
          where: {
            networkId_blockHash_transactionHash_logIndex: {
              networkId: this.config.networkId,
              blockHash,
              transactionHash,
              logIndex: log.logIndex!,
            },
          },
          create: {
            id: randomUUID(),
            networkId: this.config.networkId,
            registryId: normalizeHex(this.config.registryId),
            blockNumber,
            blockHash,
            transactionHash,
            transactionIndex: log.transactionIndex!,
            logIndex: log.logIndex!,
            eventName: event.eventName,
            domainHash: event.domainHash ? normalizeHex(event.domainHash) : null,
            payload: jsonSafe(event.payload),
            status: "FINALIZED",
            observedAt: now,
          },
          update: { status: "FINALIZED", orphanedAt: null },
        });
      }
      return tx.evmObserverCursor.update({
        where: { networkId: this.config.networkId },
        data: {
          nextBlock: blockNumber + 1n,
          lastProcessedBlock: blockNumber,
          lastProcessedHash: blockHash,
          observedHead,
          finalizedHead,
        },
      });
    });
  }
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
