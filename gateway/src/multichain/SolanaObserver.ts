import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { hashNetworkId } from "./AttestationCodec.js";

const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,88}$/;
const DOMAIN_EVENT_DISCRIMINATOR = Buffer.from([251, 63, 5, 20, 116, 211, 59, 224]);

export interface SolanaObserverConfig {
  networkId: string;
  programId: string;
  commitment: "finalized";
  startSlot: bigint;
  pageSize: number;
  maxPagesPerPoll: number;
}

export interface SolanaSignatureInfo {
  signature: string;
  slot: bigint;
  err: unknown | null;
  blockTime: number | null;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
}

export interface SolanaTransaction {
  slot: bigint;
  blockTime: number | null;
  meta: { err: unknown | null; logMessages: readonly string[] | null } | null;
}

export interface SolanaObserverClient {
  getSlot(input: { commitment: "finalized" }): Promise<bigint>;
  getSignaturesForAddress(input: {
    address: string;
    before?: string;
    until?: string;
    limit: number;
    commitment: "finalized";
  }): Promise<readonly SolanaSignatureInfo[]>;
  getSignatureStatus(input: {
    signature: string;
    searchTransactionHistory: true;
  }): Promise<{ confirmationStatus: "processed" | "confirmed" | "finalized" | null } | null>;
  getTransaction(input: {
    signature: string;
    commitment: "finalized";
    maxSupportedTransactionVersion: 0;
  }): Promise<SolanaTransaction | null>;
}

export interface DecodedSolanaSourceEvent {
  instructionIndex: number;
  logIndex: number;
  eventName: string;
  domainHash?: Hex;
  payload: unknown;
}

export interface SolanaEventDecoder {
  decode(logMessages: readonly string[], programId: string): readonly DecodedSolanaSourceEvent[];
}

export interface SolanaEventValidator {
  validate(event: DecodedSolanaSourceEvent, context: { signature: string; slot: bigint }): Promise<void>;
}

