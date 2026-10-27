import { Connection, PublicKey } from "@solana/web3.js";
import { startSerialPoller, type SerialPoller } from "../runtime/serialPoller.js";
import { decodeSolanaDomainRecord } from "./FinalizedStateReader.js";
import {
  DomainStateChangedDecoder,
  SolanaObserver,
  type DecodedSolanaSourceEvent,
  type SolanaEventValidator,
  type SolanaObserverClient,
  type SolanaObserverConfig,
  type SolanaPollResult,
  type SolanaSignatureInfo,
  type SolanaTransaction,
} from "./SolanaObserver.js";

export interface SolanaIndexerAccountClient {
  getAccountInfo(input: { address: string; commitment: "finalized"; minContextSlot: bigint }): Promise<null | {
    owner: string;
    contextSlot: bigint;
    data: Uint8Array;
  }>;
}

function slotNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("slot Solana fora do intervalo seguro");
  return result;
}

/** Production RPC adapter shared by the scanner and finalized account validator. */
export class Web3SolanaIndexerClient implements SolanaObserverClient, SolanaIndexerAccountClient {
  private readonly connection: Connection;
  constructor(rpcUrl: string, private readonly expectedGenesisHash?: string) { this.connection = new Connection(rpcUrl, "finalized"); }
  async getSlot() {
    if (this.expectedGenesisHash && await this.connection.getGenesisHash() !== this.expectedGenesisHash) throw new Error("Solana indexer genesis mismatch");
    return BigInt(await this.connection.getSlot("finalized"));
  }
  async getSignaturesForAddress(input: { address: string; before?: string; until?: string; limit: number; commitment: "finalized" }): Promise<readonly SolanaSignatureInfo[]> {
    const rows = await this.connection.getSignaturesForAddress(new PublicKey(input.address), {
      before: input.before, until: input.until, limit: input.limit,
    }, input.commitment);
    return rows.map((row) => ({
      signature: row.signature, slot: BigInt(row.slot), err: row.err,
      blockTime: row.blockTime ?? null, confirmationStatus: row.confirmationStatus ?? null,
    }));
  }
  async getSignatureStatus(input: { signature: string; searchTransactionHistory: true }) {
    const result = await this.connection.getSignatureStatuses([input.signature], { searchTransactionHistory: input.searchTransactionHistory });
    const status = result.value[0];
    return status ? { confirmationStatus: status.confirmationStatus ?? null } : null;
  }
  async getTransaction(input: { signature: string; commitment: "finalized"; maxSupportedTransactionVersion: 0 }): Promise<SolanaTransaction | null> {
    const result = await this.connection.getTransaction(input.signature, {
      commitment: input.commitment, maxSupportedTransactionVersion: input.maxSupportedTransactionVersion,
    });
    return result ? { slot: BigInt(result.slot), blockTime: result.blockTime ?? null, meta: result.meta ? { err: result.meta.err, logMessages: result.meta.logMessages ?? null } : null } : null;
  }
  async getAccountInfo(input: { address: string; commitment: "finalized"; minContextSlot: bigint }) {
    const result = await this.connection.getAccountInfoAndContext(new PublicKey(input.address), {
      commitment: input.commitment, minContextSlot: slotNumber(input.minContextSlot),
    });
    return result.value ? { owner: result.value.owner.toBase58(), contextSlot: BigInt(result.context.slot), data: result.value.data } : null;
  }
}

export class SolanaRegistryIndexerError extends Error {
  constructor(readonly code: "INDEXED_EVENT_INVALID" | "INDEXED_ACCOUNT_MISSING" | "INDEXED_ACCOUNT_INVALID", message: string) {
    super(message);
    this.name = "SolanaRegistryIndexerError";
  }
}

function eventU64(payload: unknown, field: "globalDomainEpoch" | "originSequence"): bigint {
  const value = (payload as any)?.[field];
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new SolanaRegistryIndexerError("INDEXED_EVENT_INVALID", `${field} ausente no evento`);
}

/** Validates every Registry event against its finalized PDA account before persistence. */
export class SolanaRegistryAccountValidator implements SolanaEventValidator {
  private readonly programId: PublicKey;
  constructor(private readonly client: SolanaIndexerAccountClient, programId: string) {
    this.programId = new PublicKey(programId);
  }

  async validate(event: DecodedSolanaSourceEvent, context: { signature: string; slot: bigint }): Promise<void> {
    if (event.eventName !== "DomainStateChanged" || !event.domainHash
      || (event.payload as any)?.schemaVersion !== 2) {
      throw new SolanaRegistryIndexerError("INDEXED_EVENT_INVALID", "evento Registry ou schema inválido");
    }
    const domainHash = Buffer.from(event.domainHash.slice(2), "hex");
    const [address] = PublicKey.findProgramAddressSync([Buffer.from("domain"), domainHash], this.programId);
    const account = await this.client.getAccountInfo({
      address: address.toBase58(), commitment: "finalized", minContextSlot: context.slot,
    });
    if (!account) throw new SolanaRegistryIndexerError("INDEXED_ACCOUNT_MISSING", "DomainRecord finalizado não encontrado");
    if (account.owner !== this.programId.toBase58() || account.contextSlot < context.slot) {
      throw new SolanaRegistryIndexerError("INDEXED_ACCOUNT_INVALID", "owner ou slot do DomainRecord diverge");
    }
    let state;
    try { state = decodeSolanaDomainRecord(account.data); }
    catch { throw new SolanaRegistryIndexerError("INDEXED_ACCOUNT_INVALID", "discriminator, schema ou layout do DomainRecord inválido"); }
    if (state.domainHash.toLowerCase() !== event.domainHash.toLowerCase()) {
      throw new SolanaRegistryIndexerError("INDEXED_ACCOUNT_INVALID", "PDA não corresponde ao domainHash do evento");
    }
    const eventEpoch = eventU64(event.payload, "globalDomainEpoch");
    const eventSequence = eventU64(event.payload, "originSequence");
    if (state.globalDomainEpoch < eventEpoch
      || (state.globalDomainEpoch === eventEpoch && state.originSequence < eventSequence)) {
      throw new SolanaRegistryIndexerError("INDEXED_ACCOUNT_INVALID", "DomainRecord regrediu em relação ao evento");
    }
  }
}

/** Registry indexer: finalized scanner/backfill + deterministic decoder + account validation. */
export class SolanaRegistryIndexer {
  private readonly observer: SolanaObserver;
  private poller?: SerialPoller;
  constructor(
    database: any,
    observerClient: SolanaObserverClient,
    accountClient: SolanaIndexerAccountClient,
    config: SolanaObserverConfig,
    clock: () => Date = () => new Date(),
  ) {
    this.observer = new SolanaObserver(
      database, observerClient, new DomainStateChangedDecoder(), config, clock,
      new SolanaRegistryAccountValidator(accountClient, config.programId),
    );
  }

  runOnce(): Promise<SolanaPollResult> {
    return this.observer.poll();
  }

  start(intervalMs: number, onError: (error: unknown) => void, onResult?: (result: SolanaPollResult) => void): void {
    if (this.poller || !Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error("intervalo do indexador inválido");
    this.poller = startSerialPoller(async () => { onResult?.(await this.runOnce()); }, intervalMs, onError);
  }

  async stop(): Promise<void> {
    const poller = this.poller;
    await poller?.stop();
    this.poller = undefined;
  }
}