interface CursorRow {
  networkId: string;
  programId: string;
  commitment: string;
  startSlot: bigint;
  lastSlot: bigint | null;
  lastSignature: string | null;
  observedSlot: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Delegate<Row> {
  findUnique(args: any): Promise<Row | null>;
  create(args: any): Promise<Row>;
  update(args: any): Promise<Row>;
}

interface SolanaObserverTransaction {
  solanaObserverCursor: Delegate<CursorRow>;
  solanaObservedTransaction: { upsert(args: any): Promise<unknown> };
  solanaSourceEvent: { upsert(args: any): Promise<unknown> };
}

interface SolanaObserverDatabase extends SolanaObserverTransaction {
  $transaction<T>(operation: (tx: SolanaObserverTransaction) => Promise<T>): Promise<T>;
}

export type SolanaObserverErrorCode =
  | "INVALID_SOLANA_OBSERVER_CONFIG"
  | "SOLANA_CURSOR_CONFIG_MISMATCH"
  | "SOLANA_CURSOR_GAP"
  | "SOLANA_BACKFILL_LIMIT"
  | "SOLANA_TRANSACTION_MISSING";

export class SolanaObserverError extends Error {
  constructor(readonly code: SolanaObserverErrorCode, message: string) {
    super(message);
    this.name = "SolanaObserverError";
  }
}

export interface SolanaPollResult {
  observedSlot: bigint;
  scannedSignatures: number;
  persistedTransactions: number;
  persistedEvents: number;
  lastSlot: bigint | null;
  lastSignature: string | null;
}

function fail(code: SolanaObserverErrorCode, message: string): never {
  throw new SolanaObserverError(code, message);
}

function validateConfig(config: SolanaObserverConfig): void {
  try {
    hashNetworkId(config.networkId);
  } catch {
    fail("INVALID_SOLANA_OBSERVER_CONFIG", "networkId Solana inválido");
  }
  if (!BASE58_PATTERN.test(config.programId)) {
    fail("INVALID_SOLANA_OBSERVER_CONFIG", "programId Solana inválido");
  }
  if (config.commitment !== "finalized") {
    fail("INVALID_SOLANA_OBSERVER_CONFIG", "observer Solana exige commitment finalized");
  }
  if (config.startSlot < 0n) fail("INVALID_SOLANA_OBSERVER_CONFIG", "startSlot inválido");
  if (!Number.isSafeInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 1_000) {
    fail("INVALID_SOLANA_OBSERVER_CONFIG", "pageSize deve estar entre 1 e 1000");
  }
  if (!Number.isSafeInteger(config.maxPagesPerPoll)
    || config.maxPagesPerPoll < 1
    || config.maxPagesPerPoll > 100) {
    fail("INVALID_SOLANA_OBSERVER_CONFIG", "maxPagesPerPoll deve estar entre 1 e 100");
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

function bytes32(buffer: Buffer, offset: number): Hex {
  return `0x${buffer.subarray(offset, offset + 32).toString("hex")}` as Hex;
}

function u64(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

/** Decodes only the canonical Anchor DomainStateChanged event. */
export class DomainStateChangedDecoder implements SolanaEventDecoder {
  decode(logMessages: readonly string[], programId: string): readonly DecodedSolanaSourceEvent[] {
    const events: DecodedSolanaSourceEvent[] = [];
    let instructionIndex = -1;
    for (let logIndex = 0; logIndex < logMessages.length; logIndex += 1) {
      const message = logMessages[logIndex];
      if (message === `Program ${programId} invoke [1]`) instructionIndex += 1;
      if (!message.startsWith("Program data: ")) continue;
      let data: Buffer;
      try {
        data = Buffer.from(message.slice("Program data: ".length), "base64");
      } catch {
        continue;
      }
      if (instructionIndex < 0 || data.length !== 198
        || !data.subarray(0, 8).equals(DOMAIN_EVENT_DISCRIMINATOR)) continue;
      events.push({
        instructionIndex,
        logIndex,
        eventName: "DomainStateChanged",
        domainHash: bytes32(data, 10),
        payload: {
          action: data[8],
          recordKind: data[9],
          domainHash: bytes32(data, 10),
          originFamily: data[42],
          originNetworkHash: bytes32(data, 43),
          originRegistry: bytes32(data, 75),
          globalDomainEpoch: u64(data, 107),
          originSequence: u64(data, 115),
          status: data[123],
          originTransaction: bytes32(data, 124),
          schemaVersion: data.readUInt16LE(156),
          actor: bytes32(data, 158),
          timestamp: data.readBigInt64LE(190),
        },
      });
    }
    return events;
  }
}

export class SolanaObserver {
  constructor(
    private readonly database: SolanaObserverDatabase,
    private readonly client: SolanaObserverClient,
    private readonly decoder: SolanaEventDecoder,
    private readonly config: SolanaObserverConfig,
    private readonly clock: () => Date = () => new Date(),
    private readonly validator?: SolanaEventValidator,
  ) {
    validateConfig(config);
  }

  async poll(): Promise<SolanaPollResult> {
    const cursor = await this.loadCursor();
    if (cursor.lastSignature) {
      const status = await this.client.getSignatureStatus({
        signature: cursor.lastSignature,
        searchTransactionHistory: true,
      });
      if (status?.confirmationStatus !== "finalized") {
        fail("SOLANA_CURSOR_GAP", "assinatura âncora do cursor não está finalizada");
      }
    }
    const observedSlot = await this.client.getSlot({ commitment: "finalized" });
    const signatures = await this.collectSignatures(cursor.lastSignature);
    const successful = signatures.filter((item) => item.err === null && item.slot >= this.config.startSlot);
    const transactions = await Promise.all(successful.map(async (info) => {
      const transaction = await this.client.getTransaction({
        signature: info.signature,
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction || transaction.slot !== info.slot || transaction.meta?.err !== null) {
        fail("SOLANA_TRANSACTION_MISSING", `transação finalizada indisponível: ${info.signature}`);
      }
      const events = this.decoder.decode(transaction.meta.logMessages ?? [], this.config.programId);
      if (this.validator) {
        for (const event of events) await this.validator.validate(event, { signature: info.signature, slot: info.slot });
      }
      return { info, transaction, events };
    }));
    const newest = signatures[0] ?? null;
    const now = this.clock();
    const updated = await this.database.$transaction(async (tx) => {
      for (const item of transactions.sort((a, b) => a.info.slot < b.info.slot ? -1 : a.info.slot > b.info.slot ? 1 : 0)) {
        await tx.solanaObservedTransaction.upsert({
          where: { networkId_signature: { networkId: this.config.networkId, signature: item.info.signature } },
          create: {
            id: randomUUID(),
            networkId: this.config.networkId,
            slot: item.info.slot,
            signature: item.info.signature,
            blockTime: item.transaction.blockTime === null
              ? null
              : new Date(item.transaction.blockTime * 1_000),
            observedAt: now,
          },
          update: {},
        });
        for (const event of item.events) {
          await tx.solanaSourceEvent.upsert({
            where: {
              networkId_signature_instructionIndex_logIndex: {
                networkId: this.config.networkId,
                signature: item.info.signature,
                instructionIndex: event.instructionIndex,
                logIndex: event.logIndex,
              },
            },
            create: {
              id: randomUUID(),
              networkId: this.config.networkId,
              programId: this.config.programId,
              slot: item.info.slot,
              signature: item.info.signature,
              instructionIndex: event.instructionIndex,
              logIndex: event.logIndex,
              eventName: event.eventName,
              domainHash: event.domainHash?.toLowerCase() ?? null,
              payload: jsonSafe(event.payload),
              observedAt: now,
            },
            update: {},
          });
        }
      }
      return tx.solanaObserverCursor.update({
        where: { networkId: this.config.networkId },
        data: {
          lastSlot: newest?.slot ?? cursor.lastSlot,
          lastSignature: newest?.signature ?? cursor.lastSignature,
          observedSlot,
        },
      });
    });
    return {
      observedSlot,
      scannedSignatures: signatures.length,
      persistedTransactions: transactions.length,
      persistedEvents: transactions.reduce((count, item) => count + item.events.length, 0),
      lastSlot: updated.lastSlot,
      lastSignature: updated.lastSignature,
    };
  }

  private async loadCursor(): Promise<CursorRow> {
    const existing = await this.database.solanaObserverCursor.findUnique({
      where: { networkId: this.config.networkId },
    });
    if (existing) {
      if (existing.programId !== this.config.programId
        || existing.commitment !== this.config.commitment
        || existing.startSlot !== this.config.startSlot) {
        fail("SOLANA_CURSOR_CONFIG_MISMATCH", "configuração diverge do cursor Solana persistido");
      }
      return existing;
    }
    return this.database.solanaObserverCursor.create({
      data: {
        networkId: this.config.networkId,
        programId: this.config.programId,
        commitment: this.config.commitment,
        startSlot: this.config.startSlot,
      },
    });
  }

  private async collectSignatures(until: string | null): Promise<SolanaSignatureInfo[]> {
    const collected = new Map<string, SolanaSignatureInfo>();
    let before: string | undefined;
    let completed = false;
    for (let pageNumber = 0; pageNumber < this.config.maxPagesPerPoll; pageNumber += 1) {
      const page = await this.client.getSignaturesForAddress({
        address: this.config.programId,
        before,
        ...(until ? { until } : {}),
        limit: this.config.pageSize,
        commitment: "finalized",
      });
      for (const info of page) {
        if (!BASE58_PATTERN.test(info.signature)) {
          fail("SOLANA_CURSOR_GAP", "RPC retornou assinatura Solana inválida");
        }
        if (info.confirmationStatus !== "finalized") {
          fail("SOLANA_CURSOR_GAP", `assinatura não finalizada retornada: ${info.signature}`);
        }
        if (info.slot >= this.config.startSlot) collected.set(info.signature, info);
      }
      const oldest = page.at(-1);
      if (page.length < this.config.pageSize || !oldest || oldest.slot < this.config.startSlot) {
        completed = true;
        break;
      }
      before = oldest.signature;
    }
    if (!completed) fail("SOLANA_BACKFILL_LIMIT", "backfill excedeu maxPagesPerPoll sem fechar o gap");
    return [...collected.values()];
  }
}
